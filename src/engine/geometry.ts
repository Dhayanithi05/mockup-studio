import type { Assets, CompositionState, FitMode, Point, Quad } from '../types';

export const clamp = (value: number, min = 0, max = 1): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export const quadArea = (quad: Quad): number =>
  Math.abs(
    quad.reduce((sum, p, i) => {
      const q = quad[(i + 1) % 4];
      return sum + p.x * q.y - q.x * p.y;
    }, 0),
  ) / 2;
export function isConvexQuad(quad: Quad): boolean {
  if (!quad.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return false;
  const signs = quad.map((p, i) => {
    const b = quad[(i + 1) % 4],
      c = quad[(i + 2) % 4];
    return (b.x - p.x) * (c.y - b.y) - (b.y - p.y) * (c.x - b.x);
  });
  return signs.every((n) => n > 1e-9) || signs.every((n) => n < -1e-9);
}
export function quadDimensions(quad: Quad): { width: number; height: number } {
  return {
    width: (distance(quad[0], quad[1]) + distance(quad[3], quad[2])) / 2,
    height: (distance(quad[0], quad[3]) + distance(quad[1], quad[2])) / 2,
  };
}
export type Homography = [number, number, number, number, number, number, number, number, number];

/** Exact projective map from the unit square into a convex quad, ordered TL, TR, BR, BL. */
export function calculateHomography(quad: Quad): Homography {
  if (!isConvexQuad(quad)) throw new Error('The screen corners must form a convex quadrilateral.');
  const [p0, p1, p2, p3] = quad;
  const dx1 = p1.x - p2.x,
    dx2 = p3.x - p2.x,
    dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y,
    dy2 = p3.y - p2.y,
    dy3 = p0.y - p1.y + p2.y - p3.y;
  if (Math.abs(dx3) + Math.abs(dy3) < 1e-10)
    return [p1.x - p0.x, p3.x - p0.x, p0.x, p1.y - p0.y, p3.y - p0.y, p0.y, 0, 0, 1];
  const determinant = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(determinant) < 1e-12) throw new Error('The screen region is too narrow to render.');
  const g = (dx3 * dy2 - dx2 * dy3) / determinant,
    h = (dx1 * dy3 - dx3 * dy1) / determinant;
  return [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + h * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + h * p3.y,
    p0.y,
    g,
    h,
    1,
  ];
}
export function applyHomography(matrix: Homography, point: Point): Point {
  const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denominator,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denominator,
  };
}
export function invertHomography(m: Homography): Homography {
  const [a, b, c, d, e, f, g, h, i] = m;
  const result: Homography = [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ];
  const determinant = a * result[0] + b * result[3] + c * result[6];
  if (Math.abs(determinant) < 1e-12) throw new Error('The screen transformation is singular.');
  return result.map((value) => value / determinant) as Homography;
}

/** Inset is measured in natural mockup pixels in the screen's unwarped plane. */
export function insetQuad(quad: Quad, inset: number): Quad {
  if (!inset) return quad.map((p) => ({ ...p })) as Quad;
  const size = quadDimensions(quad),
    matrix = calculateHomography(quad);
  const u = clamp(inset / size.width, -0.5, 0.49),
    v = clamp(inset / size.height, -0.5, 0.49);
  return [
    { x: u, y: v },
    { x: 1 - u, y: v },
    { x: 1 - u, y: 1 - v },
    { x: u, y: 1 - v },
  ].map((point) => applyHomography(matrix, point)) as Quad;
}
export interface FitRect {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}
export function fitRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  mode: 'contain' | 'cover' = 'contain',
): FitRect {
  const scale = (mode === 'cover' ? Math.max : Math.min)(
    targetWidth / Math.max(1, sourceWidth),
    targetHeight / Math.max(1, sourceHeight),
  );
  const width = sourceWidth * scale,
    height = sourceHeight * scale;
  return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height, scale };
}
export function designScaleForFit(
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  mode: FitMode,
  customScale = 1,
): number {
  const widthScale = width / Math.max(1, sourceWidth),
    heightScale = height / Math.max(1, sourceHeight);
  if (mode === 'height') return heightScale;
  if (mode === 'contain') return Math.min(widthScale, heightScale);
  if (mode === 'cover') return Math.max(widthScale, heightScale);
  if (mode === 'actual') return 1;
  if (mode === 'custom') return Math.max(0.001, customScale);
  return widthScale;
}
export interface ScreenMetrics {
  width: number;
  height: number;
  sourceViewportHeight: number;
  maxScroll: number;
  designScale: number;
}
export function getScreenMetrics(composition: CompositionState, assets: Assets): ScreenMetrics {
  const mockupWidth = assets.mockup?.width ?? 700,
    mockupHeight = assets.mockup?.height ?? 525;
  const quad = composition.screen.quad.map((p) => ({
    x: p.x * mockupWidth,
    y: p.y * mockupHeight,
  })) as Quad;
  const rawSize = quadDimensions(quad);
  const width = Math.max(
    1,
    rawSize.width - 2 * clamp(composition.screen.inset, -rawSize.width / 2, rawSize.width * 0.49),
  );
  const height = Math.max(
    1,
    rawSize.height -
      2 * clamp(composition.screen.inset, -rawSize.height / 2, rawSize.height * 0.49),
  );
  const designScale = designScaleForFit(
    assets.design?.width ?? width,
    assets.design?.height ?? height,
    width,
    height,
    composition.designFit,
    composition.designScale,
  );
  const sourceViewportHeight = height / designScale;
  return {
    width,
    height,
    designScale,
    sourceViewportHeight,
    maxScroll: Math.max(0, (assets.design?.height ?? 0) - sourceViewportHeight),
  };
}
/** Placement in unwarped screen pixels, with scroll always measured in original design pixels. */
export function getDesignPlacement(composition: CompositionState, assets: Assets, scrollY: number) {
  const metrics = getScreenMetrics(composition, assets);
  const width = (assets.design?.width ?? 0) * metrics.designScale,
    height = (assets.design?.height ?? 0) * metrics.designScale;
  return {
    ...metrics,
    x: (metrics.width - width) / 2,
    y:
      height < metrics.height
        ? (metrics.height - height) / 2
        : -clamp(scrollY, 0, metrics.maxScroll) * metrics.designScale,
    designWidth: width,
    designHeight: height,
  };
}

