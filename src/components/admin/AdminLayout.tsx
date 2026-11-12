import React, { useState } from 'react';
import { User } from '../../lib/types';
import {
  Shield,
  Bell,
  Sparkles,
  LayoutDashboard,
  Users as UsersIcon,
  Gamepad2,
  AlertTriangle,
  Star,
  GitBranch,
  ClipboardList,
  Radio,
  Menu,
  X,
} from '../ui/Icons';
import { Brand } from '../ui/Brand';
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

const ALL_TABS = [
  { id: 'overview', label: 'Home', shortLabel: 'Home', icon: LayoutDashboard, isAi: false },
  { id: 'bracket-studio', label: 'Brackets', shortLabel: 'Brackets', icon: GitBranch, isAi: false },
  { id: 'ai-assistant', label: 'Ask', shortLabel: 'Ask', icon: Sparkles, isAi: true },
  { id: 'match-data', label: 'Matches', shortLabel: 'Matches', icon: ClipboardList, isAi: false },
  { id: 'live-stream', label: 'Stream', shortLabel: 'Stream', icon: Radio, isLive: true },
  { id: 'users', label: 'Users', shortLabel: 'Users', icon: UsersIcon },
  { id: 'games', label: 'Games', shortLabel: 'Games', icon: Gamepad2 },
  { id: 'reports', label: 'Reports', shortLabel: 'Reports', icon: AlertTriangle },
  { id: 'integrity', label: 'Fair play', shortLabel: 'Fair play', icon: Shield },
  { id: 'operations', label: 'Tournament desk', shortLabel: 'Tournament desk', icon: ClipboardList },
  { id: 'featured', label: 'Spotlight', shortLabel: 'Spotlight', icon: Star },
];

const ADMIN_NAV_GROUPS = [
  { label: 'Workspace', ids: ['overview', 'bracket-studio', 'operations', 'match-data', 'live-stream'] },
  { label: 'Manage', ids: ['users', 'games', 'reports', 'integrity', 'featured'] },
  { label: 'Tools', ids: ['ai-assistant'] },
];

// Bottom nav shows the 5 most-used tabs on mobile
const MOBILE_BOTTOM_TABS = [
  { id: 'overview', label: 'Home', icon: LayoutDashboard },
  { id: 'bracket-studio', label: 'Brackets', icon: GitBranch },
  { id: 'live-stream', label: 'Stream', icon: Radio },
  { id: 'match-data', label: 'Matches', icon: ClipboardList },
  { id: 'ai-assistant', label: 'Ask', icon: Sparkles },
];

