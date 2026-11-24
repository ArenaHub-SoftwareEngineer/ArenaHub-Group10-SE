import React, { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'motion/react';
import { X } from './Icons';

const SHEET_QUERY = '(max-width: 640px)';

function useSheet() {
  const [sheet, setSheet] = useState(() => window.matchMedia(SHEET_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(SHEET_QUERY);
    const sync = () => setSheet(media.matches);
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  return sheet;
}

/**
 * Native dialog supplies focus containment, Escape, and an inert background.
 * Desktop: the panel springs in at the centre. Phone: a bottom sheet that slides up and can be dragged down
 * by its handle to close (the content itself still scrolls normally).
 */
export function Modal({ open, title, description, icon, onClose, children, busy = false, className = '' }: {
  open: boolean; title: string; description?: string; icon?: React.ReactNode; onClose: () => void;
  children: React.ReactNode; busy?: boolean; className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const reduced = useReducedMotion() || document.documentElement.dataset.motion === 'reduced';
  const sheet = useSheet();
  const drag = useDragControls();
  useEffect(() => {
    if (!open || !dialog.current) return;
    trigger.current = document.activeElement as HTMLElement;
    if (!dialog.current.open) dialog.current.showModal();
    dialog.current.querySelector<HTMLElement>('input:not([type="checkbox"]), textarea, select')?.focus();
    // The page behind stops scrolling. Lock <html> too: it is the scroller on long pages such as the welcome page,
    // and leaving it scrollable shows a second scrollbar beside the dialog's own.
    const root = document.documentElement;
    const previous = [document.body.style.overflow, root.style.overflow];
    document.body.style.overflow = 'hidden';
    root.style.overflow = 'hidden';
    return () => { [document.body.style.overflow, root.style.overflow] = previous; };
  }, [open]);
  const motionProps = sheet
    ? { initial: { y: reduced ? 0 : '100%', opacity: reduced ? 0 : 1 }, animate: { y: 0, opacity: 1 }, exit: { y: reduced ? 0 : '100%', opacity: reduced ? 0 : 1 },
      transition: reduced ? { duration: 0 } : { type: 'spring' as const, stiffness: 420, damping: 42 } }
    : { initial: { opacity: 0, y: reduced ? 0 : 14, scale: reduced ? 1 : .97 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: reduced ? 0 : 6, scale: reduced ? 1 : .99 },
      transition: reduced ? { duration: 0 } : { type: 'spring' as const, stiffness: 560, damping: 38, mass: .8 } };
  return <dialog ref={dialog} className={`arena-dialog${sheet ? ' is-sheet' : ''} ${className}`} aria-labelledby={titleId}
    aria-describedby={description ? descriptionId : undefined} aria-busy={busy}
    onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}
    onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <AnimatePresence onExitComplete={() => { dialog.current?.close(); trigger.current?.focus(); }}>
      {open && <motion.section className="dialog-panel" {...motionProps}
        drag={sheet && !busy && !reduced ? 'y' : false} dragListener={false} dragControls={drag}
        dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: .7 }}
        onDragEnd={(_, info) => { if (info.offset.y > 110 || info.velocity.y > 600) onClose(); }}>
        {sheet && <div className="dialog-grabber" aria-hidden="true" onPointerDown={event => drag.start(event)}><span /></div>}
        <header className="dialog-header">{icon && <span className="dialog-icon" aria-hidden="true">{icon}</span>}<div className="dialog-heading"><h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}</div>
          <button type="button" className="dialog-close" aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={18} /></button>
        </header>{children}
      </motion.section>}
    </AnimatePresence>
  </dialog>;
}