export interface MockupTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  scale: number;
  width: number;
  height: number;
}
/** Maps natural mockup pixel coordinates into output raster coordinates. x/y framing offsets are percentages. */
export function getMockupTransform(
  composition: CompositionState,
  assets: Assets,
  width: number,
  height: number,
  currentTime = 0,
): MockupTransform {
  const naturalWidth = assets.mockup?.width ?? 700,
    naturalHeight = assets.mockup?.height ?? 525;
  const { output, motion } = composition;
  const baseScale =
    output.framing === 'original'
      ? width / Math.max(1, output.width)
      : (output.framing === 'fill' ? Math.max : Math.min)(
          width / naturalWidth,
          height / naturalHeight,
        );
  const duration = Math.max(0.001, motion.duration);
  const phase = clamp((motion.loop ? Math.max(0, currentTime) % duration : currentTime) / duration);
  const cameraScale =
    motion.camera === 'push'
      ? 1 + 0.04 * phase
      : motion.camera === 'pull'
        ? 1.04 - 0.04 * phase
        : 1;
  const scale = baseScale * Math.max(0.001, output.scale) * cameraScale;
  const angle = (output.rotation * Math.PI) / 180;
  const a = Math.cos(angle) * scale,
    b = Math.sin(angle) * scale,
    c = -b,
    d = a;
  const pan =
    motion.camera === 'left'
      ? -0.04 * phase * width
      : motion.camera === 'right'
        ? 0.04 * phase * width
        : 0;
  return {
    a,
    b,
    c,
    d,
    e:
      width / 2 + (output.x * width) / 100 + pan - (a * naturalWidth) / 2 - (c * naturalHeight) / 2,
    f: height / 2 + (output.y * height) / 100 - (b * naturalWidth) / 2 - (d * naturalHeight) / 2,
    scale,
    width: naturalWidth,
    height: naturalHeight,
  };
}
/** Input is normalized to original mockup dimensions; output is in output raster pixels. */
export function screenToOutput(
  point: Point,
  composition: CompositionState,
  assets: Assets,
  width: number,
  height: number,
  currentTime = 0,
): Point {
  const t = getMockupTransform(composition, assets, width, height, currentTime),
    x = point.x * t.width,
    y = point.y * t.height;
  return { x: t.a * x + t.c * y + t.e, y: t.b * x + t.d * y + t.f };
}
/** Exact inverse of screenToOutput, returning normalized natural mockup coordinates. */
export function outputToMockup(
  point: Point,
  composition: CompositionState,
  assets: Assets,
  width: number,
  height: number,
  currentTime = 0,
): Point {
  const t = getMockupTransform(composition, assets, width, height, currentTime),
    x = point.x - t.e,
    y = point.y - t.f,
    det = t.a * t.d - t.b * t.c;
  return { x: (t.d * x - t.c * y) / det / t.width, y: (-t.b * x + t.a * y) / det / t.height };
}
