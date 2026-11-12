import { BracketDraft, Match } from './types';
export function csvCell(value: unknown) {
  const text = String(value ?? '');
  return '"' + (/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replace(/"/g, '""') + '"';
}
export function scheduleCSV(matches: Match[], context?: ReadonlyMap<string, BracketDraft>) {
  return [[...(context ? ['Game', 'Bracket'] : []), 'Match', 'Team 1', 'Team 2', 'Status', 'Date', 'Time', 'Score'], ...matches.map(m => [...(context ? [context.get(m.id)?.gameName, context.get(m.id)?.title] : []), m.matchNumber, m.team1?.name || 'TBD', m.team2?.name || 'TBD', m.status, m.scheduledDate, m.scheduledTime, `${m.score.team1Score}-${m.score.team2Score}`])].map(row => row.map(csvCell).join(',')).join('\r\n');
}
export function downloadSchedule(matches: Match[], context?: ReadonlyMap<string, BracketDraft>) {
  const url = URL.createObjectURL(new Blob(['\uFEFF' + scheduleCSV(matches, context)], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'arenahub-match-schedule.csv'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
