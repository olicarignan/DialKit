import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ICON_CLIPBOARD, ICON_CHECK } from '../icons';
import { exportConfig, exportJSON, exportCSS } from '../export';

interface CopyMenuProps {
  panelId: string;
}

type Format = 'config' | 'json' | 'css';

const FORMAT_LABELS: Record<Format, string> = {
  config: 'Copy as code',
  json: 'Copy as JSON',
  css: 'Copy as CSS variables',
};

export function CopyMenu({ panelId }: CopyMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const [themeAttrs, setThemeAttrs] = useState<{ theme?: string; frostedMode?: string }>({});

  const open = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    const rootEl = triggerRef.current?.closest('.dialkit-root') as HTMLElement | null;
    setThemeAttrs({
      theme: rootEl?.getAttribute('data-theme') ?? undefined,
      frostedMode: rootEl?.getAttribute('data-frosted-mode') ?? undefined,
    });
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  const toggle = useCallback(() => {
    if (isOpen) close();
    else open();
  }, [isOpen, open, close]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) return;
      close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, close]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, close]);

  const handlePick = (fmt: Format) => {
    let text = '';
    switch (fmt) {
      case 'config':
        text = exportConfig(panelId);
        break;
      case 'json':
        text = exportJSON(panelId);
        break;
      case 'css':
        text = exportCSS(panelId);
        break;
    }
    if (text) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
    close();
  };

  return (
    <>
      <motion.button
        ref={triggerRef}
        className="dialkit-toolbar-add"
        onClick={toggle}
        title="Copy parameters"
        whileTap={{ scale: 0.9 }}
        transition={{ type: 'spring', visualDuration: 0.15, bounce: 0.3 }}
      >
        <span style={{ position: 'relative', width: 16, height: 16 }}>
          <AnimatePresence initial={false} mode="wait">
            {copied ? (
              <motion.svg
                key="check"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ position: 'absolute', inset: 0, width: 16, height: 16, color: 'var(--dial-text-label)' }}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.08 }}
              >
                <path d={ICON_CHECK} />
              </motion.svg>
            ) : (
              <motion.svg
                key="clipboard"
                viewBox="0 0 24 24"
                fill="none"
                style={{ position: 'absolute', inset: 0, width: 16, height: 16, color: 'var(--dial-text-label)' }}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.08 }}
              >
                <path d={ICON_CLIPBOARD.board} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <path d={ICON_CLIPBOARD.sparkle} fill="currentColor" />
                <path d={ICON_CLIPBOARD.body} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </motion.svg>
            )}
          </AnimatePresence>
        </span>
      </motion.button>

      {createPortal(
        <AnimatePresence>
          {isOpen && (
            <motion.div
              ref={dropdownRef}
              className="dialkit-root dialkit-copy-dropdown"
              data-theme={themeAttrs.theme}
              data-frosted-mode={themeAttrs.frostedMode}
              style={{ position: 'fixed', top: pos.top, right: pos.right }}
              initial={{ opacity: 0, y: 4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.97, pointerEvents: 'none' as any }}
              transition={{ type: 'spring', visualDuration: 0.15, bounce: 0 }}
            >
              {(Object.keys(FORMAT_LABELS) as Format[]).map((fmt) => (
                <button
                  key={fmt}
                  className="dialkit-copy-item"
                  onClick={() => handlePick(fmt)}
                >
                  {FORMAT_LABELS[fmt]}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
