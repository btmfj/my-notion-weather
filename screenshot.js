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
    // 画面幅を少し広めに設定
    await page.setViewport({ width: 1200, height: 3000 });

    // 1時間予報のページ。ここから今日・明日・10日間（下部）を取得します。
    const targetUrl = 'https://tenki.jp/forecast/9/44/8510/41425/1hour.html';
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    const ts = new Date().getTime();
    const newUrls = [];

    // --- セレクタを修正 ---
    const targets = [
      { selector: '#forecast-point-1h-today', name: 'weather_today', width: 800, height: 450 },
      { selector: '#forecast-point-1h-tomorrow', name: 'weather_tomorrow', width: 800, height: 450 },
      { selector: '.forecast-10days-divided-list', name: 'weather_week', width: 800, height: 600 }
    ];

    for (const target of targets) {
      // 要素が見つかるまで待機（最大15秒に短縮してエラーを早く察知）
      try {
        await page.waitForSelector(target.selector, { timeout: 15000 });
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
            console.log(`${target.name} アップロード完了`);
          }
        }
      } catch (e) {
        console.warn(`警告: セレクタ ${target.selector} が見つかりませんでした。スキップします。`);
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
