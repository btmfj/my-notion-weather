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

// --- 特定したブロックIDをセット ---
const BLOCK_ID_TODAY = '2df131d5c2838067982cdd9b17fc2344'; 
const BLOCK_ID_TOMORROW = '2df131d5c283803db084d8b59909041c'; 
const BLOCK_ID_WEEK = '2df131d5c28380368646e647279b9e01'; // 10日間天気用
const DATABASE_ID = '2e3131d5c28380efb35fca292b17b57f'; 

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
    
    // 日本時間の判定
    const jstFormatter = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });
    const parts = jstFormatter.formatToParts(now);
    const jstDate = `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}`;
    const jstHour = parseInt(parts.find(p => p.type === 'hour').value);

    console.log(`現在の日本時間: ${jstHour}時`);
    const newUrls = [];

    // --- ステップ1: 今日・明日の予報 (1時間予報ページ) ---
    console.log("今日・明日の予報を取得中...");
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

    // --- ステップ2: 10日間予報 (通常予報ページ) ---
    console.log("10日間予報を取得中...");
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

    // --- ステップ3: Notionダッシュボードの更新 ---
    console.log("Notionブロックを更新します...");
    const updateTasks = [
      { id: BLOCK_ID_TODAY, url: newUrls[0] },
      { id: BLOCK_ID_TOMORROW, url: newUrls[1] },
      { id: BLOCK_ID_WEEK, url: newUrls[2] }
    ];

    for (const task of updateTasks) {
      if (task.url) {
        await notion.blocks.update({
          block_id: task.id,
          image: { type: 'external', external: { url: `${task.url}?t=${ts}` } }
        });
      }
    }
    console.log("ダッシュボードの全画像ブロックを更新しました。");

    // --- ステップ4: データベース蓄積 (0時台のみ) ---
    if (jstHour === 0) {
      console.log("0時台のため、データベースへの蓄積記録を作成します...");
      await notion.pages.create({
        parent: { database_id: DATABASE_ID },
        properties: {
          "タイトル": { title: [{ text: { content: `${jstDate} の天気記録` } }] },
          "日付": { date: { start: jstDate } }
        },
        children: [
          { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ text: { content: "☀️ 本日の天気予報" } }] } },
          { object: 'block', type: 'image', image: { type: 'external', external: { url: newUrls[0] } } }
        ]
      });
      console.log("データベースへの保存完了。");
    }

  } catch (error) {
    console.error("実行エラー:", error);
  } finally {
    if (browser) await browser.close();
    process.exit(0);
  }
})();
