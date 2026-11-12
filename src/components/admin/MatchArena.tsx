import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_LABEL, PLATFORM_LABEL, SIGNAL_CATEGORIES, type MonitorPlatform, type RiskResult } from '../../lib/integrityRisk';

export interface ArenaPlayer { id: string; playerName: string; team: string; platform: MonitorPlatform; connection: string; risk: RiskResult }

const TILT = 58, PILLAR = 56, GAP_X = 96, GAP_Y = 150, PAD = 70, UNIT = 1.5, BASE = 8;

/** One stacked block of a pillar: four sides and a top, standing on the floor at height `from`. */
function Block({ from, height, className }: { from: number; height: number; className: string }) {
  const side = { height, ['--h' as string]: `${height}px` } as React.CSSProperties;
  return <div className={`monitor3d-block ${className}`} style={{ transform: `translateZ(${from}px)` }} aria-hidden="true">
    <i className="monitor3d-face north" style={side} /><i className="monitor3d-face south" style={side} />
    <i className="monitor3d-face west" style={{ width: height }} /><i className="monitor3d-face east" style={{ width: height }} />
    <i className="monitor3d-face top" style={{ transform: `translateZ(${height}px)` }} />
  </div>;
}

/**
 * 3D view of one match. Every player is a pillar grouped by team. A pillar's height is the risk
 * score, and its coloured layers show which categories the score comes from. Drag or use the slider
 * to turn the view; each label is a button that opens the player's session.
 */
export function MatchArena({ players, onOpen }: { players: ArenaPlayer[]; onOpen: (id: string) => void }) {
  const [turn, setTurn] = useState(-28), [scale, setScale] = useState(1);
  const frame = useRef<HTMLDivElement>(null), drag = useRef<{ x: number; turn: number } | null>(null);
  const teams = useMemo(() => {
    const groups = new Map<string, ArenaPlayer[]>();
    for (const p of players) { const key = p.team || 'No team set'; groups.set(key, [...(groups.get(key) || []), p]); }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [players]);
  const columns = Math.max(1, ...teams.map(([, list]) => list.length));
  const width = PAD * 2 + (columns - 1) * GAP_X + PILLAR, depth = PAD * 2 + (teams.length - 1) * GAP_Y + PILLAR;
  // The floor can be turned, so the frame is sized from its half-diagonal: room above for the tallest
  // pillar and its label, room below for the nearest corner.
  const half = Math.hypot(width, depth) / 2, centre = 180 + half * 0.55, frameHeight = centre + half * 0.75 + 16;
  useEffect(() => {
    const element = frame.current; if (!element) return;
    const fit = () => setScale(Math.max(0.4, Math.min(1.5, element.clientWidth / (half * 2.5 + 40))));
    fit(); const observer = new ResizeObserver(fit); observer.observe(element); return () => observer.disconnect();
  }, [half]);
  const billboard = (z: number) => ({ transform: `translateZ(${z}px) rotateZ(${-turn}deg) rotateX(${-TILT}deg)` });

  return <div className="monitor3d">
    <div ref={frame} className="monitor3d-frame" style={{ height: frameHeight * scale }}
      onPointerDown={e => { if ((e.target as HTMLElement).closest('button')) return; drag.current = { x: e.clientX, turn }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (drag.current) setTurn(Math.max(-80, Math.min(80, drag.current.turn + (e.clientX - drag.current.x) * 0.4))); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <div className="monitor3d-scale" style={{ transform: `scale(${scale})`, paddingTop: centre - depth / 2 }}>
        <div className="monitor3d-floor" style={{ width, height: depth, transform: `rotateX(${TILT}deg) rotateZ(${turn}deg)` }}>
          {teams.map(([team, list], row) => <React.Fragment key={team}>
            <span className="monitor3d-team" style={{ left: 8, top: PAD + row * GAP_Y + PILLAR + 14 }}>{team}</span>
            {list.map((player, column) => {
              let z = BASE;
              const layers = SIGNAL_CATEGORIES.filter(c => player.risk.categories[c] > 0).map(c => { const share = Math.min(player.risk.categories[c], 100) * UNIT; const from = z; z += share; return { c, from, share }; });
              // Categories can add up past 100, so the stack is squeezed to the capped score.
              const total = z - BASE, limit = player.risk.score * UNIT, squeeze = total > limit && total > 0 ? limit / total : 1;
              const top = BASE + total * squeeze;
              return <div key={player.id} className={`monitor3d-pillar ${player.risk.level}`} style={{ left: PAD + column * GAP_X, top: PAD + row * GAP_Y, width: PILLAR, height: PILLAR }} onClick={() => onOpen(player.id)}>
                <Block from={0} height={BASE} className="base" />
                {layers.map(l => <Block key={l.c} from={BASE + (l.from - BASE) * squeeze} height={Math.max(2, l.share * squeeze)} className={`cat-${l.c}`} />)}
                <div className="monitor3d-label" style={billboard(top + 6)}>
                  <button type="button" aria-haspopup="dialog" onClick={e => { e.stopPropagation(); onOpen(player.id); }}
                    aria-label={`${player.playerName}, ${PLATFORM_LABEL[player.platform]}, risk ${player.risk.score} of 100, ${player.risk.level}. Open session`}>
                    <strong>{player.risk.score}</strong><span>{player.playerName}</span>
                  </button>
                </div>
              </div>;
            })}
          </React.Fragment>)}
        </div>
      </div>
    </div>
    <div className="monitor3d-controls">
      <label>Turn the view<input type="range" min={-80} max={80} step={1} value={Math.round(turn)} onChange={e => setTurn(Number(e.target.value))} /></label>
      <ul className="monitor3d-legend" aria-label="Pillar colours">{SIGNAL_CATEGORIES.map(c => <li key={c}><i className={`cat-${c}`} aria-hidden="true" />{CATEGORY_LABEL[c]}</li>)}</ul>
    </div>
    <p className="field-hint">Pillar height is the risk score from 0 to 100. Colours show where it comes from. A flat tile means nothing has been reported. Select a player to see the evidence.</p>
  </div>;
}
