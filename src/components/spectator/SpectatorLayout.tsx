import React, { useMemo } from 'react';
import { User } from '../../lib/types';
import { Home, CalendarDays, Trophy, Crown, PlaySquare, GitBranch, Users, ShieldCheck, Bot, Flag, Settings2, HelpCircle } from '../ui/Icons';
import { hasCampusEmail } from '../../lib/campusAccess';
import { CAMPUS_LOGO, CAMPUS_SHORT_NAME } from '../../lib/institution';
import { AppShell, type ShellGroup, type ShellLive } from '../ui/AppShell';
import { ProfileMenu, type AccountPanel } from '../common/ProfileMenu';
import { NotificationBell } from '../common/NotificationBell';

interface SpectatorLayoutProps {
  currentUser: User;
  isGuest?: boolean;
  activeTab: string;
  routeKey: string;
  onTabChange: (tab: string) => void;
  onNotificationNavigate?: (tab: string, entityId?: string) => void;
  onLogout: () => void;
  onOpenAdmin: () => void;
  onOpenAccountPanel: (panel: AccountPanel) => void;
  /** Live matches for the rail's "Live now" list. */
  live?: ShellLive[];
  children: React.ReactNode;
}

export const SpectatorLayout: React.FC<SpectatorLayoutProps> = ({
  currentUser, isGuest = false, activeTab, routeKey, onTabChange, onNotificationNavigate, onLogout, onOpenAdmin, onOpenAccountPanel, live = [], children,
}) => {
  const campus = hasCampusEmail(currentUser.email);
  const canAccessAdmin = campus && ['organizer', 'moderator', 'school-admin', 'admin'].includes(currentUser.role);
  const isActive = (id: string) => id === 'current-live' ? activeTab === 'live' || activeTab === 'current-live'
    : id === 'choose-tournament' ? activeTab === 'brackets' || activeTab === 'choose-tournament' : activeTab === id;

  const groups = useMemo<ShellGroup[]>(() => [
    { label: 'Arena', items: [
      { id: 'home', label: 'Home', icon: Home, keywords: 'start featured' },
      { id: 'current-live', label: 'Match center', short: 'Watch', icon: PlaySquare, keywords: 'live stream watch match' },
      { id: 'schedule', label: 'Schedule', icon: CalendarDays, keywords: 'calendar dates times' },
      { id: 'choose-tournament', label: 'Brackets', icon: GitBranch, keywords: 'tournament bracket' },
      { id: 'standings', label: 'Standings', icon: Trophy, keywords: 'rankings table records' },
      { id: 'leaderboard', label: 'Player leaderboard', short: 'Leaders', icon: Crown, keywords: 'top players kda kills mvp stats rankings' },
      { id: 'teams', label: 'Players & teams', short: 'Teams', icon: Users, keywords: 'rosters colleges ranks' },
    ] },
    { label: 'Participation', items: [
      { id: 'operations', label: 'My team', icon: Flag, keywords: 'registration check-in roster' },
      { id: 'integrity', label: 'Anti-cheat', icon: ShieldCheck, keywords: 'required scan companion android windows fair play appeal' },
    ] },
    { label: 'Help & account', items: [
      { id: 'ai-assistant', label: 'Arena AI', icon: Bot, keywords: 'assistant ask' },
      { id: 'support', label: 'Support', icon: HelpCircle, keywords: 'help faq' },
      { id: 'settings', label: 'Settings', icon: Settings2, keywords: 'profile preferences account' },
    ] },
  ], []);

  const status = isGuest ? 'Preview' : campus ? `${CAMPUS_SHORT_NAME} member` : 'Spectator';
  return <div className="spectator-shell">
    <AppShell workspace="arena" context={campus ? CAMPUS_SHORT_NAME : undefined} contextLogo={campus ? CAMPUS_LOGO || undefined : undefined} groups={groups} live={live} navLabel="Viewer navigation" isActive={isActive} onNavigate={onTabChange}
      mobileTabs={['home', 'current-live', 'choose-tournament', 'schedule']} pageKey={activeTab}
      routeKey={routeKey} pageTitle={activeTab === 'live' ? 'Match details' : activeTab === 'brackets' ? 'Tournament bracket' : groups.flatMap(group => group.items).find(item => item.id === activeTab)?.label || 'Home'} fullBleed={activeTab === 'ai-assistant'}
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
