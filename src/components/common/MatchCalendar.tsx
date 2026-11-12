import React from 'react';
import { manilaToday, scheduleDate, timeOrder } from '../../lib/calendar';
import type { Match } from '../../lib/types';
import { ChevronLeft, ChevronRight } from '../ui/Icons';

const monthLabel = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const dayLabel = new Intl.DateTimeFormat('en', { dateStyle: 'full', timeZone: 'UTC' });
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function calendarMonth(date: string): Date {
  return new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
}

export function scheduledMatchesByDay(matches: Match[], today = manilaToday()) {
  const events = new Map<string, Match[]>();
  for (const match of [...matches].sort((a, b) => timeOrder(a.scheduledTime || '') - timeOrder(b.scheduledTime || ''))) {
    const date = scheduleDate(match.scheduledDate || '', today);
    if (!date || timeOrder(match.scheduledTime || '') === 9999) continue;
    const entries = events.get(date) ?? [];
    entries.push(match);
    events.set(date, entries);
  }
  return events;
}

export function MatchCalendar({ month, events, selectedDay, onMonthChange, onSelectDay }: {
  month: Date;
  events: Map<string, Match[]>;
  selectedDay?: string;
  onMonthChange: (month: Date) => void;
  onSelectDay: (date: string) => void;
}) {
  const today = manilaToday();
  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const firstWeekday = month.getUTCDay();
  const days = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return <div className="draft-calendar">
    <div className="draft-calendar-header">
      <h3 aria-live="polite">{monthLabel.format(month)}</h3>
      <div>
        <button type="button" className="arena-outline" onClick={() => onMonthChange(new Date(`${today.slice(0, 7)}-01T00:00:00Z`))}>Today</button>
        <button type="button" className="quiet-icon-button" aria-label="Previous month" onClick={() => onMonthChange(new Date(Date.UTC(year, monthIndex - 1, 1)))}><ChevronLeft size={18} /></button>
        <button type="button" className="quiet-icon-button" aria-label="Next month" onClick={() => onMonthChange(new Date(Date.UTC(year, monthIndex + 1, 1)))}><ChevronRight size={18} /></button>
      </div>
    </div>
    <div className="draft-calendar-grid" aria-label={monthLabel.format(month)}>
      {weekdays.map(day => <span className="draft-calendar-weekday" key={day}>{day}</span>)}
      {Array.from({ length: Math.ceil((days + firstWeekday) / 7) * 7 }, (_, index) => {
        const day = index - firstWeekday + 1;
        if (day < 1 || day > days) return <span key={index} className="draft-calendar-blank" aria-hidden="true" />;
        const date = new Date(Date.UTC(year, monthIndex, day));
        const key = date.toISOString().slice(0, 10);
        const entries = events.get(key) ?? [];
        return <button type="button" key={index} className="draft-calendar-day" onClick={() => onSelectDay(key)}
          aria-pressed={selectedDay ? key === selectedDay : undefined} aria-current={key === today ? 'date' : undefined} aria-label={`${dayLabel.format(date)}${entries.length ? `, ${entries.length} scheduled` : ''}`}>
          <span className="draft-calendar-date">{day}</span>
          {entries.slice(0, 2).map(match => <span className="draft-calendar-event" key={match.id}>
            {match.scheduledTime} · {match.matchNumber}
          </span>)}
          {entries.length > 2 && <span className="draft-calendar-more">+{entries.length - 2} more</span>}
          {entries.length > 0 && <span className="draft-calendar-dot" aria-hidden="true" />}
        </button>;
      })}
    </div>
  </div>;
}
