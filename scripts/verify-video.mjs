import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4175';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.route('**/__video-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Video engine verification</title>',
    }),
  );
  await page.goto(`${base}/__video-test`);
  await page.evaluate(async () => {
    const exporter = await import('/src/engine/export.ts');
    const { createDefaults } = await import('/src/state/defaults.ts');
    const { loadImage } = await import('/src/engine/image.ts');
    const assets = { mockup: null, design: null, background: null, foreground: null };
    assets.mockup = await loadImage(
      await (await fetch('/assets/demo-mockup.png')).blob(),
      'demo-mockup.png',
    );
    assets.design = await loadImage(
      await (await fetch('/assets/demo-design.jpg')).blob(),
      'demo-design.jpg',
    );
    window.videoTest = { exporter, createDefaults, assets };
  });
  for (const [width, height, mode] of [
    [1920, 1080, 'maximum'],
    [3840, 2160, 'maximum'],
    [1920, 1080, 'realtime'],
  ]) {
    const output = await page.evaluate(
      async ({ width, height, mode }) => {
        const { exporter, createDefaults, assets } = window.videoTest;
        const composition = createDefaults();
        composition.video = {
          width,
          height,
          fps: 30,
          duration: 1,
          bitrate: 30,
          codec: 'auto',
          mode,
        };
        composition.motion.duration = 1;
        composition.motion.delay = 0;
        composition.motion.endHold = 0;
        const updates = [];
        const start = performance.now();
        const result = await exporter.renderVideo(composition, assets, (update) =>
          updates.push(update),
        );
        const video = document.createElement('video');
        const url = URL.createObjectURL(result.blob);
        video.src = url;
        video.muted = true;
        await new Promise((resolve, reject) => {
          video.onloadedmetadata = resolve;
          video.onerror = () => reject(new Error('Exported WebM cannot be decoded'));
        });
        const metadata = {
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration,
        };
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
        return {
          metadata,
          codec: result.codec,
          mode: result.mode,
          bytes: Array.from(new Uint8Array(await result.blob.arrayBuffer())),
          updates: updates.length,
          progress: updates.at(-1),
          elapsedMs: performance.now() - start,
        };
      },
      { width, height, mode },
    );
    assert.equal(output.metadata.width, width);
    assert.equal(output.metadata.height, height);
    assert.equal(output.progress.progress, 1);
    assert.equal(output.mode, mode === 'maximum' ? 'WebCodecs' : 'MediaRecorder');
    assert.ok(
      Math.abs(output.metadata.duration - 1) < 0.005,
      `Expected exact 1sec container, got ${output.metadata.duration}`,
    );
    assert.ok(output.bytes.length > 1000);
    await mkdir('test-results/exports', { recursive: true });
    await writeFile(
      path.join('test-results/exports', `${width}x${height}-${mode}.webm`),
      Buffer.from(output.bytes),
    );
    console.log(JSON.stringify({ ...output, bytes: output.bytes.length }));
  }
  const cancellation = await page.evaluate(async () => {
    const { exporter, createDefaults, assets } = window.videoTest;
    const composition = createDefaults();
    composition.video = {
      width: 1920,
      height: 1080,
      fps: 30,
      duration: 10,
      bitrate: 30,
      codec: 'auto',
      mode: 'maximum',
    };
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 75);
    try {
      await exporter.renderVideo(composition, assets, () => {}, controller.signal);
      return 'did not cancel';
    } catch (error) {
      return error.name;
    }
  });
  assert.equal(cancellation, 'AbortError');
  console.log(JSON.stringify({ cancellation }));
} finally {
  await browser.close();
}
