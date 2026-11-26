import React, { useMemo } from 'react';
import { User } from '../../lib/types';
import { Home, CalendarDays, Trophy, PlaySquare, GitBranch, Users, ShieldCheck, Bot, Settings2, HelpCircle } from '../ui/Icons';
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
      { id: 'current-live', label: 'Watch', title: 'Match center', icon: PlaySquare, keywords: 'live stream watch match' },
      { id: 'schedule', label: 'Schedule', icon: CalendarDays, keywords: 'calendar dates times' },
      { id: 'choose-tournament', label: 'Brackets', icon: GitBranch, keywords: 'tournament bracket' },
      { id: 'standings', label: 'Standings', icon: Trophy, keywords: 'rankings table records' },
      { id: 'teams', label: 'Teams', title: 'Players & teams', icon: Users, keywords: 'rosters colleges ranks' },
    ] },
    // Guests who joined with a student invite watch and comment; competing and Arena AI are for campus accounts.
    ...(campus ? [{ label: 'Compete', items: [
      { id: 'integrity', label: 'Anti-cheat', icon: ShieldCheck, keywords: 'required scan companion android windows fair play appeal' },
    ] }] : []),
    { label: 'Account', items: [
      ...(campus ? [{ id: 'ai-assistant', label: 'Assistant', title: 'Arena AI', icon: Bot, keywords: 'assistant ask' }] : []),
      { id: 'support', label: 'Help', title: 'Support', icon: HelpCircle, keywords: 'help faq' },
      { id: 'settings', label: 'Settings', icon: Settings2, keywords: 'profile preferences account' },
    ] },
  ], [campus]);

  const status = isGuest ? 'Preview' : campus ? `${CAMPUS_SHORT_NAME} member` : 'Guest viewer';
  return <div className="spectator-shell">
    <AppShell workspace="arena" context={campus ? CAMPUS_SHORT_NAME : undefined} contextLogo={campus ? CAMPUS_LOGO || undefined : undefined} groups={groups} live={live} navLabel="Viewer navigation" isActive={isActive} onNavigate={onTabChange}
      mobileTabs={['home', 'current-live', 'choose-tournament', 'schedule']} pageKey={activeTab} widePage={['schedule', 'brackets', 'live'].includes(activeTab)}
      routeKey={routeKey} pageTitle={activeTab === 'live' ? 'Match details' : activeTab === 'brackets' ? 'Tournament bracket' : (item => item?.title || item?.label)(groups.flatMap(group => group.items).find(item => item.id === activeTab)) || 'Home'} fullBleed={activeTab === 'ai-assistant'}
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
