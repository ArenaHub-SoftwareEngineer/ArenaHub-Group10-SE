// Report a player: the one action staff take on a player from check-in or the live wall.
// Staff pick the cheat they saw, say what happened and when, and attach evidence: a snapshot of the player's live
// screen (taken automatically from the wall) or a screenshot/clip they upload. The report goes to the Reports queue
// (integrity cases, evidence in private storage) and is also noted on the player's monitor session.
import React, { useEffect, useMemo, useState } from 'react';
import { antiCheatCall as call } from '../../lib/antiCheatApi';
import { CHEAT_CATALOG } from '../../lib/cheatCatalog';
import { errorMessage } from '../../lib/errors';
import type { MonitorGame } from '../../lib/integrityRisk';
import { submitIntegrityCase } from '../../lib/integrityService';
import { Modal } from '../ui/Modal';
import { Req } from '../ui/Req';
import { Flag } from '../ui/Icons';
import './screenWall.css';

interface ReportSession { id: string; matchId: string; matchLabel: string; game: MonitorGame; gameLabel: string; playerName: string; team: string }
type Level = 'low' | 'medium' | 'high';
const LEVELS: { id: Level; label: string; hint: string }[] = [
  { id: 'low', label: 'Unsure', hint: 'Worth a note' },
  { id: 'medium', label: 'Likely', hint: 'Needs a second look' },
  { id: 'high', label: 'Clear', hint: 'Plain in the evidence' },
];

/** The current frame of a player's tile on the live wall, as a JPEG file. Null when there is no picture yet. */
export async function snapshotOf(playerName: string): Promise<File | null> {
  const tile = Array.from(document.querySelectorAll<HTMLElement>('.lw-tile')).find(el => el.dataset.player === playerName);
  const video = Array.from(tile?.querySelectorAll('video') || []).find(v => !v.hidden && v.videoWidth > 0);
  if (!video) return null;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  try {
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>(done => canvas.toBlob(done, 'image/jpeg', 0.9));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return blob ? new File([blob], `${playerName}-screen-${stamp}.jpg`, { type: 'image/jpeg' }) : null;
  } catch { return null; }
}

export function ReportDialog({ sessionId, snapshot, onClose, onDetails }: { sessionId: string; snapshot?: File | null; onClose: () => void; onDetails?: () => void }) {
  const [session, setSession] = useState<ReportSession | null>(null);
  const [cheatId, setCheatId] = useState(''), [level, setLevel] = useState<Level>('medium'), [what, setWhat] = useState('');
  const [file, setFile] = useState<File | null>(snapshot || null);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [error, setError] = useState(''), [done, setDone] = useState(false);
  const preview = useMemo(() => file && file.type.startsWith('image/') ? URL.createObjectURL(file) : '', [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    let live = true;
    call<ReportSession>(`/sessions/${sessionId}`).then(row => { if (live) setSession(row); }).catch(err => { if (live) setError(errorMessage(err, 'This player could not be loaded.')); });
    return () => { live = false; };
  }, [sessionId]);

  const cheats = session ? CHEAT_CATALOG[session.game] : [];
  const cheat = cheats.find(item => item.id === cheatId);
  const ready = !!cheat && what.trim().length >= 20 && !!file;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!session || !cheat || !file || busy) return;
    setBusy(true); setError('');
    const text = what.trim().split(/\s+/).join(' ');
    try {
      const details = `${session.playerName}${session.team ? ` (${session.team})` : ''}, ${session.matchLabel}. ${cheat.name}, ${LEVELS.find(l => l.id === level)!.label.toLowerCase()}. ${text}`;
      await submitIntegrityCase({ matchId: session.matchId, reason: 'Suspected cheating', details: details.padEnd(30, '.'), evidenceUrl: '' }, file, setProgress);
      // Also on the player's monitor session, so the referee sees it next to the device signals.
      await call(`/sessions/${session.id}/observations`, { body: { cheatId: cheat.id, severity: level, note: text.length > 150 ? text.slice(0, 147) + '...' : text.padEnd(10, '.') } }).catch(() => undefined);
      setDone(true);
    } catch (err) { setError(errorMessage(err, 'The report could not be sent.')); }
    finally { setBusy(false); }
  };

  return <Modal open icon={<Flag size={20} />} title={session ? `Report ${session.playerName}` : 'Report player'}
    description={session ? `${session.matchLabel} · ${session.gameLabel}` : 'Loading'} busy={busy} onClose={onClose} className="feature-dialog rd-dialog">
    {done ? <div className="feature-dialog-body rd-done">
      <p role="status"><strong>Report sent.</strong> It is in Reports with the evidence, for the organizers to decide.</p>
      <div className="feature-dialog-actions"><button type="button" className="arena-primary" onClick={onClose}>Done</button></div>
    </div> : <form className="feature-dialog-body module-form rd-form" onSubmit={submit}>
      <fieldset className="rd-evidence">
        <legend><Req>Evidence</Req></legend>
        {preview ? <img src={preview} alt="Evidence to attach" /> : file ? <p className="field-hint">{file.name}</p> : <p className="field-hint">Attach a screenshot or a short clip that shows it.</p>}
        <label className="arena-outline rd-file">{file ? 'Use a different file' : 'Choose screenshot or clip'}
          <input type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm" onChange={event => setFile(event.target.files?.[0] || file)} />
        </label>
        {snapshot && file === snapshot && <small className="field-hint">Snapshot of the live screen when you pressed Report.</small>}
      </fieldset>
      <label><Req>What did you see?</Req>
        <select required value={cheatId} onChange={event => setCheatId(event.target.value)} disabled={!session}>
          <option value="">Choose a cheat type</option>
          {cheats.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        {cheat && <span className="field-hint">{cheat.what}</span>}
      </label>
      <div className="rd-levels" role="radiogroup" aria-label="How sure are you?">
        {LEVELS.map(item => <button key={item.id} type="button" role="radio" aria-checked={level === item.id} className={level === item.id ? 'is-active' : ''} onClick={() => setLevel(item.id)}>
          <strong>{item.label}</strong><small>{item.hint}</small></button>)}
      </div>
      <label><Req>What happened and when</Req>
        <textarea required minLength={20} maxLength={2000} rows={3} value={what} onChange={event => setWhat(event.target.value)}
          placeholder="e.g. At 12:40 the crosshair tracked an enemy behind a wall for 3 seconds." />
      </label>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="feature-dialog-actions">
        {onDetails && <button type="button" className="arena-outline" onClick={onDetails} disabled={busy}>Device scan details</button>}
        <button className="arena-primary" disabled={busy || !ready}>{busy ? (progress ? `Uploading ${progress}%` : 'Sending…') : 'Send report'}</button>
      </div>
    </form>}
  </Modal>;
}
