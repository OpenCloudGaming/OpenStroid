import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface SettingsModalHostProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function SettingsModalHost({ open, onClose, children }: SettingsModalHostProps) {
  const [contentReady, setContentReady] = useState(false);

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
      />

      <div
        className="animated-modal-panel settings-modal"
        onClick={(event) => event.stopPropagation()}
      >
        {contentReady ? children : <div className="settings-modal-placeholder" aria-hidden />}
      </div>
    </div>,
    document.body,
  );
}
