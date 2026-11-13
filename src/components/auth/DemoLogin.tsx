import React, { useState } from 'react';
import { useAuth } from '../../lib/authContext';

// LOCAL DEMO ONLY. These accounts exist only in the Firebase emulator (tests/seed-emulators.mjs).
// This file is loaded only when the site is built for the emulator (npm run demo); the production build
// leaves it out entirely, and scripts/check-production-build.mjs fails the build if it ever slips in.
const ACCOUNTS = [
  { label: 'Admin', detail: 'Test Organizer · full staff access', email: 'organizer@wmsu.edu.ph' },
  { label: 'Player', detail: 'Test Student · regular user', email: 'student@wmsu.edu.ph' },
];
const PASSWORD = 'ArenaHub-QA-Only-27!';

export default function DemoLogin({ onSuccess }: { onSuccess?: () => void }) {
  const { signInWithEmail } = useAuth();
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const use = async (email: string) => {
    setBusy(email); setError('');
    try { const result = await signInWithEmail(email, PASSWORD); if (result.error) setError(`${result.error} Is npm run demo still running?`); else onSuccess?.(); }
    catch { setError('The local test accounts are not reachable. Start the demo with npm run demo.'); }
    finally { setBusy(''); }
  };
  return <section className="demo-login" aria-label="Local test accounts">
    <p><strong>Local demo</strong> · test accounts, not on the real site</p>
    <div>{ACCOUNTS.map(account => <button key={account.email} type="button" className="arena-outline" disabled={!!busy} onClick={() => void use(account.email)}>
      <strong>{busy === account.email ? 'Signing in…' : `Sign in as ${account.label}`}</strong><small>{account.detail}</small>
    </button>)}</div>
    {error && <p className="auth-flow-error" role="alert">{error}</p>}
  </section>;
}
