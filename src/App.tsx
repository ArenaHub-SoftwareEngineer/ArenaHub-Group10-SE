import { CAMPUS_SHORT_NAME } from './lib/institution';
import { scheduleMatches } from './lib/formats/placement';
import { isWatchableLiveMatch } from './lib/streamUtils';
import { Modal } from './components/ui/Modal';
import type { AccountPanel } from './components/common/ProfileMenu';
/**
 * ArenaHub — App.tsx
 *
 * Routing / shell picker driven by real Firebase Auth state.
 * Role-switcher is REMOVED — shell is determined by ahUser.role from Firestore.
 */

import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Loader2 } from './components/ui/Icons';

import { useAuth, AuthProvider } from './lib/authContext';
import { Brand } from './components/ui/Brand';
import { ToastProvider, useToast } from './components/ui/Toast';
import { hasCampusEmail, redeemSpectatorAccess } from './lib/campusAccess';
import { AuthEntry } from './components/auth/AuthEntry';
import { EmailVerificationScreen } from './components/auth/EmailVerificationScreen';

// Spectator Shell
import { SpectatorLayout } from './components/spectator/SpectatorLayout';
import { HomeScreen } from './components/spectator/HomeScreen';
const LiveMatchView = lazy(() => import('./components/spectator/LiveMatchView').then(m => ({ default: m.LiveMatchView })));
import { CurrentLiveView } from './components/spectator/CurrentLiveView';
import { liveRailItem, upNext, watchGames } from './lib/watchCards';
import { ChooseTournamentView } from './components/spectator/ChooseTournamentView';
import { BracketsView } from './components/spectator/BracketsView';
import { MatchTimeline } from './components/spectator/MatchTimeline';
import { MatchPlayerStatsSummary } from './components/spectator/MatchPlayerStatsSummary';
import { hasPlayerStats } from './lib/matchStats';
import { MVPCard } from './components/ui/MVPCard';
const TeamsView = lazy(() => import('./components/spectator/TeamsView').then(m => ({ default: m.TeamsView })));
const SpectatorAIView = lazy(() => import('./components/spectator/SpectatorAIView').then(m => ({ default: m.SpectatorAIView })));

// Organizer / Admin Shell
const AdminLayout = lazy(() => import('./components/admin/AdminLayout').then(m => ({ default: m.AdminLayout })));
const AdminOverview = lazy(() => import('./components/admin/AdminOverview').then(m => ({ default: m.AdminOverview })));
const MatchMonitorView = lazy(() => import('./components/admin/MatchMonitorView').then(m => ({ default: m.MatchMonitorView })));
const UsersView = lazy(() => import('./components/admin/UsersView').then(m => ({ default: m.UsersView })));
const GamesCategoriesView = lazy(() => import('./components/admin/GamesCategoriesView').then(m => ({ default: m.GamesCategoriesView })));
const ReportsView = lazy(() => import('./components/admin/ReportsView').then(m => ({ default: m.ReportsView })));
const FeaturedView = lazy(() => import('./components/admin/FeaturedView').then(m => ({ default: m.FeaturedView })));
const PlacementEventsView = lazy(() => import('./components/admin/PlacementEventsView').then(m => ({ default: m.PlacementEventsView })));
const BracketStudioView = lazy(() => import('./components/admin/BracketStudioView').then(m => ({ default: m.BracketStudioView })));
// Loaded on first use: Fair Play brings the Storage SDK and video review, admission brings the QR reader.
const IntegrityCenter = lazy(() => import('./components/common/FairPlayCenter').then(m => ({ default: m.FairPlayCenter })));
const PlayerAntiCheat = lazy(() => import('./components/common/PlayerAntiCheat').then(m => ({ default: m.PlayerAntiCheat })));
const TournamentOperations = lazy(() => import('./components/common/TournamentOperations').then(m => ({ default: m.TournamentOperations })));
const StandingsPage = lazy(() => import('./components/spectator/StandingsView').then(m => ({ default: m.StandingsPage })));
const PlayerLeaderboardView = lazy(() => import('./components/spectator/PlayerLeaderboardView').then(m => ({ default: m.PlayerLeaderboardView })));
const SpectatorQRReader = lazy(() => import('./components/auth/SpectatorQRReader').then(m => ({ default: m.SpectatorQRReader })));
const AIAssistantView = lazy(() => import('./components/admin/AIAssistantView').then(m => ({ default: m.AIAssistantView })));
const AdminMatchDataEntry = lazy(() => import('./components/admin/AdminMatchDataEntry').then(m => ({ default: m.AdminMatchDataEntry })));
const AdminLiveStreamManager = lazy(() => import('./components/admin/AdminLiveStreamManager').then(m => ({ default: m.AdminLiveStreamManager })));

