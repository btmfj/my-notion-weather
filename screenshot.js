const puppeteer = require('puppeteer');
const cloudinary = require('cloudinary').v2;
const { Client } = require('@notionhq/client');

// 各種設定（GitHub Secretsから読み込み）
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
    // ブラウザの起動
    browser = await puppeteer.launch({ 
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: "new"
    });
    const page = await browser.newPage();
    const targetUrl = 'https://weather.yahoo.co.jp/weather/jp/41/8510/41425.html';
    
    console.log("天気予報ページへアクセス中...");
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.setViewport({ width: 1000, height: 2000 });

    const ts = new Date().getTime();
    const newUrls = [];

    // 撮影ターゲットの設定
    const targets = [
      { id: '#yjw_pinpoint', name: 'weather_today', clip: { x: 0, y: 0, width: 900, height: 650 } },
      { id: '#yjw_pinpoint_tomorrow', name: 'weather_tomorrow' },
      { id: '#yjw_week', name: 'weather_week' }
    ];

    // --- 1. スクリーンショット撮影 & アップロード ---
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

    // --- 2. Notionの画像ブロックを自動更新 ---
    console.log("Notionのページをスキャンして画像を更新中...");
    
    // ページ内のブロック一覧を取得
    const response = await notion.blocks.children.list({ block_id: pageId });
    // 画像ブロックだけを抽出
    const imageBlocks = response.results.filter(block => block.type === 'image');

    console.log(`ページ内に ${imageBlocks.length} 個の画像ブロックを確認しました。`);

    for (let i = 0; i < Math.min(imageBlocks.length, newUrls.length); i++) {
      // Notion APIの更新用リクエスト
      await notion.blocks.update({
        block_id: imageBlocks[i].id,
        image: {
          external: { 
            url: newUrls[i] 
          }
          // 更新時は type: "external" を含めないのがNotionの仕様
        }
      });
      console.log(`Notionの ${i + 1} 枚目の画像を最新に書き換えました！`);
    }

    console.log("すべての工程が正常に完了しました！");

  } catch (error) {
    console.error("エラーが発生しました:", error);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
