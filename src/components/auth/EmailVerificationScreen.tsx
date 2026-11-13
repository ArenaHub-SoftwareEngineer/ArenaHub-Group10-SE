import React, { useEffect, useState } from 'react';
import { useAuth } from '../../lib/authContext';
import { reload } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { authErrorMessage } from '../../lib/authMessages';
import { Brand } from '../ui/Brand';
import { Mail } from '../ui/Icons';

export function EmailVerificationScreen() {
  const { firebaseUser, resendVerificationEmail, reloadUser, logout, verificationNotice } = useAuth();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [remaining, setRemaining] = useState(0);
  useEffect(() => { if (!remaining) return; const timeout = setTimeout(() => setRemaining(value => Math.max(0, value - 1)), 1000); return () => clearTimeout(timeout); }, [remaining]);
  // Opens ArenaHub by itself once the link is clicked, even in another tab or on the phone. It asks Firebase
  // Auth only (no database reads) every 4 seconds while this page is visible, for up to 15 minutes, and
  // again whenever the player switches back to this tab.
  useEffect(() => {
    let active = true, checking = false;
    const started = Date.now();
    const poll = async () => {
      const user = auth.currentUser;
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
    try { await reloadUser(); if (!auth.currentUser?.emailVerified) setNotice('Your email is not verified yet. Open the verification link, then check again.'); }
    catch { setError('Could not check verification. Check your connection and try again.'); }
    finally { setBusy(false); }
  };
  const resend = async () => {
    setBusy(true); setError(''); setNotice('');
    try { await resendVerificationEmail(); setRemaining(60); setNotice('Verification email sent. Check your inbox and spam folder.'); }
    catch (e) { setError(authErrorMessage(e)); }
    finally { setBusy(false); }
  };
  return <div className="auth-status-screen"><section className="auth-status-card"><Brand /><span className="auth-status-icon"><Mail size={25} /></span><h1>Verify your email</h1><p>We sent a verification link to <strong>{firebaseUser?.email}</strong>. Click it, on this device or your phone. This page opens ArenaHub by itself once you have.</p><p className="auth-flow-hint">A verified email is required to enter ArenaHub. Spectator admission also needs a current student invitation.</p>{verificationNotice && <p className="auth-flow-error" role="alert">{verificationNotice}</p>}{error && <p className="auth-flow-error" role="alert">{error}</p>}{notice && <p className="auth-flow-success" role="status">{notice}</p>}<button disabled={busy} className="arena-primary auth-submit" onClick={() => void check()}>{busy ? 'Please wait…' : 'I’ve verified my email'}</button><button disabled={busy || remaining > 0} className="arena-outline auth-submit" onClick={() => void resend()}>{remaining ? `Resend in ${remaining}s` : 'Resend verification email'}</button><button disabled={busy} className="auth-flow-text" onClick={() => void logout()}>Use a different account</button></section></div>;
}
