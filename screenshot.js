const puppeteer = require('puppeteer');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

(async () => {
  let browser;
  try {
    browser = await puppeteer.launch({ 
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: "new"
    });
    const page = await browser.newPage();
    const targetUrl = 'https://weather.yahoo.co.jp/weather/jp/41/8510/41425.html';
    
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.setViewport({ width: 1000, height: 2000 }); // 縦を長めに設定

    // --- 撮影ターゲットの設定 ---
    const targets = [
      { id: '#yjw_pinpoint_today', name: 'weather_today' },   // 今日の天気
      { id: '#yjw_pinpoint_tomorrow', name: 'weather_tomorrow' }, // 明日の天気
      { id: '#yjw_week', name: 'weather_week' }              // 週間天気
    ];

    console.log("=========================================");
    for (const target of targets) {
      const element = await page.$(target.id);
      if (element) {
        const fileName = `${target.name}.png`;
        await element.screenshot({ path: fileName });

        // Cloudinaryへアップロード
        const res = await cloudinary.uploader.upload(fileName, {
          public_id: target.name,
          overwrite: true,
          invalidate: true,
          resource_type: 'image'
        });
        console.log(`${target.name} 更新完了: ${res.secure_url}`);
      }
    }
    console.log("=========================================");

  } catch (error) {
    console.error("エラー:", error);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
