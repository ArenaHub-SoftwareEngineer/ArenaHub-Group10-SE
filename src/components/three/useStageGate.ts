// Shared gate for the admin 3D scenes (reports deck, activity skyline, account ring).
// A scene only mounts with WebGL and without data saver; it pauses off screen or in a background tab,
// holds still for reduced motion, and uses a lighter setup on phones and low-core machines.
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { reducedMotion, saveData, webglAvailable } from './ArenaHero';

export function useStageGate(host: RefObject<HTMLElement | null>) {
  const [enabled] = useState(() => webglAvailable() && !saveData());
  const [still, setStill] = useState(reducedMotion);
  const [lite] = useState(() => window.matchMedia('(max-width: 767px)').matches || (navigator.hardwareConcurrency || 8) <= 4);
  const [inView, setInView] = useState(true);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');

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
  }, [host]);

  return { enabled, still, lite, paused: !inView || !visible };
}

export type StagePalette = Record<'brand' | 'live' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'muted' | 'floor' | 'surface' | 'text', string>;

/** Scene colours come from the design tokens, so the 3D matches the page in dark and light themes. */
export function useStagePalette(): StagePalette {
  return useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    return {
      brand: token('--brand', '#ff6600'), live: token('--live', '#e91916'), success: token('--success', '#4ade80'),
      warning: token('--warning', '#facc15'), danger: token('--danger', '#f87171'), info: token('--info', '#7cb4ff'),
      violet: token('--violet', '#c4a1ff'), muted: token('--text-muted', '#a1a1aa'), floor: token('--surface-soft', '#1f1f23'),
      surface: token('--surface-elevated', '#2a2a2f'), text: token('--text-primary', '#efeff1'),
    };
  }, []);
}
