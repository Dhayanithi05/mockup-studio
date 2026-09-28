import { describe, expect, it } from 'vitest';
import { createDefaults } from '../src/state/defaults';
import type { Assets, CompositionState, ImageAsset } from '../src/types';
import { getScreenMetrics } from '../src/engine/geometry';
import { scrollAtTime } from '../src/engine/timeline';
import {
  ASPECT_RATIOS,
  MOTION_PRESETS,
  OUTPUT_RECIPES,
  QUALITY_PRESETS,
  RESOLUTION_PRESETS,
  applyMotionPreset,
  applyOutputRecipe,
  applyQualityPreset,
  applyResolutionPreset,
  matchAspectRatio,
  matchMotionPreset,
  matchOutputRecipe,
  matchQualityPreset,
  matchResolutionPreset,
  qualityBitrate,
  reconcileAutoDuration,
  resizeComposition,
  setCompositionAspect,
  setCompositionDuration,
  setCompositionFrameRate,
  updateMotionSettings,
} from '../src/engine/presets';

const asset = (width: number, height: number): ImageAsset => ({
  id: 'source',
  name: 'original.png',
  width,
  height,
  size: 42,
  type: 'image/png',
  blob: new Blob(),
  bitmap: {} as ImageBitmap,
  url: 'blob:source',
});
const assets: Assets = {
  mockup: asset(1000, 800),
  design: asset(1440, 12000),
  background: null,
  foreground: null,
};
const empty: Assets = { mockup: null, design: null, background: null, foreground: null };

function customized(): CompositionState {
  const result = createDefaults();
  result.name = 'My saved composition';
  result.motion = {
    ...result.motion,
    mode: 'timeline',
    direction: 'up',
    duration: 51,
    delay: 9,
    endHold: 7,
    speed: 777,
    camera: 'left',
    loop: true,
    easing: 'bezier',
    bezier: [0.1, 0.9, 0.8, 0.2],
    keyframes: [{ id: 'edited', time: 32, progress: 0.23, easing: 'easeIn' }],
  };
  result.output = { ...result.output, x: 12, y: 34, scale: 1.9, rotation: 72, opacity: 0.6 };
  result.screenshot = {
    ...result.screenshot,
    filename: 'my-project',
    scale: 3,
    quality: 0.71,
    format: 'jpeg',
  };
  result.video = {
    ...result.video,
    duration: 51,
    bitrate: 87,
    fps: 24,
    codec: 'vp8',
    mode: 'realtime',
  };
  result.screen.radius = 23;
  result.scrollY = 1000;
  return result;
}

