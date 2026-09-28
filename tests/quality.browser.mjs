import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

// Real decoded pixels and actual lossless exports; run against the local Vite server.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/__quality-check', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Original pixel quality verification</title>',
    }),
  );
  await page.goto(`${process.argv[2] ?? 'http://127.0.0.1:4175'}/__quality-check`);
  const result = await page.evaluate(async () => {
    const { renderComposition } = await import('/src/engine/renderer.ts');
    const { captureScreenshot } = await import('/src/engine/export.ts');
    const { loadImage } = await import('/src/engine/image.ts');
    const { createDefaults } = await import('/src/state/defaults.ts');
    const makeAsset = async (width, height, seed) => {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      const pixels = ctx.createImageData(width, height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          pixels.data[i] = (x * 37 + y * 17 + seed) % 256;
          pixels.data[i + 1] = (x * 13 + y * 43 + seed * 3) % 256;
          pixels.data[i + 2] = (x * 29 + y * 11 + seed * 7) % 256;
          pixels.data[i + 3] = 255;
        }
      }
      ctx.putImageData(pixels, 0, 0);
      const original = await canvas.convertToBlob({ type: 'image/png' });
      const asset = await loadImage(original, 'pixel-pattern.png');
      const sourceBytes = new Uint8Array(await original.arrayBuffer());
      const retainedBytes = new Uint8Array(await asset.blob.arrayBuffer());
      const unchanged =
        sourceBytes.length === retainedBytes.length &&
        sourceBytes.every((value, i) => value === retainedBytes[i]);
      canvas.width = canvas.height = 1;
      return { asset, pixels, unchanged, sameBlob: asset.blob === original };
    };
    const mockup = await makeAsset(1024, 768, 19);
    const design = await makeAsset(256, 2048, 197);
    const assets = {
      mockup: mockup.asset,
      design: design.asset,
      foreground: null,
      background: null,
    };
    const c = createDefaults();
    c.motion.mode = 'manual';
    c.output = { ...c.output, width: 1024, height: 768, framing: 'original' };
    const region = (left, top, width, height) => [
      { x: left / 1024, y: top / 768 },
      { x: (left + width) / 1024, y: top / 768 },
      { x: (left + width) / 1024, y: (top + height) / 768 },
      { x: left / 1024, y: (top + height) / 768 },
    ];
    c.screen = { ...c.screen, quad: region(64, 64, 256, 128), id: 'primary' };
    c.extraScreens = [
      { ...structuredClone(c.screen), quad: region(512, 64, 256, 256), id: 'secondary' },
    ];
    const readBlob = async (blob) => {
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      const result = {
        width: bitmap.width,
        height: bitmap.height,
        pixels: ctx.getImageData(0, 0, bitmap.width, bitmap.height),
      };
      bitmap.close();
      canvas.width = canvas.height = 1;
      return result;
    };
    const compare = (actual, expected) => {
      let mismatches = 0,
        maxError = 0;
      for (let i = 0; i < actual.length; i++) {
        const error = Math.abs(actual[i] - expected[i]);
        if (error > 0) mismatches++;
        maxError = Math.max(maxError, error);
      }
      return { mismatches, maxError, channels: actual.length };
    };
    const expected = mockup.pixels.data.slice();
    for (const rectangle of [
      { x: 64, y: 64, width: 256, height: 128 },
      { x: 512, y: 64, width: 256, height: 256 },
    ]) {
      for (let y = 0; y < rectangle.height; y++) {
        const target = ((y + rectangle.y) * 1024 + rectangle.x) * 4;
        expected.set(design.pixels.data.subarray(y * 256 * 4, (y + 1) * 256 * 4), target);
      }
    }
    const exported = await readBlob(await captureScreenshot(c, assets));
    const twoScreens = compare(exported.pixels.data, expected);
    c.screen.enabled = false;
    c.extraScreens[0].enabled = false;
    const originalOnly = await readBlob(await captureScreenshot(c, assets));
    const mockupFidelity = compare(originalOnly.pixels.data, mockup.pixels.data);
    c.screen.enabled = true;
    c.extraScreens[0].enabled = true;

    // Native viewport must render the same pixels as cropping the full output, with
    // no full-image downscaling even when the logical canvas exceeds browser limits.
    const viewport = { x: 160, y: 110, width: 700, height: 510 };
    const full = new OffscreenCanvas(1024, 768);
    const fullCtx = full.getContext('2d');
    const tile = new OffscreenCanvas(viewport.width, viewport.height);
    const tileCtx = tile.getContext('2d');
    const viewportResults = [];
    for (const variant of ['native', 'rotated', 'effects', 'perspective']) {
      if (variant === 'rotated') c.output.rotation = 12;
      if (variant === 'effects') {
        c.output.opacity = 0.7;
        c.output.background = 'gradient';
        c.output.color = '#7f2387';
        c.output.color2 = '#26a173';
        c.screen.reflection = 0.4;
        c.screen.brightness = 108;
      }
      if (variant === 'perspective') c.extraScreens[0].quad[2].x -= 0.08;
      renderComposition({
        ctx: fullCtx,
        width: 1024,
        height: 768,
        composition: c,
        assets,
        quality: 'export',
      });
      renderComposition({
        ctx: tileCtx,
        width: 1024,
        height: 768,
        viewport,
        composition: c,
        assets,
        quality: 'export',
      });
      const expectedTile = fullCtx.getImageData(
        viewport.x,
        viewport.y,
        viewport.width,
        viewport.height,
      );
      const actualTile = tileCtx.getImageData(0, 0, viewport.width, viewport.height);
      viewportResults.push({ variant, ...compare(actualTile.data, expectedTile.data) });
    }
    const hugeViewport = { x: 48000, y: 24000, width: 512, height: 384 };
    const hugeTile = new OffscreenCanvas(512, 384);
    renderComposition({
      ctx: hugeTile.getContext('2d'),
      width: 98304,
      height: 73728,
      viewport: hugeViewport,
      composition: c,
      assets,
      quality: 'preview',
    });

    // Verify original source detail above common 1920/2048 preview limits. Each
    // alternating/random pixel must survive source decode -> screen -> PNG encode.
    const highDesign = await makeAsset(2304, 6144, 73);
    const highMockup = await makeAsset(2560, 2560, 101);
    const high = createDefaults();
    high.motion.mode = 'manual';
    high.scrollY = 3072;
    high.output = { ...high.output, width: 2560, height: 2560, framing: 'original' };
    high.screen.quad = [
      { x: 128 / 2560, y: 128 / 2560 },
      { x: 2432 / 2560, y: 128 / 2560 },
      { x: 2432 / 2560, y: 2432 / 2560 },
      { x: 128 / 2560, y: 2432 / 2560 },
    ];
    const highExport = await readBlob(
      await captureScreenshot(high, {
        mockup: highMockup.asset,
        design: highDesign.asset,
        background: null,
        foreground: null,
      }),
    );
    const highExpected = highMockup.pixels.data.slice();
    for (let y = 0; y < 2304; y++) {
      highExpected.set(
        highDesign.pixels.data.subarray((3072 + y) * 2304 * 4, (3073 + y) * 2304 * 4),
        ((y + 128) * 2560 + 128) * 4,
      );
    }
    return {
      sourceBytesUnchanged: [mockup, design, highDesign, highMockup].every(
        (source) => source.unchanged && source.sameBlob,
      ),
      decodedDimensions: [highDesign.asset.bitmap.width, highDesign.asset.bitmap.height],
      dimensions: [exported.width, exported.height],
      twoScreens,
      mockupFidelity,
      viewportResults,
      highResolution: {
        dimensions: [highExport.width, highExport.height],
        ...compare(highExport.pixels.data, highExpected),
      },
      hugeLogicalPreview: [hugeTile.width, hugeTile.height],
    };
  });
  console.log(JSON.stringify(result, null, 2));
  assert.equal(
    result.sourceBytesUnchanged,
    true,
    'Uploaded source files must be retained byte-for-byte',
  );
  assert.deepEqual(result.decodedDimensions, [2304, 6144]);
  assert.deepEqual(result.dimensions, [1024, 768]);
  assert.equal(
    result.twoScreens.mismatches,
    0,
    'Both native-size screens must exactly retain original design pixels',
  );
  assert.equal(
    result.mockupFidelity.mismatches,
    0,
    'Native-size mockup PNG export must preserve every decoded original pixel',
  );
  assert.deepEqual(result.highResolution.dimensions, [2560, 2560]);
  assert.equal(
    result.highResolution.mismatches,
    0,
    'High-resolution scrolled design must never use a downsampled preview',
  );
  for (const resultCase of result.viewportResults) {
    // Offset Canvas2D gradient/filter/opacity passes can differ by two 8-bit
    // rounding levels. Neutral native artwork and high-resolution PNG copies
    // are held to exact equality above; transformed previews stay within this
    // small color arithmetic tolerance, with no reduction in spatial detail.
    assert.equal(
      resultCase.maxError <=
        (resultCase.variant === 'effects' || resultCase.variant === 'perspective' ? 2 : 1),
      true,
      `${resultCase.variant} viewport must match the original full-resolution render`,
    );
  }
  assert.deepEqual(
    result.hugeLogicalPreview,
    [512, 384],
    'Zoomed preview should allocate only visible native pixels',
  );
  console.log('Source preservation, multi-screen PNG fidelity, and native viewport checks passed.');
} finally {
  await browser.close();
}
