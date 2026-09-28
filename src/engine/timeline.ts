import type { Assets, CompositionState, Easing, TimelineKeyframe } from '../types';
import { clamp, getScreenMetrics } from './geometry';

export function cubicBezier(
  progress: number,
  control: [number, number, number, number] = [0.42, 0, 0.58, 1],
): number {
  const x = clamp(progress);
  if (x === 0 || x === 1) return x;
  const [x1, y1, x2, y2] = control;
  const sample = (t: number, a: number, b: number) =>
    3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let low = 0,
    high = 1;
  for (let i = 0; i < 28; i++) {
    const middle = (low + high) / 2;
    if (sample(middle, clamp(x1), clamp(x2)) < x) low = middle;
    else high = middle;
  }
  return sample((low + high) / 2, y1, y2);
}
export function easing(
  progress: number,
  kind: Easing,
  bezier?: [number, number, number, number],
): number {
  const t = clamp(progress);
  if (kind === 'easeIn') return t * t * t;
  if (kind === 'easeOut') return 1 - (1 - t) ** 3;
  if (kind === 'easeInOut') return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  if (kind === 'bezier') return cubicBezier(t, bezier);
  return t;
}
export function timelineProgress(
  time: number,
  keyframes: TimelineKeyframe[],
  bezier?: [number, number, number, number],
): number {
  const frames = [...keyframes]
    .filter((k) => Number.isFinite(k.time) && Number.isFinite(k.progress))
    .sort((a, b) => a.time - b.time);
  if (!frames.length) return 0;
  if (time < frames[0].time) return clamp(frames[0].progress);
  let start = frames[0];
  for (const end of frames.slice(1)) {
    if (time < end.time) {
      const t = easing(
        (time - start.time) / Math.max(0.00001, end.time - start.time),
        start.easing,
        bezier,
      );
      return clamp(start.progress + (end.progress - start.progress) * t);
    }
    start = end;
  }
  return clamp(start.progress);
}
/** Deterministic source-coordinate scrolling, shared by playback and each offline export frame. */
export function scrollAtTime(time: number, composition: CompositionState, assets: Assets): number {
  const { maxScroll } = getScreenMetrics(composition, assets);
  const motion = composition.motion;
  if (motion.mode === 'manual' || maxScroll === 0) return clamp(composition.scrollY, 0, maxScroll);
  const delay = Math.max(0, motion.delay),
    hold = Math.max(0, motion.endHold);
  const activeDuration =
    motion.mode === 'auto'
      ? maxScroll / Math.max(1, motion.speed)
      : Math.max(0.001, motion.duration - delay - hold);
  const cycle =
    motion.mode === 'auto'
      ? Math.max(0.001, motion.duration, delay + activeDuration + hold)
      : Math.max(0.001, motion.duration);
  const t = motion.loop ? Math.max(0, time) % cycle : Math.max(0, time);
  let progress =
    motion.mode === 'timeline'
      ? timelineProgress(t, motion.keyframes, motion.bezier)
      : easing(
          (t - delay) / activeDuration,
          motion.mode === 'auto' ? 'linear' : motion.easing,
          motion.bezier,
        );
  if (motion.direction === 'up') progress = 1 - progress;
  return clamp(progress) * maxScroll;
}
