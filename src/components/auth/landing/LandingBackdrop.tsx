import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BRAND_COLOR } from '../../../lib/brandColor';
import { StageBoundary, reducedMotion, saveData, webglAvailable } from '../../three/ArenaHero';
import { landingSignal, measureChapter } from './landingSignal';

const LandingScene = lazy(() => import('../../three/LandingScene'));

/**
 * The fixed 3D layer behind the whole welcome page. Without WebGL, on data saver or with reduced motion,
 * a still gradient stands in and nothing heavy is downloaded.
 */
export function LandingBackdrop() {
  const [enabled] = useState(() => !saveData() && webglAvailable() && !reducedMotion());
  const [lite] = useState(() => window.matchMedia('(max-width: 767px)').matches || (navigator.hardwareConcurrency || 8) <= 4);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let frame = 0;
    const sync = () => { frame = 0; landingSignal.chapter = measureChapter(); };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(sync); };
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      landingSignal.px = (event.clientX / window.innerWidth) * 2 - 1;
      landingSignal.py = (event.clientY / window.innerHeight) * 2 - 1;
    };
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden');
    sync();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('pointermove', onPointer, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <div className={`lp-backdrop${ready ? ' is-ready' : ''}`} aria-hidden="true">
    {enabled && <StageBoundary fallback={null} onError={() => setReady(false)}>
      <Suspense fallback={null}>
        <LandingScene color={BRAND_COLOR} lite={lite} paused={!visible} onReady={() => setReady(true)} />
      </Suspense>
    </StageBoundary>}
    <div className="lp-backdrop-vignette" />
  </div>;
}
