import React, { useEffect, useRef, useState } from 'react';
import { manilaToday } from '../../lib/calendar';
import { canEditMatchSchedule, hasMatchSchedule, parseStreamSchedule, type MatchScheduleUpdate } from '../../lib/streamSchedule';
import type { Match } from '../../lib/types';
import { calendarMonth, MatchCalendar, ScheduleDayAgenda, scheduleDayTitle, scheduledMatchesByDay, scheduleMatchTitle } from '../common/MatchCalendar';
import { Modal } from '../ui/Modal';
import { Req } from '../ui/Req';
import { TimeField } from '../ui/TimeField';
import { AlertTriangle, CalendarDays, Clock, Edit2, Trash2 } from '../ui/Icons';
import { matchTitle } from '../common/MatchPicker';
import { errorMessage } from '../../lib/errors';
import { matchName } from '../../lib/matchName';
import { BREAK_MINUTES, GAME_TIMING_LABEL, clock24, clockLabel, durationLabel, endRangeLabel, estimateMatch, matchSlot, overlaps, parseClock, rangeLabel, scheduleTimeLabel, slotLabel, timingGame, type MatchEstimate } from '../../lib/matchTiming';

type Editor = { date: string; matchId: string; time: string; end: string; endEdited: boolean; editing: boolean };
const DAY = 24 * 60;

