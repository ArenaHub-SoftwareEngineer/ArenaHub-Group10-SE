import React, { useState } from 'react';
import { manilaToday, timeOrder } from '../../lib/calendar';
import { parseStreamSchedule, type MatchScheduleUpdate } from '../../lib/streamSchedule';
import type { Match } from '../../lib/types';
import { calendarMonth, dayLabel, MatchCalendar, scheduledMatchesByDay } from '../common/MatchCalendar';
import { Modal } from '../ui/Modal';
import { Req } from '../ui/Req';
import { errorMessage } from '../../lib/errors';

export function DraftScheduleCalendar({ matches, onApply }: {
  matches: Match[];
  onApply: (updates: MatchScheduleUpdate[]) => void;
}) {
  const today = manilaToday();
  const [month, setMonth] = useState(() => calendarMonth(today));
  const [editor, setEditor] = useState<{ date: string; matchId: string; time: string } | null>(null);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const editable = matches.filter(match => match.status !== 'live' && match.status !== 'completed');
  const events = scheduledMatchesByDay(matches, today);

  function openDay(date: string) {
    setError('');
    setFeedback('');
    setEditor({ date, matchId: '', time: '' });
  }

  function selectMatch(matchId: string) {
    const match = editable.find(option => option.id === matchId);
    const time = timeOrder(match?.scheduledTime || '');
    setEditor(current => current && {
      ...current,
      matchId,
      time: time === 9999 ? '' : `${String(Math.floor(time / 60)).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}`,
    });
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editor) return;
    try {
      const updates = parseStreamSchedule(`${editor.matchId},${editor.date},${editor.time}`, matches);
      onApply(updates);
      setMonth(calendarMonth(editor.date));
      setFeedback(`Match scheduled for ${dayLabel.format(new Date(`${editor.date}T00:00:00Z`))} at ${editor.time} Manila time.`);
      setEditor(null);
    } catch (err) {
      setError(errorMessage(err, 'Could not add this match to the schedule.'));
    }
  }

  return <div className="draft-calendar">
    <p className="studio-muted">Choose a date to add or move a match. Times use Manila time.</p>
    <MatchCalendar month={month} events={events} onMonthChange={setMonth} onSelectDay={openDay} />
    {feedback && <p className="settings-notice" role="status">{feedback}</p>}
    <Modal open={editor !== null} onClose={() => setEditor(null)} title="Schedule a match" description="Changes are added to this bracket draft in Manila time.">
      {editor && <form className="module-form" onSubmit={save}>
        {(events.get(editor.date)?.length ?? 0) > 0 && <ul className="stream-schedule-preview" aria-label="Matches already scheduled">
          {events.get(editor.date)?.map(match => <li key={match.id}>
            <strong>{match.matchNumber} · {match.team1?.name || 'TBD'} vs {match.team2?.name || 'TBD'}</strong>
            <span>{match.scheduledTime}</span>
          </li>)}
        </ul>}
        {editable.length ? <>
          <label><Req>Match</Req>
            <select value={editor.matchId} required onChange={event => selectMatch(event.target.value)}>
              <option value="">Choose a match</option>
              {editable.map(match => <option key={match.id} value={match.id}>
                {match.matchNumber} · {match.team1?.name || 'TBD'} vs {match.team2?.name || 'TBD'}
              </option>)}
            </select>
          </label>
          <div className="draft-calendar-fields">
            <label><Req>Date</Req><input type="date" required value={editor.date} onChange={event => setEditor({ ...editor, date: event.target.value })} /></label>
            <label><Req>Time</Req><input type="time" required value={editor.time} onChange={event => setEditor({ ...editor, time: event.target.value })} /></label>
          </div>
          {error && <p className="module-error" role="alert">{error}</p>}
        </> : <p className="studio-muted">All matches in this draft have already started or finished.</p>}
        <footer className="dialog-actions">
          <button type="button" className="arena-outline" onClick={() => setEditor(null)}>{editable.length ? 'Cancel' : 'Close'}</button>
          {editable.length > 0 && <button className="arena-primary" type="submit">Save to draft</button>}
        </footer>
      </form>}
    </Modal>
  </div>;
}
