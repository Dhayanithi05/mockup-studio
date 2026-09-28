import type { Assets, CompositionState, Quad, RenderOptions } from '../types';
import {
  clamp,
  fitRect,
  getDesignPlacement,
  getMockupTransform,
  insetQuad,
  isConvexQuad,
  screenToOutput,
} from './geometry';
import { drawPerspectiveTexture, screenMaskPath, type DrawingContext } from './perspective';
import { getScreens, screenComposition, screenEnabled, screenScrollAtTime } from './screens';
export { getScreenMetrics, getMockupTransform, screenToOutput, outputToMockup } from './geometry';

type WorkingCanvas = OffscreenCanvas | HTMLCanvasElement;
const scratchCanvases = new WeakMap<object, Map<string, WorkingCanvas>>();
function getScratch(
  owner: object,
  key: string,
  width: number,
  height: number,
): { canvas: WorkingCanvas; ctx: DrawingContext } {
  let cache = scratchCanvases.get(owner);
  if (!cache) {
    cache = new Map();
    scratchCanvases.set(owner, cache);
  }
  let canvas = cache.get(key);
  if (!canvas) {
    canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : document.createElement('canvas');
    cache.set(key, canvas);
  }
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d') as DrawingContext | null;
  if (!ctx)
    throw new Error('Unable to allocate the composition canvas. Try a smaller output resolution.');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}