import { PreferencesPage, SupportPage, SchedulePage } from './components/common/WorkspacePages';
import { readHistoryTab, useWorkspaceRoute } from './lib/navigation';
import { auth } from './lib/firebase';
import { firestoreService } from './lib/firestore';
import type { BracketDraft } from './lib/types';
import type { AskFocus } from './lib/ai';

// ─── Full-screen loading skeleton ─────────────────────────────────────────────
/** Inside the shell: a lazily loaded tab shows this while its code arrives; the navigation stays. */
function TabLoading() {
  return <div className="tab-loading" role="status" aria-live="polite">
    <span className="tab-loading-text"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />Loading page…</span>
    <span className="skeleton-block skeleton-title" aria-hidden="true" />
    <span className="skeleton-block skeleton-line" aria-hidden="true" />
    <span className="skeleton-row" aria-hidden="true">{[0, 1, 2, 3].map(i => <span key={i} className="skeleton-block skeleton-tile" />)}</span>
    <span className="skeleton-block skeleton-panel" aria-hidden="true" />
  </div>;
}

function AppLoadingScreen() {
  return (
    <div className="auth-status-screen" role="status">
      <div className="flex flex-col items-center gap-4">
        <Brand />
        <div className="flex items-center gap-2 text-(--text-muted) text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading ArenaHub…</span>
        </div>
      </div>
    </div>
  );
}

// ─── Email verification gate ──────────────────────────────────────────────────
// (Shown when signed in via email/password but not yet verified)
// AuthScreen handles this internally via the 'verify' mode — 
// but if the user refreshes mid-session with an unverified account, 
// we catch it here too.
function VerifyGate() { return <EmailVerificationScreen />; }

