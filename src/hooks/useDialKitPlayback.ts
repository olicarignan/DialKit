import { useCallback, useSyncExternalStore } from 'react';
import { DialStore, PanelPlayback } from '../store/DialStore';

export interface DialKitPlaybackAPI extends PanelPlayback {
  setPlaying: (isPlaying: boolean) => void;
  togglePlaying: () => void;
  setSpeed: (speed: number) => void;
  setProgress: (progress: number) => void;
}

// Subscribes to a panel's transport state and returns reactive values plus setters.
// The host wires these into its own animations:
//   - isPlaying — freeze the animation when false
//   - speed — multiply the animation rate
//   - progress (0..1) — host writes this as the animation advances; the user may also drag
//     the dock's scrub slider to set it, which the host should react to by jumping its
//     animation to that progress.
export function useDialKitPlayback(panelId: string): DialKitPlaybackAPI {
  const playback = useSyncExternalStore(
    (cb) => DialStore.subscribePlayback(panelId, cb),
    () => DialStore.getPlayback(panelId),
    () => DialStore.getPlayback(panelId),
  );

  const setPlaying = useCallback((v: boolean) => DialStore.setPlaying(panelId, v), [panelId]);
  const togglePlaying = useCallback(() => DialStore.togglePlaying(panelId), [panelId]);
  const setSpeed = useCallback((v: number) => DialStore.setPlaybackSpeed(panelId, v), [panelId]);
  const setProgress = useCallback((v: number) => DialStore.setPlaybackProgress(panelId, v), [panelId]);

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
