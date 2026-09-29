import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1224, height: 700 } });
  await page.goto('http://127.0.0.1:4175');
  await page.getByRole('button', { name: 'Collapse motion timeline' }).waitFor();

  const timeline = page.locator('.timeline');
  const track = page.locator('.timeline-track');
  const toggle = page.getByRole('button', { name: 'Collapse motion timeline' });
  const expandedHeight = await timeline.evaluate((element) => element.getBoundingClientRect().height);
  assert.equal(await track.isVisible(), true);

  await toggle.click();
  await page.getByRole('button', { name: 'Expand motion timeline' }).waitFor();
  assert.equal(await track.isVisible(), false);
  const collapsedHeight = await timeline.evaluate((element) => element.getBoundingClientRect().height);
  assert.ok(collapsedHeight < expandedHeight, 'Collapsed timeline should free vertical space.');

  await page.getByRole('button', { name: 'Expand motion timeline' }).click();
  await page.getByRole('button', { name: 'Collapse motion timeline' }).waitFor();
  assert.equal(await track.isVisible(), true);
  console.log('Timeline collapse and expansion passed.');
} finally {
  await browser.close();
}
