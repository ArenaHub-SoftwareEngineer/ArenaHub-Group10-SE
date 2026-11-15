import React, { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../../lib/apiBase';
import { auth } from '../../lib/firebase';
import { frameTime, reviewSampleTimes, validateFrameFindings, type FrameFinding, type ReviewFrame, type ReviewGame } from '../../lib/videoReview';
import { Upload, ShieldCheck, Play, Pause, ChevronLeft, ChevronRight, X, Check, Download } from '../ui/Icons';
import { readEvidence, type EvidenceFile } from '../../lib/evidenceStorage';
import type { Match } from '../../lib/types';
import { errorMessage } from '../../lib/errors';

type CapturedFrame = ReviewFrame & { state: 'captured' | 'analyzing' | 'reviewed'; finding?: FrameFinding };
function waitForVideo(video: HTMLVideoElement, event: 'loadedmetadata' | 'seeked', signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error('This video could not be read. Try an MP4 encoded with H.264.')), 12000);
    const abort = () => finish(new Error('Review stopped.'));
    const ok = () => finish(), bad = () => finish(new Error('This video format could not be decoded.'));
    const finish = (error?: Error) => { clearTimeout(timeout); video.removeEventListener(event, ok); video.removeEventListener('error', bad); signal.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
    video.addEventListener(event, ok, { once: true }); video.addEventListener('error', bad, { once: true }); signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
export function VideoReviewWorkbench({ matches, game, staff, attachment, caseId, onSubmit, onSaveReview, onBusyChange }: {
  matches: Match[]; game: ReviewGame; staff: boolean; attachment?: EvidenceFile; caseId?: string;
  onSubmit: (matchId: string, file: File, notes: string) => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  onSaveReview?: (caseId: string, frames: FrameFinding[], summary: string) => Promise<void>;
}) {
  const video = useRef<HTMLVideoElement>(null), abort = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null), [url, setUrl] = useState(''), [matchId, setMatchId] = useState('');
  const [duration, setDuration] = useState(0), [position, setPosition] = useState(0), [playing, setPlaying] = useState(false);
  const [frames, setFrames] = useState<CapturedFrame[]>([]), [selected, setSelected] = useState<number | null>(null), [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [stage, setStage] = useState(''), [error, setError] = useState(''), [saved, setSaved] = useState('');
  const [modelName, setModelName] = useState('');
  useEffect(() => { onBusyChange?.(busy || saving); }, [busy, saving, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  useEffect(() => {
    if (!file) { setUrl(''); return; }
    const objectUrl = URL.createObjectURL(file); setUrl(objectUrl);
    return () => { abort.current?.abort(); URL.revokeObjectURL(objectUrl); };
  }, [file]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    setFile(null); setFrames([]); setError(''); setSaved(''); setDuration(0); setPosition(0); setSelected(null); setModelName(''); setNotes('');
    setMatchId(matches.length === 1 ? matches[0].id : '');
    if (!attachment) return;
    let active = true; setStage('Opening private evidence…');
    readEvidence(attachment).then(blob => { if (active) setFile(new File([blob], attachment.name, { type: attachment.mime })); }).catch(() => { if (active) setError('The saved evidence could not open. Check your access, storage permissions and bucket CORS configuration.'); }).finally(() => { if (active) setStage(''); });
    return () => { active = false; abort.current?.abort(); };
  }, [attachment?.path, game, caseId]);
  const loadFile = (value?: File) => {
    if (!value) return;
    if (!['video/mp4', 'video/webm'].includes(value.type) || value.size > 100 * 1024 * 1024 || !value.size) { setError('Choose an MP4 or WebM clip up to 100 MB.'); return; }
    abort.current?.abort(); setFile(value); setFrames([]); setSelected(null); setError(''); setSaved(''); setDuration(0); setPosition(0); setModelName('');
  };
  const capture = async (controller: AbortController) => {
    const player = document.createElement('video'); player.preload = 'auto'; player.muted = true;
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot extract video frames.');
    try {
      const ready = waitForVideo(player, 'loadedmetadata', controller.signal); player.src = url; player.load(); await ready;
      const start = Math.min(position, Math.max(0, duration - .001)), times = reviewSampleTimes(duration, start);
      const scale = Math.min(1, 960 / player.videoWidth); canvas.width = Math.round(player.videoWidth * scale); canvas.height = Math.round(player.videoHeight * scale);
      const captured: CapturedFrame[] = [];
      for (const timestamp of times) {
        if (controller.signal.aborted) throw new Error('Review stopped.');
        const seekTime = Math.max(.001, timestamp);
        const seek = waitForVideo(player, 'seeked', controller.signal); player.currentTime = seekTime; await seek;
        context.drawImage(player, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL('image/jpeg', .65).split(',')[1];
        if (image.length > 250000) throw new Error('A video frame is too large. Try a lower-resolution clip.');
        captured.push({ timestamp, image, state: 'captured' });
        setFrames([...captured]); setSelected(timestamp); setStage(`Extracted ${captured.length} of ${times.length} actual frames`);
      }
      return captured;
    } finally { player.removeAttribute('src'); player.load(); }
  };
  const analyze = async (useModel: boolean) => {
    if (!file || !duration || (!caseId && !matchId)) { setError('Choose a match and a readable video first.'); return; }
    video.current?.pause(); setBusy(true); setError(''); setSaved(''); setModelName('');
    const controller = new AbortController(); abort.current = controller;
    try {
      let working = await capture(controller);
      if (!useModel) { setStage(`${working.length} sampled frames ready for manual review`); return; }
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Sign in as a tournament organizer for model review.');
      for (let offset = 0; offset < working.length; offset += 6) {
        if (controller.signal.aborted) throw new Error('Review stopped. Completed frame results are preserved.');
        const batch = working.slice(offset, offset + 6);
        working = working.map((frame, i) => i >= offset && i < offset + 6 ? { ...frame, state: 'analyzing' } : frame);
        setFrames(working); setSelected(batch[0].timestamp); setStage(`Model reviewing ${frameTime(batch[0].timestamp)}–${frameTime(batch.at(-1)!.timestamp)} · ${offset} of ${working.length} frames returned`);
        const response = await fetch(apiUrl('/api/fair-play/analyze'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ game, matchId: caseId ? matches[0]?.id : matchId, frames: batch.map(({ timestamp, image }) => ({ timestamp, image })) }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(75000)]) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'The model could not review this batch.');
        const results = validateFrameFindings(payload, batch);
        working = working.map(frame => { const finding = results.find(row => row.timestamp === frame.timestamp); return finding ? { ...frame, state: 'reviewed', finding } : frame; });
        setFrames(working); setModelName(payload.model); setSelected(batch[0].timestamp);
      }
      setStage(`Review complete · ${working.length} sampled frames returned by the model`);
    } catch (e) { setError(controller.signal.aborted ? 'Review stopped. Completed frames and results are still available.' : errorMessage(e, 'Video review failed.')); setFrames(current => current.map(frame => frame.state === 'analyzing' ? { ...frame, state: 'captured' } : frame)); setStage(''); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!file) return; setSaving(true); setError('');
    try {
      if (caseId && (!staff || !onSaveReview)) throw new Error('Only authorized organizers can save a video review.');
      if (caseId && onSaveReview) {
        if (notes.trim().length < 10) throw new Error('Add a brief organizer observation before saving the review.');
        await onSaveReview(caseId, frames.flatMap(f => f.finding ? [f.finding] : []), notes.trim());
        setSaved('Organizer review saved with the case.');
      } else { if (!matchId) throw new Error('Choose the match shown in this clip.'); await onSubmit(matchId, file, notes); setSaved('Video submitted privately to the organizers.'); }
    } catch (e) { setError(errorMessage(e, 'The review could not be saved.')); } finally { setSaving(false); }
  };
  const selectedFrame = frames.find(frame => frame.timestamp === selected);
  const seek = (seconds: number) => { if (video.current) { video.current.pause(); video.current.currentTime = Math.max(0, Math.min(duration, seconds)); } };
  const exportReview = () => {
    const blob = new Blob([JSON.stringify({ fileName: file?.name, game, model: modelName || null, sampling: '2 fps, selected 30-second segment; not full-video analysis', reviewedFrames: frames.flatMap(f => f.finding ? [f.finding] : []), organizerNotes: notes, verdict: 'Human review required; no cheating determination' }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'), objectUrl = URL.createObjectURL(blob); link.href = objectUrl; link.download = 'arenahub-video-review.json'; link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };
  return <section className="video-workbench">
    <header className="video-review-heading"><div><span className="section-overline">VIDEO EVIDENCE</span><h2>{caseId ? 'Inspect this clip.' : 'Let the footage tell the story.'}</h2><p>{caseId && !staff ? 'Your original evidence is available here while organizers review the report.' : staff ? 'Inspect the actual frames, compare context, and record your decision.' : 'Choose the match and upload a clip. Your organizers take it from here.'}</p></div><ShieldCheck size={28} /></header>
    {!caseId && <label className="video-match-label">Match<select value={matchId} disabled={busy || saving} onChange={e => { setMatchId(e.target.value); setFrames([]); setSelected(null); setModelName(''); setStage(''); }}>{matches.length !== 1 && <option value="">Choose the match in your clip</option>}{matches.map(m => <option key={m.id} value={m.id}>{m.matchNumber} · {m.team1?.name || 'TBD'} vs {m.team2?.name || 'TBD'}</option>)}</select></label>}
    {!file && !attachment && <label className="video-dropzone"><Upload size={30} /><strong>Upload the moment worth reviewing</strong><span>MP4 or WebM · up to 100 MB · original player POV is best</span><input aria-label="Upload evidence video" type="file" accept="video/mp4,video/webm" onChange={e => loadFile(e.target.files?.[0])} /></label>}
    {file && <><div className="video-file-caption"><span>{file.name}</span>{!attachment && <button disabled={busy || saving} className="arena-text-button" onClick={() => { setFile(null); setFrames([]); setDuration(0); }}>Change clip</button>}</div>
      <div className="video-inspection-layout"><div className="video-player-column"><video ref={video} src={url || undefined} controls playsInline preload="metadata" onLoadedMetadata={e => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0 && d <= 600) setDuration(d); else setError('Use a clip no longer than 10 minutes. Trim a longer broadcast first.'); }} onTimeUpdate={e => setPosition(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setError('This video cannot be played here. Try an MP4 encoded with H.264.')} />
        <div className="video-transport"><button aria-label="Step back approximately one frame" onClick={() => seek(position - 1 / 30)}><ChevronLeft size={18} /></button><button aria-label={playing ? 'Pause clip' : 'Play clip'} onClick={() => { if (video.current) playing ? video.current.pause() : void video.current.play().catch(() => setError('Tap the video play control to start playback.')); }}>{playing ? <Pause size={18} /> : <Play size={18} />}</button><button aria-label="Step forward approximately one frame" onClick={() => seek(position + 1 / 30)}><ChevronRight size={18} /></button><span>{frameTime(position)} / {frameTime(duration)}</span><small>Step ≈ 1/30 s</small></div>
        {staff && <div className="video-analysis-actions"><button disabled={busy || saving || !duration} className="arena-primary" onClick={() => void analyze(true)}><ShieldCheck size={16} /> Analyze next 30 seconds</button><button disabled={busy || saving || !duration} className="arena-outline" onClick={() => void analyze(false)}>Inspect frames manually</button>{busy && <button className="arena-outline" onClick={() => abort.current?.abort()}><X size={15} /> Stop</button>}</div>}
        {staff && <p className="video-disclosure">Starts at the playhead. The model receives 2 sampled frames per second from up to 30 seconds through the configured AI provider. It does not inspect every video frame, audio, devices, or game data.</p>}
      </div>
      {staff && <aside className="video-findings"><span className="section-overline">FRAME OBSERVATIONS</span>{selectedFrame ? <><img src={`data:image/jpeg;base64,${selectedFrame.image}`} alt={`Actual captured frame at ${frameTime(selectedFrame.timestamp)}`} /><div className="video-finding-heading"><strong>{frameTime(selectedFrame.timestamp)}</strong><span className={`finding-state ${selectedFrame.finding?.classification || selectedFrame.state}`}>{selectedFrame.finding ? selectedFrame.finding.classification === 'review' ? 'Review this moment' : selectedFrame.finding.classification === 'context-needed' ? 'More context needed' : 'No visible concern' : selectedFrame.state === 'analyzing' ? 'Sent to model' : 'Captured · not analyzed'}</span></div>{selectedFrame.finding ? <><p>{selectedFrame.finding.observation}</p><h4>Possible legitimate explanation</h4><p>{selectedFrame.finding.possibleExplanation || 'The model did not provide one. The referee must check surrounding context.'}</p><h4>What the referee still needs</h4><p>{selectedFrame.finding.missingContext || 'Confirm the original player perspective and surrounding play.'}</p></> : <p>{selectedFrame.state === 'analyzing' ? 'Waiting for the model’s actual response for this batch.' : 'This is an extracted video frame. No model assessment has been returned.'}</p>}</> : <div className="video-findings-empty"><ShieldCheck size={30} /><p>Captured frames and returned observations appear here as the review progresses.</p></div>}</aside>}
      </div>
      {stage && <p className="video-stage" role="status">{stage}</p>}
      {frames.length > 0 && <><div className="video-frame-progress"><span style={{ width: `${frames.filter(f => f.state === 'reviewed').length / frames.length * 100}%` }} /></div><div className="video-filmstrip" aria-label="Actual sampled video frames">{frames.map(frame => <button key={frame.timestamp} className={`film-frame ${frame.timestamp === selected ? 'selected' : ''} ${frame.finding?.classification || frame.state}`} aria-label={`Inspect ${frameTime(frame.timestamp)}${frame.finding ? `, ${frame.finding.classification}` : ', captured'}`} onClick={() => { setSelected(frame.timestamp); seek(frame.timestamp); }}><img src={`data:image/jpeg;base64,${frame.image}`} alt="" /><span>{frameTime(frame.timestamp)}</span></button>)}</div><p className="video-disclosure">{modelName ? `Model: ${modelName}. ` : ''}A flagged image is a review lead. “No visible concern” does not establish clean play. Broadcast overlays and spectator vision can be misleading.</p></>}
      {(!caseId || staff) && <><label className="video-notes-label">{caseId ? 'Organizer observation' : 'Anything to point out? (optional)'}<textarea maxLength={1800} value={notes} onChange={e => setNotes(e.target.value)} placeholder={caseId ? 'Describe what you confirmed and which perspective you inspected.' : 'For example: watch the encounter around 00:18.'} /></label>
      <div className="video-save-actions"><button disabled={busy || saving || !duration} className="arena-primary" onClick={() => void save()}><Check size={16} />{saving ? 'Saving evidence…' : caseId ? 'Save organizer review' : 'Send clip for review'}</button>{staff && frames.length > 0 && <button className="arena-outline" onClick={exportReview}><Download size={15} /> Export observations</button>}</div></>}
    </>}
    {error && <p role="alert" className="field-error">{error}</p>}{saved && <p role="status" className="module-notice">{saved}</p>}
    <p className="video-review-footnote">Visual evidence supports a referee’s investigation. It cannot prove hidden software, map hacks, or aim automation by itself.</p>
  </section>;
}
