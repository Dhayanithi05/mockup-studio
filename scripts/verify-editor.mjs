import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:4175');
  await page.waitForFunction(() =>
    document.querySelector('.asset-metadata strong')?.textContent.includes('Portfolio'),
  );
  const state = () =>
    page.evaluate(async () => {
      const url = performance
        .getEntriesByType('resource')
        .find((r) => r.name.includes('/src/state/store.ts'))?.name;
      const { useEditor } = await import(url || '/src/state/store.ts');
      const s = useEditor.getState();
      return {
        c: s.composition,
        assets: Object.fromEntries(
          Object.entries(s.assets).map(([k, a]) => [
            k,
            a ? { width: a.width, height: a.height, size: a.size, name: a.name } : null,
          ]),
        ),
        candidates: s.candidates,
        playing: s.playing,
        time: s.time,
      };
    });
  assert.equal((await state()).assets.mockup.width, 700);
  await page.getByRole('button', { name: 'Go to bottom', exact: true }).click();
  assert.ok((await state()).c.scrollY > 1000);
  await page.getByRole('button', { name: 'Go to top', exact: true }).click();
  assert.equal((await state()).c.scrollY, 0);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  assert.ok((await state()).c.scrollY > 0);
  await page.getByRole('button', { name: 'Restart motion', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.keyboard.press('Escape');
  await mkdir('test-results/editor', { recursive: true });
  // The upload is a genuine 3000×16000 PNG; no reduced JPEG proxy is used.
  const png = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(3000, 16000);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#eee8dc';
    ctx.fillRect(0, 0, 3000, 16000);
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = i % 2 ? '#214345' : '#b2c1ba';
      ctx.fillRect(90, i * 1000 + 90, 2820, 820);
      ctx.fillStyle = '#fff';
      ctx.font = '120px sans-serif';
      ctx.fillText(`Portfolio section ${i + 1}`, 180, i * 1000 + 300);
    }
    const blob = await canvas.convertToBlob();
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  const designPath = path.resolve('test-results/editor/tall-design.png');
  await writeFile(designPath, Uint8Array.from(png));
  await page.locator('[data-testid="asset-input"]').setInputFiles(designPath);
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal((await state()).assets.design.width, 3000);
  assert.equal((await state()).assets.design.height, 16000);
  assert.equal((await state()).assets.design.size, png.length);
  await page.getByRole('button', { name: 'Export settings', exact: true }).click();
  for (const [preset, width, height] of [
    ['Full HD', 1920, 1080],
    ['Portfolio 4K', 3840, 2160],
    ['Story / Reel', 1080, 1920],
  ]) {
    await page.getByLabel('Resolution preset', { exact: true }).selectOption(preset);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export screenshot', exact: true }).click();
    const dl = await downloadPromise;
    const out = path.resolve(`test-results/editor/screenshot-${width}x${height}.png`);
    await dl.saveAs(out);
    const bytes = await readFile(out);
    assert.equal(bytes.readUInt32BE(16), width);
    assert.equal(bytes.readUInt32BE(20), height);
  }
  await page.getByLabel('Resolution preset', { exact: true }).selectOption('Full HD');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Replace Mockup', exact: true }).click();
  const phoneSvg = await readFile('tests/fixtures/phone-mockup.svg', 'utf8');
  const phonePng = await page.evaluate(async (svg) => {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    await img.decode();
    const cv = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
    cv.getContext('2d').drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    return Array.from(new Uint8Array(await (await cv.convertToBlob()).arrayBuffer()));
  }, phoneSvg);
  const phonePath = path.resolve('test-results/editor/phone-mockup.png');
  await writeFile(phonePath, Uint8Array.from(phonePng));
  await (await chooser).setFiles(phonePath);
  await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 90000 });
  assert.ok((await state()).candidates.length > 0, 'Replacement should invoke screen detection');
  const before = (await state()).c.screen.quad[0].x;
  const x = page.getByLabel('Top left X', { exact: true });
  const px = Number(await x.inputValue());
  await x.fill(String(px + 4));
  assert.notEqual((await state()).c.screen.quad[0].x, before);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.ok(
    Math.abs((await state()).c.screen.quad[0].x - before) < 1e-9,
    'Undo must restore the detected calibration, not an earlier mockup',
  );
  await page.screenshot({ path: 'test-results/editor/calibration.png' });
  await page.locator('nav').getByRole('button', { name: 'Project' }).click();
  await page.getByLabel('Project name', { exact: true }).fill('QA saved project');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await page.getByText('Project saved on this device.', { exact: true }).waitFor();
  await page.reload();
  await page.locator('nav').getByRole('button', { name: 'Project' }).click();
  await page.getByRole('button', { name: /^QA saved project/ }).click();
  await page.waitForFunction(() =>
    document.querySelector('.project-name')?.textContent.includes('QA saved project'),
  );
  assert.equal((await state()).assets.design.height, 16000);
  await page.locator('nav').getByRole('button', { name: 'Design' }).click();
  await page.locator('[data-testid="asset-input"]').setInputFiles({
    name: 'unsupported.fig',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('example'),
  });
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /Direct .fig rendering/);
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: 'test-results/editor/laptop.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/editor/mobile.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log(
    'Editor acceptance checks passed: original 3000×16000 PNG upload, playback, 1080p/4K/portrait downloads, mockup replacement and auto detection, manual calibration, undo, saved-project reload, .fig guidance, laptop/mobile layout.',
  );
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) {
    console.log(await page.locator('body').ariaSnapshot());
    await page.screenshot({ path: 'test-results/editor-failure.png' });
  }
  throw error;
} finally {
  await browser.close();
}
