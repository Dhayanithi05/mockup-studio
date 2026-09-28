import { describe, expect, it } from 'vitest';
import { createDefaults } from '../src/state/defaults';
import type { Assets, ImageAsset, Quad, TimelineKeyframe } from '../src/types';
import {
  applyHomography,
  calculateHomography,
  fitRect,
  getDesignPlacement,
  getMockupTransform,
  getScreenMetrics,
  insetQuad,
  invertHomography,
  isConvexQuad,
  outputToMockup,
  quadArea,
  screenToOutput,
} from '../src/engine/geometry';
import { cubicBezier, easing, scrollAtTime, timelineProgress } from '../src/engine/timeline';

const asset = (width: number, height: number): ImageAsset => ({
  id: 'test',
  name: 'source.png',
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
  design: asset(1440, 12000),
  background: null,
  foreground: null,
};
const composition = () => {
  const c = createDefaults();
  c.screen.quad = [
    { x: 0.1, y: 0.2 },
    { x: 0.9, y: 0.2 },
    { x: 0.9, y: 0.7 },
    { x: 0.1, y: 0.7 },
  ];
  return c;
};

describe('source-coordinate layout', () => {
  it('fits a tall design by width and calculates its original-pixel scroll range', () => {
    const m = getScreenMetrics(composition(), assets);
    expect(m.width).toBeCloseTo(800);
    expect(m.height).toBeCloseTo(400);
    expect(m.designScale).toBeCloseTo(800 / 1440);
    expect(m.sourceViewportHeight).toBeCloseTo(720);
    expect(m.maxScroll).toBeCloseTo(11280);
  });
  it('centers contain-fit designs and correctly disables vertical scrolling', () => {
    const c = composition();
    c.designFit = 'contain';
    const p = getDesignPlacement(c, assets, 5000);
    expect(p.maxScroll).toBe(0);
    expect(p.x).toBeCloseTo(376);
    expect(p.y).toBeCloseTo(0);
  });
  it('does not stretch a short design in width-fit mode', () => {
    const p = getDesignPlacement(composition(), { ...assets, design: asset(1440, 300) }, 10000);
    expect(p.maxScroll).toBe(0);
    expect(p.y).toBeCloseTo((400 - (300 * 800) / 1440) / 2);
  });
  it('clamps source scroll at both ends', () => {
    expect(getDesignPlacement(composition(), assets, -200).y).toBeCloseTo(0);
    const p = getDesignPlacement(composition(), assets, 1e7);
    expect(p.y + p.designHeight).toBeCloseTo(p.height);
  });
  it('supports 1:1 actual size and absolute custom source scaling', () => {
    const c = composition();
    c.designFit = 'actual';
    expect(getScreenMetrics(c, assets).designScale).toBe(1);
    c.designFit = 'custom';
    c.designScale = 2;
    expect(getScreenMetrics(c, assets).sourceViewportHeight).toBe(200);
  });
  it('reduces the viewport in natural mockup pixels when applying inset', () => {
    const c = composition();
    c.screen.inset = 10;
    const m = getScreenMetrics(c, assets);
    expect(m.width).toBe(780);
    expect(m.height).toBeCloseTo(380);
  });
});
describe('framing and normalized coordinates', () => {
  it('contains or crops instead of distorting aspect ratio', () => {
    expect(fitRect(1000, 500, 800, 800)).toEqual({
      x: 0,
      y: 200,
      width: 800,
      height: 400,
      scale: 0.8,
    });
    expect(fitRect(1000, 500, 800, 800, 'cover')).toEqual({
      x: -400,
      y: 0,
      width: 1600,
      height: 800,
      scale: 1.6,
    });
  });
  it('maps normalized coordinates reversibly through rotation, framing and camera', () => {
    const c = composition();
    c.output.rotation = 31;
    c.output.scale = 1.37;
    c.output.x = -12;
    c.output.y = 8;
    c.motion.camera = 'push';
    const p = { x: 0.123, y: 0.783 };
    const output = screenToOutput(p, c, assets, 1080, 1920, 6);
    const recovered = outputToMockup(output, c, assets, 1080, 1920, 6);
    expect(recovered.x).toBeCloseTo(p.x, 10);
    expect(recovered.y).toBeCloseTo(p.y, 10);
  });
  it('keeps framing identical at preview and export resolutions', () => {
    const c = composition();
    c.output.rotation = -7;
    c.output.x = 3;
    c.motion.camera = 'right';
    const preview = screenToOutput({ x: 0.7, y: 0.3 }, c, assets, 960, 540, 4),
      full = screenToOutput({ x: 0.7, y: 0.3 }, c, assets, 3840, 2160, 4);
    expect(full.x).toBeCloseTo(preview.x * 4);
    expect(full.y).toBeCloseTo(preview.y * 4);
  });
  it('preserves mockup aspect when changing landscape to portrait', () => {
    const c = composition(),
      t = getMockupTransform(c, assets, 1080, 1920);
    expect(t.a).toBe(t.d);
    expect(t.width / t.height).toBe(1.25);
  });
});
describe('projective mapping and masks', () => {
  const quad: Quad = [
    { x: 70, y: 40 },
    { x: 900, y: 180 },
    { x: 670, y: 700 },
    { x: 150, y: 590 },
  ];
  it('maps all four exact homography corners', () => {
    const h = calculateHomography(quad);
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ].forEach((p, i) => {
      const q = applyHomography(h, p);
      expect(q.x).toBeCloseTo(quad[i].x, 9);
      expect(q.y).toBeCloseTo(quad[i].y, 9);
    });
  });
  it('uses projective perspective, not a bilinear bounding-box stretch', () => {
    const h = calculateHomography(quad),
      p = applyHomography(h, { x: 0.5, y: 0.5 });
    expect(Math.abs(p.x - quad.reduce((sum, q) => sum + q.x, 0) / 4)).toBeGreaterThan(5);
    const inverse = applyHomography(invertHomography(h), p);
    expect(inverse.x).toBeCloseTo(0.5, 10);
    expect(inverse.y).toBeCloseTo(0.5, 10);
  });
  it('rejects crossed, concave and zero-area regions', () => {
    expect(isConvexQuad(quad)).toBe(true);
    expect(isConvexQuad([quad[0], quad[2], quad[1], quad[3]])).toBe(false);
    expect(() =>
      calculateHomography([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ]),
    ).toThrow();
  });
  it('insets a rectangle exactly and contracts a perspective mask', () => {
    const rectangle: Quad = [
      { x: 0, y: 0 },
      { x: 800, y: 0 },
      { x: 800, y: 400 },
      { x: 0, y: 400 },
    ];
    expect(insetQuad(rectangle, 10)).toEqual([
      { x: 10, y: 10 },
      { x: 790, y: 10 },
      { x: 790, y: 390 },
      { x: 10, y: 390 },
    ]);
    expect(quadArea(insetQuad(quad, 20))).toBeLessThan(quadArea(quad));
  });
});
describe('deterministic motion', () => {
  it('has bounded easing and the expected cubic midpoint', () => {
    expect(easing(-5, 'easeIn')).toBe(0);
    expect(easing(5, 'easeOut')).toBe(1);
    expect(easing(0.25, 'easeInOut')).toBeCloseTo(0.0625);
    expect(easing(0.5, 'easeInOut')).toBe(0.5);
  });
  it('solves custom bezier x instead of treating time as its curve parameter', () => {
    expect(cubicBezier(0.5, [0, 0, 1, 1])).toBeCloseTo(0.5, 6);
    expect(cubicBezier(0.25, [0.42, 0, 0.58, 1])).toBeCloseTo(0.12916, 4);
    expect(cubicBezier(1, [0.42, 0, 0.58, 1])).toBe(1);
  });
  it('holds the hero and footer around cinematic scroll', () => {
    const c = composition(),
      m = getScreenMetrics(c, assets);
    c.motion.duration = 12;
    c.motion.delay = 1;
    c.motion.endHold = 1.5;
    expect(scrollAtTime(0.5, c, assets)).toBe(0);
    expect(scrollAtTime(5.75, c, assets)).toBeCloseTo(m.maxScroll / 2);
    expect(scrollAtTime(11, c, assets)).toBe(m.maxScroll);
    expect(scrollAtTime(100, c, assets)).toBe(m.maxScroll);
  });
  it('auto mode scrolls at source pixels per second independently from export size', () => {
    const c = composition();
    c.motion.mode = 'auto';
    c.motion.speed = 250;
    c.motion.delay = 1;
    expect(scrollAtTime(3, c, assets)).toBeCloseTo(500);
    c.output.width = 7680;
    c.output.height = 4320;
    expect(scrollAtTime(3, c, assets)).toBeCloseTo(500);
  });
  it('reverses direction and loops including the hold duration', () => {
    const c = composition();
    c.motion.direction = 'up';
    const max = getScreenMetrics(c, assets).maxScroll;
    expect(scrollAtTime(0, c, assets)).toBe(max);
    expect(scrollAtTime(12, c, assets)).toBe(0);
    c.motion.loop = true;
    expect(scrollAtTime(12, c, assets)).toBe(max);
  });
  it('manual motion uses the chosen source offset at any timestamp', () => {
    const c = composition();
    c.motion.mode = 'manual';
    c.scrollY = 1234;
    expect(scrollAtTime(1000, c, assets)).toBe(1234);
  });
  it('interpolates per-segment easing, pauses, and sorted keyframes', () => {
    const frames: TimelineKeyframe[] = [
      { id: 'end', time: 10, progress: 1, easing: 'linear' },
      { id: 'start', time: 0, progress: 0, easing: 'linear' },
      { id: 'hold', time: 2, progress: 0, easing: 'easeIn' },
    ];
    expect(timelineProgress(1, frames)).toBe(0);
    expect(timelineProgress(6, frames)).toBeCloseTo(0.125);
    expect(timelineProgress(10, frames)).toBe(1);
    expect(frames[0].id).toBe('end');
  });
  it('handles duplicate timestamps without dividing by zero', () => {
    const frames: TimelineKeyframe[] = [
      { id: 'a', time: 0, progress: 0, easing: 'linear' },
      { id: 'b', time: 0, progress: 0.5, easing: 'linear' },
      { id: 'c', time: 1, progress: 1, easing: 'linear' },
    ];
    expect(timelineProgress(0, frames)).toBe(0.5);
    expect(timelineProgress(0.5, frames)).toBe(0.75);
  });
});
