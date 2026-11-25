import React, { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useAuth } from '../../lib/authContext';
import { reload } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { authErrorMessage } from '../../lib/authMessages';
import { Brand } from '../ui/Brand';
import { ExternalLink, MailCheck, RefreshCw } from '../ui/Icons';
import { SignupSteps } from './AuthScreen';

const RESEND_SECONDS = 60;

/** The inbox people already use, picked from their address, so "check your email" is one tap away. */
function inboxesFor(email: string) {
  const domain = email.split('@')[1]?.toLowerCase() || '';
  // Searches every folder, spam included, for the last day's verification mail.
  const gmail = { label: 'Open Gmail', href: 'https://mail.google.com/mail/u/0/#search/in%3Aanywhere+newer_than%3A1d+verify' };
  const outlook = { label: 'Open Outlook', href: 'https://outlook.live.com/mail/0/' };
  const yahoo = { label: 'Open Yahoo Mail', href: 'https://mail.yahoo.com/' };
  if (/^(outlook|hotmail|live|msn)\./.test(domain)) return [outlook, gmail];
  if (/^(yahoo|ymail)\./.test(domain)) return [yahoo, gmail];
  return [gmail, outlook];
}

/** A paper envelope drawn in CSS 3D. It tilts toward the pointer, and the letter inside rises once it opens. */
function Envelope() {
  const scene = useRef<HTMLDivElement>(null);
  const tilt = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    scene.current?.style.setProperty('--tilt-x', `${((event.clientY - box.top) / box.height - 0.5) * -16}deg`);
    scene.current?.style.setProperty('--tilt-y', `${((event.clientX - box.left) / box.width - 0.5) * 22}deg`);
  };
  const reset = () => { scene.current?.style.setProperty('--tilt-x', '0deg'); scene.current?.style.setProperty('--tilt-y', '0deg'); };
  return <div className="verify-stage" onPointerMove={tilt} onPointerLeave={reset} aria-hidden="true">
    <div ref={scene} className="verify-envelope">
      <div className="verify-envelope-back" />
      <div className="verify-letter">
        <img src="/arenahub-logo.svg" alt="" width="28" height="34" />
        <span className="verify-letter-line" />
        <span className="verify-letter-line is-short" />
        <span className="verify-letter-button">Verify email</span>
      </div>
      <div className="verify-envelope-front" />
      <div className="verify-envelope-flap" />
    </div>
    <div className="verify-stage-shadow" />
  </div>;
}

export function EmailVerificationScreen() {
  const { firebaseUser, resendVerificationEmail, reloadUser, logout, verificationNotice } = useAuth();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [remaining, setRemaining] = useState(() => verificationNotice ? 0 : RESEND_SECONDS), [watching, setWatching] = useState(true);
  const email = firebaseUser?.email || '';
  useEffect(() => { if (!remaining) return; const timeout = setTimeout(() => setRemaining(value => Math.max(0, value - 1)), 1000); return () => clearTimeout(timeout); }, [remaining]);
  // Opens ArenaHub by itself once the link is clicked, even in another tab or on the phone. It asks Firebase
  // Auth only (no database reads) every 4 seconds while this page is visible, for up to 15 minutes, and
  // again whenever the player switches back to this tab.
  useEffect(() => {
    let active = true, checking = false;
    const started = Date.now();
    const poll = async () => {
      const user = auth.currentUser;
      if (active && Date.now() - started > 15 * 60_000) setWatching(false);
      if (!active || checking || !user || document.visibilityState !== 'visible' || Date.now() - started > 15 * 60_000) return;
      checking = true;
      try { await reload(user); if (active && user.emailVerified) await reloadUser(); }
      catch { /* offline for a moment; the next tick tries again */ }
      finally { checking = false; }
    };
    const timer = setInterval(() => void poll(), 4000);
    const onFocus = () => void poll();
    window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [reloadUser]);
  const check = async () => {
    setBusy(true); setError(''); setNotice('');
    try { await reloadUser(); if (!auth.currentUser?.emailVerified) setNotice('Not verified yet. Open the link in the email, then check again.'); }
    catch { setError('Could not check verification. Check your connection and try again.'); }
    finally { setBusy(false); }
  };
  const resend = async () => {
    setBusy(true); setError(''); setNotice('');
    try { await resendVerificationEmail(); setRemaining(RESEND_SECONDS); setWatching(true); setNotice('A new link is on its way. Only the newest link works.'); }
    catch (e) { setError(authErrorMessage(e)); }
    finally { setBusy(false); }
  };
  const inboxes = inboxesFor(email);
  return <div className="auth-status-screen verify-screen">
    <section className="auth-status-card verify-card">
      <Brand />
      <SignupSteps current={1} />
      <Envelope />
      <h1>Verify your email</h1>
      <p>We sent a link to</p>
      <span className="verify-address"><MailCheck size={16} aria-hidden="true" />{email}</span>

      <div className="verify-inboxes">{inboxes.map((inbox, index) => <a key={inbox.href} className={index ? 'arena-outline' : 'arena-primary'} href={inbox.href} target="_blank" rel="noopener noreferrer">{inbox.label}<ExternalLink size={15} aria-hidden="true" /></a>)}</div>

      <ol className="verify-howto">
        <li><span>Open the email from ArenaHub. Not there? Check Spam or Promotions.</span></li>
        <li><span>Tap <strong>Verify email</strong>. Your phone works too.</span></li>
        <li><span>Come back here. This page opens ArenaHub by itself.</span></li>
      </ol>

      <p className={`verify-watch${watching ? ' is-live' : ''}`} role="status"><span aria-hidden="true" />{watching ? 'Waiting for you to click the link' : 'Stopped checking. Press the button below once you have verified.'}</p>
      {verificationNotice && <p className="auth-flow-error" role="alert">{verificationNotice}</p>}
      {error && <p className="auth-flow-error" role="alert">{error}</p>}
      {notice && <p className="auth-flow-success" role="status">{notice}</p>}

      <button disabled={busy} className="arena-outline auth-submit" onClick={() => void check()}>{busy ? 'Please wait…' : 'I’ve verified my email'}</button>
      <button disabled={busy || remaining > 0} className="verify-resend" onClick={() => void resend()}>
        <span className="verify-resend-ring" style={{ '--left': remaining / RESEND_SECONDS } as React.CSSProperties} aria-hidden="true"><RefreshCw size={14} /></span>
        {remaining ? `Resend email in ${remaining}s` : 'Resend verification email'}
      </button>
      <button disabled={busy} className="auth-flow-text" onClick={() => void logout()}>Use a different account</button>
    </section>
  </div>;
}
