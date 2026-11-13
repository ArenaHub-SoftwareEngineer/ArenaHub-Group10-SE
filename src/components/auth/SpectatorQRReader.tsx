import { CAMPUS_SHORT_NAME } from '../../lib/institution';
import React, { useEffect, useRef, useState } from 'react';
import { checkSpectatorInvite, pendingSpectatorInvite, rememberSpectatorInvite, clearSpectatorInvite } from '../../lib/campusAccess';
import { parseInviteInput } from '../../lib/inviteInput';
import { Camera, Upload, QrCode, X, CheckCircle2 } from '../ui/Icons';
import { Req } from '../ui/Req';

export function SpectatorQRReader({ onVerified, admissionMode = false }: { onVerified?: () => void | Promise<void>; admissionMode?: boolean }) {
  const [input, setInput] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [ready, setReady] = useState(false), [camera, setCamera] = useState(false), [cameraPending, setCameraPending] = useState(false);
  const video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true), cameraEpoch = useRef(0), operation = useRef(0);
  const stopCamera = () => { cameraEpoch.current++; if (timer.current) clearTimeout(timer.current); stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; if (video.current) video.current.srcObject = null; if (mounted.current) { setCamera(false); setCameraPending(false); } };
  useEffect(() => {
    mounted.current = true;
    const existing = pendingSpectatorInvite();
    if (existing) {
      setBusy(true); const current = ++operation.current;
      checkSpectatorInvite(existing).then(() => { if (mounted.current && operation.current === current) setReady(true); }).catch(e => { if (mounted.current && operation.current === current) { if (!(e as any).code) clearSpectatorInvite(); setError(e instanceof Error && !(e as any).code ? e.message : 'The invitation could not be checked. Check your connection and try again.'); } }).finally(() => { if (mounted.current && operation.current === current) setBusy(false); });
    }
    return () => { mounted.current = false; operation.current++; stopCamera(); };
  }, []);
  const accept = async (value: string) => {
    const current = ++operation.current; setBusy(true); setError(''); setReady(false);
    try {
      const token = parseInviteInput(value, window.location.href);
      await checkSpectatorInvite(token);
      if (!mounted.current || operation.current !== current) return;
      rememberSpectatorInvite(token); setReady(true); setInput('');
      await onVerified?.();
    } catch (e) { if (mounted.current && operation.current === current) setError(e instanceof Error && !(e as any).code ? e.message : 'The invitation could not be checked. Check your connection and try again.'); }
    finally { if (mounted.current && operation.current === current) setBusy(false); }
  };
  const startCamera = async () => {
    stopCamera(); setError(''); setCameraPending(true); const current = cameraEpoch.current;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setError('Camera scanning needs HTTPS and camera support. Upload a QR image or paste the invitation link instead.'); setCameraPending(false); return; }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (!mounted.current || current !== cameraEpoch.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media; setCamera(true); setCameraPending(false);
    } catch (e) { if (mounted.current && current === cameraEpoch.current) { setCameraPending(false); setError((e as DOMException).name === 'NotAllowedError' ? 'Camera access was denied. Upload a QR image or paste the invitation link instead.' : 'The camera could not open. Check that another app is not using it, or upload a QR image.'); } }
  };
  useEffect(() => {
    if (!camera || !video.current || !stream.current) return;
    let active = true;
    const player = video.current, canvas = document.createElement('canvas'), context = canvas.getContext('2d', { willReadFrequently: true });
    player.srcObject = stream.current;
    const scan = async () => {
      if (!active || !mounted.current) return;
      if (player.readyState >= 2 && player.videoWidth && context) {
        const ratio = Math.min(1, 1024 / Math.max(player.videoWidth, player.videoHeight)); canvas.width = Math.round(player.videoWidth * ratio); canvas.height = Math.round(player.videoHeight * ratio);
        context.drawImage(player, 0, 0, canvas.width, canvas.height);
        const { default: jsQR } = await import('jsqr');
        if (!active || !mounted.current) return;
        const image = context.getImageData(0, 0, canvas.width, canvas.height), decoded = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
        if (decoded?.data) { stopCamera(); await accept(decoded.data); return; }
      }
      if (active) timer.current = setTimeout(() => void scan().catch(() => { stopCamera(); setError('This camera could not read the QR. Upload an image or paste its link instead.'); }), 200);
    };
    void player.play().then(scan).catch(() => { if (active) { stopCamera(); setError('The camera preview could not start. Upload a QR image instead.'); } });
    return () => { active = false; if (timer.current) clearTimeout(timer.current); };
  }, [camera]);
  const readImage = async (file?: File) => {
    if (!file) return; stopCamera(); setError(''); setBusy(true);
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or WebP QR image up to 12 MB.');
      const bitmap = await createImageBitmap(file);
      let data: string | undefined;
      try {
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
        const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('This browser could not read the image. Paste the invitation link instead.');
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const { default: jsQR } = await import('jsqr'); data = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })?.data;
      } finally { bitmap.close(); }
      if (!mounted.current) return;
      if (!data) throw new Error('No QR code was found. Use a clear image showing the whole code, or paste its invitation link.');
      await accept(data);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'The QR image could not be read.'); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <section className="auth-qr-reader"><div className="auth-qr-intro"><QrCode size={28} /><h3>Join with a student invitation</h3><p>Scan a current QR shared by an approved {CAMPUS_SHORT_NAME} student. Then sign in or create your own account.</p></div>
    {ready && <p className="auth-flow-success" role="status"><CheckCircle2 size={17} />{admissionMode ? 'Invitation checked. You can complete spectator admission.' : 'Invitation ready. Your account still needs to sign in and verify its email.'}</p>}
    {ready && admissionMode && <button type="button" disabled={busy} className="arena-primary auth-submit" onClick={() => void accept(pendingSpectatorInvite() || input)}>Complete admission</button>}
    {busy && <p className="auth-flow-hint" role="status">Checking the invitation…</p>}{error && <p className="auth-flow-error" role="alert">{error}</p>}
    {camera && <div className="auth-camera"><video ref={video} muted playsInline aria-label="Live QR camera preview" /><p>Point your camera at the whole invitation QR.</p></div>}
    <div className="auth-qr-actions">{camera || cameraPending ? <button type="button" className="arena-outline" onClick={stopCamera}><X size={16} /> Stop camera</button> : <button type="button" disabled={busy} className="arena-outline" onClick={() => void startCamera()}><Camera size={16} /> Use camera</button>}
      <label className={`arena-outline auth-qr-upload ${busy || cameraPending ? 'is-disabled' : ''}`}><Upload size={16} /> Upload image<input type="file" aria-label="Upload invitation QR image" accept="image/png,image/jpeg,image/webp" disabled={busy || cameraPending} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void readImage(file); }} /></label>
    </div>
    <form onSubmit={e => { e.preventDefault(); stopCamera(); void accept(input); }} className="auth-flow-form"><label><Req>Invitation link or code</Req><input autoComplete="off" spellCheck={false} value={input} maxLength={2000} disabled={busy} onChange={e => setInput(e.target.value)} placeholder="Paste the invitation link" required /></label><button type="submit" className="arena-outline" disabled={busy || cameraPending || !input.trim()}>Check invitation</button></form>
    <p className="auth-flow-hint">QR images are read on your device. Admission is checked with ArenaHub; a QR alone does not sign you in.</p>
  </section>;
}
