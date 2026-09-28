import type { Assets, CompositionState, ScreenRegion } from '../types';
import { clamp, getScreenMetrics } from './geometry';
import { scrollAtTime } from './timeline';

/** The first screen keeps the original project format; additional screens follow its order. */
export function getScreens(composition: CompositionState): ScreenRegion[] {
  return [composition.screen, ...(composition.extraScreens ?? [])];
}

export function screenEnabled(screen: ScreenRegion): boolean {
  return screen.enabled !== false;
}

/** A lightweight view for existing geometry functions, without mutating the saved project. */
export function screenComposition(composition: CompositionState, index: number): CompositionState {
  const screen = getScreens(composition)[index] ?? composition.screen;
  return screen === composition.screen ? composition : { ...composition, screen };
}

/** Source-pixel scroll coordinates are measured against the first visible scrollable screen. */
export function getScrollReference(
  composition: CompositionState,
  assets: Assets,
): CompositionState {
  for (const [index, screen] of getScreens(composition).entries()) {
    if (!screenEnabled(screen)) continue;
    const current = screenComposition(composition, index);
    if (getScreenMetrics(current, assets).maxScroll > 0) return current;
  }
  return composition;
}

export function compositionScrollAtTime(
  time: number,
  composition: CompositionState,
  assets: Assets,
): number {
  return scrollAtTime(time, getScrollReference(composition, assets), assets);
}

/** Only writes the requested screen so undo and persistence retain every other screen. */
export function updateScreen(
  composition: CompositionState,
  index: number,
  patch: Partial<ScreenRegion>,
): Partial<CompositionState> {
  const screens = getScreens(composition);
  if (!Number.isInteger(index) || index < 0 || index >= screens.length) return {};
  const screen = { ...screens[index], ...patch };
  if (index === 0) return { screen };
  return {
    extraScreens: screens
      .slice(1)
      .map((current, position) => (position === index - 1 ? screen : current)),
  };
}

/**
 * Scroll remains stored in original design pixels for the scroll reference. All screens
 * share the same progress, while each uses its own original-resolution source viewport.
 */
export function screenScrollAtTime(
  time: number,
  composition: CompositionState,
  assets: Assets,
  index: number,
  scrollY?: number,
): number {
  const local = screenComposition(composition, index);
  const localMax = getScreenMetrics(local, assets).maxScroll;
  const reference = getScrollReference(composition, assets);
  const referenceMax = getScreenMetrics(reference, assets).maxScroll;
  if (scrollY !== undefined || composition.motion.mode === 'manual') {
    return referenceMax > 0 ? clamp((scrollY ?? composition.scrollY) / referenceMax) * localMax : 0;
  }
  if (composition.motion.mode !== 'auto') return scrollAtTime(time, local, assets);
  if (referenceMax === 0) return 0;
  return clamp(scrollAtTime(time, reference, assets) / referenceMax) * localMax;
}
