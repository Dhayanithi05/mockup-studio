import { preview } from 'vite';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
const server = await preview({ preview: { host: '127.0.0.1', port: 5198, strictPort: true } });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5198');
  await page.getByText('Portfolio — Figma export.jpg', { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.match(
    await page.evaluate(() => getComputedStyle(document.body).fontFamily),
    /Space Grotesk/,
  );
  assert.equal(
    await page.evaluate(() =>
      [...document.fonts].some(
        (font) => font.family.includes('Space Grotesk') && font.status === 'loaded',
      ),
    ),
    true,
  );
  await mkdir('test-results/production', { recursive: true });
  await page.screenshot({ path: 'test-results/production/editor.png' });
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await page.getByLabel('Resolution preset', { exact: true }).selectOption('Full HD');
  await page.getByLabel('Duration', { exact: true }).fill('1');
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Render Video', exact: true }).click();
  const file = await promise;
  await file.saveAs('test-results/production/ui-recording.webm');
  assert.ok((await readFile('test-results/production/ui-recording.webm')).length > 1000);
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  console.log(
    'Production Chrome smoke check passed: source assets, typography, interface, and real Render Video download.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
