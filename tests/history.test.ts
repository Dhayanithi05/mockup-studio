import { beforeEach, describe, it, expect } from 'vitest';
import { useEditor, beginHistoryGroup, endHistoryGroup } from '../src/state/store';
import { createDefaults } from '../src/state/defaults';
beforeEach(() => {
  endHistoryGroup();
  useEditor.setState({ composition: createDefaults(), past: [], future: [] });
});
describe('Editing history', () => {
  it('keeps consecutive separate changes independently undoable', () => {
    const s = useEditor.getState();
    s.update({ scrollY: 100 });
    s.update({ scrollY: 200 });
    s.undo();
    expect(useEditor.getState().composition.scrollY).toBe(100);
    s.undo();
    expect(useEditor.getState().composition.scrollY).toBe(0);
    s.redo();
    expect(useEditor.getState().composition.scrollY).toBe(100);
  });
  it('groups one drag gesture while retaining its starting state', () => {
    const s = useEditor.getState();
    s.update({ scrollY: 100 });
    beginHistoryGroup();
    s.update({ scrollY: 200 });
    s.update({ scrollY: 250 });
    s.update({ scrollY: 300 });
    endHistoryGroup();
    s.undo();
    expect(useEditor.getState().composition.scrollY).toBe(100);
    s.redo();
    expect(useEditor.getState().composition.scrollY).toBe(300);
  });
});
