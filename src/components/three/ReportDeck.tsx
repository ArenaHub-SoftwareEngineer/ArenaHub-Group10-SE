import React, { Suspense, lazy, useMemo, useRef, useState } from 'react';
import { StageBoundary } from './ArenaHero';
import { useStageGate, useStagePalette, type StagePalette } from './useStageGate';
import type { DeckCard } from './ReportDeckStage';

const ReportDeckStage = lazy(() => import('./ReportDeckStage'));
export type { DeckCard };

/**
 * The Reports page's 3D deck. Without WebGL or on data saver it renders nothing and the page's list does the work;
 * the scene is decorative for assistive technology because the same reports are in the list and focus panel.
 */
export function ReportDeck({ cards, selectedId, onSelect, onStep }: {
  cards: (Omit<DeckCard, 'color'> & { tone: keyof StagePalette })[]; selectedId: string | null; onSelect: (id: string) => void; onStep: (delta: 1 | -1) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const gate = useStageGate(host);
  const palette = useStagePalette();
  const [ready, setReady] = useState(false);
  const deck = useMemo(() => cards.map(({ tone, ...card }) => ({ ...card, color: palette[tone] })), [cards, palette]);
  return <div ref={host} className={`adp-stage${ready ? ' is-ready' : ''}`} aria-hidden="true">
    {gate.enabled && <StageBoundary fallback={null}>
      <Suspense fallback={null}>
        <ReportDeckStage cards={deck} selectedId={selectedId} palette={palette} still={gate.still} lite={gate.lite} paused={gate.paused}
          onSelect={onSelect} onStep={onStep} onReady={() => setReady(true)} />
      </Suspense>
    </StageBoundary>}
  </div>;
}
