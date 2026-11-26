import { useEffect, useState } from 'react';
import { applyActionCode, reload, signInWithCustomToken } from 'firebase/auth';
import { auth } from '../../lib/firebase';
import { apiUrl } from '../../lib/apiBase';
import { Brand } from '../ui/Brand';
import { Loader2 } from '../ui/Icons';

/** The path Firebase's account emails point to (Authentication > Templates > Customize action URL). */
export const EMAIL_ACTION_PATH = '/auth/action';

/** Only a page on this site, so a link cannot send people somewhere else. */
function safeReturn(raw: string | null, dropNotice: boolean) {
  try {
    const url = new URL(raw || '/', location.origin);
    if (url.origin !== location.origin || url.pathname === EMAIL_ACTION_PATH) return '/';
    if (dropNotice) url.searchParams.delete('account');
    return url.pathname + url.search + url.hash;
  } catch { return '/'; }
}

/**
 * Verify email: applies the link and signs the player in, even in a browser that never signed in (their phone,
 * the Gmail app). Password reset and email change keep Firebase's own pages, so they are passed straight on.
 */
export function EmailActionPage() {
  const [error, setError] = useState('');
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const mode = params.get('mode'), oobCode = params.get('oobCode') || '', back = params.get('continueUrl');
    if (mode !== 'verifyEmail') { location.replace(`https://${auth.config.authDomain}/__/auth/action${location.search}`); return; }
    let active = true;
    (async () => {
      const reply = await fetch(apiUrl('/api/account/verify-email'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oobCode }) })
        .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) as { token?: string; error?: string } }))
        .catch(() => ({ status: 0, body: {} as { token?: string; error?: string } }));
      if (reply.body.token) {
        await signInWithCustomToken(auth, reply.body.token);
        location.replace(safeReturn(back, true)); return;
      }
      // The API could not do it (offline or not set up): verify in this browser instead.
      if (reply.status === 503 || reply.status === 0) await applyActionCode(auth, oobCode);
      else if (reply.status !== 200) throw new Error(reply.body.error || 'Could not verify your email. Try the link again.');
      // Already signed in here, or a personal account: continue, or sign in with the "verified" notice.
      if (auth.currentUser) { await reload(auth.currentUser).catch(() => undefined); location.replace(safeReturn(back, true)); }
      else location.replace(safeReturn(back, false));
    })().catch(e => { if (active) setError(e instanceof Error && !e.message.startsWith('Firebase') ? e.message : 'This link was already used or has expired. Sign in, then send a new link from the verification screen.'); });
    return () => { active = false; };
  }, []);
  return <div className="auth-status-screen" role="status">
    {error
      ? <section className="auth-status-card"><Brand /><h1>Email not verified</h1><p role="alert" className="auth-flow-error">{error}</p><a className="arena-primary auth-submit" href="/">Go to sign in</a></section>
      : <div className="flex flex-col items-center gap-4"><Brand /><div className="flex items-center gap-2 text-(--text-muted) text-sm"><Loader2 className="w-4 h-4 animate-spin" /><span>Verifying your email and signing you in…</span></div></div>}
  </div>;
}
