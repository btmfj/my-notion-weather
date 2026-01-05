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

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({ 
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=ja,en-US,en'],
      headless: "new"
    });
    
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja-JP' });
    await page.setViewport({ width: 1200, height: 2000 });

    const targetUrl = 'https://weather.yahoo.co.jp/weather/jp/41/8510/41425.html';
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    const ts = new Date().getTime();
    const newUrls = [];

    // --- ターゲット設定 ---
    const targets = [
      { id: '#yjw_pinpoint', name: 'weather_today', width: 674, height: 320 },
      { id: '#yjw_pinpoint_tomorrow', name: 'weather_tomorrow', width: 674, height: 279 },
      { id: '#yjw_week', name: 'weather_week', width: 674, height: 263 }
    ];

    for (const target of targets) {
      const element = await page.$(target.id);
      if (element) {
        const fileName = `${target.name}.png`;
        const rect = await element.boundingBox();
        
        if (rect) {
          await page.screenshot({
            path: fileName,
            clip: {
              x: rect.x,
              y: rect.y,
              width: target.width,
              height: target.height
            }
          });

          // Cloudinaryへアップロード
          const res = await cloudinary.uploader.upload(fileName, {
            public_id: `${target.name}_${ts}`,
            overwrite: true,
            invalidate: true
          });
          newUrls.push(res.secure_url);
          console.log(`${target.name} をアップロード完了: ${res.secure_url}`);
        }
      }
    }

    console.log("Notionの画像を更新中...");
    const response = await notion.blocks.children.list({ block_id: pageId });
    // ページ内の画像ブロックのみを抽出
    const imageBlocks = response.results.filter(block => block.type === 'image');

    if (imageBlocks.length === 0) {
      console.log("警告: Notionページ内に画像ブロックが見つかりませんでした。");
    }

    for (let i = 0; i < Math.min(imageBlocks.length, newUrls.length); i++) {
      // キャッシュ回避のためURL末尾にタイムスタンプを付与
      const cacheBustedUrl = `${newUrls[i]}?t=${ts}`;
      
      await notion.blocks.update({
        block_id: imageBlocks[i].id,
        image: { 
          external: { 
            url: cacheBustedUrl 
          } 
        }
      });
      console.log(`${i + 1} 枚目のNotionブロックを更新しました。`);
      console.log(`URL: ${cacheBustedUrl}`);
    }

    console.log("すべての工程が正常に完了しました！");

  } catch (error) {
    console.error("エラーが発生しました:", error);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
