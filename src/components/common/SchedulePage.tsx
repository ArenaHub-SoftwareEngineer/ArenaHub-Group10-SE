import React, { useState } from 'react';
import type { BracketDraft, Match } from '../../lib/types';
import { manilaToday } from '../../lib/calendar';
import { isScheduleMatch } from '../../lib/streamSchedule';
import { CalendarDays, Edit2, Radio } from '../ui/Icons';
import { Modal } from '../ui/Modal';
import { calendarMonth, MatchCalendar, ScheduleDayAgenda, scheduleDayTitle, scheduledMatchesByDay, scheduleMatchTitle } from './MatchCalendar';
import { matchName } from '../../lib/matchName';
import { scheduleTimeLabel } from '../../lib/matchTiming';
import './schedule.css';

const STATUS_LABEL: Record<Match['status'], string> = {
  live: 'Live', upcoming: 'Upcoming', completed: 'Completed', alert: 'On hold', 'pre-match': 'Pre-match',
};

export function PublishedScheduleDialog({ open, onClose, bracket, onSelect, onManage }: {
  open: boolean;
  onClose: () => void;
  bracket?: BracketDraft;
  onSelect: (match: Match) => void;
  onManage?: (id: string) => void;
}) {
  const [date, setDate] = useState('');
  const close = () => { setDate(''); onClose(); };
  return <Modal open={open} title={date ? scheduleDayTitle(date) : 'Match schedule'}
    className={date ? 'schedule-day-dialog' : 'viewer-schedule-dialog'} onClose={close}
    description={bracket ? `${bracket.title} · Manila time` : 'Manila time'}>
    {open && bracket && <>
      {onManage && !date && <div className="page-actions schedule-dialog-actions"><button type="button" className="arena-outline"
        onClick={() => { close(); onManage(bracket.id); }}><Edit2 size={16} /> Manage schedule</button></div>}
      <PublishedCalendar key={bracket.id} brackets={[bracket]} onSelect={match => { close(); onSelect(match); }} dialog={{ date, onDateChange: setDate }} />
    </>}
    {open && !bracket && <p className="schedule-empty">No published schedule is available for this bracket.</p>}
  </Modal>;
}

function PublishedCalendar({ brackets, onSelect, dialog }: {
  brackets: BracketDraft[];
  onSelect: (match: Match) => void;
  dialog?: { date: string; onDateChange: (date: string) => void };
}) {
  const today = manilaToday();
  const events = scheduledMatchesByDay(brackets.flatMap(bracket => bracket.matches).filter(isScheduleMatch), today);
  const dates = [...events.keys()].sort();
  const first = dates.find(date => date >= today) ?? dates.at(-1) ?? today;
  const [chosenMonth, setMonth] = useState<Date>();
  const month = chosenMonth ?? calendarMonth(first);
  const [date, setDate] = useState('');
  const selectedDate = dialog?.date ?? date;
  const selectDate = dialog?.onDateChange ?? setDate;
  const dayMatches = events.get(selectedDate) ?? [];
  const titlesByMatch = new Map(brackets.flatMap(bracket => bracket.matches.map(match => [match.id, bracket.title] as const)));

  const agenda = <ScheduleDayAgenda count={dayMatches.length}>
    <ul>{dayMatches.map(match => <li key={match.id} className="schedule-entry">
      <time>{scheduleTimeLabel(match)}</time>
      <div><strong>{scheduleMatchTitle(match)}</strong><small>{[brackets.length > 1 && titlesByMatch.get(match.id), matchName(match), match.lobby ? undefined : match.roundName, match.matchFormat].filter(Boolean).join(' · ')}</small></div>
      {match.status === 'live' ? <button type="button" className="arena-outline arena-sm" onClick={() => onSelect(match)}><Radio size={14} /> Watch live</button>
        : <small className="schedule-status" data-status={match.status}>{match.status === 'upcoming' && selectedDate < today ? 'Scheduled' : STATUS_LABEL[match.status]}</small>}
    </li>)}</ul>
  </ScheduleDayAgenda>;

  if (dialog && selectedDate) return <>
    <button type="button" className="arena-outline schedule-back" onClick={() => selectDate('')}>Back to calendar</button>
    {agenda}
  </>;

  if (!dates.length) return <div className="schedule-empty schedule-empty-panel">
    <CalendarDays size={24} aria-hidden="true" /><strong>No match times published yet</strong>
  </div>;

  return <>
    <MatchCalendar variant="browse" month={month} events={events} selectedDay={selectedDate} onSelectDay={selectDate} onMonthChange={setMonth} />
    {!dialog && <Modal open={Boolean(date)} title={date ? scheduleDayTitle(date) : 'Match schedule'} description="Manila time"
      className="schedule-day-dialog" onClose={() => setDate('')}>{agenda}</Modal>}
  </>;
}

export function SchedulePage({ brackets, onSelect, onManage }: {
  brackets: BracketDraft[];
  onSelect: (match: Match) => void;
  onManage?: (id?: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const selected = brackets.find(bracket => bracket.id === filter);
  const visible = selected ? [selected] : brackets;
  return <div className="module-page schedule-page">
    <header className="dashboard-page-heading with-actions">
      <div>
        <h1>Match schedule</h1>
        <p>Published match dates and times in Manila time.</p>
      </div>
      {onManage && <div className="page-actions">
        <button type="button" className="arena-primary" onClick={() => onManage(selected?.id)}><Edit2 size={16} /> Manage schedule</button>
      </div>}
    </header>
    {brackets.length > 0 && <label className="module-form schedule-bracket-choice">Tournament
      <select value={selected?.id || ''} onChange={event => setFilter(event.target.value)}>
        <option value="">All tournaments</option>
        {brackets.map(bracket => <option key={bracket.id} value={bracket.id}>{bracket.title} · {bracket.gameName}</option>)}
      </select>
    </label>}
    <PublishedCalendar key={selected?.id ?? 'all'} brackets={visible} onSelect={onSelect} />
  </div>;
}
