import React, { useState } from 'react';
import { User } from '../../lib/types';
import {
  Home,
  CalendarDays,
  Trophy,
  PlaySquare,
  GitBranch,
  Users,
  ShieldCheck,
  Clock,
  Bell,
  Bot,
  Menu,
  X,
} from '../ui/Icons';
import { hasCampusEmail } from '../../lib/campusAccess';
import { Brand } from '../ui/Brand';
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
  breadcrumb?: string;
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'current-live', label: 'Match center', icon: PlaySquare },
  { id: 'brackets', label: 'Brackets', icon: GitBranch },
  { id: 'teams', label: 'Teams', icon: Users },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'standings', label: 'Standings', icon: Trophy },
  { id: 'integrity', label: 'Fair play', icon: ShieldCheck },
  { id: 'operations', label: 'My team', icon: Users },
  { id: 'ai-assistant', label: 'Arena AI', icon: Bot },
];

const SPECTATOR_NAV_GROUPS = [
  { label: 'Discover', ids: ['home', 'current-live', 'brackets', 'teams', 'schedule', 'standings'] },
  { label: 'Tools', ids: ['operations', 'ai-assistant', 'integrity'] },
];

export const SpectatorLayout: React.FC<SpectatorLayoutProps> = ({
  currentUser,
  isGuest = false,
  activeTab,
  onTabChange,
  onNotificationNavigate,
  onLogout,
  onOpenAdmin,
  onOpenAccountPanel,
  breadcrumb = 'Good afternoon, Riley',
  children,
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const canAccessAdmin = hasCampusEmail(currentUser.email) && (
    currentUser.role === 'organizer' ||
    currentUser.role === 'moderator' ||
    currentUser.role === 'school-admin' ||
    currentUser.role === 'admin');

  const isActiveLive = activeTab === 'live' || activeTab === 'current-live';
  const isActiveBrackets = activeTab === 'brackets' || activeTab === 'choose-tournament';

  const handleTabChange = (tab: string) => {
    onTabChange(tab);
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="app-shell spectator-shell flex overflow-x-hidden">
      {/* ── Desktop Sidebar (hidden on mobile) ── */}
      <aside className="app-sidebar hidden md:flex w-48 lg:w-60 xl:w-64 border-r flex-col justify-between shrink-0 sticky top-0 h-dvh overflow-y-auto">
        <div>
          {/* Logo */}
          <div className="h-16 px-5 border-b border-[var(--border)] flex items-center">
            <Brand context={hasCampusEmail(currentUser.email) ? 'WMSU' : undefined} />
          </div>

          {/* Primary Nav */}
          <nav aria-label="Viewer navigation" className="px-3 py-4 space-y-4">
            {SPECTATOR_NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <span className="nav-section-label">{group.label}</span>
                <div className="space-y-0.5">
                  {group.ids.map((id) => NAV_ITEMS.find((item) => item.id === id)!).map(({ id, label, icon: Icon }) => {
                    const active = id === 'current-live' ? isActiveLive : id === 'brackets' ? isActiveBrackets : activeTab === id;
                    return (
                      <button key={id} data-tab={id} aria-current={active ? "page" : undefined} onClick={() => handleTabChange(id)} className={`nav-item ${active ? 'nav-item-active' : ''}`}>
                        <Icon className="w-4 h-4" />
                        <span>{label}</span>
                        {id === 'ai-assistant' && <span className="nav-meta-badge">AI</span>}
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
            onSwitch={canAccessAdmin ? onOpenAdmin : undefined} switchLabel="Admin console" onLogout={onLogout} guest={isGuest} />
        </div>
      </aside>

      {/* ── Mobile slide-over menu overlay ── */}
      {isMobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 flex"
          onClick={() => setIsMobileMenuOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          {/* Drawer */}
          <div
            className="app-sidebar relative w-72 max-w-[85vw] border-r flex flex-col justify-between h-full shadow-2xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div>
              <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
                <Brand />
                <button
                  type="button" aria-label="Close navigation"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="p-2 rounded-[4px] text-(--text-muted) hover:text-(--text-primary) hover:bg-(--surface-elevated) transition-colors cursor-pointer"
                >
                  <X aria-hidden="true" className="w-5 h-5" />
                </button>
              </div>

              {/* Nav */}
              <nav className="p-3 space-y-1">
                {[
                  { id: 'home', label: 'Home', Icon: Home },
                  { id: 'current-live', label: 'Match center', Icon: PlaySquare },
                  { id: 'brackets', label: 'Brackets', Icon: GitBranch },
                  { id: 'teams', label: 'Teams', Icon: Users },
                  { id: 'ai-assistant', label: 'Arena AI', Icon: Bot, isAi: true },
                  { id: 'schedule', label: 'Schedule', Icon: CalendarDays },
                  { id: 'standings', label: 'Standings', Icon: Trophy },
                  { id: 'integrity', label: 'Fair play', Icon: ShieldCheck },
                  { id: 'operations', label: 'My team', Icon: Users },
                ].map(({ id, label, Icon, isAi }) => {
                  const active =
                    id === 'current-live'
                      ? isActiveLive
                      : id === 'brackets'
                      ? isActiveBrackets
                      : activeTab === id;
                  return (
                    <button
                      key={id}
                      onClick={() => handleTabChange(id)}
                      className={`nav-item min-h-11 ${active ? 'nav-item-active' : ''}`}
                    >
                      <Icon className="w-5 h-5" />
                      <span>{label}</span>
                      {isAi && (
                        <span className="nav-meta-badge">AI</span>
                      )}
                    </button>
                  );
                })}

              </nav>
            </div>

          </div>
        </div>
      )}

      {/* ── Main Content Area ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header Bar */}
        <header className="app-topbar h-16 border-b px-4 lg:px-7 flex items-center justify-between shrink-0 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            {/* Hamburger (mobile/tablet only) */}
            <button
              type="button" aria-label="Open navigation" aria-expanded={isMobileMenuOpen}
              onClick={() => setIsMobileMenuOpen(true)}
              className="md:hidden p-2 rounded-[4px] text-(--text-muted) hover:text-(--text-primary) hover:bg-(--surface-soft) transition-colors cursor-pointer"
            >
              <Menu aria-hidden="true" className="w-5 h-5" />
            </button>

            {/* Logo (mobile only when sidebar is hidden) */}
            <span className="md:hidden"><Brand /></span>

            {/* Breadcrumb (desktop) */}
            <div className="hidden md:flex items-center gap-2 text-sm text-(--text-muted)">
              <span className="hover:text-(--text-primary) cursor-pointer" onClick={() => onTabChange('home')}>
                ArenaHub
              </span>
              <span>/</span>
              <span className="text-(--text-primary) font-medium">{breadcrumb}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 lg:gap-3">
            {/* College badge (desktop only) */}
            <div className="hidden md:flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]" />
              <span className="font-medium text-(--text-primary) text-xs">
                {isGuest ? 'Sample arena' : hasCampusEmail(currentUser.email) ? 'WMSU' : 'Spectator'}
              </span>
              <span className="nav-meta-badge">
                {isGuest ? 'Preview' : hasCampusEmail(currentUser.email) ? 'Member' : 'Guest'}
              </span>
            </div>

            <NotificationBell onNavigate={onNotificationNavigate || handleTabChange} />

            <ProfileMenu user={currentUser} placement="below" onOpenPanel={onOpenAccountPanel}
              onSwitch={canAccessAdmin ? onOpenAdmin : undefined} switchLabel="Admin console" onLogout={onLogout} guest={isGuest} />
          </div>
        </header>

        {/* Content Body — with bottom padding on mobile for the bottom nav */}
        <main
          className={`flex-1 relative overflow-y-auto ${
            activeTab === 'ai-assistant'
              ? 'p-0 overflow-hidden flex flex-col h-[calc(100vh-4rem)] md:h-[calc(100dvh-4rem)] max-h-[calc(100vh-4rem)] md:max-h-[calc(100dvh-4rem)]'
              : 'p-4 lg:p-8 pb-24 md:pb-8'
          }`}
        >
          {children}
        </main>

      </div>

      {/* ── Mobile Bottom Navigation Bar (hidden on lg+) ── */}
      <nav aria-label="Viewer shortcuts" className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-(--bg-base)/95 backdrop-blur-md border-t border-(--border) flex items-stretch safe-area-pb">
        {NAV_ITEMS.filter(item => ['home', 'current-live', 'brackets', 'schedule'].includes(item.id)).map(({ id, label, icon: Icon }) => {
          const active =
            id === 'current-live'
              ? isActiveLive
              : id === 'brackets'
              ? isActiveBrackets
              : activeTab === id;
          return (
            <button
              key={id}
              onClick={() => handleTabChange(id)}
              aria-current={active ? 'page' : undefined}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 min-h-[56px] relative transition-colors cursor-pointer ${
                active ? 'text-(--text-primary)' : 'text-(--text-muted) hover:text-(--text-secondary)'
              }`}
            >
              <Icon className={`w-5 h-5 ${active ? 'stroke-[2]' : 'stroke-[1.5]'}`} />
              <span className={`text-xs font-medium ${active ? 'text-(--text-primary)' : ''}`}>
                {label}
              </span>
              {active && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-white" />
              )}
            </button>
          );
        })}
      </nav>

    </div>
  );
};
