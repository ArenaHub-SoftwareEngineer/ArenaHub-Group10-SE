import React, { useMemo } from 'react';
import { Match, BracketDraft } from '../../lib/types';
import { ArrowRight, CalendarDays, GitBranch, Radio, ShieldCheck, Sparkles } from '../ui/Icons';
import { publicationGameKey } from '../../lib/bracketPublication';
import { GAME_ARTWORK } from '../common/GameArtworkTiles';
import { bracketScheduleLabel } from '../../lib/calendar';
import { upcomingOrder, watchGames, type WatchCard } from '../../lib/watchCards';
import { formatViewers, useViewerCounts } from '../../lib/presence';
import { CAMPUS_SHORT_NAME } from '../../lib/institution';
import { ArenaHero } from '../three/ArenaHero';
import { WatchCardView } from './WatchCardView';
import { GameCover, GAME_ART_CREDIT } from '../common/GameCover';

interface HomeScreenProps {
  spotlights?: Array<{ id: string; title: string; meta: string; link?: string }>;
  liveMatch?: Match; matches: Match[]; publishedBrackets: BracketDraft[];
  onViewLiveMatch: (m: Match) => void;
  onNavigateTab: (tab: string, params?: Record<string, string>) => void; onSelectPublishedBracket: (bracket: BracketDraft) => void;
}

const short = (name?: string) => (name || 'TBD').replace(/^DEMO\s+/i, '');

/**
 * Home, like a streaming site's front page: the 3D arena with what is on right now, live channels,
 * what is up next, games to browse, and the published brackets.
 */
