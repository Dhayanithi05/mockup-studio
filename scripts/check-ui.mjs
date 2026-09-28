import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 950 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:4175');
  await page.waitForFunction(() => document.querySelector('canvas')?.width > 0);
  await page.waitForTimeout(1500);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/editor.png' });
  console.log(
    JSON.stringify({
      title: await page.title(),
      errors,
      body: (await page.locator('body').innerText()).slice(-700),
    }),
  );
} finally {
  await browser.close();
}
