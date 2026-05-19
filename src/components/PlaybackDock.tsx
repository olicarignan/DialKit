import { useCallback, useRef, useSyncExternalStore } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { DialStore } from '../store/DialStore';

interface PlaybackDockProps {
  theme?: string;
  frostedMode?: string;
}

// Floating bottom-center dock that controls transport state for the most recently active panel.
// Visible only when at least one panel is expanded.
export function PlaybackDock({ theme, frostedMode }: PlaybackDockProps) {
  // Re-render whenever any panel's expand state changes so we show/hide accordingly
  const anyExpanded = useSyncExternalStore(
    (cb) => DialStore.subscribeExpansion(cb),
    () => DialStore.isAnyPanelExpanded(),
    () => DialStore.isAnyPanelExpanded(),
  );

  // Re-render when the active panel switches (or any panel registers/unregisters)
  const panelId = useSyncExternalStore(
    (cb) => {
      const unsubActive = DialStore.subscribeLastActive(cb);
      const unsubGlobal = DialStore.subscribeGlobal(cb);
      return () => {
        unsubActive();
        unsubGlobal();
      };
    },
    () => DialStore.getLastActivePanelId(),
    () => DialStore.getLastActivePanelId(),
  );

  return (
    <AnimatePresence>
      {anyExpanded && panelId && (
        <motion.div
          className="dialkit-playback-dock"
          data-theme={theme}
          data-frosted-mode={frostedMode}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12, pointerEvents: 'none' as any }}
          transition={{ type: 'spring', visualDuration: 0.3, bounce: 0.15 }}
        >
          <PlaybackDockBody panelId={panelId} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PlaybackDockBody({ panelId }: { panelId: string }) {
  const playback = useSyncExternalStore(
    (cb) => DialStore.subscribePlayback(panelId, cb),
    () => DialStore.getPlayback(panelId),
    () => DialStore.getPlayback(panelId),
  );

  // Remember whether playback was running before the user grabbed the scrubber, so we
  // can restore that state when they release (auto-pause during scrub, then auto-resume).
  const wasPlayingBeforeScrubRef = useRef<boolean | null>(null);

  const handleSpeed = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    DialStore.setPlaybackSpeed(panelId, parseFloat(e.target.value));
  }, [panelId]);

  const handleProgress = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    DialStore.setPlaybackProgress(panelId, parseFloat(e.target.value));
  }, [panelId]);

  const handleScrubStart = useCallback(() => {
    wasPlayingBeforeScrubRef.current = DialStore.getPlayback(panelId).isPlaying;
    DialStore.setPlaying(panelId, false);
  }, [panelId]);

  const handleScrubEnd = useCallback(() => {
    if (wasPlayingBeforeScrubRef.current === true) {
      DialStore.setPlaying(panelId, true);
    }
    wasPlayingBeforeScrubRef.current = null;
  }, [panelId]);

  const handleTogglePlay = useCallback(() => {
    DialStore.togglePlaying(panelId);
  }, [panelId]);

  return (
    <>
      <motion.button
        className="dialkit-dock-button"
        onClick={handleTogglePlay}
        title={playback.isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        whileTap={{ scale: 0.9 }}
        transition={{ type: 'spring', visualDuration: 0.15, bounce: 0.3 }}
      >
        {playback.isPlaying ? '⏸' : '▶'}
      </motion.button>

      <div className="dialkit-dock-control">
        <span className="dialkit-dock-label">Speed</span>
        <input
          className="dialkit-dock-slider"
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={playback.speed}
          onChange={handleSpeed}
          aria-label="Playback speed"
        />
        <span className="dialkit-dock-value">{playback.speed.toFixed(2)}×</span>
      </div>

      <div className="dialkit-dock-control">
        <span className="dialkit-dock-label">Scrub</span>
        <input
          className="dialkit-dock-slider"
          type="range"
          min={0}
          max={1}
          step={0.005}
          value={playback.progress}
          onChange={handleProgress}
          onPointerDown={handleScrubStart}
          onPointerUp={handleScrubEnd}
          onPointerCancel={handleScrubEnd}
          aria-label="Animation progress"
        />
        <span className="dialkit-dock-value">{(playback.progress * 100).toFixed(0)}%</span>
      </div>
    </>
  );
}