describe('complete motion presets', () => {
  it.each(MOTION_PRESETS)(
    '$label replaces the entire motion and reaches both endpoints',
    (preset) => {
      const source = customized(),
        before = structuredClone(source);
      const result = applyMotionPreset(source, assets, preset.id);
      expect(source).toEqual(before);
      expect(result.motion.mode).toBe(preset.mode);
      expect(result.motion.direction).toBe('down');
      expect(result.motion.loop).toBe(false);
      expect(result.motion.camera).toBe(preset.camera);
      expect(result.motion.bezier).toEqual([0.42, 0, 0.58, 1]);
      expect(result.motion.easing).toBe(preset.easing);
      expect(result.motion.speed).toBe(preset.speed);
      expect(result.motion.delay).toBe(preset.delay);
      expect(result.motion.endHold).toBe(preset.endHold);
      expect(result.motion.keyframes.map((frame) => frame.time)).toEqual([
        0,
        result.motion.delay,
        result.motion.duration - result.motion.endHold,
        result.motion.duration,
      ]);
      expect(result.motion.keyframes.map((frame) => frame.progress)).toEqual([0, 0, 1, 1]);
      expect(scrollAtTime(0, result, assets)).toBe(0);
      const maxScroll = getScreenMetrics(result, assets).maxScroll;
      expect(
        scrollAtTime(result.motion.duration - result.motion.endHold, result, assets),
      ).toBeCloseTo(maxScroll, 6);
      expect(scrollAtTime(result.motion.duration, result, assets)).toBe(maxScroll);
      expect(result.video.duration).toBe(result.motion.duration);
      expect(result.scrollY).toBe(0);
      expect(result.output).toEqual(source.output);
      expect(result.screenshot).toEqual(source.screenshot);
      expect(result.screen).toEqual(source.screen);
      expect(result.designFit).toBe(source.designFit);
      expect(result.name).toBe(source.name);
      expect(matchMotionPreset(result, assets)).toBe(preset.id);
    },
  );

  it('auto duration traverses a tall design even when it takes longer than the old duration', () => {
    const result = applyMotionPreset(createDefaults(), assets, 'slow');
    expect(result.motion.duration).toBeGreaterThan(60);
    expect(result.motion.duration).toBeGreaterThanOrEqual(
      getScreenMetrics(result, assets).maxScroll / result.motion.speed +
        result.motion.delay +
        result.motion.endHold,
    );
  });

  it('every preset can follow every other preset without carrying settings across', () => {
    for (const previous of MOTION_PRESETS)
      for (const next of MOTION_PRESETS) {
        const initial = createDefaults();
        expect(
          applyMotionPreset(applyMotionPreset(initial, assets, previous.id), assets, next.id)
            .motion,
        ).toEqual(applyMotionPreset(initial, assets, next.id).motion);
      }
  });

  it('matches defaults by values, and reports edits as custom without relying on a preset id', () => {
    expect(matchMotionPreset(createDefaults(), assets)).toBe('ux');
    const result = applyMotionPreset(createDefaults(), assets, 'product');
    result.motion.keyframes[0].id = 'new-id';
    expect(matchMotionPreset(result, assets)).toBe('product');
    result.motion.direction = 'up';
    expect(matchMotionPreset(result, assets)).toBe('custom');
  });

  it('has valid timing with no design or with a short contained design', () => {
    for (const preset of MOTION_PRESETS)
      for (const sourceAssets of [empty, { ...assets, design: asset(1440, 200) }]) {
        const result = applyMotionPreset(createDefaults(), sourceAssets, preset.id);
        expect(result.motion.duration).toBeGreaterThan(result.motion.delay + result.motion.endHold);
        expect(scrollAtTime(result.motion.duration, result, sourceAssets)).toBe(0);
      }
  });

  it('reconciles auto duration after speed, source-fit, and pause changes', () => {
    const result = applyMotionPreset(createDefaults(), assets, 'slow');
    result.motion.speed = 20;
    result.motion.delay = 3;
    result.motion.endHold = 2;
    const updated = reconcileAutoDuration(result, assets);
    expect(updated.motion.duration).toBeGreaterThan(result.motion.duration);
    expect(updated.video.duration).toBe(updated.motion.duration);
    expect(scrollAtTime(updated.motion.duration - 2, updated, assets)).toBeCloseTo(
      getScreenMetrics(updated, assets).maxScroll,
    );
    expect(reconcileAutoDuration(createDefaults(), assets).motion.duration).toBe(12);
  });

  it('loops on the displayed duration instead of resetting during the rounded final hold', () => {
    const result = applyMotionPreset(createDefaults(), assets, 'slow');
    result.motion.loop = true;
    const maxScroll = getScreenMetrics(result, assets).maxScroll;
    expect(scrollAtTime(result.motion.duration - 0.0001, result, assets)).toBe(maxScroll);
    expect(scrollAtTime(result.motion.duration, result, assets)).toBe(0);
    expect(scrollAtTime(result.motion.duration * 2, result, assets)).toBe(0);
    expect(scrollAtTime(result.motion.duration + 5, result, assets)).toBeCloseTo(
      scrollAtTime(5, result, assets),
    );
  });

  it('preserves a full auto traversal for legacy compositions with a shorter stored duration', () => {
    const result = applyMotionPreset(createDefaults(), assets, 'slow');
    result.motion.loop = true;
    result.motion.duration = 12;
    const maxScroll = getScreenMetrics(result, assets).maxScroll;
    const cycle = result.motion.delay + maxScroll / result.motion.speed + result.motion.endHold;
    expect(scrollAtTime(12, result, assets)).toBeGreaterThan(0);
    expect(scrollAtTime(cycle - 0.001, result, assets)).toBe(maxScroll);
    expect(scrollAtTime(cycle, result, assets)).toBe(0);
  });

  it('keeps the final pixel through a short auto sequence and its duration edits', () => {
    const source = createDefaults();
    const viewportHeight = getScreenMetrics(source, assets).sourceViewportHeight;
    const shortAssets = { ...assets, design: asset(1440, viewportHeight + 1) };
    const preset = applyMotionPreset(source, shortAssets, 'fast');
    expect(preset.motion.duration).toBe(1);
    const result = setCompositionDuration(preset, 0.5);
    result.motion.loop = true;
    const maxScroll = getScreenMetrics(result, shortAssets).maxScroll;
    expect(maxScroll).toBeCloseTo(1);
    expect(scrollAtTime(0.49, result, shortAssets)).toBe(maxScroll);
    expect(scrollAtTime(0.5, result, shortAssets)).toBe(0);
    expect(scrollAtTime(0.99, result, shortAssets)).toBe(maxScroll);
  });
});

