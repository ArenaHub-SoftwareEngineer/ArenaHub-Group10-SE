import React, { useMemo, useState } from 'react';
import type { Match } from '../../lib/types';
import { sortedTimeline, TIMELINE_TYPES } from '../../lib/matchHighlights';
import { Crown, Flame, Shield, Skull, Target, Zap } from '../ui/Icons';
import './matchHighlights.css';

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = { 'first-blood': Skull, tower: Shield, lord: Crown, objective: Target, ace: Flame };

/**
 * Key moments an organizer recorded for this match (Matches page → Timeline and MVP).
 * Shows only what was entered; it never invents events. Renders nothing when there are none.
 */
export const MatchTimeline: React.FC<{ match: Match; className?: string }> = ({ match, className = '' }) => {
  const events = useMemo(() => { try { return sortedTimeline(match.timelineEvents || []); } catch { return match.timelineEvents || []; } }, [match.timelineEvents]);
  const types = TIMELINE_TYPES.filter(t => events.some(e => e.type === t.id));
  const [filter, setFilter] = useState<string>('all');
  if (!events.length) return null;
  const shown = filter === 'all' ? events : events.filter(e => e.type === filter);

  return <section className={`match-timeline ${className}`} aria-labelledby={`timeline-${match.id}`}>
    <header>
      <h3 id={`timeline-${match.id}`}>Match timeline</h3>
      {types.length > 1 && <div className="match-timeline-filters" role="group" aria-label="Filter events">
        <button type="button" className="ah-chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
        {types.map(t => <button key={t.id} type="button" className="ah-chip" aria-pressed={filter === t.id} onClick={() => setFilter(t.id)}>{t.label}</button>)}
      </div>}
    </header>
    <ol>{shown.map((event, i) => {
      const Icon = ICONS[event.type || ''] || Zap;
      return <li key={`${event.time}-${i}`}>
        <time>{event.time}</time>
        <span className={`match-timeline-icon type-${event.type || 'other'}`} aria-hidden="true"><Icon size={14} /></span>
        <p><strong>{event.title || 'Event'}</strong>{event.team && <span className="match-timeline-team">{event.team}</span>}<span>{event.text}</span></p>
      </li>;
    })}</ol>
  </section>;
};
