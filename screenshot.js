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
    await page.setViewport({ width: 1400, height: 4000 });

    const targetUrl = 'https://tenki.jp/forecast/9/44/8510/41425/1hour.html';
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    const ts = new Date().getTime();
    const newUrls = [];

    // --- セレクタの最終調整 ---
    const targets = [
      { selector: '#forecast-point-1h-today', name: 'weather_today' },
      { selector: '#forecast-point-1h-tomorrow', name: 'weather_tomorrow' },
      // 10日間天気は、このクラス名で取得するのが最も確実です
      { selector: '.forecast-10days-divided-list', name: 'weather_week' }
    ];

    for (const target of targets) {
      try {
        // 確実に要素が出るまで待ち、少し余裕を持って待機（2秒）
        await page.waitForSelector(target.selector, { timeout: 20000 });
        const element = await page.$(target.selector);
        
        if (element) {
          // 要素までスクロール
          await element.scrollIntoView();
          // スクロール後の描画待ち
          await new Promise(resolve => setTimeout(resolve, 1000));

          const fileName = `${target.name}.png`;
          const rect = await element.boundingBox();
          
          if (rect) {
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
            console.log(`${target.name} アップロード完了 (${Math.round(rect.width)}x${Math.round(rect.height)})`);
          }
        }
      } catch (e) {
        console.warn(`警告: ${target.selector} の取得に失敗しました。詳細: ${e.message}`);
      }
    }

    console.log("Notionの画像ブロックを探索中...");
    const allImageBlocks = await getAllImageBlocks(pageId);
    console.log(`Notion上の画像ブロック数: ${allImageBlocks.length}`);

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
