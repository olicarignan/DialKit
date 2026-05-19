// Lightweight state store with subscriptions for dialkit

export type SpringConfig = {
  type: 'spring';
  stiffness?: number;
  damping?: number;
  mass?: number;
  visualDuration?: number;
  bounce?: number;
};

export type EasingConfig = {
  type: 'easing';
  duration: number;
  ease: [number, number, number, number];
};

export type TransitionConfig = SpringConfig | EasingConfig;

export type ActionConfig = {
  type: 'action';
  label?: string;
};

export type SelectConfig = {
  type: 'select';
  options: (string | { value: string; label: string })[];
  default?: string;
};

export type ColorConfig = {
  type: 'color';
  default?: string;
};

export type TextConfig = {
  type: 'text';
  default?: string;
  placeholder?: string;
};

export type DialValue = number | boolean | string | SpringConfig | EasingConfig | ActionConfig | SelectConfig | ColorConfig | TextConfig;

export type DialConfig = {
  [key: string]: DialValue | [number, number, number, number?] | DialConfig;
};

export type ResolvedValues<T extends DialConfig> = {
  [K in keyof T]: T[K] extends [number, number, number, number?]
    ? number
    : T[K] extends SpringConfig
      ? TransitionConfig
      : T[K] extends EasingConfig
        ? TransitionConfig
        : T[K] extends SelectConfig
          ? string
          : T[K] extends ColorConfig
            ? string
            : T[K] extends TextConfig
              ? string
              : T[K] extends DialConfig
                ? ResolvedValues<T[K]>
                : T[K];
};

export type ShortcutMode = 'fine' | 'normal' | 'coarse';
export type ShortcutInteraction = 'scroll' | 'drag' | 'move' | 'scroll-only';

export type ShortcutConfig = {
  key?: string;
  modifier?: 'alt' | 'shift' | 'meta';
  mode?: ShortcutMode;
  interaction?: ShortcutInteraction;
};

export type ControlMeta = {
  type: 'slider' | 'toggle' | 'spring' | 'transition' | 'folder' | 'action' | 'select' | 'color' | 'text';
  path: string;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  children?: ControlMeta[];
  defaultOpen?: boolean;
  options?: (string | { value: string; label: string })[];
  placeholder?: string;
  shortcut?: ShortcutConfig;
};

export type PanelConfig = {
  id: string;
  name: string;
  controls: ControlMeta[];
  values: Record<string, DialValue>;
  shortcuts: Record<string, ShortcutConfig>;
};

type Listener = () => void;
type ActionListener = (action: string) => void;

export type Preset = {
  id: string;
  name: string;
  values: Record<string, DialValue>;
};

// A point-in-time capture of a panel's values plus when (and optionally why) it was captured.
// Used for undo/redo, future timeline scrubbing, and animation playback.
export type HistorySnapshot = {
  values: Record<string, DialValue>;
  timestamp: number;
  label?: string;
};

export type PanelHistory = {
  past: HistorySnapshot[];   // states older than current — undo restores from here
  future: HistorySnapshot[]; // states that were undone — redo restores from here
};

const MAX_HISTORY = 100;
const MAX_DISCARDED_BRANCHES = 5;

// localStorage debounce window — coalesces rapid changes (drags) into one write
const PERSIST_DEBOUNCE_MS = 300;
// Bump the suffix when the persisted schema needs to be invalidated
const PERSIST_KEY_PREFIX = 'dialkit';
const PERSIST_KEY_VERSION = 'v1';

// Stable empty objects for unregistered panels (React 19 useSyncExternalStore requirement —
// returning a fresh fallback on every read trips the infinite-loop detection).
const EMPTY_VALUES: Record<string, DialValue> = Object.freeze({});
const EMPTY_HISTORY: PanelHistory = Object.freeze({ past: [], future: [] }) as PanelHistory;

class DialStoreClass {
  private panels: Map<string, PanelConfig> = new Map();
  private listeners: Map<string, Set<Listener>> = new Map();
  private globalListeners: Set<Listener> = new Set();
  private snapshots: Map<string, Record<string, DialValue>> = new Map();
  private actionListeners: Map<string, Set<ActionListener>> = new Map();
  private presets: Map<string, Preset[]> = new Map();
  private activePreset: Map<string, string | null> = new Map();
  private baseValues: Map<string, Record<string, DialValue>> = new Map();
  private history: Map<string, PanelHistory> = new Map();
  private discardedBranches: Map<string, HistorySnapshot[][]> = new Map();
  private activeGroups: Map<string, HistorySnapshot> = new Map();
  private historyListeners: Map<string, Set<Listener>> = new Map();
  // Most recently interacted panel — used to scope keyboard undo/redo
  private lastActivePanelId: string | null = null;
  // Persistence: per-panel storage key + enabled flag + debounced flush timer
  private panelNames: Map<string, string> = new Map();
  private persistEnabled: Map<string, boolean> = new Map();
  private persistTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  // Captured at panel registration so resetPanel can restore even after edits drift baseValues
  private originalDefaults: Map<string, Record<string, DialValue>> = new Map();

