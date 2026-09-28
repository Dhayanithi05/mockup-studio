import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1224, height: 700 } });
  await page.goto('http://127.0.0.1:4175');
  await page.waitForFunction(() => document.querySelector('.left-sidebar nav button'));
  await mkdir('test-results/workspace-rail', { recursive: true });

  const rail = page.locator('.left-sidebar');
  const projectLabel = page.locator('.left-sidebar nav button span').first();
  const collapsed = await rail.boundingBox();
  assert.ok(
    collapsed && collapsed.width <= 61,
    `Expected compact rail, received ${collapsed?.width}px`,
  );
  assert.equal(await projectLabel.evaluate((element) => getComputedStyle(element).opacity), '0');
  const alignment = await rail.evaluate((sidebar) => {
    const offsetFromControlCenter = (item) => {
      const control = item.closest('button').getBoundingClientRect();
      const visible = item.getBoundingClientRect();
      return Math.abs(control.left + control.width / 2 - (visible.left + visible.width / 2));
    };
    return [
      ...[...sidebar.querySelectorAll('nav button > svg')].map(offsetFromControlCenter),
      ...[...sidebar.querySelectorAll('.layer-thumb')].map(offsetFromControlCenter),
      ...[...sidebar.querySelectorAll('.add-asset > svg')].map(offsetFromControlCenter),
    ];
  });
  assert.ok(
    alignment.every((offset) => offset <= 1),
    `Uncentered compact items: ${alignment}`,
  );
  await page.screenshot({ path: 'test-results/workspace-rail/collapsed.png' });

  await rail.hover();
  await page.waitForFunction(
    () => document.querySelector('.left-sidebar')?.getBoundingClientRect().width > 160,
  );
  const expanded = await rail.boundingBox();
  assert.ok(
    expanded && expanded.width >= 170,
    `Expected expanded rail, received ${expanded?.width}px`,
  );
  assert.equal(await projectLabel.evaluate((element) => getComputedStyle(element).opacity), '1');
  await page.screenshot({ path: 'test-results/workspace-rail/expanded.png' });

  await page.mouse.move(700, 150);
  await page.getByRole('button', { name: 'Project', exact: true }).focus();
  await page.waitForFunction(
    () => document.querySelector('.left-sidebar')?.getBoundingClientRect().width > 160,
  );
  console.log('Workspace rail hover and keyboard-focus expansion passed.');
} finally {
  await browser.close();
}
