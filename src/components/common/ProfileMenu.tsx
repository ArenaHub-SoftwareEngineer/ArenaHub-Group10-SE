import React, { useId, useRef } from 'react';
import type { User } from '../../lib/types';
import { ArrowLeft, ChevronDown, HelpCircle, LogOut, Settings2, ShieldCheck } from '../ui/Icons';

export type AccountPanel = 'settings' | 'support';

export function ProfileMenu({ user, placement, onOpenPanel, onSwitch, switchLabel, onLogout, guest = false }: {
  user: User;
  placement: 'above' | 'below';
  onOpenPanel: (panel: AccountPanel) => void;
  onSwitch?: () => void;
  switchLabel?: 'Viewer' | 'Admin console';
  onLogout?: () => void;
  guest?: boolean;
}) {
  const id = useId();
  const popover = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const SwitchIcon = switchLabel === 'Viewer' ? ArrowLeft : ShieldCheck;

  const select = (action: () => void) => {
    popover.current?.hidePopover();
    trigger.current?.focus({ preventScroll: true });
    action();
  };

  const roleLabel = guest ? 'Guest' : user.role.replace('-', ' ');
  return <div className={`profile-menu profile-menu-${placement}`}>
    {/* The visible name is the button's name (voice control: "click Test Student"); the initials are decoration. */}
    <button ref={trigger} type="button" className="profile-trigger"
      popoverTarget={id} onClick={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const panel = popover.current;
        if (!panel) return;
        const width = Math.min(256, window.innerWidth - 16);
        const left = placement === 'above' ? bounds.left : bounds.right - width;
        panel.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
        if (placement === 'above') {
          panel.style.bottom = `${window.innerHeight - bounds.top + 8}px`;
          panel.style.maxHeight = `${bounds.top - 16}px`;
        } else {
          panel.style.top = `${bounds.bottom + 8}px`;
          panel.style.maxHeight = `${window.innerHeight - bounds.bottom - 16}px`;
        }
      }}>
      <span className="identity-avatar h-8 w-8 shrink-0 text-xs" aria-hidden="true">{user.avatarInitials}</span>
      <span className="profile-trigger-name">
        <strong>{user.name}</strong>
        <small>{roleLabel}</small>
        <span className="sr-only">, profile options</span>
      </span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    <div ref={popover} id={id} popover="auto" className="profile-popover" aria-label="Profile options" role="group">
      <div className="profile-menu-identity">
        <strong>{user.name}</strong>
        {user.email && !guest && <small>{user.email}</small>}
      </div>
      <button type="button" onClick={() => select(() => onOpenPanel('settings'))}><Settings2 size={16} /> Settings</button>
      <button type="button" onClick={() => select(() => onOpenPanel('support'))}><HelpCircle size={16} /> Support</button>
      {onSwitch && <button type="button" onClick={() => select(onSwitch)}><SwitchIcon size={16} /> {switchLabel}</button>}
      {onLogout && <div className="profile-menu-signout">
        <button type="button" onClick={() => select(onLogout)}><LogOut size={16} /> {guest ? 'Sign in' : 'Log out'}</button>
      </div>}
    </div>
  </div>;
}
