import type { Assets, CompositionState, MotionSettings, VideoSettings } from '../types';
import { getScreenMetrics } from './geometry';
import { getScrollReference } from './screens';

/** Presets describe complete, reproducible settings rather than patches of the previous preset. */
export const MOTION_PRESETS = [
  {
    id: 'ux',
    label: 'UX Case Study',
    description: 'A considered scroll with time to take in the details.',
    mode: 'cinematic',
    speed: 180,
    duration: 12,
    delay: 1,
    endHold: 1.5,
    easing: 'easeInOut',
    camera: 'none',
  },
  {
    id: 'slow',
    label: 'Portfolio Slow',
    description: 'A steady, unhurried journey through the entire design.',
    mode: 'auto',
    speed: 140,
    duration: 12,
    delay: 1,
    endHold: 1,
    easing: 'linear',
    camera: 'none',
  },
  {
    id: 'product',
    label: 'Product Showcase',
    description: 'A confident reveal with a subtle camera push.',
    mode: 'cinematic',
    speed: 360,
    duration: 10,
    delay: 0.5,
    endHold: 1,
    easing: 'easeOut',
    camera: 'push',
  },
  {
    id: 'fast',
    label: 'Fast Overview',
    description: 'Move quickly from the first screen to the final detail.',
    mode: 'auto',
    speed: 1000,
    duration: 6,
    delay: 0,
    endHold: 0.5,
    easing: 'linear',
    camera: 'none',
  },
  {
    id: 'reel',
    label: 'Social Reel',
    description: 'An eight-second story with smooth acceleration.',
    mode: 'cinematic',
    speed: 500,
    duration: 8,
    delay: 0.5,
    endHold: 0.5,
    easing: 'easeInOut',
    camera: 'none',
  },
] as const;
export type MotionPresetId = (typeof MOTION_PRESETS)[number]['id'];

export const RESOLUTION_PRESETS = [
  { id: '4k', label: 'Portfolio 4K', width: 3840, height: 2160 },
  { id: '1080p', label: 'Full HD', width: 1920, height: 1080 },
  { id: '1440p', label: 'QHD / 2K', width: 2560, height: 1440 },
  { id: '5k', label: '5K', width: 5120, height: 2880 },
  { id: '6k', label: '6K', width: 6016, height: 3384 },
  { id: '8k', label: '8K', width: 7680, height: 4320 },
  { id: 'portrait', label: 'Instagram Portrait', width: 1080, height: 1350 },
  { id: 'square', label: 'Instagram Square', width: 1080, height: 1080 },
  { id: 'story', label: 'Story / Reel', width: 1080, height: 1920 },
  { id: 'thumbnail', label: 'YouTube Thumbnail', width: 1280, height: 720 },
  { id: 'behance', label: 'Behance Cover', width: 808, height: 632 },
  { id: 'dribbble', label: 'Dribbble', width: 1600, height: 1200 },
] as const;
export type ResolutionPresetId = (typeof RESOLUTION_PRESETS)[number]['id'] | 'original';

// Separate floors and ceilings keep tier matching unambiguous at tiny and very large resolutions.
export const QUALITY_PRESETS = [
  { id: 'standard', label: 'Standard', baseBitrate: 16, minBitrate: 2, maxBitrate: 65 },
  { id: 'high', label: 'High', baseBitrate: 24, minBitrate: 3, maxBitrate: 85 },
  { id: 'very', label: 'Very high', baseBitrate: 32, minBitrate: 4, maxBitrate: 105 },
  { id: 'maximum', label: 'Maximum', baseBitrate: 45, minBitrate: 5, maxBitrate: 120 },
] as const;
export type QualityPresetId = (typeof QUALITY_PRESETS)[number]['id'];

export const ASPECT_RATIOS = [
  { id: '16:9', label: '16:9', width: 16, height: 9 },
  { id: '9:16', label: '9:16', width: 9, height: 16 },
  { id: '1:1', label: '1:1', width: 1, height: 1 },
  { id: '4:5', label: '4:5', width: 4, height: 5 },
  { id: '3:2', label: '3:2', width: 3, height: 2 },
  { id: '4:3', label: '4:3', width: 4, height: 3 },
] as const;
export type AspectRatioId = (typeof ASPECT_RATIOS)[number]['id'];

