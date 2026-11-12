import React, { useEffect, useState } from 'react';
import { useAuth } from '../../lib/authContext';
import { auth } from '../../lib/firebase';
import { authErrorMessage } from '../../lib/authMessages';
import { Brand } from '../ui/Brand';
import { Mail } from '../ui/Icons';

export function EmailVerificationScreen() {
  const { firebaseUser, resendVerificationEmail, reloadUser, logout, verificationNotice } = useAuth();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [remaining, setRemaining] = useState(0);
  useEffect(() => { if (!remaining) return; const timeout = setTimeout(() => setRemaining(value => Math.max(0, value - 1)), 1000); return () => clearTimeout(timeout); }, [remaining]);
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
  return <div className="auth-status-screen"><section className="auth-status-card"><Brand /><span className="auth-status-icon"><Mail size={25} /></span><h1>Verify your email</h1><p>Open the verification link sent to <strong>{firebaseUser?.email}</strong>, then return here.</p><p className="auth-flow-hint">A verified email is required to enter ArenaHub. Spectator admission also needs a current student invitation.</p>{verificationNotice && <p className="auth-flow-error" role="alert">{verificationNotice}</p>}{error && <p className="auth-flow-error" role="alert">{error}</p>}{notice && <p className="auth-flow-success" role="status">{notice}</p>}<button disabled={busy} className="arena-primary auth-submit" onClick={() => void check()}>{busy ? 'Please wait…' : 'I’ve verified my email'}</button><button disabled={busy || remaining > 0} className="arena-outline auth-submit" onClick={() => void resend()}>{remaining ? `Resend in ${remaining}s` : 'Resend verification email'}</button><button disabled={busy} className="auth-flow-text" onClick={() => void logout()}>Use a different account</button></section></div>;
}
