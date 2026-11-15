import React, { useEffect, useState } from 'react';
import type { Match, MatchTimelineEvent } from '../../lib/types';
import { firestoreService } from '../../lib/firestore';
import { matchMvp, MAX_TIMELINE_EVENTS, mvpCandidates, sortedTimeline, timelineEvent, TIMELINE_TYPES } from '../../lib/matchHighlights';
import { useToast } from '../ui/Toast';
import { Plus, Save, Trash2 } from '../ui/Icons';
import { errorMessage } from '../../lib/errors';
import '../spectator/matchHighlights.css';

/** Organizer entry for a match's key moments and its MVP. Viewers see them on the watch page. */
export const MatchHighlightsEditor: React.FC<{ match: Match }> = ({ match }) => {
  const { showToast } = useToast();
  const [events, setEvents] = useState<MatchTimelineEvent[]>([]);
  const [draft, setDraft] = useState({ time: '', type: 'first-blood', team: '', text: '' });
  const [mvp, setMvp] = useState('');
  const [highlight, setHighlight] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const candidates = mvpCandidates(match);
  const teams = [match.team1, match.team2].filter(t => t?.collegeCode && !t.isBye);

  useEffect(() => {
    setEvents(sortedTimeline(match.timelineEvents || []));
    const saved = typeof match.mvp === 'object' ? match.mvp : undefined;
    setMvp(saved?.ign || ''); setHighlight(saved?.statsHighlight || '');
    setDraft({ time: '', type: 'first-blood', team: '', text: '' }); setError('');
  }, [match.id]);

  const add = (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    try {
      if (events.length >= MAX_TIMELINE_EVENTS) throw new Error(`A match timeline holds up to ${MAX_TIMELINE_EVENTS} events.`);
      // Validate here, not inside the state updater: React runs updaters later, outside this try.
      const next = sortedTimeline([...events, timelineEvent(match, draft)]);
      setEvents(next);
      setDraft(d => ({ ...d, time: '', text: '' }));
    } catch (err) { setError(errorMessage(err, 'Check the event.')); }
  };
  const save = async () => {
    setError(''); setSaving(true);
    try {
      await firestoreService.saveMatchHighlights(match.id, sortedTimeline(events), matchMvp(match, mvp, highlight));
      showToast('Timeline and MVP saved to the published match.', 'success');
    } catch (err) { setError(errorMessage(err, 'Could not save. Retry.')); }
    finally { setSaving(false); }
  };

  return <section className="rounded-[4px] bg-(--surface-soft) border border-(--border) p-4 highlights-editor" aria-labelledby="highlights-title">
    <div>
      <h3 id="highlights-title" className="text-sm font-bold text-(--text-primary)">Timeline and MVP</h3>
      <p className="text-xs text-(--text-muted)">Record key moments with their game time. Viewers see them on the match page, in time order.</p>
    </div>

    <form className="highlights-editor-add module-form" onSubmit={add}>
      <label>Game time<input value={draft.time} onChange={e => setDraft({ ...draft, time: e.target.value })} placeholder="12:35" inputMode="numeric" maxLength={6} aria-describedby="highlights-time-hint" /></label>
      <label>What happened<select value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })}>{TIMELINE_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
      <label>Team<select value={draft.team} onChange={e => setDraft({ ...draft, team: e.target.value })}>
        <option value="">Both or neither</option>{teams.map(t => <option key={t!.id} value={t!.collegeCode}>{t!.name} ({t!.collegeCode})</option>)}
      </select></label>
      <label className="span-all">Description<input value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} maxLength={200} placeholder="Takes the first Lord after a won fight at mid" /></label>
      <span id="highlights-time-hint" className="field-hint span-all">Minutes:seconds from the in-game clock.</span>
      <div className="span-all"><button className="arena-outline"><Plus size={16} />Add event</button></div>
    </form>

    {events.length > 0 ? <ul aria-label="Recorded events">{events.map((event, i) => <li key={`${event.time}-${i}`}>
      <time>{event.time}</time>
      <p><strong>{event.title}</strong>{event.team ? ` · ${event.team}` : ''} · {event.text}</p>
      <button type="button" className="quiet-icon-button" aria-label={`Remove ${event.title} at ${event.time}`} onClick={() => setEvents(list => list.filter((_, n) => n !== i))}><Trash2 size={16} /></button>
    </li>)}</ul> : <p className="text-xs text-(--text-muted)">No events recorded for this match yet.</p>}

    <div className="module-form operations-two-fields">
      <label>Match MVP
        <select value={mvp} onChange={e => setMvp(e.target.value)} disabled={!candidates.length}>
          <option value="">{candidates.length ? 'No MVP' : 'Add rosters to name an MVP'}</option>
          {candidates.map(c => <option key={`${c.teamCode}-${c.ign}`} value={c.ign}>{c.ign} · {c.teamCode}{c.role ? ` · ${c.role}` : ''}{c.kda ? ` · ${c.kda}` : ''}</option>)}
        </select>
      </label>
      <label>MVP highlight (optional)<input value={highlight} onChange={e => setHighlight(e.target.value)} maxLength={120} placeholder="Triple kill in the deciding fight" disabled={!mvp} /></label>
    </div>
    <p className="field-hint">The MVP is shown publicly by in-game name only.</p>

    {error && <p className="module-error" role="alert">{error}</p>}
    <div><button type="button" className="arena-primary" onClick={() => void save()} disabled={saving}><Save size={16} />{saving ? 'Saving…' : 'Save timeline and MVP'}</button></div>
  </section>;
};