export const OUTPUT_RECIPES = [
  {
    id: 'portfolio',
    label: 'Portfolio 4K',
    description: 'A crisp case-study presentation.',
    width: 3840,
    height: 2160,
    motion: 'ux',
    fps: 30,
    quality: 'very',
    scale: 1,
    background: 'original',
    color: '#747474',
    color2: '#333333',
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    description: 'A spacious frame with a slow camera reveal.',
    width: 3840,
    height: 2160,
    motion: 'product',
    fps: 60,
    quality: 'maximum',
    scale: 0.88,
    background: 'gradient',
    color: '#292c37',
    color2: '#111318',
  },
  {
    id: 'reel',
    label: 'Instagram Reel',
    description: 'A vertical, eight-second showcase.',
    width: 1080,
    height: 1920,
    motion: 'reel',
    fps: 30,
    quality: 'high',
    scale: 1,
    background: 'gradient',
    color: '#eee9e1',
    color2: '#c4bdb4',
  },
  {
    id: 'post',
    label: 'Instagram Post',
    description: 'A portrait frame for your next project.',
    width: 1080,
    height: 1350,
    motion: 'ux',
    fps: 30,
    quality: 'high',
    scale: 1,
    background: 'color',
    color: '#eee9e1',
    color2: '#c4bdb4',
  },
  {
    id: 'behance',
    label: 'Behance Landscape',
    description: 'Room for the details of your work.',
    width: 1920,
    height: 1440,
    motion: 'slow',
    fps: 30,
    quality: 'very',
    scale: 1,
    background: 'original',
    color: '#747474',
    color2: '#333333',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    description: 'A polished widescreen product walkthrough.',
    width: 1920,
    height: 1080,
    motion: 'product',
    fps: 60,
    quality: 'high',
    scale: 1,
    background: 'original',
    color: '#747474',
    color2: '#333333',
  },
] as const;
export type OutputRecipeId = (typeof OUTPUT_RECIPES)[number]['id'];

function lookup<T extends { readonly id: string }>(
  catalog: readonly T[],
  id: string,
  kind: string,
): T {
  const preset = catalog.find((item) => item.id === id);
  if (!preset) throw new Error(`Unknown ${kind} preset: ${id}`);
  return preset;
}

function close(a: number, b: number) {
  return Math.abs(a - b) < 0.000001;
}

function keyframesFor(
  motion: Pick<MotionSettings, 'duration' | 'delay' | 'endHold' | 'easing'>,
): MotionSettings['keyframes'] {
  return [
    { id: 'hero', time: 0, progress: 0, easing: 'linear' },
    { id: 'start', time: motion.delay, progress: 0, easing: motion.easing },
    { id: 'end', time: motion.duration - motion.endHold, progress: 1, easing: 'linear' },
    { id: 'hold', time: motion.duration, progress: 1, easing: 'linear' },
  ];
}

function motionSettings(composition: CompositionState, assets: Assets, id: string): MotionSettings {
  const preset = lookup(MOTION_PRESETS, id, 'motion');
  const duration =
    preset.mode === 'auto'
      ? Math.ceil(
          (Math.max(
            0.5,
            getScreenMetrics(getScrollReference(composition, assets), assets).maxScroll /
              preset.speed,
          ) +
            preset.delay +
            preset.endHold) *
            100,
        ) / 100
      : preset.duration;
  const motion: MotionSettings = {
    mode: preset.mode,
    speed: preset.speed,
    direction: 'down',
    duration,
    delay: preset.delay,
    endHold: preset.endHold,
    loop: false,
    easing: preset.easing,
    bezier: [0.42, 0, 0.58, 1],
    camera: preset.camera,
    keyframes: [],
  };
  motion.keyframes = keyframesFor(motion);
  return motion;
}

