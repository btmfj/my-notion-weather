const puppeteer = require('puppeteer');
const cloudinary = require('cloudinary').v2;
const { Client } = require('@notionhq/client');

// --- 全体の強制終了タイマー (5分) ---
setTimeout(() => {
  console.error("実行時間が長すぎたため、強制終了します。");
  process.exit(1);
}, 300000); 

// --- 設定 ---
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const pageId = process.env.NOTION_PAGE_ID;
const DATABASE_ID = '2e3131d5c28380efb35fca292b17b57f'; 

// 更新用画像ブロックの取得（無限ループ対策のため再帰を簡略化）
async function getAllImageBlocks(blockId) {
  try {
    const response = await notion.blocks.children.list({ block_id: blockId });
    // 第1階層の画像ブロックのみを取得対象にする（安全のため）
    return response.results.filter(block => block.type === 'image');
  } catch (e) {
    console.error("ブロック取得エラー:", e);
    return [];
  }
}

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({ 
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      headless: "new"
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1400, height: 3000, deviceScaleFactor: 2 });

    const now = new Date();
    const ts = now.getTime();
    const jstDate = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Tokyo' }).format(now).replace(/\//g, '-');
    const jstHour = parseInt(new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', hour12: false, timeZone: 'Asia/Tokyo' }).format(now));

    const newUrls = [];

    // --- ステップ1: 今日・明日の予報 ---
    console.log("予報データを取得中...");
    // 待機条件を domcontentloaded にし、タイムアウトを30秒に短縮
    await page.goto('https://tenki.jp/forecast/9/44/8510/41425/1hour.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    const dailyTargets = [
      { selector: '#forecast-point-1h-today', name: 'weather_today' },
      { selector: '#forecast-point-1h-tomorrow', name: 'weather_tomorrow' }
    ];

    for (const target of dailyTargets) {
      await page.waitForSelector(target.selector, { timeout: 15000 });
      const element = await page.$(target.selector);
      const rect = await element.boundingBox();
      await page.screenshot({ path: `${target.name}.png`, clip: rect });
      const res = await cloudinary.uploader.upload(`${target.name}.png`, { public_id: `${target.name}_${ts}`, overwrite: true });
      newUrls.push(res.secure_url);
    }

    // --- ステップ2: 10日間予報 ---
    await page.goto('https://tenki.jp/forecast/9/44/8510/41425/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('h3, h2, .section-title', { timeout: 15000 });
    
    const rectWeek = await page.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('h3, h2, .section-title'));
      const targetHeader = headers.find(h => h.textContent.includes('10日間天気'));
      const section = targetHeader ? targetHeader.closest('section') || targetHeader.parentElement : null;
      if (!section) return null;
      const { x, y, width, height } = section.getBoundingClientRect();
      return { x, y, width, height };
    });

    if (rectWeek) {
      await page.screenshot({ path: `weather_week.png`, clip: rectWeek });
      const res = await cloudinary.uploader.upload(`weather_week.png`, { public_id: `weather_week_${ts}`, overwrite: true });
      newUrls.push(res.secure_url);
    }

    // --- ステップ3: 蓄積 (0時台) ---
    if (jstHour === 0) {
      console.log("レコード作成中...");
      await notion.pages.create({
        parent: { database_id: DATABASE_ID },
        properties: {
          "タイトル": { title: [{ text: { content: `${jstDate} の天気記録` } }] },
          "日付": { date: { start: jstDate } }
        },
        children: [{
          object: 'block', type: 'heading_2',
          heading_2: { rich_text: [{ text: { content: "☀️ 本日の天気予報" } }] }
        }, {
          object: 'block', type: 'image',
          image: { type: 'external', external: { url: newUrls[0] } }
        }]
      });
    }

    // --- ステップ4: ダッシュボード更新 ---
    console.log("ダッシュボード更新中...");
    const imageBlocks = await getAllImageBlocks(pageId);
    for (let i = 0; i < Math.min(imageBlocks.length, newUrls.length); i++) {
      await notion.blocks.update({
        block_id: imageBlocks[i].id,
        image: { external: { url: `${newUrls[i]}?t=${ts}` } }
      });
    }
    
    console.log("完了！");

  } catch (error) {
    console.error("エラー詳細:", error.message);
  } finally {
    if (browser) await browser.close();
    process.exit(0); // 確実に終了させる
  }
})();