function drawBackground(
  ctx: DrawingContext,
  width: number,
  height: number,
  composition: CompositionState,
  assets: Assets,
): void {
  const { output } = composition;
  if (output.background === 'transparent') return;
  if (output.background === 'gradient') {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, output.color);
    gradient.addColorStop(1, output.color2);
    ctx.fillStyle = gradient;
  } else ctx.fillStyle = output.color;
  ctx.fillRect(0, 0, width, height);
  if (output.background === 'image' && assets.background) {
    const rect = fitRect(assets.background.width, assets.background.height, width, height, 'cover');
    ctx.drawImage(assets.background.bitmap, rect.x, rect.y, rect.width, rect.height);
  }
}
function drawScene(opts: RenderOptions): void {
  const { ctx, width, height, composition, assets, currentTime = 0, quality = 'preview' } = opts;
  const viewport = opts.viewport ?? { x: 0, y: 0, width, height };
  const transform = getMockupTransform(composition, assets, width, height, currentTime);
  const drawMockup = (bitmap: CanvasImageSource): void => {
    ctx.save();
    ctx.setTransform(
      transform.a,
      transform.b,
      transform.c,
      transform.d,
      transform.e - viewport.x,
      transform.f - viewport.y,
    );
    ctx.drawImage(bitmap, 0, 0, transform.width, transform.height);
    ctx.restore();
  };
  if (assets.mockup) drawMockup(assets.mockup.bitmap);
  for (const [index, screen] of getScreens(composition).entries()) {
    if (!assets.design || !screenEnabled(screen) || !isConvexQuad(screen.quad)) continue;
    const current = screenComposition(composition, index);
    const naturalQuad = screen.quad.map((p) => ({
      x: p.x * transform.width,
      y: p.y * transform.height,
    })) as Quad;
    const inset = insetQuad(naturalQuad, screen.inset);
    const quad = inset.map((p) =>
      screenToOutput(
        { x: p.x / transform.width, y: p.y / transform.height },
        current,
        assets,
        width,
        height,
        currentTime,
      ),
    ) as Quad;
    const minX = Math.max(0, viewport.x, Math.floor(Math.min(...quad.map((p) => p.x))) - 2),
      minY = Math.max(0, viewport.y, Math.floor(Math.min(...quad.map((p) => p.y))) - 2);
    const maxX = Math.min(
        width,
        viewport.x + viewport.width,
        Math.ceil(Math.max(...quad.map((p) => p.x))) + 2,
      ),
      maxY = Math.min(
        height,
        viewport.y + viewport.height,
        Math.ceil(Math.max(...quad.map((p) => p.y))) + 2,
      );
    if (maxX > minX && maxY > minY) {
      const layer = getScratch(ctx, 'screen', maxX - minX, maxY - minY);
      const localQuad = quad.map((p) => ({ x: p.x - minX, y: p.y - minY })) as Quad;
      const placement = getDesignPlacement(
        current,
        assets,
        screenScrollAtTime(currentTime, composition, assets, index, opts.scrollY),
      );
      const design = assets.design;
      const sx = Math.max(0, -placement.x / placement.designScale),
        sy = Math.max(0, -placement.y / placement.designScale);
      const sw = Math.min(design.width - sx, placement.width / placement.designScale),
        sh = Math.min(design.height - sy, placement.height / placement.designScale);
      layer.ctx.save();
      screenMaskPath(layer.ctx, localQuad, screen.radius, placement.width, placement.height);
      layer.ctx.clip();
      layer.ctx.fillStyle = '#090a0c';
      layer.ctx.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
      drawPerspectiveTexture(
        layer.ctx,
        design.bitmap,
        localQuad,
        {
          sx,
          sy,
          sw,
          sh,
          x: (placement.x + sx * placement.designScale) / placement.width,
          y: (placement.y + sy * placement.designScale) / placement.height,
          width: (sw * placement.designScale) / placement.width,
          height: (sh * placement.designScale) / placement.height,
        },
        quality,
      );
      if (screen.reflection > 0) {
        const reflectionLeft = Math.max(0, Math.floor(Math.min(...quad.map((p) => p.x))) - 2);
        const reflectionTop = Math.max(0, Math.floor(Math.min(...quad.map((p) => p.y))) - 2);
        const reflectionRight = Math.min(width, Math.ceil(Math.max(...quad.map((p) => p.x))) + 2);
        const reflectionBottom = Math.min(height, Math.ceil(Math.max(...quad.map((p) => p.y))) + 2);
        const reflection = layer.ctx.createLinearGradient(
          reflectionLeft - minX,
          reflectionTop - minY,
          reflectionRight - minX,
          reflectionBottom - minY,
        );
        reflection.addColorStop(0, `rgba(255,255,255,${clamp(screen.reflection) * 0.42})`);
        reflection.addColorStop(0.48, 'rgba(255,255,255,0)');
        reflection.addColorStop(1, `rgba(255,255,255,${clamp(screen.reflection) * 0.08})`);
        layer.ctx.fillStyle = reflection;
        layer.ctx.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
      }
      layer.ctx.restore();
      ctx.save();
      ctx.globalAlpha = clamp(screen.opacity);
      ctx.globalCompositeOperation = screen.blend;
      // Keep neutral artwork out of the color-filter pipeline entirely. This also
      // preserves exact decoded RGB values in unscaled, opaque PNG compositions.
      ctx.filter =
        screen.brightness === 100 && screen.contrast === 100 && screen.saturation === 100
          ? 'none'
          : `brightness(${screen.brightness}%) contrast(${screen.contrast}%) saturate(${screen.saturation}%)`;
      ctx.drawImage(layer.canvas, minX - viewport.x, minY - viewport.y);
      ctx.restore();
    }
  }
  if (assets.foreground) drawMockup(assets.foreground.bitmap);
}

/** Shared deterministic scene rendering. Explicit dimensions always define the actual raster, never editor zoom. */
export function renderComposition(options: RenderOptions): void {
  const { ctx, width, height, composition, assets } = options;
  const viewport = options.viewport ?? { x: 0, y: 0, width, height };
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1)
    throw new Error('Output dimensions must be positive.');
  if (!Object.values(viewport).every(Number.isFinite) || viewport.width < 1 || viewport.height < 1)
    throw new Error('Preview viewport dimensions must be positive.');
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  ctx.translate(-viewport.x, -viewport.y);
  drawBackground(ctx, width, height, composition, assets);
  ctx.restore();
  if (composition.output.opacity < 1) {
    const scene = getScratch(ctx, 'scene', viewport.width, viewport.height);
    drawScene({ ...options, ctx: scene.ctx });
    ctx.globalAlpha = clamp(composition.output.opacity);
    ctx.drawImage(scene.canvas, 0, 0);
  } else drawScene(options);
  ctx.restore();
}
