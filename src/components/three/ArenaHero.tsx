import React, { Component, Suspense, lazy, useEffect, useRef, useState } from 'react';
import { BRAND_COLOR } from '../../lib/brandColor';

const ArenaStage = lazy(() => import('./ArenaStage'));

export const webglAvailable = () => {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2');
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(context);
  } catch { return false; }
};
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduced';
/** Data saver or a slow mobile connection: keep the still poster instead of downloading the 3D engine (~250 kB gzipped). */
export const saveData = () => {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return Boolean(connection?.saveData || ['slow-2g', '2g', '3g'].includes(connection?.effectiveType || ''));
};

export class StageBoundary extends Component<{ fallback: React.ReactNode; children: React.ReactNode; onError?: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError?.(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/**
 * The interactive 3D arena (ArenaStage) with everything that keeps it polite:
 * - a lightweight emblem with drag support while the 3D scene loads or if WebGL is unavailable;
 * - decorative instances use the still poster until the 3D scene is ready;
 * - reduced motion (device or the in-app setting): the scene renders without idle motion;
 * - off screen or in a background tab: rendering pauses.
 */
export function ArenaHero({ className = '', label = 'ArenaHub emblem on the arena stage. Drag to spin it.', decorative = false }: { className?: string; label?: string; /** Background use: no hint, hidden from assistive technology. */ decorative?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number } | null>(null);
  const [enabled] = useState(() => !saveData() && webglAvailable());
  const [still, setStill] = useState(reducedMotion);
  const [lite] = useState(() => window.matchMedia('(max-width: 767px)').matches || (navigator.hardwareConcurrency || 8) <= 4);
  const [inView, setInView] = useState(true);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setStill(reducedMotion());
    const attrs = new MutationObserver(sync);
    attrs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    media.addEventListener('change', sync);
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    const io = new IntersectionObserver(entries => setInView(entries[0]?.isIntersecting ?? true), { rootMargin: '80px' });
    if (host.current) io.observe(host.current);
    return () => { attrs.disconnect(); media.removeEventListener('change', sync); document.removeEventListener('visibilitychange', onVisibility); io.disconnect(); };
  }, []);

  const poster = <div className={`ah-stage-poster${decorative ? '' : ' ah-stage-fallback'}`} aria-hidden="true">
    {decorative && <img className="ah-stage-photo" src="/media/hero-stage.webp" alt="" onError={event => { event.currentTarget.hidden = true; }} />}
    <img className="ah-stage-emblem" src="/arenahub-logo.svg" alt="" width="424" height="508" draggable={false} />
    <span className="ah-stage-floor" />
  </div>;

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.classList.remove('is-dragging');
    event.currentTarget.style.removeProperty('--stage-turn');
  };

  return <div ref={host} className={`ah-stage${ready ? ' is-ready' : ''}${!decorative ? ' is-interactive' : ''} ${className}`}
    {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    onPointerDown={event => {
      if (decorative || ready || event.button !== 0) return;
      drag.current = { id: event.pointerId, x: event.clientX };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.classList.add('is-dragging');
    }}
    onPointerMove={event => {
      if (drag.current?.id !== event.pointerId) return;
      event.currentTarget.style.setProperty('--stage-turn', `${(event.clientX - drag.current.x) * 0.9}deg`);
    }}
    onLostPointerCapture={endDrag}>
    {poster}
    {enabled && <StageBoundary fallback={null} onError={() => setReady(false)}>
      <Suspense fallback={null}>
        <ArenaStage color={BRAND_COLOR} still={still} lite={lite} paused={!inView || !visible} onReady={() => setReady(true)} onContextLost={() => setReady(false)} />
      </Suspense>
    </StageBoundary>}
    {!decorative && <span className="ah-stage-hint" aria-hidden="true">Drag to spin</span>}
  </div>;
}
