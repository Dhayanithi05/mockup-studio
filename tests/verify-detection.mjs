import { build, createServer, preview } from 'vite';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';

const production = process.argv.includes('--production');
const options = {
  configFile: false,
  root: process.cwd(),
  server: { host: '127.0.0.1', port: 5197, strictPort: true },
  preview: { host: '127.0.0.1', port: 5197, strictPort: true },
  build: {
    outDir: '.detection-check',
    rollupOptions: { input: path.resolve('tests/detection-harness.html') },
  },
};
let server;
let browser;
try {
  if (production) {
    await build(options);
    server = await preview(options);
  } else {
    server = await createServer(options);
    await server.listen();
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.error('Browser error:', error.message));
  await page.goto('http://127.0.0.1:5197/tests/detection-harness.html');
  await page.waitForFunction(() => typeof window.runDetection === 'function');
  const phone = await page.evaluate(() => window.runDetection(false));
  console.log('Phone:', JSON.stringify(phone));
  assert.ok(phone.candidates.length > 0, `No phone candidates: ${phone.stages.join(', ')}`);
  assert.ok(
    Math.abs(phone.candidates[0].quad[0].x - 1 / 3) < 0.01,
    'The inner screen should rank above the outer device body',
  );
  assert.ok(
    phone.candidates.some((candidate) => {
      const centerX = candidate.quad.reduce((sum, p) => sum + p.x / 4, 0);
      const centerY = candidate.quad.reduce((sum, p) => sum + p.y / 4, 0);
      return Math.abs(centerX - 0.5) < 0.05 && Math.abs(centerY - 0.4875) < 0.07;
    }),
    'Phone display was not found near its expected position',
  );
  const alpha = await page.evaluate(() => window.runDetection(true));
  console.log('Transparent:', JSON.stringify(alpha));
  assert.ok(
    alpha.candidates.some(
      (candidate) => candidate.label.includes('Transparent') && candidate.confidence > 0.9,
    ),
    'Transparent screen opening was not detected',
  );
  assert.equal(phone.selected.length, 1, 'Phone bezel alternatives should select one display');
  assert.equal(alpha.selected.length, 1, 'Transparent opening should select one display');
  for (const [fixture, width, height, expected] of [
    [
      'dual',
      1600,
      1000,
      [
        [
          [100, 230],
          [720, 230],
          [720, 620],
          [100, 620],
        ],
        [
          [850, 230],
          [1470, 230],
          [1470, 620],
          [850, 620],
        ],
      ],
    ],
    [
      'triple',
      1800,
      1000,
      [
        [
          [160, 180],
          [440, 180],
          [440, 830],
          [160, 830],
        ],
        [
          [610, 250],
          [1250, 250],
          [1250, 650],
          [610, 650],
        ],
        [
          [1390, 200],
          [1660, 250],
          [1620, 830],
          [1350, 780],
        ],
      ],
    ],
  ]) {
    const result = await page.evaluate((name) => window.runDetection(name), fixture);
    console.log(`${fixture}:`, JSON.stringify(result));
    assert.equal(
      result.selected.length,
      expected.length,
      `${fixture} must select every physical display once, without extra bezel outlines`,
    );
    for (const [index, corners] of expected.entries()) {
      for (const [corner, [x, y]] of corners.entries()) {
        const actual = result.selected[index].quad[corner];
        assert.ok(
          Math.abs(actual.x - x / width) < 0.012 && Math.abs(actual.y - y / height) < 0.012,
          `${fixture} screen ${index + 1} corner ${corner + 1} should follow its display interior`,
        );
      }
    }
  }
  await page.evaluate(() => window.disposeDetection());
  console.log(
    `OpenCV detection passed in Chrome (${production ? 'production bundle' : 'development server'}).`,
  );
} finally {
  await browser?.close();
  if (server?.close) await server.close();
  else if (server?.httpServer) await new Promise((resolve) => server.httpServer.close(resolve));
}
