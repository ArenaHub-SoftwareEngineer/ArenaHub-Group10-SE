import { CAMPUS_SHORT_NAME } from '../../lib/institution';
import React, { useEffect, useState } from 'react';
import { currentStudentInvite, formatInviteCode } from '../../lib/campusAccess';
import type { User } from 'firebase/auth';
import { QrCode } from '../ui/Icons';

export function StudentInviteCard({ user }: { user: User }) {
  const [invite, setInvite] = useState<{ url: string; code: string; expiresAt: number; image: string } | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [copyNotice, setCopyNotice] = useState('');

  useEffect(() => {
    let active = true;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    let countdown: ReturnType<typeof setInterval> | undefined;
    setInvite(null);
    setError('');
    setCopyNotice('');
    currentStudentInvite(user).then(async next => {
      const { toDataURL } = await import('qrcode');
      const image = await toDataURL(next.url, { width: 224, margin: 4 });
      if (!active) return;
      const tick = () => setRemaining(Math.max(0, Math.ceil((next.expiresAt - Date.now()) / 1000)));
      tick();
      setInvite({ ...next, image });
      countdown = setInterval(tick, 1000);
      refresh = setTimeout(() => setAttempt(value => value + 1), Math.max(0, next.expiresAt - Date.now()) + 250);
    }).catch(() => {
      if (active) setError(`Could not load your invite. Check your connection and ${CAMPUS_SHORT_NAME} account, then retry.`);
    });
    return () => {
      active = false;
      clearTimeout(refresh);
      clearInterval(countdown);
    };
  }, [user, attempt]);

  return <section className="arena-panel student-invite">
    <h2 className="settings-section-title"><QrCode size={17} /> Spectator invitation</h2>
    <p className="studio-muted">Show this QR, or read out the code, to someone you want to invite. Guests can watch matches and comment in chat. It refreshes every 20 minutes.</p>
    {error ? <>
      <p className="module-error" role="alert">{error}</p>
      <button type="button" className="arena-outline" onClick={() => setAttempt(value => value + 1)}>Retry</button>
    </> : invite && remaining > 0 ? <div className="student-invite-content">
      <img width="224" height="224" src={invite.image} alt="Scan this QR to open ArenaHub spectator sign-up" />
      <div>
        <p className="studio-muted">Invite code</p>
        <p className="student-invite-code" aria-label={`Invite code ${invite.code.split('').join(' ')}`}>{formatInviteCode(invite.code)}</p>
        <p className="studio-muted">Refreshes in</p>
        <p className="student-invite-timer" role="timer">{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</p>
        <button type="button" className="arena-outline" onClick={async () => {
          try { await navigator.clipboard.writeText(invite.url); setCopyNotice('Invitation link copied.'); }
          catch { setCopyNotice('Copy failed. You can still share the QR.'); }
        }}>Copy invite link</button>
        {copyNotice && <p className="studio-muted" role="status">{copyNotice}</p>}
      </div>
    </div> : <p className="studio-muted" role="status">Loading a current invitation…</p>}
  </section>;
}
