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
    browser = await puppeteer.launch({ args: ['--no-sandbox'], headless: "new" });
    const page = await browser.newPage();
    await page.goto('https://weather.yahoo.co.jp/weather/jp/41/8510/41425.html', { waitUntil: 'networkidle2' });
    await page.setViewport({ width: 1000, height: 2000 });

    const ts = new Date().getTime();
    const targets = [
      { id: '#yjw_pinpoint', name: 'weather_today', clip: { x: 0, y: 0, width: 900, height: 650 } },
      { id: '#yjw_pinpoint_tomorrow', name: 'weather_tomorrow' },
      { id: '#yjw_week', name: 'weather_week' }
    ];

    const newUrls = [];

    for (const target of targets) {
      const element = await page.$(target.id);
      if (element) {
        const fileName = `${target.name}.png`;
        await (target.clip ? element.screenshot({ path: fileName, clip: target.clip }) : element.screenshot({ path: fileName }));

        const res = await cloudinary.uploader.upload(fileName, {
          public_id: `${target.name}_${ts}`, // 毎回名前を変えてキャッシュを殺す
          overwrite: true,
          invalidate: true
        });
        newUrls.push(res.secure_url);
      }
    }

    // --- Notionの書き換え処理 ---
    const response = await notion.blocks.children.list({ block_id: pageId });
    const imageBlocks = response.results.filter(block => block.type === 'image');

    for (let i = 0; i < Math.min(imageBlocks.length, newUrls.length); i++) {
      await notion.blocks.update({
        block_id: imageBlocks[i].id,
        image: { external: { url: newUrls[i] } }
      });
      console.log(`${i+1}枚目の画像を更新しました`);
    }

  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
