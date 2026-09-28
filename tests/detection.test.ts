import { describe, expect, it } from 'vitest';
import {
  detectionQuadArea,
  detectionIntersectionArea,
  distinctDetectionCandidates,
  isConvexDetectionQuad,
  orderDetectionQuad,
  preferInsetDetectionScreens,
  refineDetectionQuad,
  scoreDetectionQuad,
  selectDetectedScreens,
} from '../src/engine/detection-geometry';
import type { Quad } from '../src/types';

const quad: Quad = [
  { x: 20, y: 20 },
  { x: 180, y: 20 },
  { x: 180, y: 110 },
  { x: 20, y: 110 },
];
const photo = () => {
  const pixels = new Uint8ClampedArray(200 * 150 * 4).fill(255);
  for (let y = 21; y < 110; y++)
    for (let x = 21; x < 180; x++) {
      const offset = (y * 200 + x) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 16;
    }
  return pixels;
};

describe('screen candidate geometry', () => {
  it('orders shuffled points without changing their source objects', () => {
    const points = [quad[2], quad[0], quad[3], quad[1]];
    expect(orderDetectionQuad(points)).toEqual(quad);
    expect(points[0]).toEqual(quad[2]);
    expect(detectionQuadArea(quad)).toBe(14400);
  });

  it('rejects concave, crossed, degenerate, and invalid quadrilaterals', () => {
    expect(
      isConvexDetectionQuad([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 40, y: 40 },
        { x: 0, y: 100 },
      ]),
    ).toBe(false);
    expect(isConvexDetectionQuad([quad[0], quad[2], quad[1], quad[3]])).toBe(false);
    expect(isConvexDetectionQuad([quad[0], quad[0], quad[2], quad[3]])).toBe(false);
    expect(orderDetectionQuad([{ x: NaN, y: 0 }, ...quad.slice(1)])).toBeNull();
  });

  it('recovers the actual straight edges from a rounded contour', () => {
    const rounded: Quad = [
      { x: 28, y: 20 },
      { x: 180, y: 28 },
      { x: 172, y: 110 },
      { x: 20, y: 102 },
    ];
    const contour = [
      { x: 28, y: 20 },
      { x: 172, y: 20 },
      { x: 180, y: 28 },
      { x: 180, y: 102 },
      { x: 172, y: 110 },
      { x: 28, y: 110 },
      { x: 20, y: 102 },
      { x: 20, y: 28 },
    ];
    const result = refineDetectionQuad(rounded, contour);
    for (let index = 0; index < 4; index++) {
      expect(result[index].x).toBeCloseTo(quad[index].x);
      expect(result[index].y).toBeCloseTo(quad[index].y);
    }
  });

  it('scores a strong internal display boundary above a weak uniform-photo rectangle', () => {
    const strong = scoreDetectionQuad(quad, 200, 150, photo(), 'edge')!;
    const weak = scoreDetectionQuad(
      quad,
      200,
      150,
      new Uint8ClampedArray(200 * 150 * 4).fill(255),
      'edge',
    )!;
    expect(strong).toBeGreaterThan(0.8);
    expect(strong - weak).toBeGreaterThan(0.12);
    expect(strong).toBeLessThanOrEqual(0.98);
  });

  it('rejects outer image boundaries, tiny cards, and narrow table-leg shapes', () => {
    const imageBoundary: Quad = [
      { x: 1, y: 1 },
      { x: 198, y: 1 },
      { x: 198, y: 148 },
      { x: 1, y: 148 },
    ];
    const tiny: Quad = [
      { x: 50, y: 50 },
      { x: 55, y: 50 },
      { x: 55, y: 55 },
      { x: 50, y: 55 },
    ];
    const leg: Quad = [
      { x: 50, y: 20 },
      { x: 62, y: 20 },
      { x: 62, y: 130 },
      { x: 50, y: 130 },
    ];
    for (const shape of [imageBoundary, tiny, leg])
      expect(scoreDetectionQuad(shape, 200, 150, photo(), 'edge')).toBeNull();
  });

  it('gives an enclosed transparent screen high confidence but rejects an opaque alpha candidate', () => {
    const pixels = photo();
    expect(scoreDetectionQuad(quad, 200, 150, pixels, 'alpha')).toBeNull();
    for (let y = 21; y < 110; y++) for (let x = 21; x < 180; x++) pixels[(y * 200 + x) * 4 + 3] = 0;
    expect(scoreDetectionQuad(quad, 200, 150, pixels, 'alpha')).toBeGreaterThan(0.9);
  });

  it('keeps perspective displays and ranks/deduplicates normalized suggestions', () => {
    const perspective: Quad = [
      { x: 30, y: 30 },
      { x: 175, y: 15 },
      { x: 160, y: 115 },
      { x: 45, y: 120 },
    ];
    expect(scoreDetectionQuad(perspective, 200, 150, photo(), 'edge')).not.toBeNull();
    const normalized = quad.map((p) => ({ x: p.x / 200, y: p.y / 150 })) as Quad;
    const nearby = normalized.map((p) => ({ x: p.x + 0.005, y: p.y + 0.005 })) as Quad;
    const separate = normalized.map((p) => ({ x: p.x * 0.4, y: p.y * 0.4 })) as Quad;
    const candidates = distinctDetectionCandidates([
      { quad: normalized, confidence: 0.6, label: 'weak' },
      { quad: nearby, confidence: 0.91, label: 'strong' },
      { quad: separate, confidence: 0.72, label: 'other' },
    ]);
    expect(candidates.map((c) => c.label)).toEqual(['strong', 'other']);
  });

  it('prefers a nested display over a slightly stronger outer dark device bezel', () => {
    const outer: Quad = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ];
    const inner: Quad = [
      { x: 0.15, y: 0.15 },
      { x: 0.85, y: 0.15 },
      { x: 0.85, y: 0.85 },
      { x: 0.15, y: 0.85 },
    ];
    const ranked = distinctDetectionCandidates(
      preferInsetDetectionScreens(
        [
          { quad: outer, confidence: 0.95, label: 'Device' },
          { quad: inner, confidence: 0.92, label: 'Screen' },
        ],
        200,
        150,
        new Uint8ClampedArray(200 * 150 * 4),
      ),
    );
    expect(ranked[0].label).toBe('Screen');
  });
});

