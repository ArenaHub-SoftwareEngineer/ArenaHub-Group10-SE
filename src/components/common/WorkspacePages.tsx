import React, { useState } from 'react';
import { CalendarDays, HelpCircle, ArrowUpRight } from '../ui/Icons';
import { Match } from '../../lib/types';
import { matchLabel } from '../../lib/integrityChecks';
import { PreferencesPage } from './PreferencesPage';
export { PreferencesPage };

export function SupportPage({ onNavigate, inDialog = false }: { onNavigate: (tab: string) => void; inDialog?: boolean }) {
  return <div className="module-page">{!inDialog && <header className="module-header"><span className="cute-icon mint"><HelpCircle /></span><div><h1>A little help for your next play.</h1><p>Find your way around ArenaHub.</p></div></header>}<div className="arena-panel">{[
    ['Where do I find my next match?', 'Open Schedule to see the scheduled date, time, teams, and round. Your tournament organizer controls the official schedule.'],
    ['How do I report a match concern?', 'Open Fair play, choose Submit evidence, and include the match, a replay timestamp, and a viewable evidence link. A verified account is required.'],
    ['Does ArenaHub detect in-game cheats?', 'ArenaHub checks registration records and provides a private evidence review process. It does not inspect devices or detect game modifications. Game publishers provide in-game anti-cheat.'],
    ['Why am I seeing sample matches?', 'The sample arena demonstrates the experience. Tournament cards and sample records are not a claim that a real event is currently live. Published organizer brackets are listed separately.'],
    ['Who can access the organizer console?', 'Access requires a trusted account role assigned by the project administrator. Choosing a school or entering an admin-looking email never grants organizer access.'],
    ['The stream is unavailable. What can I do?', 'Try the embedded player’s controls or check back later. Your tournament organizer must attach a working stream. For registration or schedule corrections, contact your school’s esports committee.'],
  ].map(([q, a]) => <details className="faq-item" key={q}><summary>{q}</summary><p>{a}</p></details>)}</div><div className="flex gap-5 flex-wrap"><button className="arena-outline" onClick={() => onNavigate('integrity')}>Fair play center <ArrowUpRight size={15} /></button><button className="arena-outline" onClick={() => onNavigate('ai-assistant')}>Ask Arena AI <ArrowUpRight size={15} /></button></div></div>;
}
export { SchedulePage } from './SchedulePage';