function sameMotion(actual: MotionSettings, expected: MotionSettings) {
  return (
    (['mode', 'direction', 'loop', 'easing', 'camera'] as const).every(
      (key) => actual[key] === expected[key],
    ) &&
    (['speed', 'duration', 'delay', 'endHold'] as const).every((key) =>
      close(actual[key], expected[key]),
    ) &&
    actual.bezier.every((value, i) => close(value, expected.bezier[i])) &&
    actual.keyframes.length === expected.keyframes.length &&
    actual.keyframes.every((frame, i) => {
      const other = expected.keyframes[i];
      return (
        close(frame.time, other.time) &&
        close(frame.progress, other.progress) &&
        frame.easing === other.easing
      );
    })
  );
}

export function applyMotionPreset(
  composition: CompositionState,
  assets: Assets,
  id: string,
): CompositionState {
  const motion = motionSettings(composition, assets, id);
  return {
    ...composition,
    scrollY: 0,
    motion,
    video: { ...composition.video, duration: motion.duration },
  };
}

export function matchMotionPreset(
  composition: CompositionState,
  assets: Assets,
): MotionPresetId | 'custom' {
  return (
    MOTION_PRESETS.find((preset) =>
      sameMotion(composition.motion, motionSettings(composition, assets, preset.id)),
    )?.id ?? 'custom'
  );
}

/** Rates scale with both pixel count and frame rate; a manually entered bitrate remains custom. */
export function qualityBitrate(
  video: Pick<VideoSettings, 'width' | 'height' | 'fps'>,
  id: string,
): number {
  const preset = lookup(QUALITY_PRESETS, id, 'quality');
  const factor =
    Math.sqrt(Math.max(1, video.width * video.height) / (1920 * 1080)) *
    Math.sqrt(Math.max(1, video.fps) / 30);
  return Math.min(
    preset.maxBitrate,
    Math.max(preset.minBitrate, Math.round(preset.baseBitrate * factor)),
  );
}

export function matchQualityPreset(composition: CompositionState): QualityPresetId | 'custom' {
  return (
    QUALITY_PRESETS.find((preset) =>
      close(composition.video.bitrate, qualityBitrate(composition.video, preset.id)),
    )?.id ?? 'custom'
  );
}

export function applyQualityPreset(composition: CompositionState, id: string): CompositionState {
  return {
    ...composition,
    video: { ...composition.video, bitrate: qualityBitrate(composition.video, id) },
  };
}

export function resizeComposition(
  composition: CompositionState,
  width: number,
  height: number,
): CompositionState {
  if (
    ![width, height].every((value) => Number.isSafeInteger(value) && value >= 1 && value <= 16384)
  )
    throw new Error('Canvas dimensions must be whole pixels between 1 and 16384.');
  const quality = matchQualityPreset(composition);
  const result = {
    ...composition,
    output: { ...composition.output, width, height },
    video: { ...composition.video, width, height },
  };
  return quality === 'custom' ? result : applyQualityPreset(result, quality);
}

export function setCompositionFrameRate(
  composition: CompositionState,
  fps: number,
): CompositionState {
  if (!Number.isFinite(fps) || fps < 1 || fps > 120)
    throw new Error('Frame rate must be between 1 and 120 fps.');
  const quality = matchQualityPreset(composition);
  const result = { ...composition, video: { ...composition.video, fps } };
  return quality === 'custom' ? result : applyQualityPreset(result, quality);
}

export function applyResolutionPreset(
  composition: CompositionState,
  assets: Assets,
  id: string,
): CompositionState {
  if (id === 'original') {
    if (!assets.mockup) throw new Error('Upload a mockup to use its original resolution.');
    return resizeComposition(composition, assets.mockup.width, assets.mockup.height);
  }
  const preset = lookup(RESOLUTION_PRESETS, id, 'resolution');
  return resizeComposition(composition, preset.width, preset.height);
}

