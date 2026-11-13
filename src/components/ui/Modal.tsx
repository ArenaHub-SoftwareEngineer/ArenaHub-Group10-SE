import React, { useEffect, useId, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from './Icons';

/** Native dialog supplies focus containment, Escape, and an inert background. */
export function Modal({ open, title, description, icon, onClose, children, busy = false, className = '' }: {
  open: boolean; title: string; description?: string; icon?: React.ReactNode; onClose: () => void;
  children: React.ReactNode; busy?: boolean; className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const reduced = useReducedMotion() || document.documentElement.dataset.motion === 'reduced';
  useEffect(() => {
    if (!open || !dialog.current) return;
    trigger.current = document.activeElement as HTMLElement;
    if (!dialog.current.open) dialog.current.showModal();
    dialog.current.querySelector<HTMLElement>('input:not([type="checkbox"]), textarea, select')?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  return <dialog ref={dialog} className={`arena-dialog ${className}`} aria-labelledby={titleId}
    aria-describedby={description ? descriptionId : undefined} aria-busy={busy}
    onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}
    onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <AnimatePresence onExitComplete={() => { dialog.current?.close(); trigger.current?.focus(); }}>
      {open && <motion.section className="dialog-panel" initial={{ opacity: 0, y: reduced ? 0 : 12, scale: reduced ? 1 : .98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reduced ? 0 : 6, scale: reduced ? 1 : .99 }}
        transition={{ duration: reduced ? 0 : .18, ease: [.22, 1, .36, 1] }}>
        <header className="dialog-header">{icon && <span className="dialog-icon" aria-hidden="true">{icon}</span>}<div className="dialog-heading"><h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}</div>
          <button type="button" className="dialog-close" aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={18} /></button>
        </header>{children}
      </motion.section>}
    </AnimatePresence>
  </dialog>;
}
