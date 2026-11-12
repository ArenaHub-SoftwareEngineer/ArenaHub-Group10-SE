import React, { useState } from 'react';
import { parseStreamSchedule, type MatchScheduleUpdate } from '../../lib/streamSchedule';
import { firestoreService } from '../../lib/firestore';
import type { Match } from '../../lib/types';
import { DraftScheduleCalendar } from './DraftScheduleCalendar';
import { Calendar, Upload } from '../ui/Icons';

export function StreamScheduleEditor({ matches, publishedIds, onApplyDraft }: {
  matches: Match[];
  publishedIds?: Set<string>;
  onApplyDraft?: (updates: MatchScheduleUpdate[]) => void;
}) {
  const [source, setSource] = useState('');
  const [preview, setPreview] = useState<MatchScheduleUpdate[]>([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const example = matches.find(match => !['live', 'completed'].includes(match.status))?.matchNumber || 'M1';

  function updateSource(value: string) {
    setSource(value);
    setPreview([]);
    setError('');
    setStatus('');
  }

  async function upload(file: File) {
    if (file.size > 100_000) {
      setError('Choose a CSV file smaller than 100 KB.');
      return;
    }
    setBusy(true);
    try {
      updateSource(await file.text());
    } catch {
      setError('Could not read the CSV file.');
    } finally {
      setBusy(false);
    }
  }

  function review() {
    setError('');
    setStatus('');
    setPreview([]);
    try {
      setPreview(parseStreamSchedule(source, matches));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the schedule.');
    }
  }

  async function apply() {
    setBusy(true);
    setError('');
    try {
      const updates = parseStreamSchedule(source, matches);
      if (onApplyDraft) {
        onApplyDraft(updates);
        setStatus('Schedule added to the draft. Publish the bracket to share it.');
        setPreview([]);
        return;
      }
      firestoreService.updateMatchSchedules(updates);
      if (updates.some(update => publishedIds?.has(update.id))) {
        try {
          await firestoreService.syncBracketsToCloud();
        } catch {
          setError('Saved on this device. Spectator sync failed. Try applying the schedule again.');
          return;
        }
        setStatus('Schedule saved and published.');
      } else {
        setStatus('Schedule saved on this device.');
      }
      setPreview([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the schedule.');
    } finally {
      setBusy(false);
    }
  }

  const bulkEditor = <>
        <p className="studio-muted">Upload a CSV with match_id, date, and time columns, or write one instruction per match. Times use Manila time.</p>
        <label className="stream-schedule-upload">
          <Upload size={16} /> Upload CSV
          <input type="file" accept=".csv,text/csv" disabled={busy} onChange={event => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = '';
          }} />
        </label>
        <label className="stream-schedule-source">Schedule instructions or CSV
          <textarea rows={4} value={source} disabled={busy} maxLength={100_000}
            placeholder={`Schedule ${example} on 2026-12-04 at 7:30 PM`}
            onChange={event => updateSource(event.target.value)} />
        </label>
        {error && <p className="module-error" role="alert">{error}</p>}
        {status && <p className="studio-muted" role="status">{status}</p>}
        {preview.length > 0 && <ul className="stream-schedule-preview" aria-label="Schedule preview">
          {preview.map(update => <li key={update.id}>
            <strong>{matches.find(match => match.id === update.id)?.matchNumber}</strong>
            <span>{update.scheduledDate} · {update.scheduledTime}</span>
          </li>)}
        </ul>}
        <div className="studio-actions">
          <button type="button" className="arena-outline" disabled={busy || !source.trim()} onClick={review}>Preview schedule</button>
          {preview.length > 0 && <button type="button" className="arena-primary" disabled={busy} onClick={() => void apply()}>
            {busy ? 'Saving…' : `Apply ${preview.length} ${preview.length === 1 ? 'match' : 'matches'}`}
          </button>}
        </div>
  </>;

  return (
    <section id={onApplyDraft ? undefined : "stream-match-schedule"} className="arena-panel stream-schedule-editor">
      <h2><Calendar size={18} /> Match schedule</h2>
      {matches.length === 0 ? <p className="studio-muted">Choose a bracket or game with matches to add a schedule.</p> : onApplyDraft ? <>
        <DraftScheduleCalendar matches={matches} onApply={onApplyDraft} />
        <details className="draft-schedule-import">
          <summary>Bulk import or schedule instructions</summary>
          {bulkEditor}
        </details>
      </> : bulkEditor}
    </section>
  );
}
