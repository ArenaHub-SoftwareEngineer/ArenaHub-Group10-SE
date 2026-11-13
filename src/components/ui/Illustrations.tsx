import React from 'react';

/**
 * ArenaHub's own illustrations: flat SVG in the brand palette, with small CSS animations (illustrations.css)
 * that stop for reduced motion. They are decorative, so they are hidden from screen readers; the text next to
 * them carries the meaning.
 */

/** A broadcast screen with signal waves: "nothing live right now". */
export function BroadcastIllustration({ className = '' }: { className?: string }) {
  return <svg className={`ah-illo ah-illo-broadcast ${className}`} viewBox="0 0 240 160" aria-hidden="true" focusable="false">
    <ellipse cx="120" cy="146" rx="78" ry="7" className="ah-illo-shadow" />
    <g className="ah-illo-float">
      <rect x="52" y="34" width="136" height="88" rx="12" className="ah-illo-frame" />
      <rect x="61" y="43" width="118" height="70" rx="6" className="ah-illo-screen" />
      <path d="M112 66v24l20-12z" className="ah-illo-play" />
      <rect x="104" y="122" width="32" height="10" rx="3" className="ah-illo-frame" />
      <rect x="92" y="130" width="56" height="6" rx="3" className="ah-illo-frame" />
      <circle cx="170" cy="52" r="4" className="ah-illo-dot" />
    </g>
    <g className="ah-illo-waves" fill="none" strokeLinecap="round">
      <path d="M200 30a18 18 0 0 1 0 26" /><path d="M208 22a30 30 0 0 1 0 42" /><path d="M216 14a42 42 0 0 1 0 58" />
      <path d="M40 30a18 18 0 0 0 0 26" /><path d="M32 22a30 30 0 0 0 0 42" /><path d="M24 14a42 42 0 0 0 0 58" />
    </g>
  </svg>;
}

/** A trophy on a podium with sparkles: brackets, standings, "no results yet". */
export function TrophyIllustration({ className = '' }: { className?: string }) {
  return <svg className={`ah-illo ah-illo-trophy ${className}`} viewBox="0 0 240 160" aria-hidden="true" focusable="false">
    <ellipse cx="120" cy="146" rx="70" ry="7" className="ah-illo-shadow" />
    <rect x="70" y="112" width="100" height="30" rx="6" className="ah-illo-frame" />
    <rect x="96" y="100" width="48" height="14" rx="4" className="ah-illo-screen" />
    <g className="ah-illo-float">
      <path d="M96 30h48v22a24 24 0 0 1-48 0z" className="ah-illo-cup" />
      <path d="M96 36H84a12 12 0 0 0 12 16M144 36h12a12 12 0 0 1-12 16" fill="none" className="ah-illo-cup-line" />
      <rect x="114" y="74" width="12" height="16" className="ah-illo-cup" />
      <rect x="104" y="88" width="32" height="8" rx="3" className="ah-illo-cup" />
    </g>
    <g className="ah-illo-sparkles">
      <path d="M60 40l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" /><path d="M182 28l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /><path d="M176 74l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" />
    </g>
  </svg>;
}

/** Two controllers facing off: teams, matches, "no teams yet". */
export function VersusIllustration({ className = '' }: { className?: string }) {
  return <svg className={`ah-illo ah-illo-versus ${className}`} viewBox="0 0 240 160" aria-hidden="true" focusable="false">
    <ellipse cx="120" cy="146" rx="84" ry="7" className="ah-illo-shadow" />
    <g className="ah-illo-left">
      <path d="M30 70c0-12 8-20 20-20h30c12 0 20 8 20 20l4 34c1 10-10 14-16 7l-10-11H58l-10 11c-6 7-17 3-16-7z" className="ah-illo-frame" />
      <path d="M50 66v14M43 73h14" className="ah-illo-cup-line" fill="none" /><circle cx="82" cy="70" r="3.5" className="ah-illo-dot" /><circle cx="90" cy="78" r="3.5" className="ah-illo-play" />
    </g>
    <g className="ah-illo-right">
      <path d="M140 70c0-12 8-20 20-20h30c12 0 20 8 20 20l4 34c1 10-10 14-16 7l-10-11h-20l-10 11c-6 7-17 3-16-7z" className="ah-illo-screen-line" />
      <path d="M160 66v14M153 73h14" className="ah-illo-cup-line" fill="none" /><circle cx="192" cy="70" r="3.5" className="ah-illo-dot" /><circle cx="200" cy="78" r="3.5" className="ah-illo-play" />
    </g>
    <text x="120" y="88" textAnchor="middle" className="ah-illo-vs">VS</text>
  </svg>;
}

/** A calendar page with a clock: schedules, "nothing scheduled". */
export function CalendarIllustration({ className = '' }: { className?: string }) {
  return <svg className={`ah-illo ah-illo-calendar ${className}`} viewBox="0 0 240 160" aria-hidden="true" focusable="false">
    <ellipse cx="120" cy="146" rx="70" ry="7" className="ah-illo-shadow" />
    <g className="ah-illo-float">
      <rect x="62" y="28" width="104" height="104" rx="12" className="ah-illo-frame" />
      <rect x="62" y="28" width="104" height="26" rx="12" className="ah-illo-cup" /><rect x="62" y="44" width="104" height="10" className="ah-illo-cup" />
      {[0, 1, 2, 3].map(r => [0, 1, 2, 3].map(c => <rect key={`${r}-${c}`} x={74 + c * 22} y={64 + r * 16} width="14" height="9" rx="2" className={r === 1 && c === 2 ? 'ah-illo-dot' : 'ah-illo-screen'} />))}
    </g>
    <g className="ah-illo-clock">
      <circle cx="172" cy="112" r="24" className="ah-illo-frame" /><circle cx="172" cy="112" r="18" className="ah-illo-screen" />
      <path d="M172 100v12l8 6" className="ah-illo-cup-line ah-illo-hand" fill="none" />
    </g>
  </svg>;
}
