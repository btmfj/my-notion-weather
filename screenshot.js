const puppeteer = require('puppeteer');
const cloudinary = require('cloudinary').v2;

// GitHubのSecretsから設定を読み込み
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

(async () => {
  let browser;
  try {
    // ブラウザの起動
    browser = await puppeteer.launch({ 
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: "new"
    });
    const page = await browser.newPage();
    
    // 佐賀県白石町のYahoo天気URL
    const targetUrl = 'https://weather.yahoo.co.jp/weather/jp/41/8510/41425.html';
    
    // ページへ移動（読み込み完了まで待機）
    await page.goto(targetUrl, { 
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // 画面のサイズ設定
    await page.setViewport({ width: 1000, height: 1200 });

    // 天気情報のメイン部分（#main）を探す
    const element = await page.$('#main'); 
    if (element) {
      await element.screenshot({ path: 'weather.png' });
    } else {
      // #mainが見つからない場合はページ全体を撮る
      await page.screenshot({ path: 'weather.png' });
    }

    // Cloudinaryへアップロード（上書き & キャッシュ破棄設定）
    const uploadResponse = await cloudinary.uploader.upload('weather.png', {
      public_id: 'today_weather',
      overwrite: true,
      invalidate: true,
      resource_type: 'image'
    });

    // --- ここが重要：ログに最新URLを出力する ---
    console.log("=========================================");
    console.log("【成功】画像が更新されました");
    console.log("Notionに貼る最新URLはこちらです：");
    console.log(uploadResponse.secure_url);
    console.log("=========================================");

  } catch (error) {
    console.error("【エラー発生】:", error);
    process.exit(1); // エラーをGitHubに通知
  } finally {
    if (browser) await browser.close();
  }
})();