describe('resolution and aspect presets', () => {
  it.each(RESOLUTION_PRESETS)('$label synchronizes the canvas and video size', (preset) => {
    const source = customized();
    const result = applyResolutionPreset(source, assets, preset.id);
    expect([result.output.width, result.output.height]).toEqual([preset.width, preset.height]);
    expect([result.video.width, result.video.height]).toEqual([preset.width, preset.height]);
    expect(matchResolutionPreset(result, assets)).toBe(preset.id);
    expect(result.motion).toEqual(source.motion);
    expect(result.output.x).toBe(source.output.x);
    expect(result.screenshot).toEqual(source.screenshot);
  });

  it('original resolution uses the actual source and refuses an unavailable source', () => {
    const result = applyResolutionPreset(createDefaults(), assets, 'original');
    expect([result.output.width, result.output.height]).toEqual([1000, 800]);
    expect(matchResolutionPreset(result, assets)).toBe('original');
    expect(() => applyResolutionPreset(result, empty, 'original')).toThrow('Upload a mockup');
  });

  it.each(ASPECT_RATIOS)('$label uses the exact ratio and even dimensions', (ratio) => {
    const result = setCompositionAspect(createDefaults(), ratio.id);
    expect(result.output.width * ratio.height).toBe(result.output.height * ratio.width);
    expect(result.output.width % 2).toBe(0);
    expect(result.output.height % 2).toBe(0);
    expect(matchAspectRatio(result)).toBe(ratio.id);
  });

  it('round-trips every ratio repeatedly without pixel drift or canvas growth', () => {
    const source = createDefaults();
    let result = source;
    for (let i = 0; i < 20; i++) {
      for (const ratio of ASPECT_RATIOS) result = setCompositionAspect(result, ratio.id);
      result = setCompositionAspect(result, '16:9');
      expect([result.output.width, result.output.height]).toEqual([3840, 2160]);
    }
  });

  it('stabilizes arbitrary pixel dimensions on the common ratio grid', () => {
    let result = resizeComposition(createDefaults(), 809, 633);
    result = setCompositionAspect(result, '16:9');
    const stable = [result.output.width, result.output.height];
    for (const ratio of ASPECT_RATIOS) result = setCompositionAspect(result, ratio.id);
    result = setCompositionAspect(result, '16:9');
    expect([result.output.width, result.output.height]).toEqual(stable);
  });
});

