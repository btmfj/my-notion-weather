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
    await page.setViewport({ width: 1000, height: 2000 });

    // --- 撮影設定 ---
    // 今日の天気（発表時刻を含む親要素を指定）
    const todayTarget = await page.$('#yjw_pinpoint'); 
    if (todayTarget) {
      // 発表時刻から今日のテーブルまでを収めるため、少し高さを調整してスクショ
      await todayTarget.screenshot({ 
        path: 'weather_today.png',
        clip: { x: 0, y: 0, width: 673, height: 300 } // 発表時刻を含めた上部エリア
      });
      const res = await cloudinary.uploader.upload('weather_today.png', {
        public_id: 'weather_today',
        overwrite: true,
        invalidate: true
      });
      console.log(`weather_today 更新完了: ${res.secure_url}`);
    }

    // 明日の天気
    const tomorrowTarget = await page.$('#yjw_pinpoint_tomorrow');
    if (tomorrowTarget) {
      await tomorrowTarget.screenshot({ path: 'weather_tomorrow.png' });
      const res = await cloudinary.uploader.upload('weather_tomorrow.png', {
        public_id: 'weather_tomorrow',
        overwrite: true,
        invalidate: true
      });
      console.log(`weather_tomorrow 更新完了: ${res.secure_url}`);
    }

    // 週間天気
    const weekTarget = await page.$('#yjw_week');
    if (weekTarget) {
      await weekTarget.screenshot({ path: 'weather_week.png' });
      const res = await cloudinary.uploader.upload('weather_week.png', {
        public_id: 'weather_week',
        overwrite: true,
        invalidate: true
      });
      console.log(`weather_week 更新完了: ${res.secure_url}`);
    }

  } catch (error) {
    console.error("エラー:", error);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
