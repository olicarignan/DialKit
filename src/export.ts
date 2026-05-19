// Serializers that turn a panel's current state into pasteable code in several formats.
// Available programmatically (`import { exportConfig } from 'dialkit'`) and used by the
// Copy menu in the panel toolbar.

import { DialStore, ControlMeta, DialValue, SpringConfig, EasingConfig } from './store/DialStore';

// ─── Config literal ─────────────────────────────────────────────────────────
// Re-emits the useDialKit config object with the panel's current values substituted as defaults.
// Output is pretty-printed TypeScript/JavaScript suitable for pasting back into source code.
export function exportConfig(panelId: string): string {
  const panel = DialStore.getPanel(panelId);
  if (!panel) return '';
  return emitGroup(panel.controls, panel.values, 0, false);
}

// ─── JSON ───────────────────────────────────────────────────────────────────
// Plain JSON of the current values. Skips internal `__mode` markers.
export function exportJSON(panelId: string, pretty: boolean = true): string {
  const panel = DialStore.getPanel(panelId);
  if (!panel) return '{}';
  const clean: Record<string, DialValue> = {};
  for (const [path, value] of Object.entries(panel.values)) {
    if (path.endsWith('.__mode')) continue;
    clean[path] = value;
  }
  return JSON.stringify(clean, null, pretty ? 2 : 0);
}

// ─── CSS variables ──────────────────────────────────────────────────────────
// Flattens dotted paths into `--prefix-key: value;` lines. Skips non-primitive values
// (spring/easing configs, action triggers, internal mode markers).
export function exportCSS(panelId: string, prefix: string = '--dial'): string {
  const panel = DialStore.getPanel(panelId);
  if (!panel) return '';

  const lines: string[] = [];
  for (const [path, value] of Object.entries(panel.values)) {
    if (path.endsWith('.__mode')) continue;
    if (typeof value === 'object' && value !== null) continue;

    const key = `${prefix}-${path.replace(/\./g, '-')}`.toLowerCase();
    lines.push(`${key}: ${formatCSSValue(value)};`);
  }
  return lines.join('\n');
}

// ─── Internal ───────────────────────────────────────────────────────────────

function emitGroup(
  controls: ControlMeta[],
  values: Record<string, DialValue>,
  depth: number,
  collapsed: boolean,
): string {
  const pad = '  '.repeat(depth);
  const inner = '  '.repeat(depth + 1);
  const lines: string[] = ['{'];

  if (collapsed) lines.push(`${inner}_collapsed: true,`);

  for (const control of controls) {
    const key = lastSegment(control.path);
    if (control.type === 'folder') {
      const child = emitGroup(
        control.children ?? [],
        values,
        depth + 1,
        control.defaultOpen === false,
      );
      lines.push(`${inner}${key}: ${child},`);
    } else {
      lines.push(`${inner}${key}: ${emitValue(control, values[control.path])},`);
    }
  }

  lines.push(`${pad}}`);
  return lines.join('\n');
}

function emitValue(control: ControlMeta, value: DialValue | undefined): string {
  switch (control.type) {
    case 'slider': {
      const v = typeof value === 'number' ? value : 0;
      const min = control.min ?? 0;
      const max = control.max ?? 1;
      const step = control.step;
      const inferred = inferStep(min, max);
      // Omit step if it matches what useDialKit would infer from the range
      if (step !== undefined && Math.abs(step - inferred) > 1e-9) {
        return `[${fmtNum(v)}, ${fmtNum(min)}, ${fmtNum(max)}, ${fmtNum(step)}]`;
      }
      return `[${fmtNum(v)}, ${fmtNum(min)}, ${fmtNum(max)}]`;
    }

    case 'toggle':
      return value === true ? 'true' : 'false';

    case 'text': {
      const str = typeof value === 'string' ? value : '';
      if (control.placeholder) {
        return `{ type: 'text', default: ${JSON.stringify(str)}, placeholder: ${JSON.stringify(control.placeholder)} }`;
      }
      return JSON.stringify(str);
    }

    case 'color':
      return JSON.stringify(typeof value === 'string' ? value : '#000000');

    case 'select': {
      const opts = control.options ?? [];
      const optsCode = opts
        .map((o) =>
          typeof o === 'string'
            ? JSON.stringify(o)
            : `{ value: ${JSON.stringify(o.value)}, label: ${JSON.stringify(o.label)} }`,
        )
        .join(', ');
      const defaultStr = JSON.stringify(typeof value === 'string' ? value : '');
      return `{ type: 'select', options: [${optsCode}], default: ${defaultStr} }`;
    }

    case 'transition': {
      if (value && typeof value === 'object' && 'type' in value) {
        const v = value as SpringConfig | EasingConfig;
        if (v.type === 'spring') return emitSpring(v);
        if (v.type === 'easing') return emitEasing(v);
      }
      return 'null';
    }

    case 'action':
      if (control.label && control.label !== defaultLabel(lastSegment(control.path))) {
        return `{ type: 'action', label: ${JSON.stringify(control.label)} }`;
      }
      return `{ type: 'action' }`;

    case 'spring':
      if (value && typeof value === 'object' && 'type' in value && (value as SpringConfig).type === 'spring') {
        return emitSpring(value as SpringConfig);
      }
      return 'null';

    default:
      return 'null';
  }
}

function emitSpring(s: SpringConfig): string {
  const parts: string[] = [`type: 'spring'`];
  if (s.visualDuration !== undefined) parts.push(`visualDuration: ${fmtNum(s.visualDuration)}`);
  if (s.bounce !== undefined) parts.push(`bounce: ${fmtNum(s.bounce)}`);
  if (s.stiffness !== undefined) parts.push(`stiffness: ${fmtNum(s.stiffness)}`);
  if (s.damping !== undefined) parts.push(`damping: ${fmtNum(s.damping)}`);
  if (s.mass !== undefined) parts.push(`mass: ${fmtNum(s.mass)}`);
  return `{ ${parts.join(', ')} }`;
}

function emitEasing(e: EasingConfig): string {
  return `{ type: 'easing', duration: ${fmtNum(e.duration)}, ease: [${e.ease.map(fmtNum).join(', ')}] }`;
}

function fmtNum(n: number): string {
  // Strips float noise like 0.30000000000000004 down to 0.3
  return Number(n.toFixed(10)).toString();
}

// Mirrors DialStore's inferStep so we know when to omit the step argument.
function inferStep(min: number, max: number): number {
  const range = max - min;
  if (range <= 1) return 0.01;
  if (range <= 10) return 0.1;
  if (range <= 100) return 1;
  return 10;
}

function lastSegment(path: string): string {
  const i = path.lastIndexOf('.');
  return i === -1 ? path : path.slice(i + 1);
}

function defaultLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function formatCSSValue(value: DialValue): string {
  if (typeof value === 'number') return fmtNum(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'string') return value;
  return String(value);
}
