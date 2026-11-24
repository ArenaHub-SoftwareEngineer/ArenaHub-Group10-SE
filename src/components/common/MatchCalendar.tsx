import React from 'react';
import { manilaToday, scheduleDate, timeOrder } from '../../lib/calendar';
import type { Match } from '../../lib/types';
import { ChevronLeft, ChevronRight } from '../ui/Icons';
import { matchName } from '../../lib/matchName';
import { clock24, clockLabel, scheduleTimeLabel } from '../../lib/matchTiming';

const monthLabel = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const dayLabel = new Intl.DateTimeFormat('en', { dateStyle: 'full', timeZone: 'UTC' });
const dayTitle = new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PREVIEW_LIMIT = 2;
const SLOT_COLORS = 8;

export const scheduleDayTitle = (date: string) => dayTitle.format(new Date(`${date}T00:00:00Z`));

export function ScheduleDayAgenda({ count, children }: { count: number; children: React.ReactNode }) {
  return <section className="schedule-day-agenda" aria-label="Scheduled matches">
    <h3>Scheduled matches <span>{count}</span></h3>
    <div className="schedule-day schedule-day-entries" tabIndex={count ? 0 : undefined}>
      {count ? children : <p className="schedule-empty">No matches on this date.</p>}
    </div>
  </section>;
}

export function calendarMonth(date: string): Date {
  return new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
}

export function scheduleMatchTitle(match: Match): string {
  if (match.lobby) return `${match.roundName} · ${match.lobby.squads} squads`;
  if (!match.team1 && !match.team2) return 'Teams to be determined';
  return `${match.team1?.name || 'To be determined'} vs ${match.team2?.name || 'To be determined'}`;
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

export function MatchCalendar({ month, events, selectedDay, onMonthChange, onSelectDay, variant = 'draft' }: {
  month: Date;
  events: Map<string, Match[]>;
  selectedDay?: string;
  onMonthChange: (month: Date) => void;
  onSelectDay: (date: string) => void;
  variant?: 'draft' | 'browse' | 'manage';
}) {
  const manage = variant === 'manage';
  const slotColors = new Map([...events.keys()].sort().flatMap(date => events.get(date) ?? [])
    .map((match, index) => [match.id, index % SLOT_COLORS]));
  const today = manilaToday();
  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const firstWeekday = month.getUTCDay();
  const days = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return <div className={`draft-calendar schedule-month-${variant}`}>
    <div className="draft-calendar-header">
      <h3 aria-live="polite">{monthLabel.format(month)}</h3>
      <div>
        <button type="button" className="arena-outline" onClick={() => onMonthChange(calendarMonth(today))}>Today</button>
        <button type="button" className="quiet-icon-button" aria-label="Previous month" onClick={() => onMonthChange(new Date(Date.UTC(year, monthIndex - 1, 1)))}><ChevronLeft size={18} /></button>
        <button type="button" className="quiet-icon-button" aria-label="Next month" onClick={() => onMonthChange(new Date(Date.UTC(year, monthIndex + 1, 1)))}><ChevronRight size={18} /></button>
      </div>
    </div>
    <div className="draft-calendar-grid" role="group" aria-label={monthLabel.format(month)}>
      {weekdays.map(day => <span className="draft-calendar-weekday" key={day}>
        {manage && <span className="schedule-weekday-full">{day}</span>}
        <span className={manage ? 'schedule-weekday-short' : undefined}>{day.slice(0, 3)}</span>
      </span>)}
      {Array.from({ length: Math.ceil((days + firstWeekday) / 7) * 7 }, (_, index) => {
        const day = index - firstWeekday + 1;
        if (day < 1 || day > days) return <span key={index} className="draft-calendar-blank" aria-hidden="true" />;
        const date = new Date(Date.UTC(year, monthIndex, day));
        const key = date.toISOString().slice(0, 10);
        const entries = events.get(key) ?? [];
        const previews = entries.slice(0, PREVIEW_LIMIT);
        return <button type="button" key={key} className="draft-calendar-day" onClick={() => onSelectDay(key)} aria-haspopup="dialog"
          aria-pressed={selectedDay ? key === selectedDay : undefined} aria-current={key === today ? 'date' : undefined} aria-label={`${dayLabel.format(date)}${entries.length ? `, ${entries.length} scheduled` : ''}`}>
          {manage ? <span className="schedule-date-line">
              <span className="draft-calendar-date">{day}</span>
              {entries.length > 0 && <span className="schedule-calendar-count" aria-hidden="true">{entries.length} <span>{entries.length === 1 ? 'match' : 'matches'}</span></span>}
            </span> : <span className="draft-calendar-date">{day}</span>}
          {previews.map(match => {
            const start = timeOrder(match.scheduledTime || '');
            const time = manage ? scheduleTimeLabel(match) : clockLabel(start);
            const name = matchName(match);
            return <span className={`schedule-slot${manage ? ' schedule-match-preview' : ''}`} data-schedule-color={slotColors.get(match.id)}
              key={match.id} title={`${scheduleTimeLabel(match)} · ${scheduleMatchTitle(match)}`}>
              <span className="schedule-slot-label">
                <time>{time}</time>
                {manage ? <strong>{match.lobby || match.team1 || match.team2 ? scheduleMatchTitle(match) : name}</strong> : <> · {name}</>}
              </span>
              <time className="schedule-slot-compact">{clock24(start)}</time>
            </span>;
          })}
          {entries.length > PREVIEW_LIMIT && <span className="schedule-match-more">+{entries.length - PREVIEW_LIMIT} more</span>}
        </button>;
      })}
    </div>
  </div>;
}
