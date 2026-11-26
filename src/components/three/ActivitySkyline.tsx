import React, { Suspense, lazy, useMemo, useRef, useState } from 'react';
import { StageBoundary } from './ArenaHero';
import { useStageGate, useStagePalette, type StagePalette } from './useStageGate';
import type { ActivityBucket } from '../../lib/logFeed';
import type { LogCategory } from '../../lib/adminInsights';

const ActivitySkylineStage = lazy(() => import('./ActivitySkylineStage'));

/** Category colours, shared with the log rows so a colour means the same thing in the 3D and the list. */
export const CATEGORY_TONE: Record<LogCategory, keyof StagePalette> = {
  matches: 'info', brackets: 'brand', broadcast: 'violet', accounts: 'success', moderation: 'danger', content: 'warning', system: 'muted',
};
const ORDER: LogCategory[] = ['moderation', 'matches', 'brackets', 'broadcast', 'content', 'accounts', 'system'];

/**
 * 3D activity skyline above a flat strip of the same buckets. The strip is the keyboard and screen reader control
 * (and the whole chart without WebGL); the 3D scene is a pointer-only mirror of it.
 */
export function ActivitySkyline({ buckets, selected, onSelect }: {
  buckets: ActivityBucket[]; selected: string | null; onSelect: (key: string | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const gate = useStageGate(host);
  const palette = useStagePalette();
  const colors = useMemo(() => Object.fromEntries(Object.entries(CATEGORY_TONE).map(([key, tone]) => [key, palette[tone]])) as Record<LogCategory, string>, [palette]);
  const [ready, setReady] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const max = Math.max(1, ...buckets.map(bucket => bucket.total));
  const focus = buckets.find(bucket => bucket.key === (hovered || selected));
  const toggle = (key: string) => onSelect(selected === key ? null : key);

  return <div ref={host} className={`adp-sky${ready ? ' is-ready' : ''}${gate.enabled ? ' has-3d' : ''}`}>
    {gate.enabled && <div className="adp-sky-3d" aria-hidden="true">
      <StageBoundary fallback={null}>
        <Suspense fallback={null}>
          <ActivitySkylineStage buckets={buckets} order={ORDER} colors={colors} floor={palette.surface} selected={selected} hovered={hovered}
            still={gate.still} lite={gate.lite} paused={gate.paused} onHover={setHovered} onSelect={toggle} onReady={() => setReady(true)} />
        </Suspense>
      </StageBoundary>
    </div>}
    <p className="adp-sky-read" aria-live="polite">
      {focus ? <><strong>{focus.total}</strong> {focus.total === 1 ? 'event' : 'events'} · {focus.label}</> : <span>Tap a bar to jump to that time</span>}
    </p>
    <div className="adp-sky-strip" role="group" aria-label="Activity over time">
      {buckets.map(bucket => <button key={bucket.key} type="button" className="adp-sky-bar" aria-pressed={selected === bucket.key}
        disabled={!bucket.total} aria-label={`${bucket.label}: ${bucket.total} ${bucket.total === 1 ? 'event' : 'events'}`}
        onMouseEnter={() => setHovered(bucket.key)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(bucket.key)} onBlur={() => setHovered(null)}
        onClick={() => toggle(bucket.key)}>
        <span className="adp-sky-fill" style={{ height: `${Math.max(bucket.total ? 12 : 4, (bucket.total / max) * 100)}%` }}>
          {ORDER.filter(category => bucket.byCategory[category]).map(category => <i key={category}
            style={{ flexGrow: bucket.byCategory[category], background: colors[category] }} />)}
        </span>
      </button>)}
    </div>
    <div className="adp-sky-axis" aria-hidden="true"><span>{buckets[0]?.label}</span><span>Now</span></div>
  </div>;
}