describe('quality presets and output recipes', () => {
  it.each([
    ...RESOLUTION_PRESETS,
    { id: 'tiny', label: 'Tiny custom canvas', width: 16, height: 16 },
    { id: 'maximum-size', label: 'Maximum custom dimensions', width: 16384, height: 16384 },
  ])(
    '$label keeps all four quality tiers distinct at every supported frame-rate range',
    (resolution) => {
      for (const fps of [1, 24, 25, 30, 50, 60, 120]) {
        const source = setCompositionFrameRate(
          resizeComposition(createDefaults(), resolution.width, resolution.height),
          fps,
        );
        const rates = QUALITY_PRESETS.map((preset) => {
          const result = applyQualityPreset(source, preset.id);
          expect(matchQualityPreset(result)).toBe(preset.id);
          expect(result.video.bitrate).toBeGreaterThanOrEqual(preset.minBitrate);
          expect(result.video.bitrate).toBeLessThanOrEqual(preset.maxBitrate);
          return result.video.bitrate;
        });
        expect(new Set(rates).size).toBe(QUALITY_PRESETS.length);
        expect(rates).toEqual([...rates].sort((a, b) => a - b));
      }
    },
  );

  it('retains each tier when switching between the smallest and largest video presets', () => {
    for (const preset of QUALITY_PRESETS) {
      let result = applyQualityPreset(createDefaults(), preset.id);
      result = setCompositionFrameRate(resizeComposition(result, 7680, 4320), 60);
      expect(matchQualityPreset(result)).toBe(preset.id);
      result = resizeComposition(result, 16, 16);
      expect(result.video.bitrate).toBe(preset.minBitrate);
      expect(matchQualityPreset(result)).toBe(preset.id);
      result = setCompositionFrameRate(resizeComposition(result, 1920, 1080), 30);
      expect(result.video.bitrate).toBe(preset.baseBitrate);
      expect(matchQualityPreset(result)).toBe(preset.id);
    }
  });

  it.each(QUALITY_PRESETS)(
    '$label adapts bitrate to pixels and frames and matches applied values',
    (preset) => {
      const hd = resizeComposition(createDefaults(), 1920, 1080);
      const applied = applyQualityPreset(hd, preset.id);
      expect(applied.video.bitrate).toBe(preset.baseBitrate);
      expect(matchQualityPreset(applied)).toBe(preset.id);
      const uhd = setCompositionFrameRate(resizeComposition(applied, 3840, 2160), 60);
      expect(uhd.video.bitrate).toBeGreaterThan(applied.video.bitrate);
      expect(uhd.video.bitrate).toBeLessThanOrEqual(120);
      expect(matchQualityPreset(uhd)).toBe(preset.id);
      const eightK = resizeComposition(uhd, 7680, 4320);
      expect(matchQualityPreset(eightK)).toBe(preset.id);
    },
  );

  it('keeps a custom bitrate when changing resolution or frame rate', () => {
    const source = createDefaults();
    source.video.bitrate = 37;
    const result = setCompositionFrameRate(resizeComposition(source, 1920, 1080), 60);
    expect(result.video.bitrate).toBe(37);
    expect(matchQualityPreset(result)).toBe('custom');
    expect(qualityBitrate({ width: 3840, height: 2160, fps: 60 }, 'maximum')).toBe(120);
  });

  it.each(OUTPUT_RECIPES)(
    '$label resets its advertised scene, motion, and export settings',
    (recipe) => {
      const source = customized(),
        before = structuredClone(source);
      const result = applyOutputRecipe(source, assets, recipe.id);
      expect(source).toEqual(before);
      expect(matchOutputRecipe(result, assets)).toBe(recipe.id);
      expect(matchMotionPreset(result, assets)).toBe(recipe.motion);
      expect([result.output.width, result.output.height]).toEqual([recipe.width, recipe.height]);
      expect([result.video.width, result.video.height]).toEqual([recipe.width, recipe.height]);
      expect(result.output.framing).toBe('fit');
      expect(result.output.rotation).toBe(0);
      expect(result.output.x).toBe(0);
      expect(result.output.y).toBe(0);
      expect(result.output.opacity).toBe(1);
      expect(result.output.scale).toBe(recipe.scale);
      expect(result.video.fps).toBe(recipe.fps);
      expect(result.video.bitrate).toBe(qualityBitrate(recipe, recipe.quality));
      expect(result.video.duration).toBe(result.motion.duration);
      expect(result.video.mode).toBe('maximum');
      expect(result.video.codec).toBe('auto');
      expect(result.screenshot.format).toBe('png');
      expect(result.screenshot.scale).toBe(1);
      expect(result.screenshot.filename).toBe(source.screenshot.filename);
      expect(result.screen).toEqual(source.screen);
      expect(result.designFit).toBe(source.designFit);
      expect(result.designScale).toBe(source.designScale);
      expect(result.name).toBe(source.name);
      expect(scrollAtTime(result.motion.duration, result, assets)).toBe(
        getScreenMetrics(result, assets).maxScroll,
      );
      result.output.x = 10;
      expect(matchOutputRecipe(result, assets)).toBe('custom');
    },
  );

  it('every output recipe is independent of the preceding recipe', () => {
    const initial = customized();
    for (const previous of OUTPUT_RECIPES)
      for (const next of OUTPUT_RECIPES) {
        expect(
          applyOutputRecipe(applyOutputRecipe(initial, assets, previous.id), assets, next.id),
        ).toEqual(applyOutputRecipe(initial, assets, next.id));
      }
  });
});