export function DraftScheduleCalendar({ matches, onApply, game, published = false, includeStarted = false }: {
  matches: Match[];
  onApply: (updates: MatchScheduleUpdate[]) => void | Promise<void>;
  published?: boolean;
  includeStarted?: boolean;
  /** The bracket's game. Draft matches carry a placeholder gameId, so the estimate needs this. */
  game?: { id?: string; name?: string };
}) {
  const today = manilaToday();
  const events = scheduledMatchesByDay(matches, today);
  const [chosenMonth, setMonth] = useState<Date>();
  const scheduledDates = [...events.keys()].sort();
  const month = chosenMonth ?? calendarMonth(scheduledDates.find(date => date >= today) ?? scheduledDates.at(-1) ?? today);
  const [selectedDay, setSelectedDay] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dateInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editor?.editing) dateInput.current?.focus();
  }, [editor?.editing, editor?.matchId]);
  const editable = matches.filter(match => canEditMatchSchedule(match, includeStarted));
  const unscheduled = editable.filter(match => !hasMatchSchedule(match, today));
  const gameOf = (match: Match) => timingGame(game?.id, game?.name, match.gameId, match.gameMode);
  const estimateFor = (matchId: string, time: string) => {
    const match = editable.find(option => option.id === matchId), start = parseClock(time);
    return match && start !== null ? estimateMatch(start, match.matchFormat, gameOf(match)) : null;
  };
  // The end box fills itself with the longest typical length until the organizer types their own.
  const suggestedEnd = (matchId: string, time: string) => {
    const estimate = estimateFor(matchId, time);
    return estimate && estimate.latestEnd < DAY ? clock24(estimate.latestEnd) : '';
  };

  function openEditor(date: string, match?: Match) {
    setError('');
    setFeedback('');
    const saved = match ? matchSlot(match) : null;
    setEditor({ date, matchId: match?.id || '', time: saved ? clock24(saved.start) : '',
      end: saved?.endSet ? clock24(saved.end) : '', endEdited: Boolean(saved?.endSet), editing: Boolean(match) });
  }

  function openDay(date: string) {
    setSelectedDay(date);
    setMonth(calendarMonth(date));
    openEditor(date);
  }

  function selectMatch(matchId: string) {
    setEditor(current => {
      if (!current) return current;
      // An end typed before any match was chosen is kept; one from another match is not.
      const keep = current.endEdited && !current.matchId;
      return { ...current, matchId, end: keep ? current.end : suggestedEnd(matchId, current.time), endEdited: keep };
    });
  }

  async function remove(match: Match) {
    if (saving) return;
    setError('');
    setFeedback('');
    setSaving(true);
    try {
      await onApply([{ id: match.id, scheduledDate: '', scheduledTime: '', scheduledEndTime: '' }]);
      setFeedback(`${matchName(match)} removed from the schedule.`);
    } catch (err) {
      setError(errorMessage(err, 'Could not remove this match from the schedule.'));
    } finally {
      setSaving(false);
    }
  }

  function setStart(time: string) {
    setEditor(current => current && { ...current, time, end: current.endEdited ? current.end : suggestedEnd(current.matchId, time) });
  }

  function setEnd(end: string) {
    setEditor(current => current && { ...current, end, endEdited: end !== '' });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editor || saving) return;
    if (endProblem) { setError(endProblem); return; }
    setSaving(true);
    try {
      const updates = parseStreamSchedule(`${editor.matchId},${editor.date},${editor.time},${editor.end}`, matches, today, includeStarted);
      await onApply(updates);
      setMonth(calendarMonth(editor.date));
      setSelectedDay(editor.date);
      openEditor(editor.date);
      const start = parseClock(editor.time) ?? 0, end = parseClock(editor.end);
      const date = scheduleDayTitle(editor.date);
      setFeedback(`Match scheduled for ${date}, ${end === null ? clockLabel(start) : rangeLabel(start, end)} Manila time.`);
    } catch (err) {
      setError(errorMessage(err, 'Could not add this match to the schedule.').replace(/^Row 1: /, ''));
    } finally {
      setSaving(false);
    }
  }

  const selected = editor ? editable.find(match => match.id === editor.matchId) : undefined;
  const start = editor?.time ? parseClock(editor.time) : null;
  const end = editor?.end ? parseClock(editor.end) : null;
  const estimate = editor ? estimateFor(editor.matchId, editor.time) : null;
  const endProblem = start !== null && end !== null && end <= start ? 'The end time must be later than the start time.' : '';
  const slot = start !== null ? { start, end: end !== null && end > start ? end : estimate?.latestEnd ?? start } : null;
  const sameDay = editor ? events.get(editor.date) ?? [] : [];
  const dayMatches = events.get(selectedDay) ?? [];
  const clashes = slot && selected ? sameDay.flatMap(match => {
    const other = match.id === selected.id ? null : matchSlot(match, gameOf(match));
    return other && overlaps(slot, other) ? [{ match, other }] : [];
  }) : [];

  function renderDay() {
    return <ul>{dayMatches.map(match => {
      const saved = matchSlot(match, gameOf(match));
      return <li key={match.id} className="schedule-entry">
        <time>{published ? scheduleTimeLabel(match) : saved ? slotLabel(saved) : match.scheduledTime}</time>
        <span><strong>{published ? scheduleMatchTitle(match) : matchTitle(match)}</strong>
          <small>{[matchName(match), match.lobby ? undefined : match.roundName, match.matchFormat].filter(Boolean).join(' · ')}</small></span>
        {canEditMatchSchedule(match, includeStarted) ? <div className="page-actions">
          <button type="button" disabled={saving} className="arena-outline arena-sm" aria-label={`Edit schedule for ${matchName(match)}`} onClick={() => openEditor(selectedDay, match)}><Edit2 size={14} aria-hidden="true" /> Edit</button>
          <button type="button" disabled={saving} className="arena-outline arena-sm arena-danger-text" aria-label={`Remove schedule for ${matchName(match)}`} onClick={() => void remove(match)}><Trash2 size={14} aria-hidden="true" /> Remove</button>
        </div> : published && <small className="schedule-status" data-status={match.status}>{match.status === 'live' ? 'Live' : 'Completed'}</small>}
      </li>;
    })}</ul>;
  }

  const showTimes = Boolean(editor?.matchId);
  return <div className="draft-calendar">
    {published ? <MatchCalendar variant="manage" month={month} events={events} selectedDay={selectedDay} onMonthChange={setMonth}
      onSelectDay={openDay} /> : <>
      <div className="schedule-toolbar">
        <p className="studio-muted">{matches.length - matches.filter(match => !hasMatchSchedule(match, today)).length} of {matches.length} matches scheduled · Manila time</p>
        <p className="studio-muted">Select a date to manage its matches.</p>
      </div>
      <details className="schedule-calendar-toggle" open>
        <summary><CalendarDays size={16} /> Calendar</summary>
        <MatchCalendar month={month} events={events} selectedDay={selectedDay} onMonthChange={setMonth} onSelectDay={openDay} />
      </details>
    </>}
    <Modal open={editor !== null} onClose={() => setEditor(null)} busy={saving} title={selectedDay ? scheduleDayTitle(selectedDay) : 'Match schedule'}
      description="Manila time" className="schedule-day-dialog">
      {editor && !editor.editing && <ScheduleDayAgenda count={dayMatches.length}>{renderDay()}</ScheduleDayAgenda>}
      {feedback && <p className="settings-notice" role="status">{feedback}</p>}
      {editor && !editor.editing && !unscheduled.length && <>
        <p className="studio-muted">All available matches are scheduled.</p>
        {error && <p className="module-error" role="alert">{error}</p>}
      </>}
      {editor && (editor.editing || unscheduled.length > 0) && <form className="module-form" onSubmit={event => void save(event)}>
        <fieldset disabled={saving} className="schedule-form-fields">
          {editor.editing ? <p><strong>{matchName(selected)} · {selected && (published ? scheduleMatchTitle(selected) : matchTitle(selected))}</strong></p>
            : <label>Unscheduled matches
              <select value={editor.matchId} onChange={event => selectMatch(event.target.value)}>
                <option value="">Choose a match to schedule</option>
                {unscheduled.map(match => <option key={match.id} value={match.id}>{matchName(match)} · {published ? scheduleMatchTitle(match) : matchTitle(match)}</option>)}
              </select>
            </label>}
          {showTimes && <div className="draft-calendar-fields has-end">
            <label className="draft-calendar-date-field"><Req>Date</Req><input ref={dateInput} type="date" required value={editor.date} onChange={event => setEditor({ ...editor, date: event.target.value })} /></label>
            <label><Req>Start time</Req><TimeField required value={editor.time} onChange={setStart} /></label>
            <label>End time<TimeField value={editor.end} onChange={setEnd} placeholder="Type or pick" /></label>
          </div>}
          {endProblem && <p className="module-error" role="alert">{endProblem}</p>}
          {estimate && <MatchEstimateNote estimate={estimate} format={selected?.matchFormat} end={end} onUseEnd={minutes => setEnd(clock24(minutes))} />}
          {clashes.length > 0 && <p className="match-estimate-clash" role="status">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>Runs at the same time as {clashes.map(({ match, other }) => `${matchName(match)} (${slotLabel(other)})`).join(', ')}. That is fine if each match has its own room and referee.</span>
          </p>}
          {error && !endProblem && <p className="module-error" role="alert">{error}</p>}
        </fieldset>
        {showTimes && <footer className="dialog-actions">
          <button type="button" className="arena-outline" disabled={saving} onClick={() => openEditor(selectedDay)}>Cancel</button>
          <button className="arena-primary" type="submit" disabled={saving || !selected || !editor.date || start === null || Boolean(endProblem)}>{published ? 'Save schedule' : 'Save to draft'}</button>
        </footer>}
      </form>}
    </Modal>
  </div>;
}