  registerPanel(id: string, name: string, config: DialConfig, shortcuts?: Record<string, ShortcutConfig>): void {
    const controls = this.parseConfig(config, '', shortcuts);
    const defaults = this.flattenValues(config, '');

    // Set initial transition modes based on config types
    this.initTransitionModes(config, '', defaults);

    // Capture pristine defaults so resetPanel can restore them even after edits
    this.originalDefaults.set(id, { ...defaults });
    this.panelNames.set(id, name);

    // Default persistence on. Per-panel toggle via setPersistenceEnabled.
    if (!this.persistEnabled.has(id)) {
      this.persistEnabled.set(id, true);
    }

    // Overlay any persisted values, normalized against the new config
    const values = this.hydrateValues(id, defaults, controls);

    this.panels.set(id, { id, name, controls, values, shortcuts: shortcuts ?? {} });
    this.snapshots.set(id, { ...values });
    this.baseValues.set(id, { ...values });
    this.notifyGlobal();
  }

  updatePanel(id: string, name: string, config: DialConfig, shortcuts?: Record<string, ShortcutConfig>): void {
    const existing = this.panels.get(id);
    if (!existing) {
      this.registerPanel(id, name, config, shortcuts);
      return;
    }

    const controls = this.parseConfig(config, '', shortcuts);
    const controlsByPath = this.mapControlsByPath(controls);
    const defaultValues = this.flattenValues(config, '');
    const nextValues: Record<string, DialValue> = {};

    for (const [path, defaultValue] of Object.entries(defaultValues)) {
      nextValues[path] = this.normalizePreservedValue(
        existing.values[path],
        defaultValue,
        controlsByPath.get(path)
      );
    }

    // Set mode defaults for new transition controls first.
    this.initTransitionModes(config, '', nextValues);

    for (const [path, mode] of Object.entries(existing.values)) {
      if (!path.endsWith('.__mode')) {
        continue;
      }

      const transitionPath = path.slice(0, -'__mode'.length - 1);
      const transitionControl = controlsByPath.get(transitionPath);
      if (transitionControl?.type === 'transition') {
        nextValues[path] = mode;
      }
    }

    // Refresh originalDefaults and panelName for the new config shape
    this.originalDefaults.set(id, { ...defaultValues });
    this.panelNames.set(id, name);

    const nextPanel: PanelConfig = { id, name, controls, values: nextValues, shortcuts: shortcuts ?? existing.shortcuts };
    this.panels.set(id, nextPanel);
    this.snapshots.set(id, { ...nextValues });

    const previousBaseValues = this.baseValues.get(id) ?? {};
    const nextBaseValues: Record<string, DialValue> = {};
    for (const [path, defaultValue] of Object.entries(defaultValues)) {
      nextBaseValues[path] = this.normalizePreservedValue(
        previousBaseValues[path],
        defaultValue,
        controlsByPath.get(path)
      );
    }

    for (const [path, value] of Object.entries(nextValues)) {
      if (path.endsWith('.__mode')) {
        nextBaseValues[path] = value;
      }
    }

    this.baseValues.set(id, nextBaseValues);

    this.schedulePersist(id);
    this.notify(id);
    this.notifyGlobal();
  }

  unregisterPanel(id: string): void {
    // Flush any pending persist before tearing down
    const pendingTimer = this.persistTimers.get(id);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.persistTimers.delete(id);
      this.persist(id);
    }

