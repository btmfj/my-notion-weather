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
    // 24時までの横幅を確保するためビューポートを十分に広く設定
    await page.setViewport({ width: 1600, height: 4000 });

    const targetUrl = 'https://tenki.jp/forecast/9/44/8510/41425/1hour.html';
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    const ts = new Date().getTime();
    const newUrls = [];

    // --- 修正されたターゲット設定 ---
    const targets = [
      { selector: '#forecast-point-1h-today', name: 'weather_today' },
      { selector: '#forecast-point-1h-tomorrow', name: 'weather_tomorrow' },
      // 10日間天気：より上位のセクションIDを指定
      { selector: '#forecast-point-10days', name: 'weather_week' }
    ];

    for (const target of targets) {
      try {
        await page.waitForSelector(target.selector, { timeout: 15000 });
        
        // 要素までスクロールして確実に描画させる
        const element = await page.$(target.selector);
        await element.scrollIntoView();

        if (element) {
          const fileName = `${target.name}.png`;
          const rect = await element.boundingBox();
          
          if (rect) {
            // 固定値を使わず、要素の実際のサイズ(rect)で丸ごと撮影
            await page.screenshot({
              path: fileName,
              clip: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
              }
            });

            const res = await cloudinary.uploader.upload(fileName, {
              public_id: `${target.name}_${ts}`,
              overwrite: true,
              invalidate: true
            });
            newUrls.push(res.secure_url);
            console.log(`${target.name} アップロード完了 (サイズ: ${Math.round(rect.width)}x${Math.round(rect.height)})`);
          }
        }
      } catch (e) {
        console.warn(`警告: ${target.selector} の取得に失敗しました。`);
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