// ─── Main authenticated app ────────────────────────────────────────────────────
function AuthenticatedApp({ publicMode = false, onSignIn }: { publicMode?: boolean; onSignIn?: () => void }) {
  const { ahUser, firebaseUser, logout } = useAuth();
  const { showToast } = useToast();

  // Active View State
  const { hash, navigate } = useWorkspaceRoute();
  const spectatorTab = readHistoryTab('arena', hash, 'home');
  const adminTab = readHistoryTab('admin', hash, 'overview');
  const setSpectatorTab = (tab: string, params?: Record<string, string>) => navigate('arena', tab, params);
  const setAdminTab = (tab: string, params?: Record<string, string>) => navigate('admin', tab, params);
  const [isAiSidebarOpen, setIsAiSidebarOpen] = useState(() => window.matchMedia('(min-width: 768px)').matches);

  // Selected Entities
  const routeParams = new URLSearchParams(hash.split('?')[1] || '');
  const selectedPublishedBracketId = routeParams.get('bracket');
  const liveStreamBracketId = routeParams.get('streamBracket');
  const liveStreamMatchId = routeParams.get('streamMatch');
  const editBracketId = routeParams.get('editBracket');

  // Database State subscriptions
  const [tournaments, setTournaments] = useState(firestoreService.getTournaments());
  useEffect(() => firestoreService.watchLiveBrackets(), []);
  const [matches, setMatches] = useState(firestoreService.getMatches());
  const [colleges, setColleges] = useState(firestoreService.getColleges());
  const [teams, setTeams] = useState(firestoreService.getTeams());
  const [users, setUsers] = useState(firestoreService.getUsers());
  const [reports, setReports] = useState(firestoreService.getReports());
  const [auditLogs, setAuditLogs] = useState(firestoreService.getAuditLogs());
  const [games, setGames] = useState(firestoreService.getGames());
  const [categories, setCategories] = useState(firestoreService.getCategories());
  const [publishedBrackets, setPublishedBrackets] = useState<BracketDraft[]>(
    firestoreService.getPublishedBrackets()
  );

  useEffect(() => {
    const unsubFirestore = firestoreService.subscribe(() => {
      setTournaments([...firestoreService.getTournaments()]);
      setMatches([...firestoreService.getMatches()]);
      setColleges([...firestoreService.getColleges()]);
      setTeams([...firestoreService.getTeams()]);
      setUsers([...firestoreService.getUsers()]);
      setReports([...firestoreService.getReports()]);
      setAuditLogs([...firestoreService.getAuditLogs()]);
      setGames([...firestoreService.getGames()]);
      setCategories([...firestoreService.getCategories()]);
      setPublishedBrackets([...firestoreService.getPublishedBrackets()]);
    });
    return () => unsubFirestore();
  }, []);

  // Sync default tournament and match
  const officialMatches = publishedBrackets.flatMap(bracket => bracket.matches);
  const eventMatches = publishedBrackets.flatMap(scheduleMatches);
  const viewerLiveMatch = officialMatches.find(isWatchableLiveMatch);
  const activeTournament = tournaments.find(t => t.id === routeParams.get('tournament')) || tournaments[0];
  const missingBracket = selectedPublishedBracketId && !publishedBrackets.some(bracket => bracket.id === selectedPublishedBracketId);
  const requestedMatch = routeParams.get('match');
  const activeMatch = requestedMatch ? officialMatches.find(match => match.id === requestedMatch) : viewerLiveMatch;
  const activeMatchBracket = activeMatch && publishedBrackets.find(bracket => bracket.matches.some(match => match.id === activeMatch.id));
  const matchCenterGame = routeParams.get('game');
  const openMatchCenter = () => setSpectatorTab('current-live', matchCenterGame ? { game: matchCenterGame } : undefined);
  // Arena AI answers about the last match or bracket the viewer opened, until they clear it.
  const [aiFocus, setAiFocus] = useState<AskFocus | null>(null);
  useEffect(() => {
    if (spectatorTab === 'live' && activeMatch && activeMatchBracket) {
      setAiFocus({ bracketId: activeMatchBracket.id, matchId: activeMatch.id, label: `${activeMatch.team1?.name || 'To be decided'} vs ${activeMatch.team2?.name || 'To be decided'}` });
    } else if (spectatorTab === 'brackets' && selectedPublishedBracketId) {
      const bracket = publishedBrackets.find(b => b.id === selectedPublishedBracketId);
      if (bracket) setAiFocus({ bracketId: bracket.id, label: bracket.title });
    }
  }, [spectatorTab, activeMatch?.id, activeMatchBracket?.id, selectedPublishedBracketId, publishedBrackets]);
  /** A record an Arena AI answer was checked against: open the match if it has one, else the bracket. */
  const openReference = (ref: { bracketId?: string; matchId?: string }) => {
    if (ref.matchId && officialMatches.some(m => m.id === ref.matchId)) setSpectatorTab('live', { match: ref.matchId });
    else if (ref.bracketId && publishedBrackets.some(b => b.id === ref.bracketId)) setSpectatorTab('brackets', { bracket: ref.bracketId });
    else showToast('That record is no longer published.', 'info');
  };
  // Live matches for the navigation rail's "Live now" list (broadcasting first, then started but not yet on air).
  const liveCards = watchGames(publishedBrackets).flatMap(game => game.cards)
    .filter(card => card.state === 'live' || card.state === 'waiting').sort((a, b) => Number(b.state === 'live') - Number(a.state === 'live'));

  const handleLogout = async () => {
    await logout();
    showToast('Signed out of ArenaHub.', 'info');
  };

  // Build a User-compatible object from the Firebase auth + Firestore profile
  const currentUser = {
    id: ahUser?.uid ?? firebaseUser?.uid ?? 'guest',
    name: ahUser?.name ?? firebaseUser?.displayName ?? 'Arena visitor',
    email: firebaseUser?.email ?? '',
    role: ahUser?.role ?? 'user',
    status: ahUser?.status ?? 'active',
    collegeId: 'col-unknown',
    collegeName: ahUser?.collegeName || 'Campus Hub',
    avatarInitials:
      ahUser?.avatarInitials ??
      (ahUser?.name ?? firebaseUser?.displayName ?? 'U')
        .split(' ')
        .map((n: string) => n[0]?.toUpperCase() ?? '')
        .join('')
        .slice(0, 2),
    joinedDate: 'Today',
  };

  // Determine which shell to show based on real role (2-role system: user vs admin)
  const isAdminRole = hasCampusEmail(firebaseUser?.email) && (
    currentUser.role === 'admin' ||
    currentUser.role === 'organizer' ||
    currentUser.role === 'school-admin' ||
    currentUser.role === 'moderator');

  const [accountPanel, setAccountPanel] = useState<AccountPanel | null>(null);
  const appShell = isAdminRole && !publicMode && !hash.startsWith('#/arena/') ? 'admin' : 'spectator';
  const [sharedError, setSharedError] = useState('');
  useEffect(() => firestoreService.watchSharedWorkspace(isAdminRole), [isAdminRole, firebaseUser?.uid]);
  useEffect(() => firestoreService.subscribe(() => setSharedError(firestoreService.getSharedError())), []);

  const accountDialogs = <>
    <Modal open={accountPanel === 'settings'} title="Settings" description="Manage your ArenaHub account and display preferences."
      className="account-dialog" onClose={() => setAccountPanel(null)}>
      <PreferencesPage user={currentUser} inDialog onSignIn={() => { setAccountPanel(null); onSignIn?.(); }} />
    </Modal>
    <Modal open={accountPanel === 'support'} title="Support" description="Find answers about matches, accounts, and fair play."
      className="account-dialog" onClose={() => setAccountPanel(null)}>
      <SupportPage inDialog onNavigate={tab => {
        setAccountPanel(null);
        if (appShell === 'admin') setAdminTab(tab);
        else setSpectatorTab(tab);
      }} />
    </Modal>
  </>;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Role-switcher is GONE — shell driven by ahUser.role */}
      {appShell === 'admin' ? (
        <AdminLayout
          currentUser={currentUser}
          onOpenAccountPanel={setAccountPanel}
          activeTab={adminTab}
          routeKey={hash}
          onTabChange={(tab) => setAdminTab(tab)}
          onNotificationNavigate={(tab, entityId) => setAdminTab(({ schedule: 'match-data', 'current-live': 'live-stream', brackets: 'bracket-studio' }[tab] || tab), entityId && tab === 'integrity' ? { case: entityId } : entityId && tab === 'operations' ? { entity: entityId } : undefined)}
          onExitToSpectator={() => setSpectatorTab('home')}
          onLogout={publicMode ? () => onSignIn?.() : handleLogout}
          openReportsCount={reports.filter((r) => r.status === 'open').length}
          live={liveCards.map(card => ({ ...liveRailItem(card), onOpen: () => setAdminTab('live-stream', { streamBracket: card.bracket.id, streamMatch: card.match.id }) }))}
        >
          <Suspense fallback={<TabLoading />}>
          {sharedError && <div className="module-error mb-6" role="alert">{sharedError}</div>}
          {adminTab === 'overview' && (
            <AdminOverview
              brackets={publishedBrackets}
              accountCount={users.length}
              reportCount={reports.filter(report => report.status === 'open').length}
              auditLogs={auditLogs}
              onOpenBracketStudio={id => setAdminTab('bracket-studio', id ? { editBracket: id } : undefined)}
              onOpenReports={() => setAdminTab('reports')}
              onOpenUsers={() => setAdminTab('users')}
              onOpenLiveStreamManager={(bracketId, matchId) => setAdminTab('live-stream', {
                streamBracket: bracketId, ...(matchId ? { streamMatch: matchId } : {}),
              })}
            />
          )}
          {adminTab === 'integrity' && <IntegrityCenter key={routeParams.get('case') || 'new'} matches={eventMatches} teams={teams} staff initialCaseId={routeParams.get('case')} />}
          {adminTab === 'operations' && <TournamentOperations key={routeParams.get('entity') || 'desk'} brackets={publishedBrackets} staff initialEntityId={routeParams.get('entity')} />}
          {adminTab === 'support' && <SupportPage onNavigate={setAdminTab} />}
          {adminTab === 'settings' && <PreferencesPage user={currentUser} onSignIn={onSignIn} />}
          {adminTab === 'match-monitor' && <MatchMonitorView matches={eventMatches} />}
          {adminTab === 'users' && <UsersView users={users} />}
          {adminTab === 'games' && (
            <GamesCategoriesView games={games} categories={categories} />
          )}
          {adminTab === 'reports' && <ReportsView reports={reports} />}
          {adminTab === 'featured' && <FeaturedView tournaments={tournaments} />}
          {adminTab === 'bracket-studio' && <BracketStudioView key={editBracketId ?? ''} initialBracketId={editBracketId} />}
          {adminTab === 'battle-royale' && <PlacementEventsView brackets={publishedBrackets} />}
          {adminTab === 'ai-assistant' && (
            <AIAssistantView key={currentUser.id}
              currentUser={currentUser}
              sidebarOpen={isAiSidebarOpen}
              onToggleSidebar={() => setIsAiSidebarOpen(!isAiSidebarOpen)}
              onOpenBrackets={() => setAdminTab('bracket-studio')}
            />
          )}
          {adminTab === 'match-data' && (
            <AdminMatchDataEntry matches={officialMatches} />
          )}
          {adminTab === 'live-stream' && (
            <AdminLiveStreamManager key={JSON.stringify([liveStreamBracketId, liveStreamMatchId])} matches={matches} initialBracketId={liveStreamBracketId} initialMatchId={liveStreamMatchId} />
          )}
          {accountDialogs}
          </Suspense>
        </AdminLayout>
      ) : (
        <SpectatorLayout
          onNotificationNavigate={(tab, entityId) => setSpectatorTab(tab === 'brackets' ? 'choose-tournament' : tab, entityId && tab === 'integrity' ? { case: entityId } : entityId && tab === 'operations' ? { entity: entityId } : undefined)}
          currentUser={currentUser}
          onOpenAccountPanel={setAccountPanel}
          activeTab={spectatorTab}
          routeKey={hash}
          onTabChange={setSpectatorTab}
          onLogout={publicMode ? () => onSignIn?.() : handleLogout}
          onOpenAdmin={() => { if (isAdminRole) setAdminTab('overview'); }}
          isGuest={publicMode}
          live={liveCards.map(card => ({ ...liveRailItem(card), onOpen: () => card.state === 'live' ? setSpectatorTab('live', { match: card.match.id, game: card.gameId }) : setSpectatorTab('current-live', { game: card.gameId }) }))}
        >
          <Suspense fallback={<TabLoading />}>
          {spectatorTab === 'integrity' && <PlayerAntiCheat key={routeParams.get('case') || 'new'} matches={eventMatches} teams={teams} onSignIn={onSignIn} initialCaseId={routeParams.get('case')} />}
          {spectatorTab === 'operations' && <TournamentOperations key={routeParams.get('entity') || 'team'} brackets={publishedBrackets} initialEntityId={routeParams.get('entity')} />}
          {spectatorTab === 'standings' && <StandingsPage brackets={publishedBrackets} selectedId={selectedPublishedBracketId} onSelect={id => setSpectatorTab('standings', { bracket: id })} />}
          {spectatorTab === 'leaderboard' && <PlayerLeaderboardView brackets={publishedBrackets} game={routeParams.get('game')} sort={routeParams.get('sort')}
            onChange={params => setSpectatorTab('leaderboard', params)} />}
          {spectatorTab === 'schedule' && <SchedulePage brackets={publishedBrackets} onSelect={m => setSpectatorTab('live', { match: m.id })} />}
          {spectatorTab === 'home' && (
            <HomeScreen
              matches={officialMatches}
              liveMatch={viewerLiveMatch}
              publishedBrackets={publishedBrackets}
              spotlights={[...firestoreService.getFeaturedHighlights(), ...firestoreService.getFeaturedPosts()].filter(item => item.isFeatured)}
              onViewLiveMatch={(m) => {
                setSpectatorTab('live', { match: m.id });
              }}
              onNavigateTab={setSpectatorTab}
              onSelectPublishedBracket={(bracket) => {
                setSpectatorTab('brackets', { bracket: bracket.id });
              }}
            />
          )}

          {spectatorTab === 'live' && (activeMatch && isWatchableLiveMatch(activeMatch) ? (
            <LiveMatchView
              key={activeMatch.id}
              match={activeMatch}
              gameName={activeMatchBracket?.gameName}
              gameImage={watchGames(publishedBrackets).find(game => game.cards.some(card => card.match.id === activeMatch.id))?.image}
              upNext={upNext(publishedBrackets, activeMatch.id)}
              onOpenCard={card => card.state === 'live' ? setSpectatorTab('live', { match: card.match.id, game: card.gameId }) : setSpectatorTab('current-live', { game: card.gameId })}
              readOnly={publicMode}
              currentUser={currentUser}
              onBack={openMatchCenter}
            />
          ) : <section className="arena-panel match-center-unavailable">
            <h1>{activeMatch?.status === 'completed' ? 'Match has ended'
              : activeMatch?.status === 'live' ? 'Broadcast not available yet'
              : activeMatch ? 'Match is not live yet' : 'Match unavailable'}</h1>
            <p className="studio-muted">Open Match center to see the current broadcasts and upcoming matches.</p>
            {/* A finished match still shows what organizers recorded: the MVP and the key moments. */}
            {activeMatch?.status === 'completed' && (activeMatch.mvp || activeMatch.timelineEvents?.length || hasPlayerStats(activeMatch)) ? <div className="match-ended-highlights">
              {activeMatch.mvp && <MVPCard mvp={activeMatch.mvp} status="completed" />}
              <MatchTimeline match={activeMatch} />
              {hasPlayerStats(activeMatch) && <MatchPlayerStatsSummary match={activeMatch} />}
            </div> : null}
            <button type="button" className="arena-outline" onClick={openMatchCenter}>Back to Match center</button>
          </section>)}

          {spectatorTab === 'current-live' && (
            <CurrentLiveView
              key={matchCenterGame || 'all'}
              brackets={publishedBrackets}
              initialGame={matchCenterGame}
              onSelectMatch={(match, game) => setSpectatorTab('live', { match: match.id, game })}
            />
          )}

          {spectatorTab === 'choose-tournament' && (
            <ChooseTournamentView brackets={publishedBrackets} onSelectBracket={bracket =>
              setSpectatorTab('brackets', { bracket: bracket.id })}
            />
          )}

          {spectatorTab === 'brackets' && (!activeTournament || missingBracket) && <section className="arena-panel match-center-unavailable">
            {/* Opening or reloading a Brackets link renders before tournaments load; BracketsView needs one. */}
            <h1>{missingBracket ? 'Bracket unavailable' : 'No tournament to show yet'}</h1>
            <p className="studio-muted">Open the tournament list to see currently published brackets.</p>
            <button type="button" className="arena-outline" onClick={() => setSpectatorTab('choose-tournament')}>All tournaments</button>
          </section>}
          {spectatorTab === 'brackets' && activeTournament && !missingBracket && (
            <BracketsView
              key={selectedPublishedBracketId || activeTournament.id}
              tournament={activeTournament}
              matches={matches}
              colleges={colleges}
              onBack={() => setSpectatorTab('choose-tournament')}
              onSelectMatch={(m) => {
                setSpectatorTab('live', { match: m.id });
              }}
              initialBracketId={selectedPublishedBracketId}
            />
          )}

          {spectatorTab === 'teams' && (
            <TeamsView colleges={colleges} teams={teams} />
          )}

          {spectatorTab === 'ai-assistant' && (
            <SpectatorAIView key={currentUser.id}
              currentUser={currentUser}
              sidebarOpen={isAiSidebarOpen}
              onToggleSidebar={() => setIsAiSidebarOpen(!isAiSidebarOpen)}
              focus={aiFocus}
              onClearFocus={() => setAiFocus(null)}
              onOpenReference={openReference}
            />
          )}

          {spectatorTab === 'support' && <SupportPage onNavigate={setSpectatorTab} />}
          {spectatorTab === 'settings' && <PreferencesPage user={currentUser} onSignIn={onSignIn} />}
          {accountDialogs}
          </Suspense>
        </SpectatorLayout>
      )}


    </div>
  );
}