export const AdminLayout: React.FC<AdminLayoutProps> = ({
  currentUser,
  activeTab,
  onTabChange,
  onNotificationNavigate,
  onExitToSpectator,
  onLogout,
  onOpenAccountPanel,
  openReportsCount,
  children,
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleTabChange = (tab: string) => {
    onTabChange(tab);
    setIsMobileMenuOpen(false);
  };

  const activeTabMeta = ALL_TABS.find((t) => t.id === activeTab);

  return (
    <div className="app-shell flex overflow-x-hidden">
      {/* ── Desktop Sidebar (hidden on mobile) ── */}
      <aside className="app-sidebar hidden lg:flex w-64 border-r flex-col justify-between shrink-0 sticky top-0 h-screen">
        <div>
          {/* Logo */}
          <div className="h-16 px-5 border-b border-[var(--border)] flex items-center justify-between">
            <Brand context="Admin" />
            <Shield className="w-4 h-4 text-[var(--text-muted)]" />
          </div>

          {/* Nav */}
          <nav className="px-3 py-4 space-y-4">
            {ADMIN_NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <span className="nav-section-label">{group.label}</span>
                <div className="space-y-0.5">
                  {group.ids.map((id) => ALL_TABS.find((tab) => tab.id === id)!).map((tab) => {
                    const isActive = activeTab === tab.id;
                    const Icon = tab.icon;
                    return (
                      <button key={tab.id} data-tab={tab.id} aria-current={isActive ? "page" : undefined} onClick={() => handleTabChange(tab.id)} className={`nav-item ${isActive ? 'nav-item-active' : ''}`}>
                        <Icon className="w-4 h-4" />
                        <span>{tab.label}</span>
                        {tab.id === 'reports' && openReportsCount > 0 && <span className="nav-meta-badge">{openReportsCount}</span>}
                        {tab.isAi && <span className="nav-meta-badge">AI</span>}
                        {(tab as any).isLive && <span className="nav-meta-badge">Live</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>

        <div className="p-3 border-t border-[var(--border)]">
          <ProfileMenu user={currentUser} placement="above" onOpenPanel={onOpenAccountPanel}
            onSwitch={onExitToSpectator} switchLabel="Viewer" onLogout={onLogout} />
        </div>
      </aside>

      {/* ── Mobile slide-over menu overlay ── */}
      {isMobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 flex"
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="app-sidebar relative w-72 max-w-[85vw] border-r flex flex-col justify-between h-full shadow-2xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              {/* Header */}
              <div className="app-sidebar p-4 border-b border-[var(--border)] flex items-center justify-between sticky top-0 z-10">
                <Brand context="Admin" />
                <button
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="p-2 rounded-[4px] text-[#666666] hover:text-white hover:bg-[#2A2A2A] transition-colors cursor-pointer"
                >
                  <X aria-label="Close navigation" className="w-5 h-5" />
                </button>
              </div>

              {/* All tabs */}
              <nav className="p-3 space-y-1">
                {ALL_TABS.map((tab) => {
                  const isActive = activeTab === tab.id;
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => handleTabChange(tab.id)}
                      className={`nav-item min-h-11 ${isActive ? 'nav-item-active' : ''}`}
                    >
                      <Icon className="w-5 h-5" />
                      <span>{tab.label}</span>
                      {tab.id === 'reports' && openReportsCount > 0 && (
                        <span className="ml-auto w-5 h-5 rounded-full bg-[#E8544B] text-white text-[9px] font-bold flex items-center justify-center">
                          {openReportsCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>

          </div>
        </div>
      )}

      {/* ── Main Content ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <header className="app-topbar h-16 border-b px-4 lg:px-7 flex items-center justify-between shrink-0 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            {/* Hamburger (mobile/tablet) */}
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-[4px] text-[#888888] hover:text-white hover:bg-[#252525] transition-colors cursor-pointer"
            >
              <Menu aria-label="Open navigation" className="w-5 h-5" />
            </button>

            {/* Mobile logo + active tab */}
            <div className="lg:hidden flex items-center gap-2">
              <Brand compact />
              <span className="text-[#555555]">/</span>
              <span className="text-sm font-medium text-white capitalize">
                {activeTabMeta?.shortLabel || activeTab}
              </span>
            </div>

            {/* Desktop breadcrumb */}
            <div className="hidden lg:flex items-center gap-2 text-xs text-[#888888]">
              <button className="hover:text-white" onClick={() => onTabChange('overview')}>
                ArenaHub
              </button>
              <span>/</span>
              <span className="text-[#888888]">Admin</span>
              <span>/</span>
              <span className="text-white font-medium capitalize">
                {activeTabMeta?.label || activeTab}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <NotificationBell staff onNavigate={onNotificationNavigate || handleTabChange} />

            <ProfileMenu user={currentUser} placement="below" onOpenPanel={onOpenAccountPanel}
              onSwitch={onExitToSpectator} switchLabel="Viewer" onLogout={onLogout} />
          </div>
        </header>

        {/* Main Content */}
        <main
          className={`flex-1 relative overflow-y-auto ${
            activeTab === 'ai-assistant'
              ? 'p-0 overflow-hidden flex flex-col h-[calc(100vh-4rem)] md:h-[calc(100dvh-4rem)] max-h-[calc(100vh-4rem)] md:max-h-[calc(100dvh-4rem)]'
              : 'p-4 lg:p-8 pb-24 lg:pb-8 max-w-7xl mx-auto w-full'
          }`}
        >
          {children}
        </main>
      </div>

      {/* ── Mobile Bottom Navigation Bar ── */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-[#141414]/95 backdrop-blur-md border-t border-[#2A2A2A] flex items-stretch">
        {MOBILE_BOTTOM_TABS.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => handleTabChange(id)}
              aria-current={active ? 'page' : undefined}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 min-h-[56px] relative transition-colors cursor-pointer ${
                active ? 'text-white' : 'text-[#555555] hover:text-[#AAAAAA]'
              }`}
            >
              <Icon className={`w-5 h-5 ${active ? 'stroke-[2]' : 'stroke-[1.5]'}`} />
              <span className={`text-[9px] font-semibold tracking-wide ${active ? 'text-white' : ''}`}>
                {label}
              </span>
              {id === 'reports' && openReportsCount > 0 && (
                <span className="absolute top-1.5 right-1/4 w-4 h-4 rounded-full bg-[#E8544B] text-white text-[8px] font-bold flex items-center justify-center">
                  {openReportsCount}
                </span>
              )}
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-white" />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
};
