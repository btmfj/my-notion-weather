const puppeteer = require('puppeteer');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

(async () => {
  const browser = await puppeteer.launch({ 
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: "new"
  });
  const page = await browser.newPage();
  
  // 佐賀県白石町のURL
  await page.goto('https://weather.yahoo.co.jp/weather/jp/41/8510/41425.html', { 
    waitUntil: 'networkidle2' 
  });

  // 画面のサイズ設定
  await page.setViewport({ width: 1000, height: 1200 });

  // 天気情報のメイン部分を指定してスクショ
  const element = await page.$('#main'); 
  if (element) {
    await element.screenshot({ path: 'weather.png' });
  } else {
    await page.screenshot({ path: 'weather.png' });
  }

 // Cloudinaryへアップロード
  const uploadResponse = await cloudinary.uploader.upload('weather.png', {
    public_id: 'today_weather',
    overwrite: true,
    invalidate: true,
    resource_type: 'image'
  });

  // 最新のURL（バージョン番号付き）をログに出力
  console.log("-----------------------------------------");
  console.log("NOTIONに貼る最新URLはこちらです：");
  console.log(uploadResponse.secure_url);
  console.log("-----------------------------------------");

  await browser.close();
