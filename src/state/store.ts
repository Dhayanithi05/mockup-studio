import { create } from 'zustand';
import type { Assets, CompositionState, DetectionCandidate, ExportProgress } from '../types';
import { createDefaults } from './defaults';
import { releaseImage } from '../engine/image';
export type Tab = 'Project' | 'Design' | 'Mockup' | 'Screen' | 'Motion' | 'Export';
interface EditorStore {
  composition: CompositionState;
  assets: Assets;
  past: CompositionState[];
  future: CompositionState[];
  projectId: string;
  tab: Tab;
  exportTab: 'screenshot' | 'video';
  zoom: number;
  preview: boolean;
  editScreen: boolean;
  grid: boolean;
  safe: boolean;
  playing: boolean;
  time: number;
  busy: ExportProgress | null;
  notice: string;
  error: string;
  candidates: DetectionCandidate[];
  selectedCorner: number;
  selectedScreen: number;
  dirty: boolean;
  update: (patch: Partial<CompositionState>, history?: boolean) => void;
  ui: (patch: Partial<EditorStore>) => void;
  setAsset: (key: keyof Assets, asset: Assets[keyof Assets]) => void;
  undo: () => void;
  redo: () => void;
  load: (composition: CompositionState, assets: Assets, id?: string) => void;
}
let grouping = false;
let groupRecorded = false;
export function beginHistoryGroup() {
  grouping = true;
  groupRecorded = false;
}
export function endHistoryGroup() {
  grouping = false;
  groupRecorded = false;
}
export const useEditor = create<EditorStore>((set, get) => ({
  composition: createDefaults(),
  assets: { design: null, mockup: null, background: null, foreground: null },
  past: [],
  future: [],
  projectId: crypto.randomUUID(),
  tab: 'Design',
  exportTab: 'screenshot',
  zoom: 0,
  preview: false,
  editScreen: false,
  grid: false,
  safe: false,
  playing: false,
  time: 0,
  busy: null,
  notice: '',
  error: '',
  candidates: [],
  selectedCorner: 0,
  selectedScreen: 0,
  dirty: false,
  update: (patch, history = true) => {
    set((s) => ({
      composition: { ...s.composition, ...patch },
      selectedScreen: Math.min(
        s.selectedScreen,
        (patch.extraScreens ?? s.composition.extraScreens ?? []).length,
      ),
      dirty: true,
      ...(history
        ? {
            past: grouping && groupRecorded ? s.past : [...s.past.slice(-49), s.composition],
            future: [],
          }
        : {}),
    }));
    if (history && grouping) groupRecorded = true;
  },
  ui: (patch) => {
    if (patch.tab || patch.busy) endHistoryGroup();
    set(patch);
  },
  setAsset: (key, asset) => {
    endHistoryGroup();
    const old = get().assets[key];
    set((s) => ({ assets: { ...s.assets, [key]: asset }, dirty: true }));
    releaseImage(old);
  },
  undo: () =>
    set((s) =>
      s.past.length
        ? {
            composition: s.past[s.past.length - 1],
            past: s.past.slice(0, -1),
            future: [s.composition, ...s.future],
            playing: false,
            dirty: true,
            selectedScreen: Math.min(
              s.selectedScreen,
              s.past[s.past.length - 1].extraScreens?.length ?? 0,
            ),
          }
        : {},
    ),
  redo: () =>
    set((s) =>
      s.future.length
        ? {
            composition: s.future[0],
            future: s.future.slice(1),
            past: [...s.past, s.composition],
            playing: false,
            dirty: true,
            selectedScreen: Math.min(s.selectedScreen, s.future[0].extraScreens?.length ?? 0),
          }
        : {},
    ),
  load: (composition, assets, id) => {
    endHistoryGroup();
    Object.values(get().assets).forEach(releaseImage);
    set({
      composition,
      assets,
      past: [],
      future: [],
      time: 0,
      playing: false,
      dirty: false,
      projectId: id || crypto.randomUUID(),
      editScreen: false,
      candidates: [],
      selectedScreen: 0,
    });
  },
}));
