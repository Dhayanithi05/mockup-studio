import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.on('pageerror', (e) => console.log(e.message));
  await page.goto('http://127.0.0.1:4175');
  await page.locator('nav').getByRole('button', { name: 'Export' }).click();
  console.log(await page.locator('.properties').ariaSnapshot());
  await page.screenshot({ path: 'test-results/export-panel.png' });
} finally {
  await browser.close();
}