function SpectatorAdmissionGate() {
  const { firebaseUser, logout } = useAuth();
  const [state, setState] = useState<{ email: string; allowed: boolean; error?: string } | null>(null);
  const email = firebaseUser?.email || '';
  useEffect(() => {
    const current = auth.currentUser;
    if (!current || current.uid !== firebaseUser?.uid) return;
    let active = true;
    redeemSpectatorAccess(current).then(
      () => { if (active) setState({ email, allowed: true }); },
      error => { if (active) setState({ email, allowed: false, error: error instanceof Error && !error.message.startsWith('Firebase') ? error.message : `Could not verify spectator access. Scan a current ${CAMPUS_SHORT_NAME} student QR and try again.` }); },
    );
    return () => { active = false; };
  }, [firebaseUser, email]);
  if (!state || state.email !== email) return <AppLoadingScreen />;
  if (state.allowed) return <AuthenticatedApp />;
  return <div className="auth-status-screen"><section className="auth-status-card auth-admission-card">
    <Brand /><h1>Finish spectator admission</h1>
    <p>You’re signed in as <strong>{email}</strong>. Add a current student invitation to enter the arena.</p>
    <SpectatorQRReader admissionMode onVerified={async () => { const user = auth.currentUser; if (!user) throw new Error('Sign in before completing admission.'); await redeemSpectatorAccess(user); setState({ email, allowed: true }); }} />
    <button className="auth-flow-text" onClick={() => void logout()}>Use a different account</button>
  </section></div>;
}

