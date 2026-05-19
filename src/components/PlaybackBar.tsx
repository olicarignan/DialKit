import { useSyncExternalStore } from 'react';
import { motion } from 'motion/react';
import { DialStore } from '../store/DialStore';

interface PlaybackBarProps {
  panelId: string;
}

// Transport strip shown at the bottom of the panel when there's any history to replay.
// Drives the playback engine in DialStore: jump/step/play-pause-restart.
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

  // Need at least one historical snapshot — the timeline always appends current values
  // as a synthetic last entry, so one snapshot means a 2-entry timeline.
  if (history.past.length < 1) return null;

  const isPlaying = playback.status === 'playing';
  const isEnded = playback.status === 'ended';

  const handlePlayPause = () => {
    if (isPlaying) {
      DialStore.pausePlayback(panelId);
    } else if (isEnded) {
      DialStore.jumpToStart(panelId);
      DialStore.startPlayback(panelId);
    } else {
      DialStore.startPlayback(panelId);
    }
  };

  const playGlyph = isPlaying ? '⏸' : isEnded ? '↻' : '▶';
  const playTitle = isPlaying ? 'Pause' : isEnded ? 'Restart' : 'Play';

  return (
    <div className="dialkit-playback-bar">
      <TransportButton onClick={() => DialStore.jumpToStart(panelId)} title="Jump to start" glyph="⏮" />
      <TransportButton onClick={() => DialStore.stepBack(panelId)} title="Previous snapshot" glyph="⏪" />
      <TransportButton onClick={handlePlayPause} title={playTitle} glyph={playGlyph} primary />
      <TransportButton onClick={() => DialStore.stepForward(panelId)} title="Next snapshot" glyph="⏩" />
      <TransportButton onClick={() => DialStore.jumpToEnd(panelId)} title="Jump to end" glyph="⏭" />
    </div>
  );
}

function TransportButton({
  onClick,
  title,
  glyph,
  primary,
}: {
  onClick: () => void;
  title: string;
  glyph: string;
  primary?: boolean;
}) {
  return (
    <motion.button
      className={`dialkit-playback-button${primary ? ' dialkit-playback-button-primary' : ''}`}
      onClick={onClick}
      title={title}
      whileTap={{ scale: 0.9 }}
      transition={{ type: 'spring', visualDuration: 0.15, bounce: 0.3 }}
    >
      {glyph}
    </motion.button>
  );
}
