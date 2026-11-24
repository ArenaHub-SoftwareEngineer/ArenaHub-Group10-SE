import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { WatchCard } from '../../lib/watchCards';
import { matchBroadcasts } from '../../lib/streamUtils';
import { CollegeLogo } from '../common/CollegeLogo';
import { cardStatus } from './WatchCardView';
import { ChevronLeft, ChevronRight, Play } from '../ui/Icons';

const code = (team?: { collegeCode?: string; name?: string }) => team?.collegeCode || (team?.name || 'TBD').slice(0, 3).toUpperCase();
const ADVANCE_MS = 9000;

/**
 * The featured row at the top of Match center: the current match in the middle with a muted live preview and
 * an info panel, the neighbours peeking out on each side. Arrows, the keyboard and the side slides move it; it
 * moves on its own every few seconds unless the pointer or keyboard focus is on it.
 */
export function FeaturedCarousel({ cards, onOpen }: { cards: WatchCard[]; onOpen: (card: WatchCard) => void }) {
  const reduced = useReducedMotion() || (typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduced');
  const [active, setActive] = useState(0), [held, setHeld] = useState(false), [preview, setPreview] = useState(false);
  const root = useRef<HTMLElement>(null);
  const count = cards.length;
  const go = (step: number) => setActive(i => (i + step + count) % count);
  useEffect(() => { if (active >= count) setActive(0); }, [count, active]);
  // Start the muted preview only after the slide has settled, so flicking through does not load every stream.
  useEffect(() => { setPreview(false); if (reduced) return; const t = setTimeout(() => setPreview(true), 900); return () => clearTimeout(t); }, [active, reduced]);
  useEffect(() => { if (held || count < 2 || reduced) return; const t = setTimeout(() => go(1), ADVANCE_MS); return () => clearTimeout(t); }, [active, held, count, reduced]);
  if (!count) return null;

  const offsetOf = (i: number) => { let o = i - active; if (o > count / 2) o -= count; if (o < -count / 2) o += count; return o; };
  return <section ref={root} className="featured" aria-roledescription="carousel" aria-label="Featured matches"
    onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)} onFocus={() => setHeld(true)}
    onBlur={e => { if (!root.current?.contains(e.relatedTarget as Node)) setHeld(false); }}
    onKeyDown={e => { if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } }}>
    <div className="featured-track">
      {cards.map((card, i) => {
        const offset = offsetOf(i), center = offset === 0, hidden = Math.abs(offset) > 2;
        const embed = center && preview && card.state === 'live' ? matchBroadcasts(card.match).find(link => link.embedUrl)?.embedUrl : null;
        const src = embed ? (() => { const u = new URL(embed); u.searchParams.set('mute', '1'); u.searchParams.set('autoplay', '1'); u.searchParams.set('controls', '0'); return u.href; })() : null;
        const { match } = card;
        return <motion.article key={card.match.id} className={`featured-slide${center ? ' is-center' : ''}`} aria-hidden={!center}
          aria-roledescription="slide" aria-label={`${i + 1} of ${count}`}
          initial={false}
          animate={{ x: `${offset * 46}%`, scale: center ? 1 : 1 - Math.min(2, Math.abs(offset)) * 0.14, opacity: hidden ? 0 : center ? 1 : 0.55, zIndex: 10 - Math.abs(offset) }}
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 32 }}
          style={{ pointerEvents: hidden ? 'none' : 'auto' }}
          onClick={() => !center && setActive(i)}>
          <div className="featured-media">
            {card.image && <img src={card.image} alt="" />}
            <div className="featured-media-shade" />
            {!src && <div className="featured-versus" aria-hidden="true"><CollegeLogo code={code(match.team1)} size="lg" /><b>VS</b><CollegeLogo code={code(match.team2)} size="lg" /></div>}
            {src && <iframe src={src} title={`Preview: ${match.team1?.name} vs ${match.team2?.name}`} allow="autoplay; encrypted-media" tabIndex={-1} />}
            {card.state === 'live' ? <span className="watch-badge watch-badge-live"><i />LIVE</span> : card.state === 'waiting' ? <span className="watch-badge watch-badge-soon">Starting soon</span> : null}
            {center && <button type="button" className="featured-hit" onClick={() => onOpen(card)} aria-label={`Watch ${match.team1?.name} vs ${match.team2?.name}`}><span className="watch-play"><Play size={24} /></span></button>}
          </div>
          {center && <div className="featured-info">
            <div className="featured-channel"><span className="watch-avatar">{card.image && <img src={card.image} alt="" />}</span><span><strong>{card.gameLabel}</strong><small>{cardStatus(card)}</small></span></div>
            <h2>{match.team1?.name || 'Awaiting team'} <span>vs</span> {match.team2?.name || 'Awaiting team'}</h2>
            <p className="featured-score"><strong>{match.score.team1Score}</strong><span>–</span><strong>{match.score.team2Score}</strong></p>
            <div className="featured-tags">{[card.bracket.title, match.roundName, match.matchFormat, card.mode].filter(Boolean).map(tag => <span key={tag}>{tag}</span>)}</div>
            <button type="button" className="arena-primary" onClick={() => onOpen(card)}><Play size={16} />{card.state === 'live' ? 'Watch now' : 'Details'}</button>
          </div>}
        </motion.article>;
      })}
    </div>
    {count > 1 && <>
      <button type="button" className="featured-arrow is-prev" aria-label="Previous match" onClick={() => go(-1)}><ChevronLeft size={24} /></button>
      <button type="button" className="featured-arrow is-next" aria-label="Next match" onClick={() => go(1)}><ChevronRight size={24} /></button>
      <div className="featured-dots" role="tablist" aria-label="Choose a featured match">{cards.map((card, i) =>
        <button key={card.match.id} type="button" role="tab" aria-selected={i === active} aria-label={`Show match ${i + 1}`} onClick={() => setActive(i)} />)}</div>
    </>}
  </section>;
}
