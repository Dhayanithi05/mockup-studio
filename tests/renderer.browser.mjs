import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

// Run with the local dev server: node tests/renderer.browser.mjs [http://127.0.0.1:4175]
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:4175');
  const result = await page.evaluate(async () => {
    const { renderComposition, screenToOutput } = await import('/src/engine/renderer.ts');
    const { createDefaults } = await import('/src/state/defaults.ts');
    const { calculateHomography, applyHomography } = await import('/src/engine/geometry.ts');
    const makeAsset = async (width, height, paint) => {
      const canvas = new OffscreenCanvas(width, height),
        ctx = canvas.getContext('2d');
      paint(ctx);
      const blob = await canvas.convertToBlob();
      return {
        id: 'test',
        name: 'test.png',
        width,
        height,
        blob,
        bitmap: await createImageBitmap(blob),
        url: '',
        type: 'image/png',
        size: blob.size,
      };
    };
    const mockup = await makeAsset(1000, 800, (ctx) => {
      ctx.fillStyle = '#b0b0b0';
      ctx.fillRect(0, 0, 1000, 800);
    });
    const design = await makeAsset(800, 3200, (ctx) => {
      ctx.fillStyle = '#f02020';
      ctx.fillRect(0, 0, 800, 800);
      ctx.fillStyle = '#20f020';
      ctx.fillRect(0, 800, 800, 800);
      ctx.fillStyle = '#2020f0';
      ctx.fillRect(0, 1600, 800, 1600);
      // Original-pixel alternating columns reveal an accidental low-resolution intermediate.
      for (let x = 0; x < 800; x += 2) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(x, 2000, 1, 400);
        ctx.fillStyle = '#000';
        ctx.fillRect(x + 1, 2000, 1, 400);
      }
    });
    const assets = { mockup, design, background: null, foreground: null },
      c = createDefaults();
    c.motion.mode = 'manual';
    c.screen.quad = [
      { x: 0.1, y: 0.2 },
      { x: 0.9, y: 0.2 },
      { x: 0.9, y: 0.7 },
      { x: 0.1, y: 0.7 },
    ];
    const output = new OffscreenCanvas(3840, 2160),
      ctx = output.getContext('2d');
    const sample = (p) => Array.from(ctx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data);
    renderComposition({
      ctx,
      width: 3840,
      height: 2160,
      composition: c,
      assets,
      scrollY: 900,
      quality: 'export',
    });
    const green = sample(screenToOutput({ x: 0.5, y: 0.45 }, c, assets, 3840, 2160));
    const outside = sample(screenToOutput({ x: 0.05, y: 0.45 }, c, assets, 3840, 2160));
    c.screen.radius = 100;
    renderComposition({
      ctx,
      width: 3840,
      height: 2160,
      composition: c,
      assets,
      scrollY: 900,
      quality: 'export',
    });
    const roundedCorner = sample(screenToOutput({ x: 0.102, y: 0.202 }, c, assets, 3840, 2160));
    c.screen.radius = 0;
    c.screen.quad = [
      { x: 0.1, y: 0.15 },
      { x: 0.9, y: 0.26 },
      { x: 0.75, y: 0.76 },
      { x: 0.19, y: 0.69 },
    ];
    const start = performance.now();
    renderComposition({
      ctx,
      width: 3840,
      height: 2160,
      composition: c,
      assets,
      scrollY: 900,
      quality: 'export',
    });
    const perspectiveMs = performance.now() - start;
    const quad = c.screen.quad.map((p) => screenToOutput(p, c, assets, 3840, 2160));
    const center = applyHomography(calculateHomography(quad), { x: 0.5, y: 0.5 });
    const perspective = sample(center),
      blob = await output.convertToBlob({ type: 'image/png' });
    const header = new DataView(await blob.arrayBuffer());
    const dimensions = [header.getUint32(16), header.getUint32(20)];
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    const portrait = new OffscreenCanvas(1080, 1920);
    renderComposition({
      ctx: portrait.getContext('2d'),
      width: 1080,
      height: 1920,
      composition: c,
      assets,
      scrollY: 0,
      quality: 'export',
    });
    const portraitBlob = await portrait.convertToBlob(),
      portraitHeader = new DataView(await portraitBlob.arrayBuffer());
    return {
      green,
      outside,
      roundedCorner,
      perspective,
      perspectiveMs,
      dimensions,
      portraitDimensions: [portraitHeader.getUint32(16), portraitHeader.getUint32(20)],
      bytes,
    };
  });
  await writeFile('tests/renderer-perspective.png', Uint8Array.from(result.bytes));
  assert.deepEqual(
    result.green,
    [32, 240, 32, 255],
    'Manual scrolling should sample the original design green band',
  );
  assert.deepEqual(
    result.outside,
    [176, 176, 176, 255],
    'Design pixels must stay inside the screen',
  );
  assert.deepEqual(
    result.roundedCorner,
    [176, 176, 176, 255],
    'Rounded mask must preserve the physical mockup',
  );
  assert.deepEqual(
    result.perspective,
    [32, 240, 32, 255],
    'Perspective screen center must show the requested source crop',
  );
  assert.deepEqual(result.dimensions, [3840, 2160]);
  assert.deepEqual(result.portraitDimensions, [1080, 1920]);
  const details = { ...result };
  delete details.bytes;
  console.log(JSON.stringify(details, null, 2));
  console.log('Renderer browser checks passed.');
} finally {
  await browser.close();
}
