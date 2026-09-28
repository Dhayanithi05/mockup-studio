import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// Run against the settled development server; source edits during this test trigger HMR.
const baseURL = process.env.MOCKUP_STUDIO_URL || 'http://127.0.0.1:4175';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
await mkdir('test-results/presets', { recursive: true });
let checks = 0;

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(baseURL);
  await page.waitForFunction(() =>
    document.querySelector('.asset-metadata strong')?.textContent.includes('Portfolio'),
  );

  // Import the exact module URL used by the app; Vite may append a cache key.
  const state = () =>
    page.evaluate(async () => {
      const loaded = (fragment) =>
        performance.getEntriesByType('resource').find((entry) => entry.name.includes(fragment))
          ?.name || fragment;
      const { useEditor } = await import(loaded('/src/state/store.ts'));
      const presets = await import(loaded('/src/engine/presets.ts'));
      const { getScreenMetrics } = await import(loaded('/src/engine/geometry.ts'));
      const { scrollAtTime } = await import(loaded('/src/engine/timeline.ts'));
      const s = useEditor.getState();
      return {
        c: s.composition,
        time: s.time,
        playing: s.playing,
        maxScroll: getScreenMetrics(s.composition, s.assets).maxScroll,
        endScroll: scrollAtTime(s.composition.motion.duration, s.composition, s.assets),
        motionPreset: presets.matchMotionPreset(s.composition, s.assets),
        outputRecipe: presets.matchOutputRecipe(s.composition, s.assets),
        qualityPreset: presets.matchQualityPreset(s.composition),
      };
    });

  const poisonSettings = () =>
    page.evaluate(async () => {
      const url = performance
        .getEntriesByType('resource')
        .find((entry) => entry.name.includes('/src/state/store.ts'))?.name;
      const { useEditor } = await import(url || '/src/state/store.ts');
      const s = useEditor.getState();
      s.update({
        scrollY: 64,
        motion: {
          ...s.composition.motion,
          mode: 'timeline',
          speed: 777,
          direction: 'up',
          duration: 27,
          delay: 8,
          endHold: 9,
          loop: true,
          easing: 'bezier',
          bezier: [0.1, 0.8, 0.9, 0.2],
          camera: 'right',
          keyframes: [{ id: 'stale', time: 17, progress: 0.3, easing: 'bezier' }],
        },
        output: {
          ...s.composition.output,
          framing: 'custom',
          x: 37,
          y: -12,
          scale: 1.4,
          rotation: 22,
          opacity: 0.4,
          background: 'transparent',
        },
        screenshot: { ...s.composition.screenshot, format: 'jpeg', quality: 0.6, scale: 3 },
        video: { ...s.composition.video, duration: 27, fps: 25, bitrate: 17, mode: 'realtime' },
      });
      s.ui({ time: 4, playing: false });
    });

  const nav = (name) => page.locator('nav').getByRole('button', { name, exact: true }).click();
  const number = async (label, value) => {
    const input = page.getByLabel(label, { exact: true });
    await input.fill(String(value));
    await input.press('Tab');
  };
  const motionButton = (label) =>
    page.getByRole('button', { name: `Motion preset ${label}`, exact: true });
  const recipeButton = (label) =>
    page.getByRole('button', { name: `Output recipe ${label}`, exact: true });
  const resolution = page.getByLabel('Resolution preset', { exact: true });

  await page.evaluate(() => document.fonts.ready);
  const font = await page.evaluate(() => ({
    body: getComputedStyle(document.body).fontFamily,
    controls: [...document.querySelectorAll('button, input, select')].map(
      (element) => getComputedStyle(element).fontFamily,
    ),
    loaded: [...document.fonts].some(
      (face) => face.family.includes('Space Grotesk') && face.status === 'loaded',
    ),
    sources: performance
      .getEntriesByType('resource')
      .filter((entry) => /\.woff2?(?:\?|$)/.test(entry.name))
      .map((entry) => entry.name),
  }));
  assert.match(font.body, /Space Grotesk/);
  assert.ok(font.controls.every((family) => /Space Grotesk/.test(family)));
  assert.equal(font.loaded, true, 'Space Grotesk must finish loading, not merely be named in CSS');
  assert.ok(
    font.sources.some((url) => url.startsWith(baseURL)),
    'Serve the font locally',
  );
  checks++;

  await nav('Motion');
  for (const [id, label, mode, speed, duration, delay, endHold, easing, camera] of [
    ['ux', 'UX Case Study', 'cinematic', 180, 12, 1, 1.5, 'easeInOut', 'none'],
    ['slow', 'Portfolio Slow', 'auto', 140, null, 1, 1, 'linear', 'none'],
    ['product', 'Product Showcase', 'cinematic', 360, 10, 0.5, 1, 'easeOut', 'push'],
    ['fast', 'Fast Overview', 'auto', 1000, null, 0, 0.5, 'linear', 'none'],
    ['reel', 'Social Reel', 'cinematic', 500, 8, 0.5, 0.5, 'easeInOut', 'none'],
  ]) {
    await poisonSettings();
    await motionButton(label).click();
    const s = await state();
    const m = s.c.motion;
    assert.equal(s.motionPreset, id, `${label} must be recognized after applying`);
    assert.equal(await motionButton(label).getAttribute('aria-pressed'), 'true');
    assert.equal(m.mode, mode);
    assert.equal(m.speed, speed);
    assert.equal(m.delay, delay);
    assert.equal(m.endHold, endHold);
    assert.equal(m.easing, easing);
    assert.equal(m.camera, camera);
    assert.equal(m.direction, 'down');
    assert.equal(m.loop, false);
    assert.deepEqual(m.bezier, [0.42, 0, 0.58, 1]);
    assert.equal(m.keyframes.length, 4);
    assert.deepEqual(
      m.keyframes.map((frame) => frame.progress),
      [0, 0, 1, 1],
    );
    assert.equal(m.keyframes.at(-1).time, m.duration);
    assert.equal(s.c.video.duration, m.duration);
    assert.equal(s.time, 0);
    assert.equal(s.c.scrollY, 0);
    assert.equal(s.playing, false);
    assert.ok(Math.abs(s.endScroll - s.maxScroll) < 0.001, `${label} must reach the design end`);
    if (duration) assert.equal(m.duration, duration);
    else assert.ok(Math.abs(m.duration - (s.maxScroll / speed + delay + endHold)) < 0.02);
    // A motion selection must preserve independently edited framing and image export settings.
    assert.equal(s.c.output.rotation, 22);
    assert.equal(s.c.screenshot.format, 'jpeg');
    await page.getByLabel('Direction', { exact: true }).selectOption('up');
    assert.equal((await state()).motionPreset, 'custom');
    assert.equal(await motionButton(label).getAttribute('aria-pressed'), 'false');
    checks++;
  }

  await motionButton('UX Case Study').click();
  await number('Duration', 1);
  let s = await state();
  assert.equal(s.c.video.duration, 1);
  assert.ok(s.c.motion.delay + s.c.motion.endHold < 1);
  assert.ok(s.c.motion.keyframes.every((frame) => frame.time >= 0 && frame.time <= 1));
  assert.ok(s.endScroll >= s.maxScroll - 0.001);
  checks++;

  await motionButton('Portfolio Slow').click();
  await page.getByRole('slider', { name: 'Scroll speed', exact: true }).press('End');
  s = await state();
  assert.equal(s.c.motion.speed, 1500);
  assert.equal(s.c.video.duration, s.c.motion.duration);
  assert.ok(
    Math.abs(s.c.motion.duration - (s.maxScroll / 1500 + s.c.motion.delay + s.c.motion.endHold)) <
      0.02,
    'Changing auto speed must update playback and export duration',
  );
  assert.equal(s.motionPreset, 'custom');
  checks++;

  await motionButton('Fast Overview').click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor({ timeout: 20000 });
  s = await state();
  assert.ok(
    s.c.scrollY >= s.maxScroll - 0.001,
    'Actual playback must reach the final design pixel',
  );
  assert.ok(Math.abs(s.time - s.c.motion.duration) < 0.001);
  checks++;

  await motionButton('UX Case Study').click();
  await page.getByLabel('Scroll mode', { exact: true }).selectOption('timeline');
  await page.getByRole('button', { name: 'Seek to keyframe at 10.5s', exact: true }).click();
  s = await state();
  assert.equal(s.time, 10.5, 'Timeline keyframes must be clickable above the scrub range');
  assert.ok(s.c.scrollY >= s.maxScroll - 0.001);
  checks++;

  await nav('Export');
  for (const [label, width, height] of [
    ['Portfolio 4K', 3840, 2160],
    ['Full HD', 1920, 1080],
    ['QHD / 2K', 2560, 1440],
    ['5K', 5120, 2880],
    ['6K', 6016, 3384],
    ['8K', 7680, 4320],
    ['Instagram Portrait', 1080, 1350],
    ['Instagram Square', 1080, 1080],
    ['Story / Reel', 1080, 1920],
    ['YouTube Thumbnail', 1280, 720],
    ['Behance Cover', 808, 632],
    ['Dribbble', 1600, 1200],
    ['original', 700, 525],
  ]) {
    await resolution.selectOption(label);
    s = await state();
    assert.equal(s.c.output.width, width, label);
    assert.equal(s.c.output.height, height, label);
    assert.equal(s.c.video.width, width, label);
    assert.equal(s.c.video.height, height, label);
    assert.equal(await resolution.inputValue(), label, `${label} must stay selected`);
    checks++;
  }
  await number('Width', 1234);
  assert.equal(await resolution.inputValue(), 'custom');
  const customResolution = (await state()).c.output;
  await resolution.selectOption('custom');
  assert.deepEqual((await state()).c.output, customResolution);
  checks++;

  await resolution.selectOption('Portfolio 4K');
  for (let round = 0; round < 3; round++) {
    for (const [label, width, height] of [
      ['9:16', 9, 16],
      ['1:1', 1, 1],
      ['4:5', 4, 5],
      ['3:2', 3, 2],
      ['4:3', 4, 3],
      ['16:9', 16, 9],
    ]) {
      await page.getByRole('button', { name: label, exact: true }).click();
      const { output } = (await state()).c;
      assert.equal(output.width * height, output.height * width, `Exact ${label} ratio`);
      assert.equal(
        Math.min(output.width, output.height),
        2160,
        'Aspect changes cannot grow the short edge',
      );
      assert.equal(output.width % 2, 0);
      assert.equal(output.height % 2, 0);
    }
  }
  s = await state();
  assert.equal(s.c.output.width, 3840);
  assert.equal(s.c.output.height, 2160);
  checks++;

  await page.getByRole('button', { name: 'Video', exact: true }).click();
  await resolution.selectOption('Full HD');
  await page.getByLabel('Frame rate', { exact: true }).selectOption('30');
  const quality = page.getByLabel('Quality preset', { exact: true });
  for (const [id, bitrate] of [
    ['standard', 16],
    ['high', 24],
    ['very', 32],
    ['maximum', 45],
  ]) {
    await quality.selectOption(id);
    assert.equal((await state()).c.video.bitrate, bitrate);
    assert.equal(await quality.inputValue(), id);
    checks++;
  }
  await quality.selectOption('high');
  await resolution.selectOption('Portfolio 4K');
  assert.equal((await state()).c.video.bitrate, 48);
  await page.getByLabel('Frame rate', { exact: true }).selectOption('60');
  assert.equal((await state()).c.video.bitrate, 68);
  assert.equal(await quality.inputValue(), 'high');
  const beforeCustomChoice = (await state()).c.video.bitrate;
  await quality.selectOption('custom');
  assert.equal(
    (await state()).c.video.bitrate,
    beforeCustomChoice,
    'Custom must not set an arbitrary bitrate',
  );
  await number('Video bitrate', 17);
  assert.equal(await quality.inputValue(), 'custom');
  await resolution.selectOption('Full HD');
  assert.equal((await state()).c.video.bitrate, 17, 'Custom bitrate must survive a size change');
  await number('Duration', 3);
  s = await state();
  assert.equal(s.c.motion.duration, 3);
  assert.equal(s.c.video.duration, 3);
  checks++;

  for (const [id, label, width, height, motion, fps, scale, background] of [
    ['portfolio', 'Portfolio 4K', 3840, 2160, 'ux', 30, 1, 'original'],
    ['cinematic', 'Cinematic', 3840, 2160, 'product', 60, 0.88, 'gradient'],
    ['reel', 'Instagram Reel', 1080, 1920, 'reel', 30, 1, 'gradient'],
    ['post', 'Instagram Post', 1080, 1350, 'ux', 30, 1, 'color'],
    ['behance', 'Behance Landscape', 1920, 1440, 'slow', 30, 1, 'original'],
    ['youtube', 'YouTube', 1920, 1080, 'product', 60, 1, 'original'],
  ]) {
    await poisonSettings();
    await recipeButton(label).click();
    s = await state();
    assert.equal(s.outputRecipe, id, `${label} recipe must fully reset inherited settings`);
    assert.equal(await recipeButton(label).getAttribute('aria-pressed'), 'true');
    assert.equal(s.motionPreset, motion);
    assert.equal(s.c.output.width, width);
    assert.equal(s.c.output.height, height);
    assert.equal(s.c.output.framing, 'fit');
    assert.equal(s.c.output.x, 0);
    assert.equal(s.c.output.y, 0);
    assert.equal(s.c.output.rotation, 0);
    assert.equal(s.c.output.opacity, 1);
    assert.equal(s.c.output.scale, scale);
    assert.equal(s.c.output.background, background);
    assert.equal(s.c.screenshot.format, 'png');
    assert.equal(s.c.screenshot.scale, 1);
    assert.equal(s.c.screenshot.quality, 0.95);
    assert.equal(s.c.video.width, width);
    assert.equal(s.c.video.height, height);
    assert.equal(s.c.video.fps, fps);
    assert.equal(s.c.video.codec, 'auto');
    assert.equal(s.c.video.mode, 'maximum');
    assert.equal(s.time, 0);
    assert.equal(s.c.scrollY, 0);
    assert.equal(s.playing, false);
    await number('Horizontal', 1);
    assert.equal((await state()).outputRecipe, 'custom');
    assert.equal(await recipeButton(label).getAttribute('aria-pressed'), 'false');
    checks++;
  }

  // Presets should remain one reversible editor action, with selection derived from state.
  await recipeButton('Instagram Reel').click();
  const beforeUndo = (await state()).c;
  await recipeButton('Portfolio 4K').click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual((await state()).c, beforeUndo);
  assert.equal(await recipeButton('Instagram Reel').getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.equal((await state()).outputRecipe, 'portfolio');
  checks++;

  for (const viewport of [
    { width: 1440, height: 950 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    for (const tab of ['Motion', 'Export']) {
      await nav(tab);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({
        path: `test-results/presets/${tab.toLowerCase()}-${viewport.width}.png`,
      });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: 'test-results/presets/export-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    `${checks} preset acceptance checks passed: motion, auto completion, duration, all resolutions, aspect stability, adaptive quality, complete output recipes, undo/redo, and locally loaded Space Grotesk. Five layout screenshots saved in test-results/presets.`,
  );
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) {
    console.log(await page.locator('body').ariaSnapshot());
    await page.screenshot({ path: 'test-results/presets/failure.png' });
  }
  throw error;
} finally {
  await browser.close();
}
