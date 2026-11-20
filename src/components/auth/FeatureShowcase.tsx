import React, { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, ChevronLeft, ChevronRight, Maximize2, X } from 'lucide-react';
import { BracketPreview, ScanPreview, WatchPreview } from './LandingPreviews';
import { AiDemo, AiPreview, BracketDemo, FairPlayDemo, WatchDemo } from './FeatureDemos';
import './showcase.css';

const FEATURES = [
  { id: 'watch', title: 'Watch live', text: 'Every broadcast in one place, with the score, the chat and what is up next.', long: 'Open a match and the broadcast, the live score and the chat sit side by side. Ask @Arena in chat and it answers from the published schedule.', preview: <WatchPreview />, demo: <WatchDemo /> },
  { id: 'brackets', title: 'Follow the bracket', text: 'Results move through the bracket the moment an organizer saves them.', long: 'Every result moves the winner forward at once, for everyone watching. Try it: tap a team to send it through.', preview: <BracketPreview />, demo: <BracketDemo /> },
  { id: 'fair', title: 'Play fair', text: 'Required scans and staff review keep every match clean.', long: 'Before a match, each player runs a device scan. Anything unusual goes to a referee, and the match waits until staff clear it.', preview: <ScanPreview />, demo: <FairPlayDemo /> },
  { id: 'ai', title: 'Ask Arena AI', text: 'Schedules, standings and results, answered in English or Filipino.', long: 'Arena AI answers from the published brackets and schedules only, so it never guesses a score.', preview: <AiPreview />, demo: <AiDemo /> },
];

const spring = { type: 'spring' as const, stiffness: 340, damping: 32, mass: .9 };

/**
 * The welcome page's feature cards. A card opens into a large panel (the card's surface grows into it, App Store
 * style) with a live, interactive preview. Tabs and the arrow keys move between features; Escape or the backdrop closes.
 */
export function FeatureShowcase({ onSignIn }: { onSignIn: () => void }) {
  const [origin, setOrigin] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const cards = useRef<Record<string, HTMLButtonElement | null>>({});
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const reduced = Boolean(useReducedMotion()) || document.documentElement.dataset.motion === 'reduced';
  const feature = FEATURES[current];
  const transition = reduced ? { duration: 0 } : spring;

  const open = (index: number) => { setCurrent(index); setOrigin(FEATURES[index].id); };
  const close = () => { const from = origin; setOrigin(null); if (from) window.setTimeout(() => cards.current[from]?.focus(), 0); };
  const go = (delta: number) => setCurrent(i => (i + delta + FEATURES.length) % FEATURES.length);

  useEffect(() => {
    if (!origin) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      const inField = event.target instanceof HTMLElement && event.target.closest('[role=tablist], input, textarea');
      if (!inField && event.key === 'ArrowRight') go(1);
      if (!inField && event.key === 'ArrowLeft') go(-1);
      if (event.key === 'Tab' && dialog.current) {
        // Keep focus inside the panel.
        const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')];
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', onKey); };
  }, [origin]);

  return <>
    <section className="landing-features" aria-label="What you can do">
      {FEATURES.map((item, index) => <button key={item.id} ref={el => { cards.current[item.id] = el; }} type="button"
        className="landing-feature" aria-haspopup="dialog" onClick={() => open(index)}>
        <motion.span layoutId={`feature-surface-${item.id}`} className="landing-feature-surface" transition={transition} />
        <span className="landing-feature-media">{item.preview}</span>
        <span className="landing-feature-body">
          <strong className="landing-feature-title">{item.title}</strong>
          <span className="landing-feature-text">{item.text}</span>
          <span className="landing-feature-open"><Maximize2 size={14} aria-hidden="true" />See it in action</span>
        </span>
      </button>)}
    </section>

    <AnimatePresence>
      {origin && <motion.div key="backdrop" className="fx-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: reduced ? 0 : .25 }} onClick={close} />}
      {origin && <div key="wrap" className="fx-wrap" onClick={event => { if (event.target === event.currentTarget) close(); }}>
        <div ref={dialog} className="fx-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <motion.div layoutId={`feature-surface-${origin}`} className="fx-surface" transition={transition} />
          <motion.div className="fx-content" initial={{ opacity: 0, y: reduced ? 0 : 16 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: .12 } }} transition={{ ...transition, delay: reduced ? 0 : .12 }}>
            <header className="fx-head">
              <div>
                <span className="fx-kicker">Preview · sample data</span>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={feature.id} initial={{ opacity: 0, x: reduced ? 0 : 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduced ? 0 : -12 }} transition={{ duration: reduced ? 0 : .18 }}>
                    <h2 id={titleId}>{feature.title}</h2>
                    <p>{feature.long}</p>
                  </motion.div>
                </AnimatePresence>
              </div>
              <button ref={closeButton} type="button" className="fx-close" aria-label="Close preview" onClick={close}><X size={18} /></button>
            </header>

            <div className="fx-stage">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={feature.id} className="fx-demo" initial={{ opacity: 0, scale: reduced ? 1 : .98 }} animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: reduced ? 1 : .98 }} transition={{ duration: reduced ? 0 : .2 }}>
                  {feature.demo}
                </motion.div>
              </AnimatePresence>
            </div>

            <footer className="fx-foot">
              <div className="fx-nav">
                <button type="button" className="fx-arrow" aria-label="Previous feature" onClick={() => go(-1)}><ChevronLeft size={18} /></button>
                <div className="fx-tabs" role="tablist" aria-label="Features">
                  {FEATURES.map((item, index) => <button key={item.id} type="button" role="tab" aria-selected={current === index} onClick={() => setCurrent(index)}>
                    {current === index && <motion.span layoutId="fx-tab-pill" className="fx-tab-pill" transition={transition} />}<span>{item.title}</span>
                  </button>)}
                </div>
                <button type="button" className="fx-arrow" aria-label="Next feature" onClick={() => go(1)}><ChevronRight size={18} /></button>
              </div>
              <button type="button" className="arena-primary" onClick={() => { setOrigin(null); onSignIn(); }}>Sign in to watch <ArrowRight size={16} aria-hidden="true" /></button>
            </footer>
          </motion.div>
        </div>
      </div>}
    </AnimatePresence>
  </>;
}
