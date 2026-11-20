import React, { useState } from 'react';
import { Brand } from '../ui/Brand';
import { Modal } from '../ui/Modal';
import { pendingSpectatorInvite } from '../../lib/campusAccess';
import { AuthScreen, type AuthTab } from './AuthScreen';
import { ArrowRight, QrCode } from '../ui/Icons';
import { ArenaHero } from '../three/ArenaHero';
import { FeatureShowcase } from './FeatureShowcase';
import { GAME_ART_CREDIT } from '../common/GameCover';
import { CAMPUS_SHORT_NAME } from '../../lib/institution';
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
        <div className="auth-entry-header-actions">
          <button type="button" className="arena-outline" onClick={() => handleOpenAuth('qr')}>
            <QrCode size={16} aria-hidden="true" />Scan QR
          </button>
          <button type="button" className="arena-primary" onClick={() => handleOpenAuth('signin')}>Sign in</button>
        </div>
      </header>

      <main className="auth-entry-main">
        <section className="ah-hero is-landing" aria-labelledby="landing-title">
          <div className="ah-hero-copy">
            <p className="ah-hero-kicker">{CAMPUS_SHORT_NAME} esports</p>
            <h1 id="landing-title">Every campus match, live.</h1>
            <p className="ah-hero-sub">Watch the broadcasts, follow the brackets and check the standings for every {CAMPUS_SHORT_NAME} tournament, on your phone or on a big screen.</p>
            <div className="ah-hero-actions">
              <button type="button" className="arena-primary" onClick={() => handleOpenAuth('signin')}>Sign in to ArenaHub <ArrowRight size={16} aria-hidden="true" /></button>
              <button type="button" className="arena-outline" onClick={() => handleOpenAuth('qr')}><QrCode size={16} aria-hidden="true" />Scan spectator QR</button>
            </div>
            <p className="auth-entry-note">Not a student? Scan a current student invitation QR, then sign in or create your own account.</p>
          </div>
          <ArenaHero className="ah-hero-stage" />
        </section>

        <FeatureShowcase onSignIn={() => handleOpenAuth('signin')} />
        <footer className="ah-footer"><span>ArenaHub · {CAMPUS_SHORT_NAME} · 2026</span><span className="ah-footer-credit">{GAME_ART_CREDIT}</span></footer>
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