/** The typical length as a hint under the time boxes; the organizer's own end time always wins. */
function MatchEstimateNote({ estimate, format, end, onUseEnd }: { estimate: MatchEstimate; format?: string; end: number | null; onUseEnd: (minutes: number) => void }) {
  const games = estimate.gamesMin === estimate.gamesMax ? `${estimate.gamesMax} game` : `${estimate.gamesMin} or ${estimate.gamesMax} games`;
  const what = estimate.game ? `${format || 'Bo1'} ${GAME_TIMING_LABEL[estimate.game]}` : `${format || 'Bo1'} match`;
  const shortest = estimate.earliestEnd - estimate.start, longest = estimate.latestEnd - estimate.start;
  const length = shortest === longest ? durationLabel(longest) : `${durationLabel(shortest)} to ${durationLabel(longest)}`;
  const tooShort = end !== null && end > estimate.start && end < estimate.earliestEnd;
  return <div className="match-estimate" aria-live="polite">
    <Clock size={18} aria-hidden="true" />
    <div>
      <strong>A typical {what} takes {length}</strong>
      <small>
        Ends about {endRangeLabel(estimate)}. {games} of about {estimate.gameMinutes} min{estimate.gamesMax > 1 ? `, ${BREAK_MINUTES} min between games` : ''}{estimate.game ? '' : ' (game length not set)'}.
      </small>
      {tooShort && <small className="match-estimate-short">Your end time leaves {durationLabel(end - estimate.start)}, less than this match usually needs.</small>}
      {end !== estimate.latestEnd && estimate.latestEnd < DAY && <button type="button" className="match-estimate-use" onClick={() => onUseEnd(estimate.latestEnd)}>Use {clockLabel(estimate.latestEnd)} as the end time</button>}
    </div>
  </div>;
}
