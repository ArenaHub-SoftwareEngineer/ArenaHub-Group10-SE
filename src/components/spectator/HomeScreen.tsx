import React, { useMemo, useRef, useState } from 'react';
import { motion, useMotionTemplate, useScroll, useSpring, useTransform } from 'motion/react';
import { Match, BracketDraft } from '../../lib/types';
import { ArrowRight, CalendarDays, Eye, Radio, ShieldCheck, Sparkles } from '../ui/Icons';
import { publicationGameKey } from '../../lib/bracketPublication';
import { GAME_ARTWORK } from '../common/GameArtworkTiles';
import { bracketScheduleLabel, manilaToday, scheduleDate, timeOrder } from '../../lib/calendar';
import { scheduleTimeLabel } from '../../lib/matchTiming';
import { upcomingOrder, watchGames, type WatchCard } from '../../lib/watchCards';
import { formatViewers, useViewerCounts } from '../../lib/presence';
import { CAMPUS_SHORT_NAME } from '../../lib/institution';
import { useCalm } from '../../lib/useCalm';
import { ArenaHero } from '../three/ArenaHero';
import { ArenaAiFilm } from '../common/ArenaAiFilm';
import { CollegeLogo } from '../common/CollegeLogo';
import { WatchCardView } from './WatchCardView';
import { GAME_ART_CREDIT } from '../common/GameCover';
import './homePoster.css';

interface HomeScreenProps {
  liveMatch?: Match; matches: Match[]; publishedBrackets: BracketDraft[];
  onViewLiveMatch: (m: Match) => void;
  onNavigateTab: (tab: string, params?: Record<string, string>) => void; onSelectPublishedBracket: (bracket: BracketDraft) => void;
  /** False for invited guests: no Arena AI or Anti-cheat sections. */
  campusMember?: boolean;
}

type Tone = 'thin' | 'brand';
type Line = { text: string; tone?: Tone };

const short = (name?: string) => name || 'TBD';
const code = (team?: { collegeCode?: string; name?: string }) => team?.collegeCode || short(team?.name).slice(0, 3).toUpperCase();
const GAME_SHORT: Record<string, string> = { mlbb: 'MLBB', dota2: 'Dota 2', 'codm-mp': 'CODM MP', 'codm-br': 'CODM BR' };
const PHOTO_CREDIT = 'Photos: Alexandros Giannakakis, Raman Shaunia and Alef Morais on Unsplash.';

