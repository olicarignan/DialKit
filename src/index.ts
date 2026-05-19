// Main hook
export { useDialKit } from './hooks/useDialKit';
export type { UseDialOptions } from './hooks/useDialKit';

// History hook — undo/redo + capability flags for a panel
export { useDialKitHistory } from './hooks/useDialKitHistory';
export type { DialKitHistoryAPI } from './hooks/useDialKitHistory';

// Playback hook — transport state (isPlaying / speed / progress) the host wires into its animations
export { useDialKitPlayback } from './hooks/useDialKitPlayback';
export type { DialKitPlaybackAPI } from './hooks/useDialKitPlayback';

// Code export — serialize a panel's current state to a config literal, JSON, or CSS variables
export { exportConfig, exportJSON, exportCSS } from './export';

// Root component (user mounts once)
export { DialRoot } from './components/DialRoot';
export type { DialPosition, DialMode, DialTheme } from './components/DialRoot';

// Individual components (for advanced usage)
export { Slider } from './components/Slider';
export { Toggle } from './components/Toggle';
export { Folder } from './components/Folder';
export { ButtonGroup } from './components/ButtonGroup';
export { SpringControl } from './components/SpringControl';
export { SpringVisualization } from './components/SpringVisualization';
export { TransitionControl } from './components/TransitionControl';
export { EasingVisualization } from './components/EasingVisualization';
export { TextControl } from './components/TextControl';
export { SelectControl } from './components/SelectControl';
export { ColorControl } from './components/ColorControl';
export { PresetManager } from './components/PresetManager';
export { ShortcutsMenu } from './components/ShortcutsMenu';

// Store (for advanced usage)
export { DialStore } from './store/DialStore';
export type {
  SpringConfig,
  EasingConfig,
  TransitionConfig,
  ActionConfig,
  SelectConfig,
  ColorConfig,
  TextConfig,
  ShortcutConfig,
  ShortcutMode,
  ShortcutInteraction,
  Preset,
  DialValue,
  DialConfig,
  ResolvedValues,
  ControlMeta,
  PanelConfig,
  HistorySnapshot,
  PanelHistory,
  PanelPlayback,
} from './store/DialStore';
