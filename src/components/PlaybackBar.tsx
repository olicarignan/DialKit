import { useEffect, useSyncExternalStore } from 'react';
import { motion } from 'motion/react';
import { DialStore } from '../store/DialStore';

interface PlaybackBarProps {
  panelId: string;
}

// Minimal playback strip: plays the panel's history on loop by default. The user only sees
// a pause button (unless they've paused, in which case it flips back to play). A small speed
// slider underneath lets them slow or accelerate playback between 0× and 2×.
export function PlaybackBar({ panelId }: PlaybackBarProps) {
  const history = useSyncExternalStore(
    (cb) => DialStore.subscribeHistory(panelId, cb),
    () => DialStore.getHistory(panelId),
    () => DialStore.getHistory(panelId),
  );

  const playback = useSyncExternalStore(
    (cb) => DialStore.subscribePlayback(panelId, cb),
    () => DialStore.getPlaybackState(panelId),
    () => DialStore.getPlaybackState(panelId),
  );

  const hasTimeline = history.past.length >= 1;
  const isPlaying = playback.status === 'playing';

  // Auto-start once the timeline is non-empty and we haven't yet played. Manual pause keeps
  // status='paused' which won't satisfy this condition again, so we don't fight the user.
  useEffect(() => {
    if (hasTimeline && playback.status === 'idle') {
      DialStore.startPlayback(panelId);
    }
  }, [hasTimeline, playback.status, panelId]);

  if (!hasTimeline) return null;

  const handleTogglePlay = () => {
    if (isPlaying) {
      DialStore.pausePlayback(panelId);
    } else {
      DialStore.startPlayback(panelId);
    }
  };

  const handleSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    DialStore.setPlaybackSpeed(panelId, parseFloat(e.target.value));
  };

  return (
    <div className="dialkit-playback-bar">
      <motion.button
        className="dialkit-playback-button-primary"
        onClick={handleTogglePlay}
        title={isPlaying ? 'Pause' : 'Play'}
        whileTap={{ scale: 0.9 }}
        transition={{ type: 'spring', visualDuration: 0.15, bounce: 0.3 }}
      >
        {isPlaying ? '⏸' : '▶'}
      </motion.button>

      <input
        className="dialkit-playback-speed"
        type="range"
        min={0}
        max={2}
        step={0.05}
        value={playback.speed}
        onChange={handleSpeedChange}
        aria-label="Playback speed"
        title={`Speed ${playback.speed.toFixed(2)}×`}
      />

      <span className="dialkit-playback-speed-value">{playback.speed.toFixed(2)}×</span>
    </div>
  );
}