describe('duration edits and validation', () => {
  it('rescales pauses and custom keyframes, preserving the relative motion and both endpoints', () => {
    const source = applyMotionPreset(createDefaults(), assets, 'ux');
    const result = setCompositionDuration(source, 3);
    expect(result.motion.duration).toBe(3);
    expect(result.video.duration).toBe(3);
    expect(result.motion.delay).toBe(0.25);
    expect(result.motion.endHold).toBe(0.375);
    expect(result.motion.keyframes.map((frame) => frame.time)).toEqual(
      source.motion.keyframes.map((frame) => frame.time / 4),
    );
    expect(scrollAtTime(1.5, result, assets)).toBeCloseTo(scrollAtTime(6, source, assets));
    expect(setCompositionDuration(result, 12).motion).toEqual(source.motion);
  });

  it('duration edits in auto mode change actual speed, not just the timeline ruler', () => {
    const source = applyMotionPreset(createDefaults(), assets, 'slow');
    const result = setCompositionDuration(source, source.motion.duration / 2);
    expect(result.motion.speed).toBe(source.motion.speed * 2);
    expect(scrollAtTime(result.motion.duration / 2, result, assets)).toBeCloseTo(
      scrollAtTime(source.motion.duration / 2, source, assets),
    );
    expect(scrollAtTime(result.motion.duration, result, assets)).toBe(
      getScreenMetrics(result, assets).maxScroll,
    );
  });

  it('repairs impossible holds without using the whole active duration', () => {
    const source = createDefaults();
    source.motion.delay = 100;
    source.motion.endHold = 100;
    const result = setCompositionDuration(source, 1);
    expect(result.motion.delay + result.motion.endHold).toBeLessThan(1);
    expect(scrollAtTime(1, result, assets)).toBe(getScreenMetrics(result, assets).maxScroll);
  });

  it('manual control edits synchronize auto playback and constrain cinematic pauses together', () => {
    const source = createDefaults();
    const auto = updateMotionSettings(source, assets, {
      mode: 'auto',
      speed: 140,
      delay: 2,
      endHold: 4,
    });
    expect(auto.motion.duration).toBeGreaterThan(60);
    expect(auto.video.duration).toBe(auto.motion.duration);
    expect(scrollAtTime(auto.motion.duration, auto, assets)).toBe(
      getScreenMetrics(auto, assets).maxScroll,
    );
    const cinematic = updateMotionSettings(source, assets, { delay: 50, endHold: 70 });
    expect(cinematic.motion.delay + cinematic.motion.endHold).toBeCloseTo(12 * 0.95);
    expect(cinematic.motion.delay / cinematic.motion.endHold).toBeCloseTo(50 / 70);
    expect(scrollAtTime(12, cinematic, assets)).toBe(getScreenMetrics(cinematic, assets).maxScroll);
  });

  it('entering timeline creates the current motion and keeps custom waypoints meaningful on pause edits', () => {
    const source = updateMotionSettings(createDefaults(), assets, {
      easing: 'easeOut',
      delay: 2,
      endHold: 3,
    });
    const timeline = updateMotionSettings(source, assets, { mode: 'timeline' });
    expect(scrollAtTime(5.5, timeline, assets)).toBeCloseTo(scrollAtTime(5.5, source, assets));
    timeline.motion.keyframes.splice(2, 0, {
      id: 'detail',
      time: 5.5,
      progress: 0.5,
      easing: 'easeOut',
    });
    const edited = updateMotionSettings(timeline, assets, {
      delay: 1,
      endHold: 1,
      easing: 'linear',
    });
    expect(edited.motion.keyframes.find((frame) => frame.id === 'detail')?.time).toBe(6);
    expect(edited.motion.keyframes.find((frame) => frame.id === 'detail')?.progress).toBe(0.5);
    expect(scrollAtTime(6, edited, assets)).toBeCloseTo(
      getScreenMetrics(edited, assets).maxScroll / 2,
    );
    expect(scrollAtTime(12, edited, assets)).toBe(getScreenMetrics(edited, assets).maxScroll);
  });

  it('restores zero-length timeline holds without losing endpoints or custom waypoints', () => {
    const source = updateMotionSettings(createDefaults(), assets, { mode: 'timeline' });
    source.motion.keyframes.splice(2, 0, {
      id: 'detail',
      time: 5.5,
      progress: 0.37,
      easing: 'easeOut',
    });
    let result = source;
    for (let i = 0; i < 3; i++) {
      result = updateMotionSettings(result, assets, { delay: 0, endHold: 0 });
      result = updateMotionSettings(result, assets, {
        delay: source.motion.delay,
        endHold: source.motion.endHold,
      });
      expect(result.motion.keyframes).toHaveLength(source.motion.keyframes.length);
      result.motion.keyframes.forEach((frame, index) => {
        const expected = source.motion.keyframes[index];
        expect(frame.time).toBeCloseTo(expected.time, 10);
        expect({ ...frame, time: expected.time }).toEqual(expected);
      });
      expect(scrollAtTime(source.motion.delay / 2, result, assets)).toBe(0);
      expect(scrollAtTime(source.motion.duration - source.motion.endHold / 2, result, assets)).toBe(
        getScreenMetrics(result, assets).maxScroll,
      );
    }
  });

  it('adds a start hold to a timeline converted from a preset with no delay', () => {
    const source = applyMotionPreset(createDefaults(), assets, 'fast');
    const timeline = updateMotionSettings(source, assets, { mode: 'timeline' });
    const result = updateMotionSettings(timeline, assets, { delay: 2 });
    expect(result.motion.keyframes[0].time).toBe(0);
    expect(result.motion.keyframes[1].time).toBe(2);
    expect(scrollAtTime(1, result, assets)).toBe(0);
    expect(scrollAtTime(2, result, assets)).toBe(0);
    expect(scrollAtTime(3, result, assets)).toBeGreaterThan(0);
  });

  it('rejects unknown ids and invalid values instead of silently selecting another preset', () => {
    const source = createDefaults();
    expect(() => applyMotionPreset(source, assets, 'missing')).toThrow('Unknown motion');
    expect(() => applyOutputRecipe(source, assets, 'missing')).toThrow('Unknown output');
    expect(() => applyResolutionPreset(source, assets, 'missing')).toThrow('Unknown resolution');
    expect(() => applyQualityPreset(source, 'missing')).toThrow('Unknown quality');
    expect(() => setCompositionAspect(source, 'missing')).toThrow('Unknown aspect');
    expect(() => setCompositionDuration(source, 0)).toThrow('Duration');
    expect(() => setCompositionDuration(source, NaN)).toThrow('Duration');
    expect(() => resizeComposition(source, 1080.5, 1920)).toThrow('whole pixels');
    expect(() => setCompositionFrameRate(source, 0)).toThrow('Frame rate');
  });
});
