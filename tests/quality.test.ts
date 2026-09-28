import { describe, expect, it } from 'vitest';
import { getQualityReport, nativeMockupOutput } from '../src/engine/quality';
import { createDefaults } from '../src/state/defaults';
import type { Assets, ImageAsset } from '../src/types';

const asset = (width: number, height: number): ImageAsset => ({
  id: 'source',
  name: 'original.png',
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
  design: asset(800, 1600),
  background: null,
  foreground: null,
};
function composition() {
  const c = createDefaults();
  c.screen.quad = [
    { x: 0.1, y: 0.2 },
    { x: 0.9, y: 0.2 },
    { x: 0.9, y: 0.7 },
    { x: 0.1, y: 0.7 },
  ];
  return nativeMockupOutput(c, assets);
}

describe('source resolution reporting', () => {
  it('reports an exact one-to-one mockup and front-facing design at native size', () => {
    const report = getQualityReport(composition(), assets, 1000, 800);
    expect(report.mockupScale).toBe(1);
    expect(report.designScale).toBeCloseTo(1);
    expect(report.designMinScale).toBeCloseTo(1);
    expect(report.upsampled).toBe(false);
    expect(report.downsampled).toBe(false);
  });
  it('accounts for actual export dimensions and camera zoom, not preview size', () => {
    const c = composition();
    c.motion.camera = 'push';
    const report = getQualityReport(c, assets, 2000, 1600, c.motion.duration);
    expect(report.mockupScale).toBeCloseTo(2.08);
    expect(report.designScale).toBeCloseTo(2.08);
    expect(report.upsampled).toBe(true);
  });
  it('reports each enabled screen rather than assuming the primary has the worst sampling', () => {
    const c = composition();
    c.extraScreens = [
      {
        ...c.screen,
        name: 'Phone',
        quad: [
          { x: 0.1, y: 0.2 },
          { x: 0.5, y: 0.2 },
          { x: 0.5, y: 0.7 },
          { x: 0.1, y: 0.7 },
        ],
      },
    ];
    let report = getQualityReport(c, assets, 1000, 800);
    expect(report.screens).toHaveLength(2);
    expect(report.screens[1].name).toBe('Phone');
    expect(report.screens[1].maxScale).toBeCloseTo(0.5);
    expect(report.designMinScale).toBeCloseTo(0.5);
    expect(report.downsampled).toBe(true);
    c.extraScreens[0].enabled = false;
    report = getQualityReport(c, assets, 1000, 800);
    expect(report.screens).toHaveLength(1);
    expect(report.downsampled).toBe(false);
  });
  it('detects local enlargement in an angled screen even when average width looks safe', () => {
    const c = composition();
    c.screen.quad = [
      { x: 0.4, y: 0.1 },
      { x: 0.6, y: 0.1 },
      { x: 0.95, y: 0.9 },
      { x: 0.05, y: 0.9 },
    ];
    const report = getQualityReport(c, assets, 1000, 800);
    expect(report.designScale).toBeGreaterThan(1);
    expect(report.designMinScale).toBeLessThan(1);
    expect(report.upsampled).toBe(true);
    expect(report.downsampled).toBe(true);
  });
  it('does not fabricate design measurements when no design is loaded', () => {
    const report = getQualityReport(composition(), { ...assets, design: null }, 1000, 800);
    expect(report.designScale).toBe(0);
    expect(report.screens).toEqual([]);
  });
});

describe('native mockup output', () => {
  it('restores exact native pixels and PNG without changing sources or screen content', () => {
    const c = composition();
    c.output = {
      ...c.output,
      width: 3840,
      height: 2160,
      scale: 2,
      x: 20,
      y: 30,
      rotation: 45,
      opacity: 0.5,
    };
    c.screenshot = { ...c.screenshot, scale: 4, format: 'jpeg' };
    const before = structuredClone(c);
    const next = nativeMockupOutput(c, assets);
    expect(next.output).toMatchObject({
      width: 1000,
      height: 800,
      framing: 'fit',
      scale: 1,
      x: 0,
      y: 0,
      rotation: 0,
      opacity: 1,
    });
    expect(next.screenshot).toMatchObject({ format: 'png', scale: 1 });
    expect(next.video).toMatchObject({ width: 1000, height: 800 });
    expect(next.screen).toBe(c.screen);
    expect(next.motion).toBe(c.motion);
    expect(c).toEqual(before);
  });
  it('does not change output settings before a mockup is loaded', () => {
    const c = composition();
    expect(nativeMockupOutput(c, { ...assets, mockup: null })).toBe(c);
  });
});
