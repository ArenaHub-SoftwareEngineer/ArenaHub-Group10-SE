import React, { Suspense, lazy, useRef, useState, type CSSProperties } from 'react';
import { StageBoundary } from './ArenaHero';
import { useStageGate } from './useStageGate';

const TeamCrestStage = lazy(() => import('./TeamCrestStage'));

/**
 * A college logo as a 3D medallion (TeamCrestStage). The flat crest underneath shows until the first frame,
 * and stays when WebGL is off. Decorative: the page names the college in text.
 */
export function TeamCrest({ logo, monogram, color, spinKey }: { logo?: string; monogram: string; color: string; spinKey: number }) {
  const host = useRef<HTMLDivElement>(null);
  const gate = useStageGate(host);
  const [ready, setReady] = useState(false);
  return <div ref={host} className={`tm-crest3d${ready ? ' is-ready' : ''}`} style={{ '--crest': color } as CSSProperties} aria-hidden="true">
    <span className="tm-crest3d-flat">{logo ? <img src={logo} alt="" /> : <b>{monogram}</b>}</span>
    {gate.enabled && <StageBoundary fallback={null} onError={() => setReady(false)}>
      <Suspense fallback={null}>
        <TeamCrestStage logo={logo} monogram={monogram} color={color} spinKey={spinKey}
          still={gate.still} lite={gate.lite} paused={gate.paused} onReady={() => setReady(true)} />
      </Suspense>
    </StageBoundary>}
  </div>;
}
