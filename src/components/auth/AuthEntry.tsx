import React, { useState } from 'react';
import { Brand } from '../ui/Brand';
import { Modal } from '../ui/Modal';
import { pendingSpectatorInvite } from '../../lib/campusAccess';
import { AuthScreen, type AuthTab } from './AuthScreen';
import { QrCode, ShieldCheck } from '../ui/Icons';
import { LandingPage } from './landing/LandingPage';
import './landing/landing.css';
import { ACCOUNT_RETURN_MESSAGE, takeAccountReturn, type AccountReturn } from '../../lib/emailLinks';
import { localAccountAccess } from '../../lib/localAccountAccess';

const DIALOG_TITLE: Record<AuthTab, string> = {
  signin: 'Welcome back',
  signup: 'Create your account',
  qr: 'Scan a QR invitation',
  reset: 'Reset your password',
};

/** A signed-out player opened a match check-in link: sign in first, then the same link shows the check-in. */
export interface CheckInGate { match: string; accountReturn: AccountReturn | null }

/** The welcome page is public; application modules mount only after authentication. */
export function AuthEntry({ checkIn }: { checkIn?: CheckInGate }) {
  // Coming back from a verification, password-reset or email-change link opens sign-in with a message.
  // On a check-in link PlayerCheckIn already read that message from the address, so it arrives as a prop.
  const [accountReturn, setAccountReturn] = useState(() => checkIn ? checkIn.accountReturn : takeAccountReturn());
  // A check-in link opens sign-in straight away: signing in is the only thing the player can do here.
  const [open, setOpen] = useState(() => Boolean(checkIn || pendingSpectatorInvite() || accountReturn || localAccountAccess));
  const [authTab, setAuthTab] = useState<'signin' | 'signup' | 'qr'>(() => !checkIn && pendingSpectatorInvite() && !accountReturn ? 'qr' : 'signin');
  const [shownTab, setShownTab] = useState<AuthTab>(authTab);

  // Spectator invitations do not apply to player check-in, so every QR button opens sign-in there.
  const handleOpenAuth = (tab: 'signin' | 'signup' | 'qr') => {
    setAuthTab(checkIn && tab === 'qr' ? 'signin' : tab);
    setOpen(true);
  };
  const checkInNotice = checkIn ? `Sign in first to check in${checkIn.match ? ` for ${checkIn.match}` : ''}. You come straight back here after.` : '';
  const notice = accountReturn ? ACCOUNT_RETURN_MESSAGE[accountReturn] : checkInNotice;

  return (
    <div className="auth-entry">
      <header className="auth-entry-header">
        <Brand />
        <div className="auth-entry-header-actions">
          {!checkIn && <button type="button" className="arena-outline" onClick={() => handleOpenAuth('qr')}>
            <QrCode size={16} aria-hidden="true" />Scan QR
          </button>}
          <button type="button" className="arena-primary" onClick={() => handleOpenAuth('signin')}>Sign in</button>
        </div>
      </header>

      {checkIn && <div className="auth-entry-checkin" role="status">
        <ShieldCheck size={18} aria-hidden="true" />
        <p><strong>Sign in first to check in{checkIn.match ? ` for ${checkIn.match}` : ''}.</strong> After you sign in or create your account, this page opens your match check-in.</p>
        <div className="auth-entry-checkin-actions">
          <button type="button" className="arena-primary" onClick={() => handleOpenAuth('signin')}>Sign in</button>
          <button type="button" className="arena-outline" onClick={() => handleOpenAuth('signup')}>Create an account</button>
        </div>
      </div>}

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
        {open && <AuthScreen initialTab={authTab} initialNotice={notice} playerCheckIn={Boolean(checkIn)} onTabChange={setShownTab} onSuccess={() => setOpen(false)} />}
      </Modal>
    </div>
  );
}
