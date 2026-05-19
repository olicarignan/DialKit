import { useCallback, useSyncExternalStore } from 'react';
import { DialStore, PanelPlayback } from '../store/DialStore';

const DEFAULT: PanelPlayback = Object.freeze({ isPlaying: true, speed: 1, progress: 0 }) as PanelPlayback;

export interface DialKitPlaybackAPI extends PanelPlayback {
  setPlaying: (isPlaying: boolean) => void;
  togglePlaying: () => void;
  setSpeed: (speed: number) => void;
  setProgress: (progress: number) => void;
}

// Subscribes to a panel's transport state and returns reactive values plus setters.
// Accepts the panel NAME the host passed to useDialKit (the underlying panel id is
// generated internally and not exposed). Until the panel has registered, the hook
// returns defaults; once registration completes it re-binds automatically.
//
// The host wires the returned signals into its own animations:
//   - isPlaying — freeze the animation when false
//   - speed     — multiply the animation rate
//   - progress  — 0..1 scrub position; host writes this as the animation advances
//                 and reads it when the user drags the dock's scrub slider.
export function useDialKitPlayback(panelName: string): DialKitPlaybackAPI {
  // Resolve name → panelId. Re-renders on register/unregister via subscribeGlobal.
  const panelId = useSyncExternalStore(
    (cb) => DialStore.subscribeGlobal(cb),
    () => DialStore.getPanelIdByName(panelName),
    () => DialStore.getPanelIdByName(panelName),
  );

  // Subscribe to that panel's playback. useCallback gives a stable subscribe function
  // per panelId so useSyncExternalStore re-binds when the id changes.
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!panelId) return () => {};
      return DialStore.subscribePlayback(panelId, cb);
    },
    [panelId],
  );

  const getSnapshot = useCallback(
    () => (panelId ? DialStore.getPlayback(panelId) : DEFAULT),
    [panelId],
  );

  const playback = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setPlaying = useCallback(
    (v: boolean) => { if (panelId) DialStore.setPlaying(panelId, v); },
    [panelId],
  );
  const togglePlaying = useCallback(
    () => { if (panelId) DialStore.togglePlaying(panelId); },
    [panelId],
  );
  const setSpeed = useCallback(
    (v: number) => { if (panelId) DialStore.setPlaybackSpeed(panelId, v); },
    [panelId],
  );
  const setProgress = useCallback(
    (v: number) => { if (panelId) DialStore.setPlaybackProgress(panelId, v); },
    [panelId],
  );

  return {
    isPlaying: playback.isPlaying,
    speed: playback.speed,
    progress: playback.progress,
    setPlaying,
    togglePlaying,
    setSpeed,
    setProgress,
  };
}
