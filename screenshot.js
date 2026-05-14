const puppeteer = require('puppeteer');
const cloudinary = require('cloudinary').v2;
const { Client } = require('@notionhq/client');

// --- 安全装置（10分で強制終了） ---
setTimeout(() => { console.error("タイムアウト終了"); process.exit(1); }, 600000); 

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// --- 更新対象のユーザー設定 ---
const TARGET_USERS = [
  {
    name: "本人",
    blocks: [
      '2df131d5c2838067982cdd9b17fc2344', // 今日
      '2df131d5c283803db084d8b59909041c', // 明日
      '2df131d5c28380368646e647279b9e01'  // 週間
    ]
  },
  {
    name: "奥様",
    blocks: [
      '360131d5c28380fdb0faefffca5e749d', // 今日
      '360131d5c28380a5ad55f467f75759fb', // 明日
      '360131d5c28380d78041ec6493c98782'  // 週間
    ]
  }
];

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({ 
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      headless: "new"
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 3000, deviceScaleFactor: 2 });
    
    const now = new Date();
    const ts = now.getTime();
    
    console.log("天気情報の取得を開始します...");
    const newUrls = [];

    // --- ステップ1: 今日・明日の予報 ---
    await page.goto('https://tenki.jp/forecast/9/44/8510/41425/1hour.html', { waitUntil: 'domcontentloaded' });
    const dailyTargets = [{ s: '#forecast-point-1h-today', n: 'today' }, { s: '#forecast-point-1h-tomorrow', n: 'tomorrow' }];
    for (const t of dailyTargets) {
      await page.waitForSelector(t.s);
      const el = await page.$(t.s);
      const rect = await el.boundingBox();
      await page.screenshot({ path: `${t.n}.png`, clip: rect });
      const res = await cloudinary.uploader.upload(`${t.n}.png`, { public_id: `${t.n}_${ts}`, overwrite: true });
      newUrls.push(res.secure_url);
    }

    // --- ステップ2: 10日間予報 ---
    await page.goto('https://tenki.jp/forecast/9/44/8510/41425/', { waitUntil: 'domcontentloaded' });
    const weekRect = await page.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('h3, h2, .section-title'));
      const target = headers.find(h => h.textContent.includes('10日間天気'));
      const section = target ? target.closest('section') || target.parentElement : null;
      if (!section) return null;
      const { x, y, width, height } = section.getBoundingClientRect();
      return { x, y, width, height };
    });
    if (weekRect) {
      await page.screenshot({ path: 'week.png', clip: weekRect });
      const res = await cloudinary.uploader.upload('week.png', { public_id: `week_${ts}`, overwrite: true });
      newUrls.push(res.secure_url);
    }

    // --- ステップ3: 全ユーザーのNotion更新 ---
    for (const user of TARGET_USERS) {
      console.log(`${user.name}様のページを更新中...`);
      const updateTasks = [
        { id: user.blocks[0], url: newUrls[0] }, // 今日
        { id: user.blocks[1], url: newUrls[1] }, // 明日
        { id: user.blocks[2], url: newUrls[2] }  // 週間
      ];

      for (const task of updateTasks) {
        if (task.url && task.id) {
          try {
            await notion.blocks.update({
              block_id: task.id,
              image: { 
                external: { url: `${task.url}?t=${ts}` } 
              }
            });
          } catch (e) {
            console.error(`ブロック更新エラー (${user.name} - ID: ${task.id}):`, e.message);
          }
        }
      }
    }
    console.log("全ユーザーのダッシュボード更新が完了しました。");

  } catch (error) {
    console.error("実行エラー:", error);
  } finally {
    if (browser) await browser.close();
    process.exit(0);
  }
})();
