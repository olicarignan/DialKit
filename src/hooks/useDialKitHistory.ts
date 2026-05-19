import { useCallback, useSyncExternalStore } from 'react';
import { DialStore } from '../store/DialStore';

export interface DialKitHistoryAPI {
  undo: () => boolean;
  redo: () => boolean;
  canUndo: boolean;
  canRedo: boolean;
  clear: () => void;
}

// Subscribes to a panel's history and exposes undo/redo controls plus capability flags.
// `canUndo` and `canRedo` re-render the consumer when the history shape changes.
export function useDialKitHistory(panelId: string): DialKitHistoryAPI {
  const snapshot = useSyncExternalStore(
    (cb) => DialStore.subscribeHistory(panelId, cb),
    () => historySignature(panelId),
    () => historySignature(panelId)
  );

  const undo = useCallback(() => DialStore.undo(panelId), [panelId]);
  const redo = useCallback(() => DialStore.redo(panelId), [panelId]);
  const clear = useCallback(() => DialStore.clearHistory(panelId), [panelId]);

  return {
    undo,
    redo,
    canUndo: snapshot.pastLen > 0,
    canRedo: snapshot.futureLen > 0,
    clear,
  };
}

// A stable signature object computed from the current history shape.
// useSyncExternalStore requires reference equality across reads when nothing changed.
const sigCache = new Map<string, { pastLen: number; futureLen: number }>();

function historySignature(panelId: string): { pastLen: number; futureLen: number } {
  const h = DialStore.getHistory(panelId);
  const cached = sigCache.get(panelId);
  if (cached && cached.pastLen === h.past.length && cached.futureLen === h.future.length) {
    return cached;
  }
  const next = { pastLen: h.past.length, futureLen: h.future.length };
  sigCache.set(panelId, next);
  return next;
}
