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
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1400, height: 5000 }); // 高さを十分に確保

    const ts = new Date().getTime();
    const newUrls = [];

    // --- ステップ1: 今日・明日の予報 ---
    console.log("今日・明日の予報を取得中...");
    await page.goto('https://tenki.jp/forecast/9/44/8510/41425/1hour.html', { waitUntil: 'networkidle2', timeout: 60000 });
    
    const dailyTargets = [
      { selector: '#forecast-point-1h-today', name: 'weather_today' },
      { selector: '#forecast-point-1h-tomorrow', name: 'weather_tomorrow' }
    ];

    for (const target of dailyTargets) {
      await page.waitForSelector(target.selector, { timeout: 20000 });
      const element = await page.$(target.selector);
      await new Promise(r => setTimeout(r, 2000));
      const rect = await element.boundingBox();
      await page.screenshot({ path: `${target.name}.png`, clip: rect });
      const res = await cloudinary.uploader.upload(`${target.name}.png`, { public_id: `${target.name}_${ts}`, overwrite: true, invalidate: true });
      newUrls.push(res.secure_url);
      console.log(`${target.name} アップロード完了`);
    }

    // --- ステップ2: 10日間予報 (テキスト検索による自動特定) ---
    console.log("10日間予報を取得中...");
    await page.goto('https://tenki.jp/forecast/9/44/8510/41425/', { waitUntil: 'networkidle2', timeout: 60000 });
    
    // 「10日間天気」という見出しを持つセクションを特定する
    const sectionElement = await page.evaluateHandle(() => {
      const headers = Array.from(document.querySelectorAll('h3, h2, .section-title'));
      const targetHeader = headers.find(h => h.textContent.includes('10日間天気'));
      return targetHeader ? targetHeader.closest('section') || targetHeader.parentElement : null;
    });

    if (sectionElement && sectionElement.asElement()) {
      const element = sectionElement.asElement();
      await element.scrollIntoView();
      await new Promise(r => setTimeout(r, 3000));
      const rect = await element.boundingBox();
      
      // 切り抜き範囲が広すぎないよう調整（余計な余白をカット）
      await page.screenshot({ path: `weather_week.png`, clip: rect });
      const res = await cloudinary.uploader.upload(`weather_week.png`, { public_id: `weather_week_${ts}`, overwrite: true, invalidate: true });
      newUrls.push(res.secure_url);
      console.log(`weather_week アップロード完了`);
    } else {
      throw new Error("10日間天気のセクションが見つかりませんでした。");
    }

    // --- ステップ3: Notionを更新 ---
    console.log("Notionの画像ブロックを探索中...");
    const allImageBlocks = await getAllImageBlocks(pageId);
    for (let i = 0; i < Math.min(allImageBlocks.length, newUrls.length); i++) {
      await notion.blocks.update({
        block_id: allImageBlocks[i].id,
        image: { external: { url: `${newUrls[i]}?t=${ts}` } }
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
