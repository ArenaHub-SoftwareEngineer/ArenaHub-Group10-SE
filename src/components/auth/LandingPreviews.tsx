import React from 'react';
import { Check } from 'lucide-react';
import { CollegeLogo } from '../common/CollegeLogo';
import { FAIR_PLAY_GAMES } from '../../lib/fairPlayGames';

/**
 * Small, real pieces of the ArenaHub interface for the welcome page, instead of stock or generated pictures.
 * They are illustrations of the product (sample colleges, no real results) and are hidden from screen readers;
 * each card's heading and text carry the meaning.
 */

/** A match card as it appears in Match center: official game art, LIVE, the two colleges and the score. */
export function WatchPreview() {
  return <div className="lp-watch" aria-hidden="true">
    <span className="lp-watch-thumb">
      <img src={FAIR_PLAY_GAMES[0].image} alt="" loading="lazy" />
      <span className="lp-watch-vs"><CollegeLogo code="CCS" size="md" /><b>vs</b><CollegeLogo code="COE" size="md" /></span>
      <span className="watch-badge watch-badge-live">Live</span>
      <span className="watch-thumb-score">1–0</span>
    </span>
    <span className="lp-watch-meta"><strong>CCS vs COE</strong><small>Mobile Legends: Bang Bang · Bo3</small></span>
  </div>;
}

/** A four-team bracket whose winning path draws itself in. */
export function BracketPreview() {
  const box = (x: number, y: number, code: string, win = false) => <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
    <rect width="92" height="26" rx="5" className={win ? 'lp-box is-win' : 'lp-box'} />
    <text x="10" y="17" className={win ? 'lp-code is-win' : 'lp-code'}>{code}</text>
  </g>;
  return <svg className="lp-bracket" viewBox="0 0 320 170" aria-hidden="true">
    <path className="lp-line" d="M100 30 H128 V57 H150 M100 70 H128 V57" />
    <path className="lp-line" d="M100 110 H128 V127 H150 M100 144 H128 V127" />
    <path className="lp-line" d="M242 57 H262 V92 H276 M242 127 H262 V92" />
    <path className="lp-path" d="M100 30 H128 V57 H150 M242 57 H262 V92 H276" pathLength="1" />
    {box(8, 17, 'CCS', true)}{box(8, 57, 'CN')}{box(8, 97, 'COE')}{box(8, 131, 'CA')}
    {box(150, 44, 'CCS', true)}{box(150, 114, 'COE')}
    <g transform="translate(276 79)"><rect width="36" height="26" rx="5" className="lp-box is-win lp-champ" /><text x="18" y="17" textAnchor="middle" className="lp-code is-win">1st</text></g>
  </svg>;
}

/** The pre-match checklist ticking itself off. */
export function ScanPreview() {
  return <ul className="lp-scan" aria-hidden="true">
    {['Device scan passed', 'Companion running', 'Referee clearance'].map((label, index) =>
      <li key={label} style={{ '--i': index } as React.CSSProperties}><span className="lp-tick"><Check size={14} strokeWidth={3} /></span>{label}</li>)}
  </ul>;
}
