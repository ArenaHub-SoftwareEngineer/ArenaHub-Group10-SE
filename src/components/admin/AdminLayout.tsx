import React, { useMemo } from 'react';
import { User } from '../../lib/types';
import { Shield, ShieldAlert, Sparkles, LayoutDashboard, Users as UsersIcon, Gamepad2, AlertTriangle, Star, GitBranch, ClipboardList, Radio, Swords } from '../ui/Icons';
import { AppShell, type ShellGroup } from '../ui/AppShell';
import { ProfileMenu, type AccountPanel } from '../common/ProfileMenu';
import { NotificationBell } from '../common/NotificationBell';

interface AdminLayoutProps {
  currentUser: User;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onNotificationNavigate?: (tab: string, entityId?: string) => void;
  onExitToSpectator: () => void;
  onLogout?: () => void;
  onOpenAccountPanel: (panel: AccountPanel) => void;
  openReportsCount: number;
  children: React.ReactNode;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({
  currentUser, activeTab, onTabChange, onNotificationNavigate, onExitToSpectator, onLogout, onOpenAccountPanel, openReportsCount, children,
}) => {
  const groups = useMemo<ShellGroup[]>(() => [
    { label: 'Workspace', items: [
      { id: 'overview', label: 'Home', icon: LayoutDashboard, keywords: 'dashboard schedule overview' },
      { id: 'bracket-studio', label: 'Brackets', icon: GitBranch, keywords: 'bracket studio create publish' },
      { id: 'operations', label: 'Tournament desk', short: 'Desk', icon: ClipboardList, keywords: 'registration roster check-in policy' },
      { id: 'match-data', label: 'Matches', icon: Swords, keywords: 'stats kda score data entry' },
      { id: 'live-stream', label: 'Stream', icon: Radio, keywords: 'broadcast youtube facebook live' },
    ] },
    { label: 'Manage', items: [
      { id: 'users', label: 'Users', icon: UsersIcon, keywords: 'people accounts roles' },
      { id: 'games', label: 'Games', icon: Gamepad2, keywords: 'categories catalog' },
      { id: 'reports', label: 'Reports', icon: AlertTriangle, badge: { kind: 'count', value: openReportsCount }, keywords: 'issues flags' },
      { id: 'integrity', label: 'Fair play', icon: Shield, keywords: 'cheating cases appeals evidence' },
      { id: 'match-monitor', label: 'Match monitor', short: 'Monitor', icon: ShieldAlert, keywords: 'anti-cheat device pairing qr phone' },
      { id: 'featured', label: 'Spotlight', icon: Star, keywords: 'featured highlights' },
    ] },
    { label: 'Tools', items: [
      { id: 'ai-assistant', label: 'Ask', icon: Sparkles, badge: { kind: 'ai' }, keywords: 'assistant ai help' },
    ] },
  ], [openReportsCount]);

  const profile = (placement: 'above' | 'below') => <ProfileMenu user={currentUser} placement={placement} onOpenPanel={onOpenAccountPanel}
    onSwitch={onExitToSpectator} switchLabel="Viewer" onLogout={onLogout} />;

  return <AppShell context="Admin" groups={groups} navLabel="Admin navigation" isActive={id => id === activeTab} onNavigate={onTabChange}
    mobileTabs={['overview', 'bracket-studio', 'live-stream', 'match-data', 'ai-assistant']} pageKey={activeTab} fullBleed={activeTab === 'ai-assistant'}
    actions={<><NotificationBell staff onNavigate={onNotificationNavigate || onTabChange} />{profile('below')}</>}>
    {children}
  </AppShell>;
};
