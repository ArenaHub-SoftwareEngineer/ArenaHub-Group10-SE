import React, { useMemo } from 'react';
import { User } from '../../lib/types';
import { Home, CalendarDays, Trophy, PlaySquare, GitBranch, Users, ShieldCheck, Bot, Flag } from '../ui/Icons';
import { hasCampusEmail } from '../../lib/campusAccess';
import { AppShell, type ShellGroup, type ShellLive } from '../ui/AppShell';
import { ProfileMenu, type AccountPanel } from '../common/ProfileMenu';
import { NotificationBell } from '../common/NotificationBell';

interface SpectatorLayoutProps {
  currentUser: User;
  isGuest?: boolean;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onNotificationNavigate?: (tab: string, entityId?: string) => void;
  onLogout: () => void;
  onOpenAdmin: () => void;
  onOpenAccountPanel: (panel: AccountPanel) => void;
  /** Kept for callers; the new top bar shows search instead of a breadcrumb. */
  breadcrumb?: string;
  /** Live matches for the rail's "Live now" list. */
  live?: ShellLive[];
  children: React.ReactNode;
}

export const SpectatorLayout: React.FC<SpectatorLayoutProps> = ({
  currentUser, isGuest = false, activeTab, onTabChange, onNotificationNavigate, onLogout, onOpenAdmin, onOpenAccountPanel, live = [], children,
}) => {
  const campus = hasCampusEmail(currentUser.email);
  const canAccessAdmin = campus && ['organizer', 'moderator', 'school-admin', 'admin'].includes(currentUser.role);
  const isActive = (id: string) => id === 'current-live' ? activeTab === 'live' || activeTab === 'current-live'
    : id === 'brackets' ? activeTab === 'brackets' || activeTab === 'choose-tournament' : activeTab === id;

  const groups = useMemo<ShellGroup[]>(() => [
    { label: 'Discover', items: [
      { id: 'home', label: 'Home', icon: Home, keywords: 'start featured' },
      { id: 'current-live', label: 'Match center', short: 'Live', icon: PlaySquare, keywords: 'live stream watch' },
      { id: 'brackets', label: 'Brackets', icon: GitBranch, keywords: 'tournament bracket' },
      { id: 'teams', label: 'Teams', icon: Users, keywords: 'players rosters colleges' },
      { id: 'schedule', label: 'Schedule', icon: CalendarDays, keywords: 'calendar dates times' },
      { id: 'standings', label: 'Standings', icon: Trophy, keywords: 'rankings table records' },
    ] },
    { label: 'You', items: [
      { id: 'operations', label: 'My team', icon: Flag, keywords: 'registration check-in roster' },
      { id: 'ai-assistant', label: 'Arena AI', icon: Bot, badge: { kind: 'ai' }, keywords: 'assistant ask help' },
      { id: 'integrity', label: 'Fair play', icon: ShieldCheck, keywords: 'report cheating appeal' },
    ] },
  ], []);

  const status = isGuest ? 'Preview' : campus ? 'WMSU member' : 'Spectator';
  return <div className="spectator-shell">
    <AppShell context={campus ? 'WMSU' : undefined} groups={groups} live={live} navLabel="Viewer navigation" isActive={isActive} onNavigate={onTabChange}
      mobileTabs={['home', 'current-live', 'brackets', 'schedule', 'ai-assistant']} pageKey={activeTab} fullBleed={activeTab === 'ai-assistant'}
      actions={<>
        <span className="shell-status" title={status}><i aria-hidden="true" />{status}</span>
        <NotificationBell onNavigate={onNotificationNavigate || onTabChange} />
        <ProfileMenu user={currentUser} placement="below" onOpenPanel={onOpenAccountPanel}
          onSwitch={canAccessAdmin ? onOpenAdmin : undefined} switchLabel="Admin console" onLogout={onLogout} guest={isGuest} />
      </>}>
      {children}
    </AppShell>
  </div>;
};
