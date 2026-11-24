import React from 'react';
import { ArrowUpRight } from '../ui/Icons';
import { PageHeading } from '../ui/PageHeading';
import { PreferencesPage } from './PreferencesPage';
export { PreferencesPage };

export function SupportPage({ onNavigate, inDialog = false }: { onNavigate: (tab: string) => void; inDialog?: boolean }) {
  return <div className="module-page">{!inDialog && <PageHeading title="Support" description="Find answers about matches, accounts, and fair play." />}<div className="arena-panel">{[
    ['Where do I find my next match?', 'Open Schedule to see the scheduled date, time, teams, and round. Your tournament organizer controls the official schedule.'],
    ['How do I report a match concern?', 'Open Fair play, choose Submit evidence, and include the match, a replay timestamp, and a viewable evidence link. A verified account is required.'],
    ['Does ArenaHub detect in-game cheats?', 'Partly. At organized matches, staff can pair a player’s phone or PC with Match monitor, which flags known cheating and modding tools, rooted phones and unusual device settings, and can record the screen. A flag is a reason for a referee to look, not proof: a private cheat that beats the game’s own anti-cheat cannot be detected from outside. Referees make every decision, and players can send evidence through Fair play.'],
    ['Who can access the organizer console?', 'Access requires a trusted account role assigned by the project administrator. Choosing a school or entering an admin-looking email never grants organizer access.'],
    ['The stream is unavailable. What can I do?', 'Try the embedded player’s controls or check back later. Your tournament organizer must attach a working stream. For registration or schedule corrections, contact your school’s esports committee.'],
  ].map(([q, a]) => <details className="faq-item" key={q}><summary>{q}</summary><p>{a}</p></details>)}</div><div className="flex gap-5 flex-wrap"><button className="arena-outline" onClick={() => onNavigate('integrity')}>Fair play center <ArrowUpRight size={15} /></button><button className="arena-outline" onClick={() => onNavigate('ai-assistant')}>Ask Arena AI <ArrowUpRight size={15} /></button></div></div>;
}
export { SchedulePage } from './SchedulePage';
