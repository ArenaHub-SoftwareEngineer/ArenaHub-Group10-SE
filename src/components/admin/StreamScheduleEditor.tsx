import React, { useRef, useState } from 'react';
import { parseStreamSchedule, type MatchScheduleUpdate } from '../../lib/streamSchedule';
import type { Match } from '../../lib/types';
import { DraftScheduleCalendar } from './DraftScheduleCalendar';
import { Calendar, Sparkles, Upload } from '../ui/Icons';
import { errorMessage } from '../../lib/errors';

export function StreamScheduleEditor({ matches, onApply, game, includeStarted = false }: {
  matches: Match[];
  game?: { id?: string; name?: string };
  onApply: (updates: MatchScheduleUpdate[]) => void | Promise<void>;
  includeStarted?: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function apply(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !source.trim()) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const updates = parseStreamSchedule(source, matches, undefined, includeStarted);
      await onApply(updates);
      setStatus(`${updates.length} ${updates.length === 1 ? 'match' : 'matches'} scheduled.`);
      setSource('');
    } catch (err) {
      setError(errorMessage(err, 'Could not apply the schedule.'));
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setError('');
    setStatus('');
    if (file.size > 100_000) {
      setError('Choose a CSV file smaller than 100 KB.');
      return;
    }
    try { setSource(await file.text()); }
    catch { setError('Could not read the CSV file.'); }
  }

  return <section className="arena-panel stream-schedule-editor">
    <h2><Calendar size={18} /> Match schedule</h2>
    <details className="draft-schedule-import">
      <summary><Sparkles size={16} /> Schedule from a prompt</summary>
      <form className="module-form schedule-prompt-form" onSubmit={event => void apply(event)}>
        <label className="stream-schedule-source">Schedule instructions or CSV
          <textarea rows={3} value={source} disabled={busy} maxLength={100_000}
            placeholder="Schedule all matches on Dec 4 starting at 8 AM every 90 minutes"
            onChange={event => { setSource(event.target.value); setError(''); setStatus(''); }} />
        </label>
        <p className="studio-muted">Use a match or round number, a date, and a time. For CSV use match_id, date, time, end_time.</p>
        {error && <p className="module-error" role="alert">{error}</p>}
        {status && <p className="settings-notice" role="status">{status}</p>}
        <div className="page-actions">
          <button className="arena-primary" type="submit" disabled={busy || !source.trim()}>{busy ? 'Applying…' : 'Apply schedule'}</button>
          <button className="arena-outline" type="button" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={16} /> Upload CSV</button>
          <input type="file" accept=".csv,text/csv" hidden ref={fileInput} onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void upload(file);
          }} />
        </div>
      </form>
    </details>
    <DraftScheduleCalendar matches={matches} onApply={onApply} game={game} includeStarted={includeStarted} />
  </section>;
}
