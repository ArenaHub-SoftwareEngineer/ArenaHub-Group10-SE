import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, Copy, Share2, ShieldCheck, Users } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { auth } from '../../lib/firebase';
import { currentStudentInvite } from '../../lib/campusAccess';
import { CAMPUS_SHORT_NAME } from '../../lib/institution';
import type { Match } from '../../lib/types';

type Mode = 'campus' | 'guest';

/** The match's own address without any old invitation in it. */
function matchLink() {
  const url = new URL(window.location.href);
  url.searchParams.delete('spectatorInvite');
  return url.href;
}
/** The match address carrying a spectator invitation (read by captureSpectatorInvite on arrival). */
function withInvite(token: string) {
  const url = new URL(matchLink());
  url.searchParams.set('spectatorInvite', token);
  return url.href;
}

/**
 * Share a match. ArenaHub is for one school, so there are two links:
 * - the plain link opens for anyone signed in with a school account (or an active spectator pass);
 * - a guest link adds the sharer's 20-minute spectator invitation. The guest signs in or creates an account,
 *   is admitted as a spectator (watch and read chat, no posting), and lands on this match.
 */
export function ShareMatchDialog({ open, onClose, match, gameName, canInvite }: {
  open: boolean; onClose: () => void; match: Match; gameName?: string; canInvite: boolean;
}) {
  const reduced = Boolean(useReducedMotion()) || document.documentElement.dataset.motion === 'reduced';
  const [mode, setMode] = useState<Mode>('campus');
  const [guest, setGuest] = useState<{ url: string; expiresAt: number } | null>(null);
  const [guestError, setGuestError] = useState('');
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const team1 = match.team1?.name || 'Awaiting team', team2 = match.team2?.name || 'Awaiting team';
  const secondsLeft = guest ? Math.max(0, Math.ceil((guest.expiresAt - now) / 1000)) : 0;
  const expired = Boolean(guest) && secondsLeft === 0;
  const link = mode === 'guest' ? (expired ? '' : guest?.url || '') : matchLink();

  useEffect(() => { if (!open) { setMode('campus'); setCopied(false); setGuestError(''); } }, [open]);

  // A guest link needs a current invitation; it is created (or reused while valid) on demand.
  useEffect(() => {
    if (!open || mode !== 'guest' || (guest && guest.expiresAt > Date.now())) return;
    const user = auth.currentUser;
    if (!user) { setGuestError('Sign in again to create a guest invitation.'); return; }
    setGuestError('');
    let active = true;
    currentStudentInvite(user).then(invite => {
      const token = new URL(invite.url).searchParams.get('spectatorInvite') || '';
      if (active) setGuest({ url: withInvite(token), expiresAt: invite.expiresAt });
    }).catch((error: { code?: string }) => {
      if (!active) return;
      setGuestError(error?.code === 'permission-denied'
        ? 'Guest invites are turned off for your account. Ask an organizer if this is a mistake.'
        : `Could not create an invitation. Check your connection and ${CAMPUS_SHORT_NAME} account, then try again.`);
    });
    return () => { active = false; };
  }, [open, mode, guest, expired]);

  useEffect(() => {
    if (!open || !link) { setQr(''); return; }
    let active = true;
    void import('qrcode').then(({ toDataURL }) => toDataURL(link, { width: 220, margin: 2, color: { dark: '#0e0e10', light: '#ffffff' } }))
      .then(image => { if (active) setQr(image); }).catch(() => { if (active) setQr(''); });
    return () => { active = false; };
  }, [open, link]);

  useEffect(() => {
    if (!open || mode !== 'guest') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open, mode]);
  useEffect(() => { if (!copied) return; const t = window.setTimeout(() => setCopied(false), 2200); return () => window.clearTimeout(t); }, [copied]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); }
    catch { setCopied(false); setGuestError('Copy failed. Select the link and copy it, or use the QR code.'); }
  };
  const canNativeShare = typeof navigator.share === 'function';
  const nativeShare = () => navigator.share?.({ title: `${team1} vs ${team2} · ArenaHub`, text: `Watch ${team1} vs ${team2} live on ArenaHub`, url: link }).catch(() => {});

  return <Modal open={open} onClose={onClose} title="Share this match" description={`${team1} vs ${team2}${gameName ? ` · ${gameName}` : ''}`} className="share-dialog">
    <div className="share-body">
      {canInvite && <div className="share-modes" role="tablist" aria-label="Who is it for">
        {([['campus', `${CAMPUS_SHORT_NAME} link`], ['guest', 'Invite a guest']] as const).map(([id, label]) =>
          <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => { setMode(id); setCopied(false); }}>
            {mode === id && <motion.span layoutId="share-mode-pill" className="share-mode-pill" transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }} />}
            <span>{label}</span>
          </button>)}
      </div>}

      <p className="share-who">{mode === 'campus'
        ? <><ShieldCheck size={16} aria-hidden="true" />Opens for anyone signed in with a {CAMPUS_SHORT_NAME} account or an active spectator pass.</>
        : <><Users size={16} aria-hidden="true" />For someone outside {CAMPUS_SHORT_NAME}. They sign in or create an account, this invitation admits them as a spectator, and they land on this match. Spectators can watch and read chat.</>}</p>

      <div className="share-main">
        <div className="share-qr" aria-live="polite">
          {qr ? <img src={qr} width="180" height="180" alt={mode === 'guest' ? 'QR code for the guest invitation link' : 'QR code for this match'} />
            : <span className="share-qr-wait">{guestError ? '' : 'Preparing…'}</span>}
        </div>
        <div className="share-actions">
          <label className="share-link"><span>Link</span>
            <input readOnly value={link || 'Creating invitation…'} onFocus={event => event.currentTarget.select()} aria-label="Share link" />
          </label>
          <button type="button" className={`arena-primary share-copy${copied ? ' is-copied' : ''}`} onClick={() => void copy()} disabled={!link}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={copied ? 'done' : 'copy'} className="share-copy-label" initial={{ opacity: 0, y: reduced ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -6 }} transition={{ duration: reduced ? 0 : .16 }}>
                {copied ? <><Check size={16} aria-hidden="true" />Copied</> : <><Copy size={16} aria-hidden="true" />Copy link</>}
              </motion.span>
            </AnimatePresence>
          </button>
          {canNativeShare && <button type="button" className="arena-outline" onClick={() => void nativeShare()} disabled={!link}><Share2 size={16} aria-hidden="true" />Share…</button>}
          <span className="sr-only" role="status">{copied ? 'Link copied.' : ''}</span>
          {mode === 'guest' && guest && <p className={`share-expiry${secondsLeft < 120 ? ' is-ending' : ''}`}>
            {secondsLeft > 0 ? <>Invitation works for <strong>{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</strong>. A new one is made when it ends.</>
              : 'This invitation ended. A new one is being created.'}
          </p>}
          {guestError && <p className="module-error" role="alert">{guestError}</p>}
        </div>
      </div>
    </div>
  </Modal>;
}
