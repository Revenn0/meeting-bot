const puppeteer = require('puppeteer');

(async () => {
  console.log('启动 Chromium...');
  const browser = await puppeteer.launch({
    headless: true,  // 看不见
  });
  
  const page = await browser.newPage();
  console.log('访问 x.com...');
  await page.goto('https://www.x.com');
  
  await page.screenshot({ path: 'x.png' });
  console.log('截图保存到 x.png');
  
  console.log('5 秒后关闭...');
  await new Promise(r => setTimeout(r, 5000));
  
  await browser.close();
  console.log('完成 ♡');
})();