/** "Today · 2:00 PM", "Tomorrow · 7:30 PM" or "Nov 28 · 3:00 PM"; the plain schedule label when the date or time is unclear. */
function whenLabel(match: Match) {
  const day = scheduleDate(match.scheduledDate?.trim() || '');
  if (!day || timeOrder(match.scheduledTime || '') === 9999) return bracketScheduleLabel(match);
  const today = manilaToday();
  const tomorrow = manilaToday(new Date(Date.now() + 86_400_000));
  const date = day === today ? 'Today' : day === tomorrow ? 'Tomorrow'
    : new Date(`${day}T12:00:00+08:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
  return `${date} · ${scheduleTimeLabel(match)}`;
}

/** The hero title for the featured match, as poster lines. */
function heroLines(featured?: WatchCard): Line[] {
  if (!featured) return [{ text: 'Every campus', tone: 'thin' }, { text: 'match,' }, { text: 'live.', tone: 'brand' }];
  const { match } = featured;
  if (match.lobby) return [{ text: short(featured.bracket.title), tone: 'thin' }, { text: `${match.roundName}.`, tone: 'brand' }];
  return [{ text: short(match.team1?.name) }, { text: 'vs', tone: 'thin' }, { text: short(match.team2?.name), tone: 'brand' }];
}

const RISE = { hidden: { y: '108%', rotate: 6 }, shown: { y: '0%', rotate: 0 } };

/**
 * A line that rises out of its mask, once, when it scrolls into view. The mask watches the viewport: the line
 * itself starts clipped away by the mask, so it would never count as visible.
 */
function RiseLine({ line, i, calm }: { line: Line; i: number; calm: boolean }) {
  return <motion.span className="hp-mask" initial={calm ? false : 'hidden'} whileInView="shown" viewport={{ once: true, amount: 0.5 }}>
    <motion.span className={`hp-line${line.tone ? ` is-${line.tone}` : ''}`} variants={RISE}
      transition={{ type: 'spring', stiffness: 90, damping: 18, delay: 0.08 + i * 0.09 }}>{line.text}</motion.span>
  </motion.span>;
}

/** Section heading in the poster style: a numbered label, then the title in heavy display type. */
function PosterHead({ id, n, label, lines, calm, action, dot }: {
  id: string; n: number; label: string; lines: Line[]; calm: boolean; action?: React.ReactNode; dot?: boolean;
}) {
  return <header className="hp-head">
    <div className="hp-head-copy">
      <p className="hp-label"><span>{String(n).padStart(2, '0')}</span>{label}</p>
      <h2 id={id} className="hp-h2">
        {dot && <span className="hp-live-dot" aria-hidden="true" />}
        {lines.map((line, i) => <React.Fragment key={line.text}>{i > 0 && ' '}<RiseLine line={line} i={i} calm={calm} /></React.Fragment>)}
      </h2>
    </div>
    {action}
  </header>;
}

/**
 * Home after sign-in, in the welcome page's poster language: the featured match as a giant headline over a
 * tilting poster card, a ticker of what is on, then numbered chapters (live, up next, games, brackets,
 * Arena AI, fair play), each with heavy display type. Data and actions are the same as before.
 */
export const HomeScreen: React.FC<HomeScreenProps> = ({ publishedBrackets, onViewLiveMatch, onNavigateTab, onSelectPublishedBracket, campusMember = true }) => {
  const calm = useCalm();
  const games = useMemo(() => watchGames(publishedBrackets), [publishedBrackets]);
  const cards = games.flatMap(game => game.cards);
  const live = cards.filter(card => card.state === 'live');
  const soon = cards.filter(card => card.state === 'waiting');
  const upcoming = cards.filter(card => card.state === 'upcoming').sort(upcomingOrder);
  const counts = useViewerCounts(live.map(card => card.match.id));
  // The hero features the most watched live match, then a match about to go live, then the next one scheduled.
  const featured: WatchCard | undefined = [...live].sort((a, b) => (counts[b.match.id] ?? 0) - (counts[a.match.id] ?? 0))[0] ?? soon[0] ?? upcoming[0];
  const open = (card: WatchCard) => onViewLiveMatch(card.match);
  const next = [...soon, ...upcoming];
  let chapter = 0;

  return <div className={`ah-home hp${calm ? ' is-calm' : ''}`}>
    <Hero featured={featured} counts={counts} ticker={[...live, ...next].slice(0, 8)} calm={calm} onOpen={open} onNavigateTab={onNavigateTab} />

    {live.length > 0 && <section className="hp-section" aria-labelledby="home-live">
      <PosterHead id="home-live" n={++chapter} label="On now" lines={[{ text: 'Live', tone: 'thin' }, { text: 'channels' }]} calm={calm} dot
        action={<button type="button" className="hp-more" onClick={() => onNavigateTab('current-live', { game: 'live' })}>Show all <ArrowRight size={16} aria-hidden="true" /></button>} />
      <div className="watch-grid">{live.slice(0, 4).map(card => <WatchCardView key={card.match.id} card={card} viewers={counts[card.match.id]} onOpen={open} />)}</div>
    </section>}

    {next.length > 0 && <section className="hp-section" aria-labelledby="home-next">
      <PosterHead id="home-next" n={++chapter} label="Coming up" lines={[{ text: 'Up', tone: 'thin' }, { text: 'next', tone: 'brand' }]} calm={calm}
        action={<button type="button" className="hp-more" onClick={() => onNavigateTab('schedule')}>Schedule <ArrowRight size={16} aria-hidden="true" /></button>} />
      <div className="watch-grid">{next.slice(0, 4).map(card => <WatchCardView key={card.match.id} card={card} onOpen={open} />)}</div>
    </section>}

    <Games n={++chapter} calm={calm} publishedBrackets={publishedBrackets} liveCount={id => (games.find(g => g.id === id)?.cards ?? []).filter(card => card.state === 'live').length} onNavigateTab={onNavigateTab} />

    <section className="hp-section" aria-labelledby="home-brackets">
      <PosterHead id="home-brackets" n={++chapter} label="Follow the tournament" lines={[{ text: 'Brackets' }]} calm={calm}
        action={<button type="button" className="hp-more" onClick={() => onNavigateTab('choose-tournament')}>All brackets <ArrowRight size={16} aria-hidden="true" /></button>} />
      {publishedBrackets.length ? <ol className="hp-brackets">
        {publishedBrackets.map((bracket, i) => <motion.li key={bracket.id}
          initial={calm ? false : { opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.4 }}
          transition={{ type: 'spring', stiffness: 120, damping: 20, delay: Math.min(i, 6) * 0.05 }}>
          <button type="button" className="hp-bracket" onClick={() => onSelectPublishedBracket(bracket)}>
            <span className="hp-bracket-n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
            <span className="hp-bracket-text"><strong>{bracket.title}</strong><small>{bracket.gameName} · {bracket.teamsCount} teams</small></span>
            <ArrowRight size={22} aria-hidden="true" className="hp-bracket-go" />
          </button>
        </motion.li>)}
      </ol> : <p className="hp-empty"><strong>No published brackets yet.</strong> Brackets appear here once an organizer publishes them.</p>}
    </section>

    {campusMember && <section className="hp-section hp-ai" aria-labelledby="home-ai">
      <div className="hp-ai-copy">
        <p className="hp-label"><span>{String(++chapter).padStart(2, '0')}</span>Ask Arena AI</p>
        <h2 id="home-ai" className="hp-h2 is-stack">
          <RiseLine line={{ text: 'Just', tone: 'thin' }} i={0} calm={calm} />{' '}<RiseLine line={{ text: 'ask.', tone: 'brand' }} i={1} calm={calm} />
        </h2>
        <p className="hp-body">Who plays next, who won, how your college is doing. Arena AI answers from the published records, in English or Filipino.</p>
        <button type="button" className="arena-primary hp-cta" onClick={() => onNavigateTab('ai-assistant')}><Sparkles size={16} aria-hidden="true" />Ask Arena AI</button>
      </div>
      <motion.div className="hp-ai-film" initial={calm ? false : { opacity: 0, rotateX: 18, y: 60 }} whileInView={{ opacity: 1, rotateX: 0, y: 0 }}
        viewport={{ once: true, amount: 0.3 }} transition={{ type: 'spring', stiffness: 70, damping: 18 }}>
        <ArenaAiFilm />
      </motion.div>
    </section>}

    {campusMember && <FairBand n={++chapter} calm={calm} onOpen={() => onNavigateTab('integrity')} />}

    <footer className="ah-footer"><span>ArenaHub · {CAMPUS_SHORT_NAME} · 2026</span><span className="ah-footer-credit">{GAME_ART_CREDIT} {PHOTO_CREDIT}</span><button type="button" className="arena-text-button" onClick={() => onNavigateTab('support')}>Help <ArrowRight size={14} aria-hidden="true" /></button></footer>
  </div>;
};

/* ------------------------------------------------------------------ Hero */

function Hero({ featured, counts, ticker, calm, onOpen, onNavigateTab }: {
  featured?: WatchCard; counts: Record<string, number>; ticker: WatchCard[]; calm: boolean;
  onOpen: (card: WatchCard) => void; onNavigateTab: HomeScreenProps['onNavigateTab'];
}) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const lift = useTransform(scrollYProgress, [0, 1], calm ? [0, 0] : [0, -120]);
  const fade = useTransform(scrollYProgress, [0, 0.8], calm ? [1, 1] : [1, 0.15]);
  const giantX = useTransform(scrollYProgress, [0, 1], calm ? ['0%', '0%'] : ['0%', '-12%']);
  const featuredLive = featured?.state === 'live';
  const viewers = featured ? counts[featured.match.id] : undefined;
  const lines = heroLines(featured);
  const longest = Math.max(...lines.map(line => line.text.length));
  const size = longest > 16 ? 'is-long' : longest > 10 ? 'is-mid' : '';
  const rise = (i: number) => calm ? {} : {
    initial: { y: '105%', rotateX: -70, opacity: 0 }, animate: { y: '0%', rotateX: 0, opacity: 1 },
    transition: { type: 'spring' as const, stiffness: 90, damping: 18, delay: 0.1 + i * 0.1 },
  };

  return <section ref={ref} className={`hp-hero${ticker.length ? ' has-ticker' : ''}`} aria-labelledby="home-hero-title">
    <motion.span className="hp-giant" aria-hidden="true" style={{ x: giantX }}>{featuredLive ? 'Live' : featured ? 'Next' : 'Arena'}</motion.span>
    <motion.div className="hp-hero-copy" style={{ y: lift, opacity: fade }}>
      <p className={`hp-kicker${featuredLive ? ' is-live' : ''}`}>
        {featuredLive ? <><span className="ah-live-tag">Live</span>{typeof viewers === 'number' && viewers > 0 ? formatViewers(viewers) : featured!.gameLabel}</>
          : featured ? <><CalendarDays size={16} aria-hidden="true" />{featured.state === 'waiting' ? 'Starting soon' : `Next up · ${whenLabel(featured.match)}`}</>
          : <>{CAMPUS_SHORT_NAME} esports</>}
      </p>
      <h1 id="home-hero-title" className={`hp-title ${size}`}>
        {lines.map((line, i) => <React.Fragment key={`${line.text}-${i}`}>{i > 0 && ' '}<span className="hp-mask"><motion.span className={`hp-line${line.tone ? ` is-${line.tone}` : ''}`} {...rise(i)}>{line.text}</motion.span></span></React.Fragment>)}
      </h1>
      <motion.p className="hp-sub" initial={calm ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45, duration: 0.5 }}>
        {featured ? [featuredLive ? undefined : featured.gameLabel, featured.bracket.title, featured.match.roundName, featured.match.matchFormat].filter(Boolean).join(' · ')
          : 'Watch live matches, follow the brackets and check the standings for every tournament on campus.'}
      </motion.p>
      {featured && !featured.match.lobby && (featuredLive || featured.match.status === 'completed') && <div className="hp-score" aria-label={`Score ${featured.match.score.team1Score} to ${featured.match.score.team2Score}`}>
        <span>{code(featured.match.team1)}</span><b>{featured.match.score.team1Score}</b><i aria-hidden="true">–</i><b>{featured.match.score.team2Score}</b><span>{code(featured.match.team2)}</span>
      </div>}
      <motion.div className="hp-actions" initial={calm ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55, duration: 0.5 }}>
        <button type="button" className="arena-primary" onClick={() => featured ? onOpen(featured) : onNavigateTab('current-live')}>
          <Radio size={16} aria-hidden="true" />{featuredLive ? 'Watch now' : featured ? 'Match details' : 'Watch'}
        </button>
        <button type="button" className="arena-outline" onClick={() => onNavigateTab('choose-tournament')}>Brackets <ArrowRight size={16} aria-hidden="true" /></button>
      </motion.div>
    </motion.div>
    <div className="hp-hero-visual">
      {featured ? <HeroPoster card={featured} live={featuredLive} viewers={viewers} calm={calm} progress={scrollYProgress} />
        : <ArenaHero className="hp-hero-stage" />}
    </div>
    {ticker.length > 0 && <div className="hp-ticker" aria-hidden="true">
      <div className="hp-ticker-track">
        {[0, 1].map(k => <span key={k}>{ticker.map(card => <React.Fragment key={card.match.id}>
          {card.state === 'live' && <b>Live</b>}
          {GAME_SHORT[card.gameId] || card.gameLabel} · {card.match.lobby ? `${short(card.bracket.title)}, ${card.match.roundName}` : `${code(card.match.team1)} ${card.state === 'live' ? `${card.match.score.team1Score}–${card.match.score.team2Score}` : 'vs'} ${code(card.match.team2)}`}
          {card.state !== 'live' && ` · ${card.state === 'waiting' ? 'starting soon' : whenLabel(card.match)}`}<i />
        </React.Fragment>)}</span>)}
      </div>
    </div>}
  </section>;
}

/** The featured match as a poster card: game art, LIVE and viewers on the frame, a scorebug, a photo tucked behind. */
function HeroPoster({ card, live, viewers, calm, progress }: { card: WatchCard; live: boolean; viewers?: number; calm: boolean; progress: ReturnType<typeof useScroll>['scrollYProgress'] }) {
  const rx = useSpring(0, { stiffness: 160, damping: 18 });
  const ry = useSpring(0, { stiffness: 160, damping: 18 });
  const sources = [`/media/games/${card.gameId}.webp`, card.image, '/media/landing/cheer.webp'].filter(Boolean) as string[];
  const [index, setIndex] = useState(0);
  const insetY = useTransform(progress, [0, 1], calm ? [0, 0] : [0, -90]);
  const tilt = useTransform(progress, [0, 1], calm ? [0, 0] : [0, 14]);
  const rotateX = useTransform(() => rx.get() + tilt.get());
  const glareX = useTransform(ry, [-12, 12], ['0%', '100%']);
  const glare = useMotionTemplate`radial-gradient(circle at ${glareX} 25%, rgb(255 255 255 / .18), transparent 55%)`;
  const { match } = card;
  return <div className="hp-poster-wrap" aria-hidden="true"
    onPointerMove={event => {
      if (calm || event.pointerType !== 'mouse') return;
      const box = event.currentTarget.getBoundingClientRect();
      ry.set(((event.clientX - box.left) / box.width - 0.5) * 18);
      rx.set(-((event.clientY - box.top) / box.height - 0.5) * 14);
    }}
    onPointerLeave={() => { rx.set(0); ry.set(0); }}>
    <motion.img className="hp-poster-inset" src="/media/landing/dim.webp" alt="" loading="lazy" style={{ y: insetY }} />
    <motion.figure className="hp-poster" style={{ rotateX, rotateY: ry }}
      initial={calm ? false : { opacity: 0, rotateY: -32, z: -300 }} animate={{ opacity: 1, rotateY: 0, z: 0 }} transition={{ type: 'spring', stiffness: 60, damping: 16, delay: 0.15 }}>
      <span className="hp-poster-clip">
        <img src={sources[index]} alt="" decoding="async" onError={() => setIndex(i => Math.min(i + 1, sources.length - 1))} />
        <span className="hp-poster-shade" />
        <motion.span className="hp-poster-glare" style={{ background: glare }} />
      </span>
      <span className="hp-poster-badges">
        {live ? <span className="hp-badge-live"><i />Live</span> : <span className="hp-badge-time"><CalendarDays size={14} />{card.state === 'waiting' ? 'Starting soon' : whenLabel(match)}</span>}
        {live && typeof viewers === 'number' && viewers > 0 && <span className="hp-badge-viewers"><Eye size={14} />{formatViewers(viewers)}</span>}
      </span>
      {!match.lobby && <span className="hp-scorebug">
        <span><CollegeLogo code={code(match.team1)} size="sm" />{code(match.team1)}</span>
        {live || match.status === 'completed' ? <><b>{match.score.team1Score}</b><i>–</i><b>{match.score.team2Score}</b></> : <i>vs</i>}
        <span>{code(match.team2)}<CollegeLogo code={code(match.team2)} size="sm" /></span>
      </span>}
    </motion.figure>
  </div>;
}

/* ------------------------------------------------------------------ Games */

function Games({ n, calm, publishedBrackets, liveCount, onNavigateTab }: {
  n: number; calm: boolean; publishedBrackets: BracketDraft[]; liveCount: (id: string) => number; onNavigateTab: HomeScreenProps['onNavigateTab'];
}) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const drift = useTransform(scrollYProgress, [0, 1], calm ? ['-10%', '-10%'] : ['4%', '-30%']);
  return <section ref={ref} className="hp-section hp-games" aria-labelledby="home-games">
    <PosterHead id="home-games" n={n} label="Pick a game" lines={[{ text: 'Games' }]} calm={calm} />
    <motion.p className="hp-marquee" aria-hidden="true" style={{ x: drift }}>Mobile Legends <i /> Dota 2 <i /> Call of Duty Mobile <i /> Mobile Legends <i /> Dota 2</motion.p>
    <div className="hp-game-row">
      {GAME_ARTWORK.map((game, i) => {
        const brackets = publishedBrackets.filter(bracket => publicationGameKey(bracket) === `game-${game.id}`).length;
        return <GameCard key={game.id} i={i} calm={calm} id={game.id} name={game.name} image={game.image} live={liveCount(game.id)}
          meta={brackets ? `${brackets} ${brackets === 1 ? 'bracket' : 'brackets'}` : 'No bracket yet'}
          onOpen={() => onNavigateTab('current-live', { game: game.id })} />;
      })}
    </div>
  </section>;
}

function GameCard({ i, calm, id, name, image, live, meta, onOpen }: {
  i: number; calm: boolean; id: string; name: string; image?: string; live: number; meta: string; onOpen: () => void;
}) {
  const rx = useSpring(0, { stiffness: 180, damping: 18 });
  const ry = useSpring(0, { stiffness: 180, damping: 18 });
  const sources = [`/media/games/${id}.webp`, image].filter(Boolean) as string[];
  const [index, setIndex] = useState(0);
  return <motion.button type="button" className="hp-game" onClick={onOpen} style={{ rotateX: rx, rotateY: ry }}
    initial={calm ? false : { opacity: 0, y: 100, rotateZ: (i - 1.5) * 5 }} whileInView={{ opacity: 1, y: 0, rotateZ: 0 }}
    viewport={{ once: true, amount: 0.3 }} transition={{ type: 'spring', stiffness: 80, damping: 16, delay: i * 0.08 }}
    onPointerMove={event => {
      if (calm || event.pointerType !== 'mouse') return;
      const box = event.currentTarget.getBoundingClientRect();
      ry.set(((event.clientX - box.left) / box.width - 0.5) * 22);
      rx.set(-((event.clientY - box.top) / box.height - 0.5) * 18);
    }}
    onPointerLeave={() => { rx.set(0); ry.set(0); }}>
    {sources[index] ? <img src={sources[index]} alt="" loading="lazy" decoding="async" onError={() => setIndex(k => k + 1)} /> : <span className="hp-game-blank" />}
    {live > 0 && <span className="watch-badge watch-badge-live">{live} live</span>}
    <span className="hp-game-copy"><strong>{GAME_SHORT[id] || name}</strong><span>{name}</span><small>{meta}</small></span>
  </motion.button>;
}

/* ------------------------------------------------------------------ Fair play */

function FairBand({ n, calm, onOpen }: { n: number; calm: boolean; onOpen: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const imgY = useTransform(scrollYProgress, [0, 1], calm ? ['0%', '0%'] : ['-12%', '12%']);
  return <section ref={ref} className="hp-section hp-fair" aria-labelledby="home-fair">
    <span className="hp-fair-photo" aria-hidden="true"><motion.img src="/media/landing/intent.webp" alt="" loading="lazy" style={{ y: imgY }} /></span>
    <div className="hp-fair-copy">
      <p className="hp-label"><span>{String(n).padStart(2, '0')}</span>Fair play</p>
      <h2 id="home-fair" className="hp-h2 is-stack">
        <RiseLine line={{ text: 'Scan in.', tone: 'thin' }} i={0} calm={calm} />{' '}<RiseLine line={{ text: 'Play' }} i={1} calm={calm} />{' '}<RiseLine line={{ text: 'clean.', tone: 'brand' }} i={2} calm={calm} />
      </h2>
      <p className="hp-body">Run the required anti-cheat scan before your match and follow your case.</p>
      <button type="button" className="arena-outline hp-cta" onClick={onOpen}><ShieldCheck size={16} aria-hidden="true" />Open anti-cheat</button>
    </div>
  </section>;
}
