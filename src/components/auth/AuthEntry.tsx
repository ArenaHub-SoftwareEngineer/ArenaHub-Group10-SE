import React, { useState } from 'react';
import { Brand } from '../ui/Brand';
import { Modal } from '../ui/Modal';
import { pendingSpectatorInvite } from '../../lib/campusAccess';
import { AuthScreen, type AuthTab } from './AuthScreen';
import { QrCode } from '../ui/Icons';
import { LandingPage } from './landing/LandingPage';
import './landing/landing.css';
import { ACCOUNT_RETURN_MESSAGE, takeAccountReturn } from '../../lib/emailLinks';
import { localAccountAccess } from '../../lib/localAccountAccess';

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
  const [open, setOpen] = useState(() => Boolean(pendingSpectatorInvite() || accountReturn || localAccountAccess));
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
        <div className="auth-entry-header-actions">
          <button type="button" className="arena-outline" onClick={() => handleOpenAuth('qr')}>
            <QrCode size={16} aria-hidden="true" />Scan QR
          </button>
          <button type="button" className="arena-primary" onClick={() => handleOpenAuth('signin')}>Sign in</button>
        </div>
      </header>

      <main className="auth-entry-main is-poster">
        <LandingPage onOpenAuth={handleOpenAuth} />
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
