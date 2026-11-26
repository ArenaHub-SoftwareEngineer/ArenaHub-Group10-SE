import React, { Suspense, lazy, useRef, useState } from 'react';
import { StageBoundary } from './ArenaHero';
import { useStageGate, useStagePalette, type StagePalette } from './useStageGate';

const StatusRingStage = lazy(() => import('./StatusRingStage'));

export interface StatusPart { id: string; label: string; value: number; tone: keyof StagePalette }

/**
 * Account totals as a 3D ring (StatusRingStage) with the total in the middle. Without WebGL a flat conic ring shows
 * the same split. Pointer-only: the status tiles beside it are the keyboard control for the same filter.
 */
export function StatusRing({ parts, total, caption, selected, onSelect }: {
  parts: StatusPart[]; total: number; caption: string; selected: string | null; onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const gate = useStageGate(host);
  const palette = useStagePalette();
  const [ready, setReady] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const focus = parts.find(part => part.id === hovered);
  let at = 0;
  const conic = total ? parts.filter(part => part.value).map(part => {
    const from = at; at += (part.value / total) * 360;
    return `${palette[part.tone]} ${from}deg ${at}deg`;
  }).join(', ') : `${palette.surface} 0deg 360deg`;

  return <div ref={host} className={`adp-ring${ready ? ' is-ready' : ''}`} aria-hidden="true">
    <div className="adp-ring-flat" style={{ background: `conic-gradient(${conic})` }} />
    {gate.enabled && <StageBoundary fallback={null}>
      <Suspense fallback={null}>
        <StatusRingStage parts={parts.map(part => ({ id: part.id, value: part.value, color: palette[part.tone] }))} empty={palette.surface}
          selected={selected} hovered={hovered} still={gate.still} lite={gate.lite} paused={gate.paused}
          onHover={setHovered} onSelect={onSelect} onReady={() => setReady(true)} />
      </Suspense>
    </StageBoundary>}
    <div className="adp-ring-center">
      <strong>{focus ? focus.value : total}</strong>
      <span>{focus ? focus.label : caption}</span>
    </div>
  </div>;
}
