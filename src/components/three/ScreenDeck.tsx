import React, { Suspense, lazy, useMemo, useRef, useState } from 'react';
import { StageBoundary } from './ArenaHero';
import { useStageGate, useStagePalette } from './useStageGate';
import type { DeckScreen } from './ScreenDeckStage';

const ScreenDeckStage = lazy(() => import('./ScreenDeckStage'));
export type { DeckScreen };

/**
 * The matches as floating 3D monitors (ScreenDeckStage). Click one to watch it. Pointer-only and aria-hidden:
 * the match list under it is the keyboard and screen reader control for the same thing. Without WebGL it shows nothing.
 */
export function ScreenDeck({ screens, onSelect }: { screens: DeckScreen[]; onSelect: (key: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const gate = useStageGate(host);
  const palette = useStagePalette();
  const colors = useMemo(() => ({ brand: palette.brand, live: palette.live, success: palette.success, surface: palette.surface, floor: palette.floor, text: palette.text, muted: palette.muted }), [palette]);
  const [ready, setReady] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const focus = screens.find(screen => screen.key === hovered);
  if (!gate.enabled || !screens.length) return null;
  return <div ref={host} className={`sd-deck${ready ? ' is-ready' : ''}${screens.length > 4 ? ' is-two-rows' : ''}`} aria-hidden="true">
    <StageBoundary fallback={null}>
      <Suspense fallback={null}>
        <ScreenDeckStage screens={screens} colors={colors} hovered={hovered} still={gate.still} lite={gate.lite} paused={gate.paused}
          onHover={setHovered} onSelect={onSelect} onReady={() => setReady(true)} />
      </Suspense>
    </StageBoundary>
    <p className="sd-hint">{focus ? <>Click to watch <strong>{focus.title}</strong></> : 'Click a screen to watch that match'}</p>
  </div>;
}
