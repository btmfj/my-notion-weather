const puppeteer = require('puppeteer');
const cloudinary = require('cloudinary').v2;
const { Client } = require('@notionhq/client');

// 各種設定
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
    // 日本語環境を指定してブラウザ起動
    browser = await puppeteer.launch({ 
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--lang=ja,en-US,en' // 言語設定を日本語優先に
      ],
      headless: "new"
    });
    
    const page = await browser.newPage();
    
    // ブラウザのヘッダー情報でも日本語を要求
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ja-JP'
    });

    const targetUrl = 'https://weather.yahoo.co.jp/weather/jp/41/8510/41425.html';
    
    console.log("天気予報ページへアクセス中...");
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.setViewport({ width: 1000, height: 2000 });

    const ts = new Date().getTime();
    const newUrls = [];

    const targets = [
      { id: '#yjw_pinpoint', name: 'weather_today', clip: { x: 0, y: 0, width: 674,  height:  320 } },
      { id: '#yjw_pinpoint_tomorrow', name: 'weather_tomorrow' },
      { id: '#yjw_week', name: 'weather_week' }
    ];

    // --- 1. 撮影 & アップロード ---
    for (const target of targets) {
      const element = await page.$(target.id);
      if (element) {
        const fileName = `${target.name}.png`;
        if (target.clip) {
          await element.screenshot({ path: fileName, clip: target.clip });
        } else {
          await element.screenshot({ path: fileName });
        }

        const res = await cloudinary.uploader.upload(fileName, {
          public_id: `${target.name}_${ts}`,
          overwrite: true,
          invalidate: true
        });
        newUrls.push(res.secure_url);
        console.log(`${target.name} をアップロードしました`);
      }
    }

    // --- 2. Notionの画像ブロックを更新 ---
    console.log("Notionの画像を更新中...");
    const response = await notion.blocks.children.list({ block_id: pageId });
    const imageBlocks = response.results.filter(block => block.type === 'image');

    for (let i = 0; i < Math.min(imageBlocks.length, newUrls.length); i++) {
      await notion.blocks.update({
        block_id: imageBlocks[i].id,
        image: {
          external: { url: newUrls[i] }
        }
      });
      console.log(`${i + 1} 枚目の画像を更新しました！`);
    }

    console.log("すべての工程が完了しました！");

  } catch (error) {
    console.error("エラーが発生しました:", error);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
