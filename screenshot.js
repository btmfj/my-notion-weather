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

    // タイムスタンプ作成（おまじない用）
    const ts = new Date().getTime();

    // --- 撮影ターゲットの定義 ---
    const targets = [
      { 
        id: '#yjw_pinpoint', 
        name: 'weather_today', 
        label: '今日の天気',
        clip: { x: 0, y: 0, width: 674,  height:  320 } // 発表時刻を含めるため広めに設定
      },
      { 
        id: '#yjw_pinpoint_tomorrow', 
        name: 'weather_tomorrow', 
        label: '明日の天気' 
      },
      { 
        id: '#yjw_week', 
        name: 'weather_week', 
        label: '週間天気' 
      }
    ];

    console.log("=========================================");
    
    for (const target of targets) {
      const element = await page.$(target.id);
      if (element) {
        const fileName = `${target.name}.png`;
        
        // スクショ実行
        if (target.clip) {
          await element.screenshot({ path: fileName, clip: target.clip });
        } else {
          await element.screenshot({ path: fileName });
        }

        // Cloudinaryへアップロード
        const res = await cloudinary.uploader.upload(fileName, {
          public_id: target.name,
          overwrite: true,
          invalidate: true,       // キャッシュを破棄
          unique_filename: false,  // URLを固定
          resource_type: 'image'
        });

        // Notionに貼るためのURLをログに表示
        console.log(`${target.label} のURL:`);
        console.log(`${res.secure_url}?v=${ts}`);
        console.log("-----------------------------------------");
      }
    }

    console.log("すべての更新が完了しました。");
    console.log("=========================================");

  } catch (error) {
    console.error("エラーが発生しました:", error);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
