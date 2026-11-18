import React, { useMemo, useState } from 'react';
import type { BracketDraft, Match } from '../../lib/types';
import { bracketScheduleLabel } from '../../lib/calendar';
import { upcomingOrder, watchGames, type WatchCard } from '../../lib/watchCards';
import { MultiMatchViewer } from './MultiMatchViewer';
import { WatchCardView, cardTitle } from './WatchCardView';
import { FeaturedCarousel } from './FeaturedCarousel';
import { BroadcastIllustration, CalendarIllustration } from '../ui/Illustrations';
import { LayoutGrid } from 'lucide-react';
import { CalendarDays, Radio } from '../ui/Icons';
import { Modal } from '../ui/Modal';

type Filter = 'all' | 'live' | 'upcoming' | string;

/**
 * Match center, laid out like a video home page: filter chips across the top, then shelves of match cards
 * (Live now, Starting soon, Upcoming). Live cards open the watch page; others explain when they start.
 */
export function CurrentLiveView({ brackets, initialGame, onSelectMatch }: {
  brackets: BracketDraft[];
  initialGame?: string | null;
  onSelectMatch: (match: Match, game: string) => void;
}) {
  const games = useMemo(() => watchGames(brackets), [brackets]);
  const [filter, setFilter] = useState<Filter>(initialGame || 'all');
  const [pending, setPending] = useState<WatchCard | null>(null);
  const [multiOpen, setMultiOpen] = useState(false);

  const all = games.flatMap(game => game.cards);
  const inScope = filter === 'all' || filter === 'live' || filter === 'upcoming' ? all : games.find(g => g.id === filter)?.cards ?? [];
  const live = inScope.filter(c => c.state === 'live');
  const waiting = inScope.filter(c => c.state === 'waiting');
  const upcoming = inScope.filter(c => c.state === 'upcoming').sort(upcomingOrder);
  const totalLive = all.filter(c => c.state === 'live').length;
  // Featured: everything live, then matches about to go live, topped up with the next scheduled ones.
  const featured = [...all.filter(c => c.state === 'live'), ...all.filter(c => c.state === 'waiting'), ...all.filter(c => c.state === 'upcoming').sort(upcomingOrder)].slice(0, 6);
  const open = (card: WatchCard) => card.state === 'live' ? onSelectMatch(card.match, card.gameId) : setPending(card);

  const shelf = (title: string, icon: React.ReactNode, cards: WatchCard[], id: string) => cards.length > 0 && <section className="watch-shelf" aria-labelledby={id}>
    <h2 id={id}>{icon}{title}<span className="watch-shelf-count">{cards.length}</span></h2>
    <div className="watch-grid">{cards.map(card => <WatchCardView key={card.match.id} card={card} onOpen={open} />)}</div>
  </section>;
  const showLive = filter !== 'upcoming', showUpcoming = filter !== 'live';
  const scopedFilter = games.some(game => game.id === filter) || ['all', 'live', 'upcoming'].includes(filter);
  const nothing = !(showLive && (live.length || waiting.length)) && !(showUpcoming && upcoming.length);

  return <div className="match-center watch-home">
    <header className="watch-home-head">
      <div>
        <h1>Match center</h1>
        <p className={`watch-live-summary${totalLive ? ' is-live' : ''}`}><i aria-hidden="true" />{totalLive ? `${totalLive} ${totalLive === 1 ? 'match' : 'matches'} live now` : 'No matches live right now'}</p>
      </div>
      <button type="button" className="arena-outline" aria-haspopup="dialog" onClick={() => setMultiOpen(true)}><LayoutGrid size={16} />Multi-view</button>
    </header>

    {filter === 'all' && <FeaturedCarousel cards={featured} onOpen={open} />}

    <div className="ah-chips" role="group" aria-label="Filter matches">
      {[{ id: 'all', label: 'All' }, { id: 'live', label: 'Live now' }, { id: 'upcoming', label: 'Upcoming' }].map(chip =>
        <button key={chip.id} type="button" className="ah-chip" aria-pressed={filter === chip.id} onClick={() => setFilter(chip.id)}>{chip.id === 'live' && <i className="watch-chip-dot" aria-hidden="true" />}{chip.label}</button>)}
      <span className="ah-chips-divider" aria-hidden="true" />
      {games.map(game => <button key={game.id} type="button" className="ah-chip" aria-pressed={filter === game.id} onClick={() => setFilter(game.id)}>
        {game.image && <img src={game.image} alt="" className="ah-chip-img" />}{game.label}
        {game.cards.some(c => c.state === 'live') && <i className="watch-chip-dot" aria-label="has live matches" />}
      </button>)}
    </div>

    {showLive && shelf('Live now', <Radio size={18} />, live, 'shelf-live')}
    {showLive && shelf('Starting soon', <Radio size={18} />, waiting, 'shelf-waiting')}
    {showUpcoming && shelf('Upcoming', <CalendarDays size={18} />, upcoming, 'shelf-upcoming')}
    {nothing && <div className="ah-empty">
      {filter === 'upcoming' ? <CalendarIllustration /> : <BroadcastIllustration />}
      <h3>{!scopedFilter ? 'Game unavailable' : filter === 'all' ? 'No matches to show' : filter === 'live' ? 'No live matches' : 'No matches for this filter'}</h3>
      <p>{filter === 'live' || filter === 'all' ? 'Live broadcasts appear here the moment an organizer starts a match.' : 'Published matches for this choice will appear here.'}</p>
      {filter !== 'all' && <button type="button" className="arena-outline" onClick={() => setFilter('all')}>Show all matches</button>}
    </div>}

    <MultiMatchViewer open={multiOpen} onClose={() => setMultiOpen(false)}
      entries={all.filter(card => !card.match.lobby).map(card => ({ match: card.match, gameName: card.gameLabel, bracketTitle: card.bracket.title, gameId: card.gameId }))} onSelectMatch={onSelectMatch} />

    <Modal open={pending !== null} onClose={() => setPending(null)}
      title={pending?.state === 'waiting' ? 'Broadcast starting soon' : pending?.match.status === 'completed' ? 'Match has ended' : 'Match is not live yet'}
      description={pending ? [pending.gameLabel, pending.mode, pending.bracket.title].filter(Boolean).join(' · ') : undefined}>
      {pending && <div className="match-center-notice">
        <strong>{cardTitle(pending.match)}</strong>
        <p>{bracketScheduleLabel(pending.match)} · {pending.match.roundName}</p>
        <p className="field-hint">{pending.match.lobby ? 'Battle Royale standings update after each game on the Brackets page.' : pending.state === 'waiting' ? 'The match has started; the organizer has not attached the broadcast yet.' : 'Come back at the scheduled time. Live matches open straight into the player.'}</p>
      </div>}
    </Modal>
  </div>;
}