// ─── Root gate ────────────────────────────────────────────────────────────────
function AppGate() {
  const { firebaseUser, ahUser, loading, logout, affiliationPending, profileError, retryProfile } = useAuth();
  if (loading) return <AppLoadingScreen />;

  // Not signed in → show auth screen
  if (!firebaseUser || affiliationPending) return <AuthEntry />;
  if (profileError) return <div className="auth-status-screen"><section className="auth-status-card"><Brand /><h1>Finish account setup</h1><p role="alert" className="auth-flow-error">{profileError}</p><button className="arena-primary auth-submit" onClick={() => void retryProfile()}>Retry loading profile</button><button className="auth-flow-text" onClick={() => void logout()}>Return to sign-in</button></section></div>;
  if (ahUser && ahUser.status !== 'active') return <div className="auth-status-screen"><div className="auth-status-card"><Brand /><h1 className="text-2xl mb-3">Account access restricted</h1><p className="text-sm text-[var(--text-muted)] mb-5">Contact your tournament organizer about your account status.</p><button className="arena-primary" onClick={logout}>Sign out</button></div></div>;

  if (firebaseUser.isAnonymous) {
    return <div className="auth-status-screen">
      <div className="auth-status-card"><Brand />
        <h1 className="text-xl mb-3">Sign in with a verified email</h1>
        <p className="text-sm text-[var(--text-muted)] mb-5">A student invitation grants spectator admission after you sign in with a verified email account.</p>
        <button className="arena-primary" onClick={logout}>Return to sign-in</button>
      </div>
    </div>;
  }

  if (!ahUser || ahUser.uid !== firebaseUser.uid) return <AppLoadingScreen />;

  if (!firebaseUser.emailVerified) {
    return <VerifyGate />;
  }

  return hasCampusEmail(firebaseUser.email) ? <AuthenticatedApp /> : <SpectatorAdmissionGate key={firebaseUser.uid} />;
}

// ─── App root ─────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Suspense fallback={<AppLoadingScreen />}><AppGate /></Suspense>
      </AuthProvider>
    </ToastProvider>
  );
}