export function matchResolutionPreset(
  composition: CompositionState,
  assets: Assets,
): ResolutionPresetId | 'custom' {
  const { width, height } = composition.output;
  const preset = RESOLUTION_PRESETS.find((item) => item.width === width && item.height === height);
  if (preset) return preset.id;
  return assets.mockup?.width === width && assets.mockup.height === height ? 'original' : 'custom';
}

/** A 72px short-edge grid represents every offered ratio exactly with even encoder dimensions.
 * Keeping this shared short edge avoids accumulating rounding errors when switching formats. */
export function setCompositionAspect(composition: CompositionState, id: string): CompositionState {
  const ratio = lookup(ASPECT_RATIOS, id, 'aspect ratio');
  const shortEdge = Math.min(
    9216,
    Math.max(
      72,
      Math.round(Math.min(composition.output.width, composition.output.height) / 72) * 72,
    ),
  );
  const unit = shortEdge / Math.min(ratio.width, ratio.height);
  return resizeComposition(composition, ratio.width * unit, ratio.height * unit);
}

export function matchAspectRatio(composition: CompositionState): AspectRatioId | 'custom' {
  const { width, height } = composition.output;
  return (
    ASPECT_RATIOS.find((ratio) => width * ratio.height === height * ratio.width)?.id ?? 'custom'
  );
}

/** A duration edit scales the entire sequence, including pauses and custom keyframes. */
export function setCompositionDuration(
  composition: CompositionState,
  duration: number,
): CompositionState {
  if (!Number.isFinite(duration) || duration < 0.1)
    throw new Error('Duration must be at least 0.1 seconds.');
  const original = composition.motion;
  const factor = duration / Math.max(0.1, original.duration);
  let delay = Math.max(0, original.delay * factor);
  let endHold = Math.max(0, original.endHold * factor);
  const maxHolds = duration * 0.95;
  if (delay + endHold > maxHolds) {
    const holdFactor = maxHolds / (delay + endHold);
    delay *= holdFactor;
    endHold *= holdFactor;
  }
  const motion: MotionSettings = {
    ...original,
    duration,
    delay,
    endHold,
    speed: original.mode === 'auto' ? original.speed / factor : original.speed,
    keyframes: original.keyframes.map((frame) => ({
      ...frame,
      time: Math.max(0, Math.min(duration, frame.time * factor)),
    })),
  };
  return { ...composition, motion, video: { ...composition.video, duration } };
}

/** Use after changing auto speed, pauses, the design, or its screen fit. */
export function reconcileAutoDuration(
  composition: CompositionState,
  assets: Assets,
): CompositionState {
  if (composition.motion.mode !== 'auto') return composition;
  const original = composition.motion;
  const duration =
    Math.ceil(
      (Math.max(
        0.5,
        getScreenMetrics(getScrollReference(composition, assets), assets).maxScroll /
          Math.max(1, original.speed),
      ) +
        Math.max(0, original.delay) +
        Math.max(0, original.endHold)) *
        100,
    ) / 100;
  const motion = {
    ...original,
    duration,
    delay: Math.max(0, original.delay),
    endHold: Math.max(0, original.endHold),
  };
  motion.keyframes = keyframesFor(motion);
  return { ...composition, motion, video: { ...composition.video, duration } };
}

