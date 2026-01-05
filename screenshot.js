const puppeteer = require('puppeteer');
const cloudinary = require('cloudinary').v2;
const { Client } = require('@notionhq/client');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const pageId = process.env.NOTION_PAGE_ID;

async function getAllImageBlocks(blockId) {
  let results = [];
  const response = await notion.blocks.children.list({ block_id: blockId });
  for (const block of response.results) {
    if (block.type === 'image') {
      results.push(block);
    } else if (block.has_children) {
      const childImages = await getAllImageBlocks(block.id);
      results = results.concat(childImages);
    }
  }
  return results;
}

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({ 
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=ja,en-US,en'],
      headless: "new"
    });
    
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja-JP' });
    // tenki.jpは表が横に長いため、少し広めのビューポートに設定
    await page.setViewport({ width: 1400, height: 3000 });

    // 10日間天気まで含まれるURLへ移動
    const targetUrl = 'https://tenki.jp/forecast/9/44/8510/41425/10days.html';
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    const ts = new Date().getTime();
    const newUrls = [];

    // --- tenki.jp 用のターゲット設定 ---
    // 今日・明日は 1hour-entry クラス、10日間は ten-days-section 内の表を取得
    const targets = [
      { selector: '#forecast-point-1h-today', name: 'weather_today', width: 800, height: 450 },
      { selector: '#forecast-point-1h-tomorrow', name: 'weather_tomorrow', width: 800, height: 450 },
      { selector: '.ten-days-weather', name: 'weather_week', width: 800, height: 560 }
    ];

    for (const target of targets) {
      // 要素が現れるまで待機
      await page.waitForSelector(target.selector);
      const element = await page.$(target.selector);
      
      if (element) {
        const fileName = `${target.name}.png`;
        const rect = await element.boundingBox();
        
        if (rect) {
          await page.screenshot({
            path: fileName,
            clip: {
              x: rect.x,
              y: rect.y,
              width: target.width || rect.width,
              height: target.height || rect.height
            }
          });

          const res = await cloudinary.uploader.upload(fileName, {
            public_id: `${target.name}_${ts}`,
            overwrite: true,
            invalidate: true
          });
          newUrls.push(res.secure_url);
          console.log(`${target.name} アップロード完了: ${res.secure_url}`);
        }
      }
    }

    console.log("Notionの画像ブロックを探索中...");
    const allImageBlocks = await getAllImageBlocks(pageId);
    
    for (let i = 0; i < Math.min(allImageBlocks.length, newUrls.length); i++) {
      const cacheBustedUrl = `${newUrls[i]}?t=${ts}`;
      await notion.blocks.update({
        block_id: allImageBlocks[i].id,
        image: { external: { url: cacheBustedUrl } }
      });
      console.log(`${i + 1} 枚目のNotionブロックを更新しました。`);
    }

    console.log("すべての工程が正常に完了しました！");

  } catch (error) {
    console.error("エラーが発生しました:", error);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