    this.panels.delete(id);
    this.listeners.delete(id);
    this.snapshots.delete(id);
    this.actionListeners.delete(id);
    this.baseValues.delete(id);
    this.history.delete(id);
    this.discardedBranches.delete(id);
    this.activeGroups.delete(id);
    this.historyListeners.delete(id);
    this.originalDefaults.delete(id);
    this.panelNames.delete(id);
    this.persistEnabled.delete(id);
    if (this.lastActivePanelId === id) {
      this.lastActivePanelId = null;
    }
    this.notifyGlobal();
  }

  // Most recently interacted panel — useful for scoping global actions like undo/redo.
  // Falls back to the first registered panel if no interaction has happened yet.
  getLastActivePanelId(): string | null {
    if (this.lastActivePanelId && this.panels.has(this.lastActivePanelId)) {
      return this.lastActivePanelId;
    }
    const first = this.panels.keys().next();
    return first.done ? null : first.value;
  }

  updateValue(panelId: string, path: string, value: DialValue): void {
    const panel = this.panels.get(panelId);
    if (!panel) return;

    this.lastActivePanelId = panelId;

    const previousValue = panel.values[path];
    const isAtomic = !this.activeGroups.has(panelId);

    // For atomic (non-grouped) changes, capture the BEFORE state so undo can restore it.
    // Skip the snapshot if the value didn't actually change.
    const before: HistorySnapshot | null =
      isAtomic && previousValue !== value
        ? { values: { ...panel.values }, timestamp: Date.now() }
        : null;

    panel.values[path] = value;

    // Auto-save to active preset or base values
    const activeId = this.activePreset.get(panelId);
    if (activeId) {
      const presets = this.presets.get(panelId) ?? [];
      const preset = presets.find(p => p.id === activeId);
      if (preset) preset.values[path] = value;
    } else {
      const base = this.baseValues.get(panelId);
      if (base) base[path] = value;
    }

    if (before) {
      this.commitHistory(panelId, before);
    }

    // Create a new snapshot reference so useSyncExternalStore detects the change
    this.snapshots.set(panelId, { ...panel.values });
    this.schedulePersist(panelId);
    this.notify(panelId);
  }

  updateSpringMode(panelId: string, path: string, mode: 'simple' | 'advanced'): void {
    this.updateTransitionMode(panelId, path, mode);
  }

  getSpringMode(panelId: string, path: string): 'simple' | 'advanced' {
    const mode = this.getTransitionMode(panelId, path);
    if (mode === 'easing') return 'simple';
    return mode;
  }

  updateTransitionMode(panelId: string, path: string, mode: 'easing' | 'simple' | 'advanced'): void {
    const panel = this.panels.get(panelId);
    if (!panel) return;

    this.lastActivePanelId = panelId;

    const modeKey = `${path}.__mode`;
    const previousMode = panel.values[modeKey];
    const isAtomic = !this.activeGroups.has(panelId);

    const before: HistorySnapshot | null =
      isAtomic && previousMode !== mode
        ? { values: { ...panel.values }, timestamp: Date.now() }
        : null;

    panel.values[modeKey] = mode;

    if (before) {
      this.commitHistory(panelId, before);
    }

    this.snapshots.set(panelId, { ...panel.values });
    this.schedulePersist(panelId);
    this.notify(panelId);
  }

  getTransitionMode(panelId: string, path: string): 'easing' | 'simple' | 'advanced' {
    const panel = this.panels.get(panelId);
    if (!panel) return 'simple';
    return (panel.values[`${path}.__mode`] as 'easing' | 'simple' | 'advanced') || 'simple';
  }

  getValue(panelId: string, path: string): DialValue | undefined {
    const panel = this.panels.get(panelId);
    return panel?.values[path];
  }

  getValues(panelId: string): Record<string, DialValue> {
    // Return the snapshot for useSyncExternalStore compatibility
    // Use stable EMPTY_VALUES to avoid infinite loop in React 19
    return this.snapshots.get(panelId) ?? EMPTY_VALUES;
  }

  getPanels(): PanelConfig[] {
    return Array.from(this.panels.values());
  }

  getPanel(id: string): PanelConfig | undefined {
    return this.panels.get(id);
  }

  subscribe(panelId: string, listener: Listener): () => void {
    if (!this.listeners.has(panelId)) {
      this.listeners.set(panelId, new Set());
    }
    this.listeners.get(panelId)!.add(listener);

    return () => {
      this.listeners.get(panelId)?.delete(listener);
    };
  }

  subscribeGlobal(listener: Listener): () => void {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  }

  subscribeActions(panelId: string, listener: ActionListener): () => void {
    if (!this.actionListeners.has(panelId)) {
      this.actionListeners.set(panelId, new Set());
    }
    this.actionListeners.get(panelId)!.add(listener);

    return () => {
      this.actionListeners.get(panelId)?.delete(listener);
    };
  }

  triggerAction(panelId: string, path: string): void {
    this.actionListeners.get(panelId)?.forEach(fn => fn(path));
  }

  savePreset(panelId: string, name: string): string {
    const panel = this.panels.get(panelId);
    if (!panel) throw new Error(`Panel ${panelId} not found`);

    const id = `preset-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const preset: Preset = {
      id,
      name,
      values: { ...panel.values },
    };

    const existing = this.presets.get(panelId) ?? [];
    this.presets.set(panelId, [...existing, preset]);
    this.activePreset.set(panelId, id);

    // Force re-render by creating new snapshot reference
    this.snapshots.set(panelId, { ...panel.values });
    this.notify(panelId);

    return id;
  }

  loadPreset(panelId: string, presetId: string): void {
    const panel = this.panels.get(panelId);
    if (!panel) return;

    const presets = this.presets.get(panelId) ?? [];
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;

    const before: HistorySnapshot = {
      values: { ...panel.values },
      timestamp: Date.now(),
      label: `before load: ${preset.name}`,
    };

    // Apply preset values
    panel.values = { ...preset.values };
    this.commitHistory(panelId, before);
    this.snapshots.set(panelId, { ...panel.values });
    this.activePreset.set(panelId, presetId);
    this.schedulePersist(panelId);
    this.notify(panelId);
  }

  deletePreset(panelId: string, presetId: string): void {
    const presets = this.presets.get(panelId) ?? [];
    this.presets.set(panelId, presets.filter(p => p.id !== presetId));

    // Clear active if deleted
    if (this.activePreset.get(panelId) === presetId) {
      this.activePreset.set(panelId, null);
    }

    // Force re-render by creating new snapshot reference
    const panel = this.panels.get(panelId);
    if (panel) {
      this.snapshots.set(panelId, { ...panel.values });
    }
    this.notify(panelId);
  }

  getPresets(panelId: string): Preset[] {
    return this.presets.get(panelId) ?? [];
  }

  getActivePresetId(panelId: string): string | null {
    return this.activePreset.get(panelId) ?? null;
  }

  clearActivePreset(panelId: string): void {
    const panel = this.panels.get(panelId);
    const base = this.baseValues.get(panelId);
    if (panel && base) {
      const before: HistorySnapshot = {
        values: { ...panel.values },
        timestamp: Date.now(),
        label: 'before clear preset',
      };
      panel.values = { ...base };
      this.commitHistory(panelId, before);
      this.snapshots.set(panelId, { ...panel.values });
    }
    this.activePreset.set(panelId, null);
    this.schedulePersist(panelId);
    this.notify(panelId);
  }

  resolveShortcutTarget(key: string, modifier?: 'alt' | 'shift' | 'meta'): {
    panelId: string;
    path: string;
    control: ControlMeta;
  } | null {
    for (const panel of this.panels.values()) {
      for (const [path, shortcut] of Object.entries(panel.shortcuts)) {
        if (!shortcut.key) continue; // skip keyless shortcuts
        if (shortcut.key.toLowerCase() !== key.toLowerCase()) continue;
        const scMod = shortcut.modifier ?? undefined;
        if (scMod !== modifier) continue;

        const control = this.findControlByPath(panel.controls, path);
        if (control) {
          return { panelId: panel.id, path, control };
        }
      }
    }
    return null;
  }

  resolveScrollOnlyTargets(): Array<{
    panelId: string;
    path: string;
    control: ControlMeta;
    shortcut: ShortcutConfig;
  }> {
    const results: Array<{ panelId: string; path: string; control: ControlMeta; shortcut: ShortcutConfig }> = [];
    for (const panel of this.panels.values()) {
      for (const [path, shortcut] of Object.entries(panel.shortcuts)) {
        if ((shortcut.interaction ?? 'scroll') !== 'scroll-only') continue;
        const control = this.findControlByPath(panel.controls, path);
        if (control) {
          results.push({ panelId: panel.id, path, control, shortcut });
        }
      }
    }
    return results;
  }

  private findControlByPath(controls: ControlMeta[], path: string): ControlMeta | null {
    for (const control of controls) {
      if (control.path === path) return control;
      if (control.type === 'folder' && control.children) {
        const found = this.findControlByPath(control.children, path);
        if (found) return found;
      }
    }
    return null;
  }

  private notify(panelId: string): void {
    this.listeners.get(panelId)?.forEach(fn => fn());
  }

  private notifyGlobal(): void {
    this.globalListeners.forEach(fn => fn());
  }

  private initTransitionModes(config: DialConfig, prefix: string, values: Record<string, DialValue>): void {
    for (const [key, value] of Object.entries(config)) {
      if (key === '_collapsed') continue;
      const path = prefix ? `${prefix}.${key}` : key;

      if (this.isEasingConfig(value)) {
        values[`${path}.__mode`] = 'easing';
      } else if (this.isSpringConfig(value)) {
        // Detect physics mode from config
        const hasPhysics = value.stiffness !== undefined || value.damping !== undefined || value.mass !== undefined;
        const hasTime = value.visualDuration !== undefined || value.bounce !== undefined;
        values[`${path}.__mode`] = hasPhysics && !hasTime ? 'advanced' : 'simple';
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value) && !this.isActionConfig(value) && !this.isSelectConfig(value) && !this.isColorConfig(value) && !this.isTextConfig(value)) {
        this.initTransitionModes(value as DialConfig, path, values);
      }
    }
  }

  private parseConfig(config: DialConfig, prefix: string, shortcuts?: Record<string, ShortcutConfig>): ControlMeta[] {
    const controls: ControlMeta[] = [];

    for (const [key, value] of Object.entries(config)) {
      if (key === '_collapsed') continue;
      const path = prefix ? `${prefix}.${key}` : key;
      const label = this.formatLabel(key);
      const shortcut = shortcuts?.[path];

      if (Array.isArray(value) && value.length <= 4 && typeof value[0] === 'number') {
        // Range tuple: [default, min, max]
        controls.push({
          type: 'slider',
          path,
          label,
          min: value[1],
          max: value[2],
          step: value[3] ?? this.inferStep(value[1], value[2]),
          shortcut,
        });
      } else if (typeof value === 'number') {
        // Single number - auto-infer range
        const { min, max, step } = this.inferRange(value);
        controls.push({ type: 'slider', path, label, min, max, step, shortcut });
      } else if (typeof value === 'boolean') {
        controls.push({ type: 'toggle', path, label, shortcut });
      } else if (this.isSpringConfig(value) || this.isEasingConfig(value)) {
        controls.push({ type: 'transition', path, label });
      } else if (this.isActionConfig(value)) {
        controls.push({ type: 'action', path, label: (value as ActionConfig).label || label });
      } else if (this.isSelectConfig(value)) {
        controls.push({ type: 'select', path, label, options: value.options });
      } else if (this.isColorConfig(value)) {
        controls.push({ type: 'color', path, label });
      } else if (this.isTextConfig(value)) {
        controls.push({ type: 'text', path, label, placeholder: value.placeholder });
      } else if (typeof value === 'string') {
        // Auto-detect: hex color vs text
        if (this.isHexColor(value)) {
          controls.push({ type: 'color', path, label });
        } else {
          controls.push({ type: 'text', path, label });
        }
      } else if (typeof value === 'object' && value !== null) {
        // Nested object becomes a folder
        const folderConfig = value as DialConfig;
        const defaultOpen = '_collapsed' in folderConfig ? !(folderConfig._collapsed as boolean) : true;
        controls.push({
          type: 'folder',
          path,
          label,
          defaultOpen,
          children: this.parseConfig(folderConfig, path, shortcuts),
        });
      }
    }

    return controls;
  }

  private flattenValues(config: DialConfig, prefix: string): Record<string, DialValue> {
    const values: Record<string, DialValue> = {};

    for (const [key, value] of Object.entries(config)) {
      if (key === '_collapsed') continue;
      const path = prefix ? `${prefix}.${key}` : key;

      if (Array.isArray(value) && value.length <= 4 && typeof value[0] === 'number') {
        values[path] = value[0]; // Default value
      } else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
        values[path] = value;
      } else if (this.isSpringConfig(value) || this.isEasingConfig(value)) {
        values[path] = value;
      } else if (this.isActionConfig(value)) {
        // Actions don't need stored values - they're just triggers
        values[path] = value;
      } else if (this.isSelectConfig(value)) {
        // Use default or first option's value
        const firstOption = value.options[0];
        const firstValue = typeof firstOption === 'string' ? firstOption : firstOption.value;
        values[path] = value.default ?? firstValue;
      } else if (this.isColorConfig(value)) {
        values[path] = value.default ?? '#000000';
      } else if (this.isTextConfig(value)) {
        values[path] = value.default ?? '';
      } else if (typeof value === 'object' && value !== null) {
        Object.assign(values, this.flattenValues(value as DialConfig, path));
      }
    }

    return values;
  }

  private isSpringConfig(value: unknown): value is SpringConfig {
    return (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      (value as SpringConfig).type === 'spring'
    );
  }

  private isEasingConfig(value: unknown): value is EasingConfig {
    return (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      (value as EasingConfig).type === 'easing'
    );
  }

  private isActionConfig(value: unknown): value is ActionConfig {
    return (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      (value as ActionConfig).type === 'action'
    );
  }

  private isSelectConfig(value: unknown): value is SelectConfig {
    return (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      (value as SelectConfig).type === 'select' &&
      'options' in value &&
      Array.isArray((value as SelectConfig).options)
    );
  }

  private isColorConfig(value: unknown): value is ColorConfig {
    return (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      (value as ColorConfig).type === 'color'
    );
  }

  private isTextConfig(value: unknown): value is TextConfig {
    return (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      (value as TextConfig).type === 'text'
    );
  }

  private isHexColor(value: string): boolean {
    return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(value);
  }

  private formatLabel(key: string): string {
    // Convert camelCase to Title Case
    return key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }

  private inferRange(value: number): { min: number; max: number; step: number } {
    // Infer reasonable range based on value
    if (value >= 0 && value <= 1) {
      return { min: 0, max: 1, step: 0.01 };
    } else if (value >= 0 && value <= 10) {
      return { min: 0, max: value * 3 || 10, step: 0.1 };
    } else if (value >= 0 && value <= 100) {
      return { min: 0, max: value * 3 || 100, step: 1 };
    } else if (value >= 0) {
      return { min: 0, max: value * 3 || 1000, step: 10 };
    } else {
      return { min: value * 3, max: -value * 3, step: 1 };
    }
  }

  private inferStep(min: number, max: number): number {
    const range = max - min;
    if (range <= 1) return 0.01;
    if (range <= 10) return 0.1;
    if (range <= 100) return 1;
    return 10;
  }

  private normalizePreservedValue(
    existingValue: DialValue | undefined,
    defaultValue: DialValue,
    control: ControlMeta | undefined
  ): DialValue {
    if (existingValue === undefined || !control) {
      return defaultValue;
    }

    switch (control.type) {
      case 'slider': {
        if (typeof existingValue !== 'number' || typeof defaultValue !== 'number') {
          return defaultValue;
        }

        const min = control.min ?? Number.NEGATIVE_INFINITY;
        const max = control.max ?? Number.POSITIVE_INFINITY;
        const clamped = Math.min(max, Math.max(min, existingValue));

        if (typeof control.step !== 'number' || control.step <= 0) {
          return clamped;
        }

        return this.roundToStep(clamped, min, max, control.step);
      }
      case 'toggle':
        return typeof existingValue === 'boolean' ? existingValue : defaultValue;
      case 'select': {
        if (typeof existingValue !== 'string') {
          return defaultValue;
        }

        const options = control.options ?? [];
        const validValues = new Set(options.map((option) => (typeof option === 'string' ? option : option.value)));
        return validValues.has(existingValue) ? existingValue : defaultValue;
      }
      case 'color':
      case 'text':
        return typeof existingValue === 'string' ? existingValue : defaultValue;
      case 'transition':
        if (this.isSpringConfig(defaultValue)) {
          return this.isSpringConfig(existingValue) ? existingValue : defaultValue;
        }
        if (this.isEasingConfig(defaultValue)) {
          return this.isEasingConfig(existingValue) ? existingValue : defaultValue;
        }
        return defaultValue;
      case 'action':
        return defaultValue;
      default:
        return defaultValue;
    }
  }

  private roundToStep(value: number, min: number, max: number, step: number): number {
    const snapped = min + Math.round((value - min) / step) * step;
    const clamped = Math.min(max, Math.max(min, snapped));
    const precision = this.stepPrecision(step);
    return Number(clamped.toFixed(precision));
  }

  private stepPrecision(step: number): number {
    const text = String(step);
    const decimalIndex = text.indexOf('.');
    return decimalIndex === -1 ? 0 : text.length - decimalIndex - 1;
  }

  private mapControlsByPath(controls: ControlMeta[]): Map<string, ControlMeta> {
    const map = new Map<string, ControlMeta>();

    const visit = (nodes: ControlMeta[]) => {
      for (const node of nodes) {
        if (node.type === 'folder' && node.children) {
          visit(node.children);
          continue;
        }

        map.set(node.path, node);
      }
    };

    visit(controls);
    return map;
  }

  // ─── History (undo/redo, snapshot timeline, branch stash) ───────────────────

  // Start a group: subsequent updateValue calls won't push history until endGroup.
  // The "before" state is captured once at begin; one history entry is committed on end.
  // Use for drag interactions (slider, color) where many micro-updates should collapse to one undo step.
  beginGroup(panelId: string, label?: string): void {
    const panel = this.panels.get(panelId);
    if (!panel) return;
    if (this.activeGroups.has(panelId)) return; // nested begin is a no-op

    this.lastActivePanelId = panelId;

    this.activeGroups.set(panelId, {
      values: { ...panel.values },
      timestamp: Date.now(),
      label,
    });
  }

  endGroup(panelId: string): void {
    const pending = this.activeGroups.get(panelId);
    if (!pending) return;
    this.activeGroups.delete(panelId);

    const panel = this.panels.get(panelId);
    if (!panel) return;

    // No commit if the group ended without any net change
    if (this.valuesEqual(pending.values, panel.values)) return;

    this.commitHistory(panelId, pending);
  }

  // Abandon a group without committing. Reverts panel values to the captured before state.
  cancelGroup(panelId: string): void {
    const pending = this.activeGroups.get(panelId);
    if (!pending) return;
    this.activeGroups.delete(panelId);

    const panel = this.panels.get(panelId);
    if (!panel) return;

    panel.values = { ...pending.values };
    this.snapshots.set(panelId, { ...panel.values });
    this.schedulePersist(panelId);
    this.notify(panelId);
  }

  isInGroup(panelId: string): boolean {
    return this.activeGroups.has(panelId);
  }

  undo(panelId: string): boolean {
    const h = this.history.get(panelId);
    if (!h || h.past.length === 0) return false;

    const panel = this.panels.get(panelId);
    if (!panel) return false;

    h.future.push({
      values: { ...panel.values },
      timestamp: Date.now(),
    });
    if (h.future.length > MAX_HISTORY) h.future.shift();

    const previous = h.past.pop()!;
    panel.values = { ...previous.values };
    this.snapshots.set(panelId, { ...panel.values });

    // Replace the wrapper so useSyncExternalStore detects the change
    this.history.set(panelId, { past: h.past, future: h.future });

    this.schedulePersist(panelId);
    this.notify(panelId);
    this.notifyHistory(panelId);
    return true;
  }

  redo(panelId: string): boolean {
    const h = this.history.get(panelId);
    if (!h || h.future.length === 0) return false;

    const panel = this.panels.get(panelId);
    if (!panel) return false;

    h.past.push({
      values: { ...panel.values },
      timestamp: Date.now(),
    });
    if (h.past.length > MAX_HISTORY) h.past.shift();

    const next = h.future.pop()!;
    panel.values = { ...next.values };
    this.snapshots.set(panelId, { ...panel.values });

    // Replace the wrapper so useSyncExternalStore detects the change
    this.history.set(panelId, { past: h.past, future: h.future });

    this.schedulePersist(panelId);
    this.notify(panelId);
    this.notifyHistory(panelId);
    return true;
  }

  canUndo(panelId: string): boolean {
    return (this.history.get(panelId)?.past.length ?? 0) > 0;
  }

  canRedo(panelId: string): boolean {
    return (this.history.get(panelId)?.future.length ?? 0) > 0;
  }

  getHistory(panelId: string): PanelHistory {
    return this.history.get(panelId) ?? EMPTY_HISTORY;
  }

  subscribeHistory(panelId: string, listener: Listener): () => void {
    if (!this.historyListeners.has(panelId)) {
      this.historyListeners.set(panelId, new Set());
    }
    this.historyListeners.get(panelId)!.add(listener);

    return () => {
      this.historyListeners.get(panelId)?.delete(listener);
    };
  }

  clearHistory(panelId: string): void {
    this.history.delete(panelId);
    this.discardedBranches.delete(panelId);
    this.activeGroups.delete(panelId);
    this.notifyHistory(panelId);
  }

  getDiscardedBranches(panelId: string): HistorySnapshot[][] {
    return this.discardedBranches.get(panelId) ?? [];
  }

  // Restore the most recently discarded future branch as the redo stack.
  // Useful when the user branched off a playback and immediately regrets it.
  restoreDiscardedBranch(panelId: string): boolean {
    const stash = this.discardedBranches.get(panelId);
    if (!stash || stash.length === 0) return false;

    const branch = stash.pop()!;
    const existing = this.history.get(panelId);
    const past = existing?.past ?? [];
    // Replace the wrapper so useSyncExternalStore detects the change
    this.history.set(panelId, { past, future: branch });

    this.notifyHistory(panelId);
    return true;
  }

  // Commit a captured "before" snapshot to past[]. Clears future and stashes it if non-empty.
  private commitHistory(panelId: string, before: HistorySnapshot): void {
    let h = this.history.get(panelId);
    if (!h) {
      h = { past: [], future: [] };
    }

    h.past.push(before);
    if (h.past.length > MAX_HISTORY) h.past.shift();

    if (h.future.length > 0) {
      const stash = this.discardedBranches.get(panelId) ?? [];
      stash.push(h.future);
      if (stash.length > MAX_DISCARDED_BRANCHES) stash.shift();
      this.discardedBranches.set(panelId, stash);
      h.future = [];
    }

    // Replace the wrapper so useSyncExternalStore detects the change
    this.history.set(panelId, { past: h.past, future: h.future });
    this.notifyHistory(panelId);
  }

  private notifyHistory(panelId: string): void {
    this.historyListeners.get(panelId)?.forEach(fn => fn());
  }

  private valuesEqual(a: Record<string, DialValue>, b: Record<string, DialValue>): boolean {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (a[key] !== b[key]) return false;
    }
    return true;
  }

  // ─── Persistence (localStorage, debounced) ──────────────────────────────────

  // Toggle persistence at the panel level. Disabling also clears any saved blob.
  setPersistenceEnabled(panelId: string, enabled: boolean): void {
    this.persistEnabled.set(panelId, enabled);
    if (!enabled) {
      this.clearStorage(panelId);
    } else {
      // If newly enabled, flush current state right away
      this.persist(panelId);
    }
  }

  // Reset a panel to its original config defaults. Pushes a history entry so the user can undo.
  // Clears the active preset and any persisted blob; future edits will repopulate storage.
  resetPanel(panelId: string): void {
    const panel = this.panels.get(panelId);
    const defaults = this.originalDefaults.get(panelId);
    if (!panel || !defaults) return;

    const before: HistorySnapshot = {
      values: { ...panel.values },
      timestamp: Date.now(),
      label: 'before reset',
    };

    panel.values = { ...defaults };
    this.baseValues.set(panelId, { ...defaults });
    this.snapshots.set(panelId, { ...panel.values });
    this.activePreset.set(panelId, null);
    this.activeGroups.delete(panelId);

    this.commitHistory(panelId, before);
    this.clearStorage(panelId);

    this.notify(panelId);
  }

  private persistKey(panelId: string): string | null {
    const name = this.panelNames.get(panelId);
    if (!name) return null;
    return `${PERSIST_KEY_PREFIX}:${name}:${PERSIST_KEY_VERSION}`;
  }

  // Coalesces rapid mutations (slider drag, etc.) into one localStorage write.
  private schedulePersist(panelId: string): void {
    if (!this.persistEnabled.get(panelId)) return;
    if (typeof localStorage === 'undefined') return;

    const existing = this.persistTimers.get(panelId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.persistTimers.delete(panelId);
      this.persist(panelId);
    }, PERSIST_DEBOUNCE_MS);

    this.persistTimers.set(panelId, timer);
  }

  private persist(panelId: string): void {
    if (!this.persistEnabled.get(panelId)) return;
    if (typeof localStorage === 'undefined') return;

    const panel = this.panels.get(panelId);
    const key = this.persistKey(panelId);
    if (!panel || !key) return;

    try {
      localStorage.setItem(key, JSON.stringify(panel.values));
    } catch {
      // Quota exceeded, blocked storage, etc. — silently skip; persistence is best-effort
    }
  }

  private clearStorage(panelId: string): void {
    if (typeof localStorage === 'undefined') return;
    const key = this.persistKey(panelId);
    if (!key) return;
    try {
      localStorage.removeItem(key);
    } catch {
      // best-effort
    }
  }

  // Read persisted values for this panel (if any) and merge over the supplied defaults,
  // normalizing against the current config so removed/changed paths fall back cleanly.
  private hydrateValues(
    panelId: string,
    defaults: Record<string, DialValue>,
    controls: ControlMeta[]
  ): Record<string, DialValue> {
    if (!this.persistEnabled.get(panelId)) return { ...defaults };
    if (typeof localStorage === 'undefined') return { ...defaults };

    const key = this.persistKey(panelId);
    if (!key) return { ...defaults };

    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      return { ...defaults };
    }
    if (!raw) return { ...defaults };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...defaults };
    }
    if (!parsed || typeof parsed !== 'object') return { ...defaults };

    const stored = parsed as Record<string, DialValue>;
    const controlsByPath = this.mapControlsByPath(controls);
    const merged: Record<string, DialValue> = {};

    for (const [path, defaultValue] of Object.entries(defaults)) {
      // For internal __mode keys (transition mode), accept the stored string as-is
      if (path.endsWith('.__mode')) {
        const storedMode = stored[path];
        merged[path] = typeof storedMode === 'string' ? storedMode : defaultValue;
        continue;
      }

      merged[path] = this.normalizePreservedValue(
        stored[path],
        defaultValue,
        controlsByPath.get(path)
      );
    }

    return merged;
  }

}

// Singleton instance
export const DialStore = new DialStoreClass();
