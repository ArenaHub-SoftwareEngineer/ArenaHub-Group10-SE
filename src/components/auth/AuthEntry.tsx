import React, { useState } from 'react';
import { Brand } from '../ui/Brand';
import { Modal } from '../ui/Modal';
import { ArenaScene } from '../spectator/ArenaScene';
import { pendingSpectatorInvite } from '../../lib/campusAccess';
import { AuthScreen, type AuthTab } from './AuthScreen';
import { QrCode } from '../ui/Icons';
import { ACCOUNT_RETURN_MESSAGE, takeAccountReturn } from '../../lib/emailLinks';

const DIALOG_TITLE: Record<AuthTab, string> = {
  signin: 'Welcome back',
  signup: 'Create your account',
  qr: 'Scan a QR invitation',
  reset: 'Reset your password',
};

/** The welcome page is public; application modules mount only after authentication. */
export function AuthEntry() {
  // Coming back from a verification, password-reset or email-change link opens sign-in with a message.
  const [accountReturn, setAccountReturn] = useState(takeAccountReturn);
  const [open, setOpen] = useState(() => Boolean(pendingSpectatorInvite() || accountReturn));
  const [authTab, setAuthTab] = useState<'signin' | 'signup' | 'qr'>(() => pendingSpectatorInvite() && !accountReturn ? 'qr' : 'signin');
  const [shownTab, setShownTab] = useState<AuthTab>(authTab);

  const handleOpenAuth = (tab: 'signin' | 'signup' | 'qr') => {
    setAuthTab(tab);
    setOpen(true);
  };

  return (
    <div className="auth-entry">
      <header className="auth-entry-header">
        <Brand />
        <div className="flex items-center gap-2">
          <button
            className="arena-outline text-xs flex items-center gap-1.5"
            onClick={() => handleOpenAuth('qr')}
          >
            <QrCode className="w-3.5 h-3.5 text-(--brand-ink)" />
            <span>Scan QR</span>
          </button>
          <button className="arena-primary text-xs" onClick={() => handleOpenAuth('signin')}>
            Sign in
          </button>
        </div>
      </header>

      <main className="auth-entry-hero">
        <div className="auth-entry-copy">
          <p className="auth-entry-eyebrow">Campus esports</p>
          <h1>
            Your campus.
            <br />
            Your squad.
            <br />
            <span>Your arena.</span>
          </h1>
          <p>
            Find upcoming matches, follow your teams, and explore tournament brackets in one
            place.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button className="arena-primary" onClick={() => handleOpenAuth('signin')}>
              Sign in to ArenaHub
            </button>

            <button
              type="button"
              className="arena-outline flex items-center gap-2"
              onClick={() => handleOpenAuth('qr')}
            >
              <QrCode className="w-4 h-4 text-(--brand-ink)" />
              <span>Scan spectator QR</span>
            </button>
          </div>

          <p className="auth-entry-note">
            Joining as a spectator? Scan a current student invitation QR, then sign in
            or create your own account.
          </p>
        </div>

        <div className="auth-entry-feature auth-entry-media">
          <ArenaScene />
        </div>
      </main>

      <Modal
        open={open}
        title={DIALOG_TITLE[shownTab]}
        icon={<img src="/arenahub-logo.svg" alt="" width="424" height="508" />}
        onClose={() => { setOpen(false); setAccountReturn(null); }}
        className="auth-entry-dialog"
      >
        {open && <AuthScreen initialTab={authTab} initialNotice={accountReturn ? ACCOUNT_RETURN_MESSAGE[accountReturn] : ''} onTabChange={setShownTab} onSuccess={() => setOpen(false)} />}
      </Modal>
    </div>
  );
}
