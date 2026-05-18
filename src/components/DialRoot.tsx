import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { DialStore, PanelConfig } from '../store/DialStore';
import { Panel } from './Panel';
import { ShortcutListener } from './ShortcutListener';

export type DialPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
export type DialMode = 'popover' | 'inline';
export type DialTheme = 'light' | 'dark' | 'system' | 'frosted';

declare const process: { env?: { NODE_ENV?: string } } | undefined;

const isDevDefault = typeof process !== 'undefined' && process?.env?.NODE_ENV
  ? process.env.NODE_ENV !== 'production'
  : typeof import.meta !== 'undefined' && (import.meta as any).env?.MODE
    ? (import.meta as any).env.MODE !== 'production'
    : true;

interface DialRootProps {
  position?: DialPosition;
  defaultOpen?: boolean;
  mode?: DialMode;
  theme?: DialTheme;
  productionEnabled?: boolean;
}

export function DialRoot({ position = 'top-right', defaultOpen = true, mode = 'popover', theme = 'system', productionEnabled = isDevDefault }: DialRootProps) {
  if (!productionEnabled) return null;
  const [panels, setPanels] = useState<PanelConfig[]>([]);
  const [mounted, setMounted] = useState(false);
  const inline = mode === 'inline';

  // Drag state
  const panelRef = useRef<HTMLDivElement>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [activePosition, setActivePosition] = useState(position);
  const savedCorner = useRef<DialPosition | null>(null);
  const draggingRef = useRef(false);
  const dragStartRef = useRef<{ pointerX: number; pointerY: number; elX: number; elY: number } | null>(null);
  const didDragRef = useRef(false);
  const snapRafRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (snapRafRef.current !== null) cancelAnimationFrame(snapRafRef.current);
  }, []);

  // Subscribe to global panel changes
  useEffect(() => {
    setMounted(true);
    setPanels(DialStore.getPanels());

    const unsubscribe = DialStore.subscribeGlobal(() => {
      setPanels(DialStore.getPanels());
    });

    return unsubscribe;
  }, []);

  // Frosted theme: detect the page's effective background luminance and use it as the light/dark signal
  const [frostedMode, setFrostedMode] = useState<'light' | 'dark'>('dark');
  useEffect(() => {
    if (theme !== 'frosted' || typeof window === 'undefined') return;

    const parseRGB = (value: string): { r: number; g: number; b: number } | null => {
      const m = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
      if (!m) return null;
      const alpha = m[4] !== undefined ? parseFloat(m[4]) : 1;
      if (alpha === 0) return null;
      return { r: +m[1], g: +m[2], b: +m[3] };
    };

    const compute = () => {
      const bg = parseRGB(getComputedStyle(document.body).backgroundColor)
        || parseRGB(getComputedStyle(document.documentElement).backgroundColor)
        || { r: 0, g: 0, b: 0 };
      const lum = (0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b) / 255;
      setFrostedMode(lum < 0.5 ? 'dark' : 'light');
    };

    compute();
    const observer = new MutationObserver(compute);
    observer.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    return () => observer.disconnect();
  }, [theme]);

  // Watch for panel open/close — open from top-left/top-right based on side, restore corner on close
  useEffect(() => {
    if (!panelRef.current || inline) return;
    const observer = new MutationObserver(() => {
      const inner = panelRef.current?.querySelector('.dialkit-panel-inner');
      if (!inner) return;
      const collapsed = inner.getAttribute('data-collapsed') === 'true';

      if (!collapsed) {
        // Opening — remember current corner so we can return to it on close, then expand from the same side
        savedCorner.current = activePosition;
        const isLeft = activePosition.endsWith('left');
        setActivePosition(isLeft ? 'top-left' : 'top-right');
        setDragOffset(null);
      } else if (savedCorner.current) {
        // Closing — restore the saved corner
        setActivePosition(savedCorner.current);
        setDragOffset(null);
      }
    });
    observer.observe(panelRef.current, { subtree: true, attributes: true, attributeFilter: ['data-collapsed'] });
    return () => observer.disconnect();
  }, [inline, activePosition]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Only drag the collapsed bubble
    const inner = panelRef.current?.querySelector('.dialkit-panel-inner');
    if (!inner || inner.getAttribute('data-collapsed') !== 'true') return;

    // Cancel any in-flight snap animation if the user grabs the bubble again
    if (snapRafRef.current !== null) {
      cancelAnimationFrame(snapRafRef.current);
      snapRafRef.current = null;
    }

    const rect = panelRef.current!.getBoundingClientRect();
    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      elX: rect.left,
      elY: rect.top,
    };
    didDragRef.current = false;
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current || !dragStartRef.current) return;

    const dx = e.clientX - dragStartRef.current.pointerX;
    const dy = e.clientY - dragStartRef.current.pointerY;

    if (!didDragRef.current && Math.abs(dx) + Math.abs(dy) < 4) return;
    didDragRef.current = true;

    setDragOffset({
      x: dragStartRef.current.elX + dx,
      y: dragStartRef.current.elY + dy,
    });
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    dragStartRef.current = null;

    // If we actually dragged, prevent the click from opening the panel and snap to nearest corner
    if (didDragRef.current) {
      e.stopPropagation();
      const inner = panelRef.current?.querySelector('.dialkit-panel-inner');
      if (inner) {
        const blocker = (ev: Event) => { ev.stopPropagation(); };
        inner.addEventListener('click', blocker, { capture: true, once: true });
      }

      if (panelRef.current) {
        const rect = panelRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const horizontal = centerX < window.innerWidth / 2 ? 'left' : 'right';
        const vertical = centerY < window.innerHeight / 2 ? 'top' : 'bottom';
        const corner = `${vertical}-${horizontal}` as DialPosition;

        const inset = 16;
        const targetX = horizontal === 'left' ? inset : window.innerWidth - rect.width - inset;
        const targetY = vertical === 'top' ? inset : window.innerHeight - rect.height - inset;
        const startX = rect.left;
        const startY = rect.top;
        const duration = 360;
        const startTime = performance.now();
        // easeOutBack — small overshoot then settle
        const c1 = 1.70158;
        const c3 = c1 + 1;
        const ease = (t: number) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);

        const tick = (now: number) => {
          const t = Math.min(1, (now - startTime) / duration);
          const e = ease(t);
          setDragOffset({
            x: startX + (targetX - startX) * e,
            y: startY + (targetY - startY) * e,
          });
          if (t < 1) {
            snapRafRef.current = requestAnimationFrame(tick);
          } else {
            snapRafRef.current = null;
            setActivePosition(corner);
            setDragOffset(null);
          }
        };
        snapRafRef.current = requestAnimationFrame(tick);
      }
    }
  }, []);

  // Don't render on server
  if (!mounted || typeof window === 'undefined') {
    return null;
  }

  // Don't render if no panels registered
  if (panels.length === 0) {
    return null;
  }

  const dragStyle = dragOffset ? {
    top: dragOffset.y,
    left: dragOffset.x,
    right: 'auto' as const,
    bottom: 'auto' as const,
  } : undefined;

  const content = (
  <ShortcutListener>
    <div className="dialkit-root" data-mode={mode} data-theme={theme} data-frosted-mode={theme === 'frosted' ? frostedMode : undefined}>
      <div
        ref={panelRef}
        className="dialkit-panel"
        data-position={inline ? undefined : (dragOffset ? undefined : activePosition)}
        data-mode={mode}
        style={dragStyle}
        onPointerDown={!inline ? handlePointerDown : undefined}
        onPointerMove={!inline ? handlePointerMove : undefined}
        onPointerUp={!inline ? handlePointerUp : undefined}
      >
        {panels.map((panel) => (
          <Panel key={panel.id} panel={panel} defaultOpen={inline || defaultOpen} inline={inline} />
        ))}
      </div>
    </div>
  </ShortcutListener>
  );

  if (inline) {
    return content;
  }

  return createPortal(content, document.body);
}
