import type { Assets, CompositionState, Quad } from '../types';
import {
  calculateHomography,
  getMockupTransform,
  getScreenMetrics,
  insetQuad,
  isConvexQuad,
  screenToOutput,
} from './geometry';
import { getScreens, screenComposition, screenEnabled } from './screens';

export interface ScreenQuality {
  index: number;
  name: string;
  /** Estimated output pixels per original design pixel, including perspective. */
  minScale: number;
  maxScale: number;
}

export interface QualityReport {
  width: number;
  height: number;
  /** Output pixels per original mockup pixel. */
  mockupScale: number;
  /** Largest estimated local design magnification among enabled screens. */
  designScale: number;
  designMinScale: number;
  screens: ScreenQuality[];
  upsampled: boolean;
  downsampled: boolean;
}

/**
 * Restore a native-size, lossless still output without changing source assets or
 * screen calibration. Motion settings stay intact; animated camera zoom remains
 * visible in the quality report for the selected frame.
 */
export function nativeMockupOutput(
  composition: CompositionState,
  assets: Assets,
): CompositionState {
  if (!assets.mockup) return composition;
  const { width, height } = assets.mockup;
  return {
    ...composition,
    output: {
      ...composition.output,
      width,
      height,
      framing: 'fit',
      scale: 1,
      x: 0,
      y: 0,
      rotation: 0,
      opacity: 1,
    },
    screenshot: { ...composition.screenshot, format: 'png', scale: 1, quality: 1 },
    video: { ...composition.video, width, height },
  };
}

/** Singular values give pixel magnification in the most/least stretched directions. */
function singularScales(a: number, b: number, c: number, d: number) {
  const sum = a * a + b * b + c * c + d * d;
  const determinant = a * d - b * c;
  const difference = Math.sqrt(Math.max(0, sum * sum - 4 * determinant * determinant));
  return {
    min: Math.sqrt(Math.max(0, (sum - difference) / 2)),
    max: Math.sqrt(Math.max(0, (sum + difference) / 2)),
  };
}

/**
 * Report source sampling, not an invented sharpness score. Perspective estimates
 * sample local Jacobians over a 5 × 5 grid including all corners and edges; an
 * average edge length alone hides enlargement at the near edge of an angled screen.
 */
export function getQualityReport(
  composition: CompositionState,
  assets: Assets,
  width: number,
  height: number,
  currentTime = 0,
): QualityReport {
  const transform = getMockupTransform(composition, assets, width, height, currentTime);
  const screens: ScreenQuality[] = [];
  if (assets.design) {
    getScreens(composition).forEach((screen, index) => {
      if (!screenEnabled(screen) || !isConvexQuad(screen.quad)) return;
      const local = screenComposition(composition, index);
      const metrics = getScreenMetrics(local, assets);
      const natural = screen.quad.map((point) => ({
        x: point.x * transform.width,
        y: point.y * transform.height,
      })) as Quad;
      const projected = insetQuad(natural, screen.inset).map((point) =>
        screenToOutput(
          { x: point.x / transform.width, y: point.y / transform.height },
          composition,
          assets,
          width,
          height,
          currentTime,
        ),
      ) as Quad;
      const h = calculateHomography(projected);
      const sourceU = metrics.designScale / metrics.width;
      const sourceV = metrics.designScale / metrics.height;
      let minScale = Infinity;
      let maxScale = 0;
      for (let y = 0; y <= 4; y++) {
        for (let x = 0; x <= 4; x++) {
          const u = x / 4;
          const v = y / 4;
          const denominator = h[6] * u + h[7] * v + h[8];
          const numeratorX = h[0] * u + h[1] * v + h[2];
          const numeratorY = h[3] * u + h[4] * v + h[5];
          const squared = denominator * denominator;
          const scales = singularScales(
            ((h[0] * denominator - numeratorX * h[6]) / squared) * sourceU,
            ((h[1] * denominator - numeratorX * h[7]) / squared) * sourceV,
            ((h[3] * denominator - numeratorY * h[6]) / squared) * sourceU,
            ((h[4] * denominator - numeratorY * h[7]) / squared) * sourceV,
          );
          minScale = Math.min(minScale, scales.min);
          maxScale = Math.max(maxScale, scales.max);
        }
      }
      screens.push({ index, name: screen.name || `Screen ${index + 1}`, minScale, maxScale });
    });
  }
  const designScale = screens.length ? Math.max(...screens.map((screen) => screen.maxScale)) : 0;
  const designMinScale = screens.length ? Math.min(...screens.map((screen) => screen.minScale)) : 0;
  const activeScales = [
    ...(assets.mockup ? [transform.scale] : []),
    ...screens.flatMap((screen) => [screen.minScale, screen.maxScale]),
  ];
  return {
    width,
    height,
    mockupScale: assets.mockup ? transform.scale : 0,
    designScale,
    designMinScale,
    screens,
    upsampled: activeScales.some((scale) => scale > 1.01),
    downsampled: activeScales.some((scale) => scale < 0.99),
  };
}
