import React from 'react';
import { Match, BracketDraft } from '../../lib/types';
import { ArrowRight, ArrowUpRight, CalendarDays, GitBranch, Radio, ShieldCheck, Sparkles } from '../ui/Icons';
import { publicationGameKey } from '../../lib/bracketPublication';
import { GAME_ARTWORK } from '../common/GameArtworkTiles';
import { bracketScheduleLabel } from '../../lib/calendar';
import { isWatchableLiveMatch } from '../../lib/streamUtils';
import { ArenaScene } from './ArenaScene';
interface HomeScreenProps {
  spotlights?: Array<{ id: string; title: string; meta: string }>;
  liveMatch?: Match; matches: Match[]; publishedBrackets: BracketDraft[];
  onViewLiveMatch: (m: Match) => void;
  onNavigateTab: (tab: string, params?: Record<string, string>) => void; onSelectPublishedBracket: (bracket: BracketDraft) => void;
}
export const HomeScreen: React.FC<HomeScreenProps> = ({ spotlights = [], liveMatch, matches, publishedBrackets, onViewLiveMatch, onNavigateTab, onSelectPublishedBracket }) => {
  const live = liveMatch?.status === 'live' ? liveMatch : undefined;
  const otherLive = matches.filter(match => isWatchableLiveMatch(match) && match.id !== live?.id);
  const upcoming = matches.filter(m => ['upcoming', 'pre-match'].includes(m.status) && m.team1 && m.team2 && !m.team2.isBye).slice(0, 3);
  return <div className="arena-home">
    <div className="home-eyebrow"><span>Campus esports</span><span className="season-tag">Season 2026 <span className="status-dot" /></span></div>
    <section className="arena-hero"><div className="hero-copy"><h1>Your campus.<br />Your squad.<br /><span>Your arena.</span></h1><p>Follow your teams, see what’s live, and find the next match.</p><div className="hero-actions"><button className="arena-primary" onClick={() => onNavigateTab('choose-tournament')}>Explore tournaments <ArrowUpRight size={17} /></button><button className="arena-outline hero-match-button" onClick={() => onNavigateTab('current-live')}><Radio size={16} /> Match center</button></div><div className="hero-footnote"><ShieldCheck size={14} /><span>Rosters. Results. Fair play. All in one place.</span></div></div><ArenaScene /></section>
    <section className="home-match-grid"><div className="live-feature arena-panel"><div className="section-inline-title"><span><Radio size={15} /> {live ? 'In the arena' : 'Match center'}</span>{live && <span className="live-pill"><span className="status-dot" /> LIVE</span>}</div>{live ? <><div className="live-match-meta">{publishedBrackets.find(bracket => bracket.matches.some(match => match.id === live.id))?.title || live.gameId} <span>· {live.roundName}</span></div><div className="home-scoreboard"><div><span className="team-emblem emblem-blue">{live.team1?.collegeCode || 'TBD'}</span><strong>{live.team1?.name || 'To be decided'}</strong></div><div className="home-score"><b>{live.score.team1Score} <span>:</span> {live.score.team2Score}</b><small>{live.matchFormat} SERIES</small></div><div><span className="team-emblem emblem-coral">{live.team2?.collegeCode || 'TBD'}</span><strong>{live.team2?.name || 'To be decided'}</strong></div></div><button className="arena-outline w-full" onClick={() => onViewLiveMatch(live)}>Open match <ArrowRight size={15} /></button></> : <div className="arena-empty"><Radio /><h3>No live matches right now.</h3><p>Live matches appear here when an organizer starts a series.</p><button className="arena-outline" onClick={() => onNavigateTab('schedule')}>See the schedule <ArrowRight size={14} /></button></div>}</div>
      <button className="copilot-feature arena-panel" onClick={() => onNavigateTab('ai-assistant')}><div className="copilot-label"><Sparkles size={14} /> Arena AI <ArrowUpRight size={16} /></div><img className="arena-character" src="/arenahub-logo.svg" alt="" width="90" height="106"/><div><h2>Ask about the tournament</h2><p>Brackets, rosters, and tournament questions. Just ask Arena.</p><span className="copilot-cta">Open Arena AI <ArrowRight size={15} /></span></div></button></section>
    {otherLive.length > 0 && <section className="arena-panel">
      <div className="section-inline-title"><span><Radio size={16} /> Also live now</span></div>
      {otherLive.map(match => <button key={match.id} type="button" className="schedule-row" onClick={() => onViewLiveMatch(match)}>
        <strong>{match.team1?.name || 'Awaiting team'} vs {match.team2?.name || 'Awaiting team'}</strong>
        <span>{match.score.team1Score}–{match.score.team2Score}</span><ArrowUpRight size={16} />
      </button>)}
    </section>}
    <section><div className="home-section-heading"><div><h2>Official brackets</h2></div><button className="arena-text-button" onClick={() => onNavigateTab('choose-tournament')}>Open brackets <ArrowUpRight size={15} /></button></div><div className="published-grid">{publishedBrackets.length ? publishedBrackets.map(b => <button className="arena-panel published-card" key={b.id} onClick={() => onSelectPublishedBracket(b)}><span className="cute-icon lavender"><GitBranch size={22} /></span><div><h3>{b.title}</h3><p>{b.gameName} · {b.teamsCount} teams</p></div><ArrowUpRight size={18} /></button>) : <div className="arena-panel empty-brackets"><GitBranch size={20} /><div><strong>No published brackets yet.</strong><p>Official brackets appear here once published by your organizer.</p></div></div>}</div></section>
    <section>
      <div className="home-section-heading"><h2>Featured games</h2><button className="arena-text-button" onClick={() => onNavigateTab('current-live')}>Match center <ArrowRight size={14} /></button></div>
      <div className="tournament-showcase">
        {GAME_ARTWORK.map(game => {
          const id = game.id;
          const gameBrackets = publishedBrackets.filter(bracket => publicationGameKey(bracket) === `game-${id}`);
          const liveCount = gameBrackets.flatMap(bracket => bracket.matches).filter(isWatchableLiveMatch).length;
          return <button key={id} className="tournament-tile" onClick={() => onNavigateTab('current-live', { game: id })}>
            <div className="tournament-art"><img src={game.image} alt="" loading="lazy" />
              {liveCount > 0 && <span className="tournament-status is-live">{liveCount} live</span>}
            </div>
            <div className="tournament-tile-heading"><h3>{game.name}</h3>
              <small>{gameBrackets.length ? `${gameBrackets.length} published bracket${gameBrackets.length === 1 ? '' : 's'}` : 'No published brackets yet'}</small>
            </div>
          </button>;
        })}
      </div>
    </section>
    <section className="home-bottom-grid"><div className="arena-panel"><div className="section-inline-title"><span><CalendarDays size={16} /> Upcoming matches</span><button className="arena-text-button" onClick={() => onNavigateTab('schedule')}>Schedule <ArrowUpRight size={14} /></button></div>{upcoming.length ? upcoming.map(m => <button className="schedule-row" key={m.id} onClick={() => onViewLiveMatch(m)}><span className="schedule-time">{bracketScheduleLabel(m)}</span><span><strong>{m.team1?.name} <em>vs</em> {m.team2?.name}</strong><small>{m.roundName} · {m.matchFormat}</small></span><ArrowUpRight size={16} /></button>) : <p className="text-sm text-[var(--text-muted)] py-6">No upcoming matches have been scheduled.</p>}</div><div className="arena-panel fairplay-feature"><span className="cute-icon mint"><ShieldCheck size={24} /></span><h2>Fair play</h2><p>Check roster eligibility and submit match evidence. Keep competition fair with organizer review.</p><button className="arena-text-button" onClick={() => onNavigateTab('integrity')}>Explore fair play <ArrowRight size={15} /></button></div></section>
    {spotlights.length > 0 && <section><div className="home-section-heading"><div><span className="section-overline">COMMUNITY PICKS · SAMPLE CONTENT</span><h2>From the community.</h2></div></div><div className="published-grid">{spotlights.map(item => <article key={item.id} className="arena-panel"><span className="section-overline">FEATURED</span><h3 className="text-sm">{item.title}</h3><p className="mt-2 text-xs text-[var(--text-muted)]">{item.meta}</p></article>)}</div></section>}
    <footer className="home-footer"><span>ArenaHub <span>© 2026</span></span><button onClick={() => onNavigateTab('support')}>Need a hand? <ArrowUpRight size={13} /></button></footer>
  </div>;
};
