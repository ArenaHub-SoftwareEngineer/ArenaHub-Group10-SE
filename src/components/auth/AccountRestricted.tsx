import React from 'react';
import { Brand } from '../ui/Brand';
import { Ban, Clock, LogOut } from '../ui/Icons';

const COPY = {
  suspended: {
    icon: Clock,
    title: 'Your account is paused',
    body: 'A tournament organizer suspended this account, so it can’t open ArenaHub for now. Nothing was deleted. Your access comes back as soon as an organizer restores it.',
  },
  banned: {
    icon: Ban,
    title: 'Your account is banned',
    body: 'A tournament organizer banned this account, usually after a chat report or a fair-play violation. If you think this is a mistake, ask your organizer to review it.',
  },
} as const;

/** Shown instead of the app when users/{uid}.status is not "active". Only staff can change that field. */
export function AccountRestricted({ status, email, onSignOut }: { status: 'suspended' | 'banned'; email: string; onSignOut: () => void }) {
  const copy = COPY[status] ?? COPY.suspended, Icon = copy.icon;
  return <div className="auth-status-screen">
    <section className="auth-status-card restricted-card" data-status={status}>
      <Brand />
      <span className="auth-status-icon restricted-icon"><Icon size={25} aria-hidden="true" /></span>
      <h1>{copy.title}</h1>
      <p>{copy.body}</p>
      <dl className="restricted-facts">
        <div><dt>Signed in as</dt><dd>{email}</dd></div>
        <div><dt>Status</dt><dd><span className="status-pill">{status === 'banned' ? 'Banned' : 'Suspended'}</span></dd></div>
      </dl>
      <p className="auth-flow-hint">Give your organizer the email above so they can find your account in Admin, then Users.</p>
      <button className="arena-primary auth-submit" onClick={onSignOut}><LogOut size={16} aria-hidden="true" />Sign out</button>
    </section>
  </div>;
}
