import React, { useMemo } from 'react';
import { User } from '../../lib/types';
import { ShieldAlert, Sparkles, LayoutDashboard, Users as UsersIcon, Gamepad2, AlertTriangle, CalendarDays, GitBranch, ClipboardList, Radio, Settings2, HelpCircle, History } from '../ui/Icons';
import { AppShell, type ShellGroup, type ShellLive } from '../ui/AppShell';
import { ProfileMenu, type AccountPanel } from '../common/ProfileMenu';
import { NotificationBell } from '../common/NotificationBell';

interface AdminLayoutProps {
  currentUser: User;
  activeTab: string;
  routeKey: string;
  onTabChange: (tab: string) => void;
  onNotificationNavigate?: (tab: string, entityId?: string) => void;
  onExitToSpectator: () => void;
  onLogout?: () => void;
  onOpenAccountPanel: (panel: AccountPanel) => void;
  openReportsCount: number;
  /** Live matches for the rail's "Live now" list. */
  live?: ShellLive[];
  children: React.ReactNode;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({
  currentUser, activeTab, routeKey, onTabChange, onNotificationNavigate, onExitToSpectator, onLogout, onOpenAccountPanel, openReportsCount, live = [], children,
}) => {
  const groups = useMemo<ShellGroup[]>(() => [
    { label: 'Events', items: [
      { id: 'overview', label: 'Overview', icon: LayoutDashboard, keywords: 'home dashboard schedule' },
      { id: 'operations', label: 'Desk', title: 'Tournament desk', icon: ClipboardList, keywords: 'registration roster check-in policy' },
      { id: 'bracket-studio', label: 'Brackets', title: 'Bracket Studio', icon: GitBranch, keywords: 'create publish tournament' },
      { id: 'schedule', label: 'Schedule', title: 'Match schedule', icon: CalendarDays, keywords: 'schedule calendar dates match times' },
    ] },
    { label: 'Media', items: [
      { id: 'live-stream', label: 'Broadcast', title: 'Broadcast desk', icon: Radio, keywords: 'stream youtube facebook live' },
    ] },
    { label: 'Manage', items: [
      { id: 'users', label: 'Users', icon: UsersIcon, keywords: 'people accounts roles' },
      { id: 'games', label: 'Games', title: 'Game catalog', icon: Gamepad2, keywords: 'categories titles' },
      { id: 'reports', label: 'Reports', title: 'Community reports', icon: AlertTriangle, badge: { kind: 'count', value: openReportsCount }, keywords: 'issues flags match cases appeals evidence' },
      { id: 'logs', label: 'Logs', title: 'System log', icon: History, keywords: 'activity audit history events what happened' },
      { id: 'match-monitor', label: 'Monitor', title: 'Anti-cheat', icon: ShieldAlert, keywords: 'live player screens anti-cheat device scan pairing qr phone cheating' },
    ] },
    { label: 'Account', items: [
      { id: 'ai-assistant', label: 'Assistant', title: 'Arena AI', icon: Sparkles, keywords: 'assistant ask' },
      { id: 'support', label: 'Help', title: 'Support', icon: HelpCircle, keywords: 'help faq' },
      { id: 'settings', label: 'Settings', icon: Settings2, keywords: 'profile preferences account' },
    ] },
  ], [openReportsCount]);

  const profile = (placement: 'above' | 'below') => <ProfileMenu user={currentUser} placement={placement} onOpenPanel={onOpenAccountPanel}
    onSwitch={onExitToSpectator} switchLabel="Viewer" onLogout={onLogout} />;

  return <AppShell workspace="admin" context="Admin" groups={groups} live={live} navLabel="Admin navigation" isActive={id => id === activeTab} onNavigate={onTabChange}
    mobileTabs={['overview', 'bracket-studio', 'live-stream', 'schedule']} pageKey={activeTab}
    routeKey={routeKey} pageTitle={(item => item?.title || item?.label)(groups.flatMap(group => group.items).find(item => item.id === activeTab)) || 'Overview'}
    fullBleed={activeTab === 'ai-assistant'} widePage={['schedule', 'bracket-studio', 'live-stream'].includes(activeTab)}
    actions={<><NotificationBell staff onNavigate={onNotificationNavigate || onTabChange} />{profile('below')}</>}>
    {children}
  </AppShell>;
};