export const HomeScreen: React.FC<HomeScreenProps> = ({ spotlights = [], publishedBrackets, onViewLiveMatch, onNavigateTab, onSelectPublishedBracket }) => {
  const games = useMemo(() => watchGames(publishedBrackets), [publishedBrackets]);
  const cards = games.flatMap(game => game.cards);
  const live = cards.filter(card => card.state === 'live');
  const soon = cards.filter(card => card.state === 'waiting');
  const upcoming = cards.filter(card => card.state === 'upcoming').sort(upcomingOrder);
  const counts = useViewerCounts(live.map(card => card.match.id));
  // The hero features the most watched live match, then a match about to go live, then the next one scheduled.
  const featured: WatchCard | undefined = [...live].sort((a, b) => (counts[b.match.id] ?? 0) - (counts[a.match.id] ?? 0))[0] ?? soon[0] ?? upcoming[0];
  const open = (card: WatchCard) => onViewLiveMatch(card.match);
  const featuredLive = featured?.state === 'live';
  const featuredViewers = featured ? counts[featured.match.id] : undefined;

  return <div className="ah-home">
    <section className="ah-hero" aria-labelledby="home-hero-title">
      <div className="ah-hero-copy">
        <p className={`ah-hero-kicker${featuredLive ? ' is-live' : ''}`}>
          {featuredLive ? <><span className="ah-live-tag">Live</span>{typeof featuredViewers === 'number' && featuredViewers > 0 ? formatViewers(featuredViewers) : featured!.gameLabel}</>
            : featured ? <><CalendarDays size={16} aria-hidden="true" />{featured.state === 'waiting' ? 'Starting soon' : `Next up · ${bracketScheduleLabel(featured.match)}`}</>
            : <>{CAMPUS_SHORT_NAME} esports</>}
        </p>
        <h1 id="home-hero-title">{featured ? (featured.match.lobby ? `${short(featured.bracket.title)}, ${featured.match.roundName}` : `${short(featured.match.team1?.name)} vs ${short(featured.match.team2?.name)}`) : 'Every campus match, in one place.'}</h1>
        <p className="ah-hero-sub">{featured ? [featuredLive ? undefined : featured.gameLabel, featured.bracket.title, featured.match.roundName, featured.match.matchFormat].filter(Boolean).join(' · ')
          : 'Watch live matches, follow the brackets and check the standings for every tournament on campus.'}</p>
        {featured && !featured.match.lobby && (featuredLive || featured.match.status === 'completed') && <div className="ah-hero-score" aria-label={`Score ${featured.match.score.team1Score} to ${featured.match.score.team2Score}`}>
          <span>{featured.match.team1?.collegeCode || short(featured.match.team1?.name).slice(0, 3)}</span>
          <b>{featured.match.score.team1Score}</b><i aria-hidden="true">–</i><b>{featured.match.score.team2Score}</b>
          <span>{featured.match.team2?.collegeCode || short(featured.match.team2?.name).slice(0, 3)}</span>
        </div>}
        <div className="ah-hero-actions">
          <button type="button" className="arena-primary" onClick={() => featured ? open(featured) : onNavigateTab('current-live')}>
            <Radio size={16} aria-hidden="true" />{featuredLive ? 'Watch now' : featured ? 'Match details' : 'Watch'}
          </button>
          <button type="button" className="arena-outline" onClick={() => onNavigateTab('choose-tournament')}>Brackets <ArrowRight size={16} aria-hidden="true" /></button>
        </div>
      </div>
      <ArenaHero className="ah-hero-stage" />
    </section>

    {live.length > 0 && <section className="ah-section" aria-labelledby="home-live">
      <header className="ah-section-head"><h2 id="home-live"><span className="ah-live-dot" aria-hidden="true" />Live channels</h2>
        <button type="button" className="arena-text-button" onClick={() => onNavigateTab('current-live', { game: 'live' })}>Show all <ArrowRight size={16} aria-hidden="true" /></button></header>
      <div className="watch-grid">{live.slice(0, 4).map(card => <WatchCardView key={card.match.id} card={card} viewers={counts[card.match.id]} onOpen={open} />)}</div>
    </section>}

    {(soon.length > 0 || upcoming.length > 0) && <section className="ah-section" aria-labelledby="home-next">
      <header className="ah-section-head"><h2 id="home-next">Up next</h2>
        <button type="button" className="arena-text-button" onClick={() => onNavigateTab('schedule')}>Schedule <ArrowRight size={16} aria-hidden="true" /></button></header>
      <div className="watch-grid">{[...soon, ...upcoming].slice(0, 4).map(card => <WatchCardView key={card.match.id} card={card} onOpen={open} />)}</div>
    </section>}

    <section className="ah-section" aria-labelledby="home-games">
      <header className="ah-section-head"><h2 id="home-games">Games</h2></header>
      <div className="ah-covers">
        {GAME_ARTWORK.map(game => {
          const gameBrackets = publishedBrackets.filter(bracket => publicationGameKey(bracket) === `game-${game.id}`);
          const liveCount = (games.find(g => g.id === game.id)?.cards ?? []).filter(card => card.state === 'live').length;
          return <button key={game.id} type="button" className="ah-cover-card" onClick={() => onNavigateTab('current-live', { game: game.id })}>
            <GameCover gameId={game.id} fallback={game.image} />
            {liveCount > 0 && <span className="watch-badge watch-badge-live">{liveCount} live</span>}
            <strong>{game.name}</strong>
            <small>{gameBrackets.length ? `${gameBrackets.length} ${gameBrackets.length === 1 ? 'bracket' : 'brackets'}` : 'No bracket yet'}</small>
          </button>;
        })}
      </div>
    </section>

    <section className="ah-section" aria-labelledby="home-brackets">
      <header className="ah-section-head"><h2 id="home-brackets">Brackets</h2>
        <button type="button" className="arena-text-button" onClick={() => onNavigateTab('choose-tournament')}>All brackets <ArrowRight size={16} aria-hidden="true" /></button></header>
      {publishedBrackets.length ? <div className="ah-list">
        {publishedBrackets.map(bracket => <button key={bracket.id} type="button" className="ah-list-row" onClick={() => onSelectPublishedBracket(bracket)}>
          <span className="ah-list-icon" aria-hidden="true"><GitBranch size={18} /></span>
          <span className="ah-list-text"><strong>{bracket.title}</strong><small>{bracket.gameName} · {bracket.teamsCount} teams</small></span>
          <ArrowRight size={16} aria-hidden="true" className="ah-list-go" />
        </button>)}
      </div> : <div className="ah-empty-panel"><GitBranch size={22} aria-hidden="true" /><strong>No published brackets yet</strong><p>Brackets appear here once an organizer publishes them.</p></div>}
    </section>

    <section className="ah-tiles" aria-label="More from ArenaHub">
      <button type="button" className="ah-tile" onClick={() => onNavigateTab('ai-assistant')}>
        <span className="ah-tile-icon" aria-hidden="true"><Sparkles size={20} /></span>
        <strong>Ask Arena AI</strong><span>Brackets, schedules, rosters and results, answered from the published records.</span>
        <ArrowRight size={16} aria-hidden="true" className="ah-tile-go" />
      </button>
      <button type="button" className="ah-tile" onClick={() => onNavigateTab('integrity')}>
        <span className="ah-tile-icon" aria-hidden="true"><ShieldCheck size={20} /></span>
        <strong>Fair play</strong><span>Run the required anti-cheat scan before your match and follow your case.</span>
        <ArrowRight size={16} aria-hidden="true" className="ah-tile-go" />
      </button>
    </section>

    {spotlights.length > 0 && <section className="ah-section" aria-labelledby="home-spotlight">
      <header className="ah-section-head"><h2 id="home-spotlight">Spotlight</h2></header>
      <div className="ah-list">{spotlights.map(item => <article key={item.id} className="ah-list-row is-static">
        <span className="ah-list-text"><strong>{item.link ? <a href={item.link} target="_blank" rel="noopener noreferrer">{item.title}</a> : item.title}</strong><small>{item.meta}</small></span>
      </article>)}</div>
    </section>}

    <footer className="ah-footer"><span>ArenaHub · {CAMPUS_SHORT_NAME} · 2026</span><span className="ah-footer-credit">{GAME_ART_CREDIT}</span><button type="button" className="arena-text-button" onClick={() => onNavigateTab('support')}>Help <ArrowRight size={14} aria-hidden="true" /></button></footer>
  </div>;
};
