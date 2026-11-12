import React, { useState } from 'react';
import { Brand } from '../ui/Brand';
import { Modal } from '../ui/Modal';
import { ArenaScene } from '../spectator/ArenaScene';
import { pendingSpectatorInvite } from '../../lib/campusAccess';
import { AuthScreen } from './AuthScreen';
import { KeyRound, QrCode } from '../ui/Icons';

/** The welcome page is public; application modules mount only after authentication. */
export function AuthEntry() {
  const [open, setOpen] = useState(() => Boolean(pendingSpectatorInvite()));
  const [authTab, setAuthTab] = useState<'signin' | 'signup' | 'qr'>(() => pendingSpectatorInvite() ? 'qr' : 'signin');

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
            <QrCode className="w-3.5 h-3.5 text-[#ff6600]" />
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
            <button
              className="arena-primary flex items-center gap-2"
              onClick={() => handleOpenAuth('signin')}
            >
              <KeyRound className="w-4 h-4" />
              <span>Sign in to ArenaHub</span>
              <span aria-hidden="true">↗</span>
            </button>

            <button
              type="button"
              className="arena-outline flex items-center gap-2"
              onClick={() => handleOpenAuth('qr')}
            >
              <QrCode className="w-4 h-4 text-[#ff6600]" />
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
        title="Welcome to ArenaHub"
        onClose={() => setOpen(false)}
        className="auth-entry-dialog max-w-md w-full"
      >
        {open && <AuthScreen initialTab={authTab} onSuccess={() => setOpen(false)} />}
      </Modal>
    </div>
  );
}
