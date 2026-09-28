import type { Assets, CompositionState } from '../types';
import { loadImage, releaseImage } from './image';
interface SavedAsset {
  blob: Blob;
  name: string;
}
interface SavedProject {
  id: string;
  updated: number;
  composition: CompositionState;
  assets: Record<keyof Assets, SavedAsset | null>;
}
export interface ProjectInfo {
  id: string;
  name: string;
  updated: number;
}
const db = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('mockup-studio', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('projects', { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
async function request<T>(
  mode: IDBTransactionMode,
  action: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('projects', mode);
    const r = action(tx.objectStore('projects'));
    tx.oncomplete = () => {
      database.close();
      resolve(r.result);
    };
    tx.onerror = () => {
      database.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      database.close();
      reject(tx.error);
    };
  });
}
export async function saveProject(id: string, composition: CompositionState, assets: Assets) {
  const stored = {} as SavedProject['assets'];
  for (const key of Object.keys(assets) as (keyof Assets)[]) {
    const a = assets[key];
    stored[key] = a ? { blob: a.blob, name: a.name } : null;
  }
  await request('readwrite', (s) =>
    s.put({ id, updated: Date.now(), composition, assets: stored } satisfies SavedProject),
  );
}
export async function listProjects(): Promise<ProjectInfo[]> {
  const rows = await request<SavedProject[]>('readonly', (s) => s.getAll());
  return rows
    .sort((a, b) => b.updated - a.updated)
    .map((p) => ({ id: p.id, name: p.composition.name, updated: p.updated }));
}
export async function openProject(id: string) {
  const p = await request<SavedProject | undefined>('readonly', (s) => s.get(id));
  if (!p) throw new Error('Project no longer exists.');
  const assets: Assets = { design: null, mockup: null, background: null, foreground: null };
  try {
    for (const key of Object.keys(assets) as (keyof Assets)[]) {
      const a = p.assets[key];
      if (a) assets[key] = await loadImage(a.blob, a.name);
    }
    return { composition: p.composition, assets };
  } catch (error) {
    Object.values(assets).forEach(releaseImage);
    throw error;
  }
}
export async function deleteProject(id: string) {
  await request('readwrite', (s) => s.delete(id));
}
