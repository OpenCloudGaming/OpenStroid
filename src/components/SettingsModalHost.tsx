import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FocusTrap } from '@mantine/core';

interface SettingsModalHostProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function SettingsModalHost({ open, onClose, children }: SettingsModalHostProps) {
  const [contentReady, setContentReady] = useState(false);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      const frame = window.requestAnimationFrame(() => {
        setContentReady(false);
      });
      return () => window.cancelAnimationFrame(frame);
    }

    const frame = window.requestAnimationFrame(() => {
      setContentReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const appRoot = document.getElementById('root');
    appRoot?.setAttribute('inert', '');
    return () => {
      appRoot?.removeAttribute('inert');
      previousFocus.current?.focus();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className="animated-modal-overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <button
        type="button"
        className="animated-modal-scrim"
        onClick={onClose}
        aria-label="Close settings"
        tabIndex={-1}
      />

      <FocusTrap active={contentReady}>
        <div
          className="animated-modal-panel settings-modal"
          onClick={(event) => event.stopPropagation()}
        >
          {contentReady ? children : <div className="settings-modal-placeholder" aria-hidden />}
        </div>
      </FocusTrap>
    </div>,
    document.body,
  );
}
