import { describe, expect, it } from 'vitest';
import { createDefaults } from '../src/state/defaults';
import { getScreenMetrics } from '../src/engine/geometry';
import {
  getScreens,
  screenComposition,
  screenEnabled,
  screenScrollAtTime,
  updateScreen,
  getScrollReference,
  compositionScrollAtTime,
} from '../src/engine/screens';
import { applyMotionPreset } from '../src/engine/presets';
import type { Assets, ImageAsset, Quad } from '../src/types';

const asset = (width: number, height: number): ImageAsset => ({
  id: 'test',
  name: 'test.png',
  width,
  height,
  blob: new Blob(),
  url: '',
  bitmap: {} as ImageBitmap,
  type: 'image/png',
  size: 0,
});
const assets: Assets = {
  mockup: asset(1000, 800),
  design: asset(500, 3000),
  background: null,
  foreground: null,
};
const quad = (height: number): Quad => [
  { x: 0.1, y: 0.1 },
  { x: 0.6, y: 0.1 },
  { x: 0.6, y: 0.1 + height / 800 },
  { x: 0.1, y: 0.1 + height / 800 },
];
const composition = () => {
  const c = createDefaults();
  c.screen = { ...c.screen, id: 'primary', quad: quad(500) };
  c.extraScreens = [{ ...structuredClone(c.screen), id: 'secondary', quad: quad(250) }];
  return c;
};

describe('multiple screen project compatibility', () => {
  it('loads legacy projects as one enabled screen', () => {
    const c = createDefaults();
    expect(getScreens(c)).toEqual([c.screen]);
    expect(screenEnabled(c.screen)).toBe(true);
  });
  it('retains stable primary-first ordering including disabled screens for editing', () => {
    const c = composition();
    c.extraScreens![0].enabled = false;
    expect(getScreens(c).map((screen) => screen.id)).toEqual(['primary', 'secondary']);
    expect(screenEnabled(getScreens(c)[1])).toBe(false);
  });
  it('provides local screen geometry without modifying the shared composition', () => {
    const c = composition();
    const view = screenComposition(c, 1);
    expect(view.screen).toBe(c.extraScreens![0]);
    expect(view.output).toBe(c.output);
    expect(c.screen.id).toBe('primary');
    expect(getScreenMetrics(view, assets).maxScroll).toBe(2750);
  });
  it('updates each screen independently and preserves unrelated metadata', () => {
    const c = composition();
    const primary = updateScreen(c, 0, { inset: 3 });
    expect(primary.screen!.inset).toBe(3);
    expect(primary.screen!.id).toBe('primary');
    expect(primary.extraScreens).toBeUndefined();
    const secondary = updateScreen(c, 1, { brightness: 105 });
    expect(secondary.extraScreens![0].brightness).toBe(105);
    expect(secondary.screen).toBeUndefined();
    expect(c.extraScreens![0].brightness).toBe(100);
  });
  it('ignores edits to missing screen indices', () => {
    expect(updateScreen(composition(), 4, { enabled: false })).toEqual({});
    expect(updateScreen(composition(), -1, { enabled: false })).toEqual({});
  });
});

describe('synchronized original-resolution scrolling', () => {
  it('maps manual positions proportionally into each original source viewport', () => {
    const c = composition();
    c.motion.mode = 'manual';
    c.scrollY = 1250;
    expect(screenScrollAtTime(0, c, assets, 0)).toBe(1250);
    expect(screenScrollAtTime(0, c, assets, 1)).toBe(1375);
    expect(screenScrollAtTime(0, c, assets, 1, 2500)).toBe(2750);
  });
  it('uses explicit preview positions consistently even in an animated mode', () => {
    const c = composition();
    expect(screenScrollAtTime(0, c, assets, 1, 1250)).toBe(1375);
    expect(screenScrollAtTime(0, c, assets, 1, 1e9)).toBe(2750);
  });
  it('reaches both footers together when auto screens have different heights', () => {
    const c = composition();
    c.motion = { ...c.motion, mode: 'auto', speed: 500, delay: 1, endHold: 1, duration: 7 };
    expect(screenScrollAtTime(3.5, c, assets, 0)).toBe(1250);
    expect(screenScrollAtTime(3.5, c, assets, 1)).toBe(1375);
    expect(screenScrollAtTime(6, c, assets, 0)).toBe(2500);
    expect(screenScrollAtTime(6, c, assets, 1)).toBe(2750);
  });
  it('preserves reverse and looping auto motion', () => {
    const c = composition();
    c.motion = {
      ...c.motion,
      mode: 'auto',
      speed: 500,
      delay: 1,
      endHold: 1,
      duration: 7,
      direction: 'up',
      loop: true,
    };
    expect(screenScrollAtTime(0, c, assets, 1)).toBe(2750);
    expect(screenScrollAtTime(6, c, assets, 1)).toBe(0);
    expect(screenScrollAtTime(10.5, c, assets, 1)).toBe(1375);
  });
  it('uses the shared timeline with independently fitted source windows', () => {
    const c = composition();
    c.motion.mode = 'timeline';
    c.motion.direction = 'down';
    c.motion.keyframes = [
      { id: 'a', time: 0, progress: 0, easing: 'linear' },
      { id: 'b', time: 10, progress: 1, easing: 'linear' },
    ];
    expect(screenScrollAtTime(5, c, assets, 0)).toBe(1250);
    expect(screenScrollAtTime(5, c, assets, 1)).toBe(1375);
  });
  it('handles a primary with no scroll without dividing by zero', () => {
    const c = composition();
    c.screen.quad = quad(3500);
    c.motion = { ...c.motion, mode: 'auto', speed: 550, delay: 1, endHold: 1, duration: 7 };
    expect(screenScrollAtTime(3.5, c, assets, 0)).toBe(0);
    expect(screenScrollAtTime(3.5, c, assets, 1)).toBe(1375);
    c.motion.mode = 'manual';
    expect(screenScrollAtTime(0, c, assets, 1)).toBe(0);
  });
  it('uses the same scrollable screen for presets, preview and exports', () => {
    const c = composition();
    c.screen.quad = quad(3500);
    const preset = applyMotionPreset(c, assets, 'slow');
    expect(getScrollReference(preset, assets).screen.id).toBe('secondary');
    expect(preset.motion.duration).toBeCloseTo(Math.ceil((2750 / 140 + 2) * 100) / 100);
    const end = compositionScrollAtTime(preset.motion.duration, preset, assets);
    expect(end).toBe(2750);
    expect(screenScrollAtTime(preset.motion.duration, preset, assets, 1, end)).toBe(2750);
  });
});
