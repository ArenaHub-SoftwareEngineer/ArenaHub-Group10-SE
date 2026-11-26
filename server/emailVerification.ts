// The "Verify email" link signs the player in, wherever they open it (their phone, the Gmail app's browser).
// The site's own handler (src/components/auth/EmailActionPage.tsx) sends the link's one-time code here. The
// server applies it, which proves the person holds that inbox, the same proof as an email sign-in link, and
// for a campus account returns a Firebase custom token so the browser is signed in without the password.
// Personal (spectator) accounts are only verified: their admission rules require a Google or password sign-in.
import express from 'express';
import { getAuth } from 'firebase-admin/auth';
import { hasCampusEmail } from '../src/lib/institution.ts';
import { adminApp, emulated } from './firebaseAdmin.ts';

type Env = Record<string, string | undefined>;
const CODE = /^[A-Za-z0-9_-]{20,200}$/;

export function createEmailVerificationRouter(env: Env, fetcher: typeof fetch = fetch) {
  const router = express.Router();
  router.use(express.json({ limit: '1kb' }));
  router.post('/verify-email', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const code = typeof req.body?.oobCode === 'string' ? req.body.oobCode : '';
    if (!CODE.test(code)) { res.status(400).json({ error: 'This verification link is not valid.' }); return; }
    const app = adminApp(env), key = env.VITE_FIREBASE_API_KEY;
    if (!app || !key) { res.status(503).json({ error: 'unavailable' }); return; }
    const host = emulated(env) ? 'http://127.0.0.1:9098/identitytoolkit.googleapis.com' : 'https://identitytoolkit.googleapis.com';
    let email = '';
    try {
      const reply = await fetcher(`${host}/v1/accounts:update?key=${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oobCode: code }), signal: AbortSignal.timeout(8000),
      });
      const body = await reply.json().catch(() => ({})) as { email?: string; error?: { message?: string } };
      if (!reply.ok) {
        const reason = String(body.error?.message || '');
        const used = /INVALID_OOB_CODE|EXPIRED_OOB_CODE/.test(reason);
        res.status(400).json({ error: used ? 'This link was already used or has expired. Sign in, then send a new link from the verification screen.' : 'Could not verify your email. Try the link again.', code: used ? 'used' : 'failed' });
        return;
      }
      email = String(body.email || '').toLowerCase();
    } catch { res.status(502).json({ error: 'Could not reach Firebase. Check your connection and open the link again.' }); return; }

    try {
      const user = await getAuth(app).getUserByEmail(email);
      if (!user.emailVerified || user.disabled) { res.json({ verified: user.emailVerified, email }); return; }
      if (!hasCampusEmail(user.email)) { res.json({ verified: true, email }); return; }
      res.json({ verified: true, email, token: await getAuth(app).createCustomToken(user.uid) });
    } catch { res.json({ verified: true, email }); }
  });
  return router;
}