describe('multiple physical screen selection', () => {
  const rectangle = (x: number, y: number, w: number, h: number): Quad => [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  const candidate = (quad: Quad, label: string, confidence = 0.9) => ({ quad, label, confidence });

  it('computes polygon overlap, including containment and reversed winding', () => {
    const a = rectangle(0.1, 0.1, 0.4, 0.4);
    const b = rectangle(0.3, 0.3, 0.4, 0.4);
    expect(detectionIntersectionArea(a, b)).toBeCloseTo(0.04);
    expect(detectionIntersectionArea(b, a)).toBeCloseTo(0.04);
    expect(detectionIntersectionArea(a, [...b].reverse() as Quad)).toBeCloseTo(0.04);
    expect(detectionIntersectionArea(a, rectangle(0.2, 0.2, 0.1, 0.1))).toBeCloseTo(0.01);
    expect(detectionIntersectionArea(a, rectangle(0.7, 0.1, 0.1, 0.1))).toBe(0);
  });

  it('retains distinct perspective displays whose bounding boxes overlap', () => {
    const a: Quad = [
      { x: 0.1, y: 0.1 },
      { x: 0.7, y: 0.7 },
      { x: 0.6, y: 0.8 },
      { x: 0, y: 0.2 },
    ];
    const b: Quad = [
      { x: 0.4, y: 0.1 },
      { x: 1, y: 0.7 },
      { x: 0.9, y: 0.8 },
      { x: 0.3, y: 0.2 },
    ];
    expect(detectionIntersectionArea(a, b)).toBeCloseTo(0);
    expect(
      selectDetectedScreens([candidate(b, 'right'), candidate(a, 'left')]).map((c) => c.label),
    ).toEqual(['left', 'right']);
  });

  it('suppresses nested bezels and overlapping alternatives for each screen', () => {
    const input = [
      candidate(rectangle(0.05, 0.1, 0.35, 0.7), 'left bezel', 0.83),
      candidate(rectangle(0.08, 0.13, 0.29, 0.61), 'left screen', 0.93),
      candidate(rectangle(0.07, 0.13, 0.29, 0.61), 'left alternative', 0.9),
      candidate(rectangle(0.55, 0.1, 0.35, 0.7), 'right bezel', 0.83),
      candidate(rectangle(0.58, 0.13, 0.29, 0.61), 'right screen', 0.92),
    ];
    expect(selectDetectedScreens(input).map((c) => c.label)).toEqual([
      'left screen',
      'right screen',
    ]);
    expect(input).toHaveLength(5);
  });

  it('does not let a shared surrounding frame hide separate physical displays', () => {
    const result = selectDetectedScreens([
      candidate(rectangle(0.03, 0.03, 0.94, 0.85), 'shared frame', 0.97),
      candidate(rectangle(0.09, 0.1, 0.32, 0.64), 'left', 0.88),
      candidate(rectangle(0.56, 0.1, 0.32, 0.64), 'right', 0.87),
    ]);
    expect(result.map((c) => c.label)).toEqual(['left', 'right']);
  });

  it('keeps low-confidence suggestions available without auto-applying them', () => {
    const inputs = [candidate(rectangle(0.1, 0.1, 0.3, 0.4), 'uncertain', 0.64)];
    expect(distinctDetectionCandidates(inputs)).toHaveLength(1);
    expect(selectDetectedScreens(inputs)).toEqual([]);
    expect(selectDetectedScreens([])).toEqual([]);
  });

  it('preserves more than the former five-suggestion limit', () => {
    const inputs = Array.from({ length: 8 }, (_, i) =>
      candidate(
        rectangle(0.04 + (i % 4) * 0.24, 0.05 + Math.floor(i / 4) * 0.45, 0.17, 0.32),
        `screen ${i + 1}`,
      ),
    );
    expect(distinctDetectionCandidates(inputs)).toHaveLength(8);
    expect(selectDetectedScreens(inputs)).toHaveLength(8);
  });

  it('keeps a small screen interior available until bezel ranking has run', () => {
    const bezel = candidate(rectangle(0.1, 0.1, 0.18, 0.35), 'bezel', 0.9);
    const screen = candidate(rectangle(0.11, 0.115, 0.16, 0.31), 'screen', 0.88);
    const distinct = distinctDetectionCandidates([bezel, screen]);
    expect(distinct).toHaveLength(2);
    const ranked = preferInsetDetectionScreens(
      distinct,
      200,
      150,
      new Uint8ClampedArray(200 * 150 * 4),
    );
    expect(selectDetectedScreens(ranked).map((c) => c.label)).toEqual(['screen']);
  });

  it('does not auto-apply invalid or crossed polygons', () => {
    const valid = rectangle(0.1, 0.1, 0.3, 0.5);
    const crossed: Quad = [valid[0], valid[2], valid[1], valid[3]];
    expect(
      selectDetectedScreens([
        candidate(valid, 'invalid confidence', NaN),
        candidate(crossed, 'crossed'),
        candidate(rectangle(-0.1, 0.1, 0.5, 0.5), 'outside image'),
        candidate(valid, 'valid'),
      ]).map((c) => c.label),
    ).toEqual(['valid']);
  });
});
