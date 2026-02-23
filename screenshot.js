const puppeteer = require('puppeteer');
const cloudinary = require('cloudinary').v2;
const { Client } = require('@notionhq/client');

// --- 安全装置（10分に延長） ---
setTimeout(() => {
  console.error("10分経過したため、安全のために強制終了します。");
  process.exit(1);
}, 600000); 

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const pageId = process.env.NOTION_PAGE_ID;
const DATABASE_ID = '2e3131d5c28380efb35fca292b17b57f'; 

async function getAllImageBlocks(blockId) {
  const response = await notion.blocks.children.list({ block_id: blockId });
  return response.results.filter(block => block.type === 'image');
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

    console.log(`現在の日本時間: ${jstHour}時`);

    const newUrls = [];

    // --- ステップ1: スクリーンショット撮影 ---
    console.log("tenki.jp から予報を取得中...");
    await page.goto('https://tenki.jp/forecast/9/44/8510/41425/1hour.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    
    const dailyTargets = [
      { selector: '#forecast-point-1h-today', name: 'today' },
      { selector: '#forecast-point-1h-tomorrow', name: 'tomorrow' }
    ];

    for (const target of dailyTargets) {
      await page.waitForSelector(target.selector, { timeout: 20000 });
      const element = await page.$(target.selector);
      const rect = await element.boundingBox();
      await page.screenshot({ path: `${target.name}.png`, clip: rect });
      const res = await cloudinary.uploader.upload(`${target.name}.png`, { public_id: `${target.name}_${ts}`, overwrite: true });
      newUrls.push(res.secure_url);
      console.log(`${target.name} の画像をCloudinaryに保存しました。`);
    }

    // --- ステップ2: ダッシュボード（既存ページ）の更新【常に実行】 ---
    console.log("ダッシュボードの画像ブロックを更新します...");
    const imageBlocks = await getAllImageBlocks(pageId);
    console.log(`更新対象の画像ブロック数: ${imageBlocks.length}`);

    for (let i = 0; i < Math.min(imageBlocks.length, newUrls.length); i++) {
      await notion.blocks.update({
        block_id: imageBlocks[i].id,
        image: { external: { url: `${newUrls[i]}?t=${ts}` } }
      });
    }
    console.log("ダッシュボードの更新が完了しました。");

    // --- ステップ3: データベース蓄積（新規ページ作成）【0時台のみ】 ---
    if (jstHour === 0) {
      console.log("0時台のため、データベースへ本日の記録を作成します...");
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
      console.log("データベースへの蓄積が完了しました。");
    }

  } catch (error) {
    console.error("エラー詳細:", error);
  } finally {
    if (browser) await browser.close();
    console.log("全工程が終了しました。");
    process.exit(0);
  }
})();