/** Keeps all timing controls meaningful for preview and export, including when switching modes. */
export function updateMotionSettings(
  composition: CompositionState,
  assets: Assets,
  patch: Partial<MotionSettings>,
): CompositionState {
  const base =
    patch.duration === undefined
      ? composition
      : setCompositionDuration(composition, patch.duration);
  const previous = base.motion;
  const motion: MotionSettings = { ...previous, ...patch };
  motion.speed = Math.max(1, Number.isFinite(motion.speed) ? motion.speed : 180);
  motion.delay = Math.max(0, Number.isFinite(motion.delay) ? motion.delay : 0);
  motion.endHold = Math.max(0, Number.isFinite(motion.endHold) ? motion.endHold : 0);
  if (motion.mode === 'auto') return reconcileAutoDuration({ ...base, motion }, assets);

  const totalHolds = motion.delay + motion.endHold;
  if (totalHolds > motion.duration * 0.95) {
    const factor = (motion.duration * 0.95) / totalHolds;
    motion.delay *= factor;
    motion.endHold *= factor;
  }
  const validFrames =
    motion.keyframes.length >= 2 &&
    motion.keyframes.every(
      (frame) =>
        Number.isFinite(frame.time) &&
        frame.time >= 0 &&
        frame.time <= motion.duration &&
        Number.isFinite(frame.progress) &&
        frame.progress >= 0 &&
        frame.progress <= 1,
    );
  if (
    motion.mode !== 'timeline' ||
    !validFrames ||
    (patch.mode === 'timeline' && previous.mode !== 'timeline')
  ) {
    motion.keyframes = keyframesFor(motion);
  } else if (
    !patch.keyframes &&
    (patch.delay !== undefined || patch.endHold !== undefined || patch.easing !== undefined)
  ) {
    // Move custom waypoints with the active interval while retaining user-added pauses.
    const previousEnd = previous.duration - previous.endHold;
    const activeSpan = Math.max(0.0001, previousEnd - previous.delay);
    const newEnd = motion.duration - motion.endHold;
    motion.keyframes = previous.keyframes.map((frame, index) => {
      // Zero-length holds collapse their transition onto an endpoint. Keep the outer
      // anchors fixed while moving those transitions when the hold is restored.
      const time =
        index === 0 && frame.time === 0
          ? 0
          : index === previous.keyframes.length - 1 && frame.time === previous.duration
            ? motion.duration
            : frame.time <= previous.delay
              ? previous.delay === 0
                ? motion.delay
                : frame.time * (motion.delay / previous.delay)
              : frame.time >= previousEnd
                ? previous.endHold === 0
                  ? newEnd
                  : newEnd + (frame.time - previousEnd) * (motion.endHold / previous.endHold)
                : motion.delay +
                  ((frame.time - previous.delay) / activeSpan) * (newEnd - motion.delay);
      const next = previous.keyframes[index + 1];
      return {
        ...frame,
        time,
        easing:
          patch.easing !== undefined && next && next.progress !== frame.progress
            ? motion.easing
            : frame.easing,
      };
    });
  }
  return { ...base, motion, video: { ...base.video, duration: motion.duration } };
}

export function applyOutputRecipe(
  composition: CompositionState,
  assets: Assets,
  id: string,
): CompositionState {
  const preset = lookup(OUTPUT_RECIPES, id, 'output');
  const result = applyMotionPreset(composition, assets, preset.motion);
  return {
    ...result,
    output: {
      ...result.output,
      width: preset.width,
      height: preset.height,
      framing: 'fit',
      scale: preset.scale,
      x: 0,
      y: 0,
      rotation: 0,
      opacity: 1,
      background: preset.background,
      color: preset.color,
      color2: preset.color2,
    },
    screenshot: { ...result.screenshot, format: 'png', quality: 0.95, scale: 1 },
    video: {
      ...result.video,
      width: preset.width,
      height: preset.height,
      fps: preset.fps,
      bitrate: qualityBitrate(preset, preset.quality),
      codec: 'auto',
      mode: 'maximum',
    },
  };
}

export function matchOutputRecipe(
  composition: CompositionState,
  assets: Assets,
): OutputRecipeId | 'custom' {
  return (
    OUTPUT_RECIPES.find((recipe) => {
      const expected = applyOutputRecipe(composition, assets, recipe.id);
      return (
        (Object.keys(expected.output) as (keyof CompositionState['output'])[]).every(
          (key) => composition.output[key] === expected.output[key],
        ) &&
        sameMotion(composition.motion, expected.motion) &&
        (Object.keys(expected.video) as (keyof VideoSettings)[]).every(
          (key) => composition.video[key] === expected.video[key],
        ) &&
        composition.screenshot.format === expected.screenshot.format &&
        composition.screenshot.scale === expected.screenshot.scale &&
        composition.screenshot.quality === expected.screenshot.quality
      );
    })?.id ?? 'custom'
  );
}
