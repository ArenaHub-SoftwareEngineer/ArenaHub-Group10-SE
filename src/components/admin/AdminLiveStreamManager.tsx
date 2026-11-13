/**
 * AdminLiveStreamManager.tsx
 *
 * Admin tool for connecting a Facebook Live or YouTube Live stream to a match,
 * featuring game cards, scheduled matches, bracket navigation,
 * and clear CRUD feedback confirmation popups.
 */

import React, { useState, useEffect } from 'react';
import { buildEmbedUrl, detectPlatform } from '../../lib/streamUtils';
import { Match, BracketDraft } from '../../lib/types';
import { useToast } from '../ui/Toast';
import { SuccessDialog } from '../ui/SuccessDialog';
import { firestoreService } from '../../lib/firestore';
import { belongsToFairPlayGame, FAIR_PLAY_GAMES, type FairPlayGame } from '../../lib/fairPlayGames';
import { TournamentBracketCanvas } from '../spectator/TournamentBracketCanvas';
import { StreamScheduleEditor } from './StreamScheduleEditor';
import { publicationGameKey } from '../../lib/bracketPublication';
import { manilaToday, scheduleDate, timeOrder } from '../../lib/calendar';
import { BroadcastSetupGuide } from '../common/BroadcastSetupGuide';
import { BroadcastDestinationsDialog } from './BroadcastDestinationsDialog';
import { PlatformLogo } from '../ui/PlatformLogo';
import { Req } from '../ui/Req';
import {
  Video,
  Link2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Eye,
  Radio,
  PauseCircle,
  Youtube,
  Facebook,
  ExternalLink,
  Copy,
  Trash2,
  Play,
  Info,
  Zap,
  Trophy,
  X,
  Check,
  Calendar,
  RefreshCw,
} from '../ui/Icons';

interface AdminLiveStreamManagerProps {
  matches: Match[];
  initialBracketId?: string | null;
  initialMatchId?: string | null;
}

type Platform = 'youtube' | 'facebook' | 'other';

interface StreamEntry {
  matchId: string;
  platform: Platform;
  rawUrl: string;
  embedUrl: string;
  title?: string;
  connectedAt: string;
  isActive: boolean;
}

const STREAM_GAMES = FAIR_PLAY_GAMES.map(game => ({
  ...game,
  title: game.id.startsWith('codm') ? `CODM ${game.mode}` : game.name,
}));

function matchesStreamGame(match: Match, game: FairPlayGame): boolean {
  if (!belongsToFairPlayGame(match, game)) return false;
  return !game.id.startsWith('codm') || Boolean(match.gameMode) || /-(mp|br)$/.test(match.gameId);
}

function matchSchedule(match: Match): string {
  if (match.status === 'completed') return 'Match completed';
  const time = match.scheduledTime?.trim() || '';
  const date = match.scheduledDate?.trim() || '';
  if (timeOrder(time) === 9999) return 'Time to be announced';
  return date && !time.toLowerCase().startsWith(date.toLowerCase()) ? `${date} · ${time}` : time;
}

function nextScheduledMatch(matches: Match[]): Match | undefined {
  const today = manilaToday();
  const now = timeOrder(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format());
  return matches
    .filter(match => match.status === 'upcoming' || match.status === 'pre-match')
    .map(match => ({ match, date: scheduleDate(match.scheduledDate || '', today), time: timeOrder(match.scheduledTime || '') }))
    .filter(({ date, time }) => date && time < 9999 && (date > today || (date === today && time >= now)))
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.time - b.time)[0]?.match;
}

// ── URL parsers ────────────────────────────────────────────────────────────────

const PLATFORM_GUIDE: Record<Platform, { title: string; icon: React.ReactNode; color: string; steps: string[] }> = {
  youtube: {
    title: 'YouTube Live',
    icon: <Youtube className="w-4 h-4" />,
    color: '#FF0000',
    steps: [
      'On YouTube Studio → Go Live and start your broadcast as usual.',
      'Once the stream is live, click the Share button on the live stream page.',
      'Copy the page URL from your browser (e.g. youtube.com/watch?v=XXXXXXXXXXX).',
      'Paste the URL below in the "Stream URL" field and click Connect.',
      'Enable embedding on YouTube. Viewers can then play the broadcast in ArenaHub.',
    ],
  },
  facebook: {
    title: 'Facebook Live',
    icon: <Facebook className="w-4 h-4" />,
    color: '#1877F2',
    steps: [
      'On Facebook, start your Live video from your Page or Group.',
      'Once you are live, right-click your stream post and choose "Open in new tab".',
      'Copy the full URL from the browser address bar (it starts with facebook.com/...)',
      'Paste it below in the "Stream URL" field. The app will parse and embed it.',
      'Note: Make sure your Facebook video/page is set to Public so the embed works.',
    ],
  },
  other: {
    title: 'Other / Custom',
    icon: <Link2 className="w-4 h-4" />,
    color: '#ff6600',
    steps: [
      'Paste any supported stream URL (YouTube or Facebook Live are best supported).',
      'TikTok LIVE and other providers are not embedded here. Use YouTube or Facebook.',
      'ArenaHub attaches an existing broadcast; it does not start a stream or accept RTMP.',
    ],
  },
};

export const AdminLiveStreamManager: React.FC<AdminLiveStreamManagerProps> = ({ matches: propMatches, initialBracketId, initialMatchId }) => {
  const { showToast } = useToast();

  // Load matches from firestoreService to stay reactive
  const [allMatches, setAllMatches] = useState<Match[]>(() => firestoreService.getMatches() || propMatches);
  const [publishedBrackets, setPublishedBrackets] = useState<BracketDraft[]>(() =>
    firestoreService.getPublishedBrackets()
  );

  // Subscribe to firestore updates
  useEffect(() => {
    const unsub = firestoreService.subscribe(() => {
      setAllMatches([...firestoreService.getMatches()]);
      setPublishedBrackets([...firestoreService.getPublishedBrackets()]);
    });
    return unsub;
  }, []);

  const [selectedScope, setSelectedScope] = useState(initialBracketId || '');
  const [lastGameId, setLastGameId] = useState('mlbb');
  const [selectedMatchId, setSelectedMatchId] = useState(initialMatchId || '');

  useEffect(() => {
    if (initialBracketId) setSelectedScope(initialBracketId);
  }, [initialBracketId]);

  const matchById = new Map(allMatches.map(match => [match.id, match]));
  const bracketMatches = (bracket: BracketDraft) => bracket.matches
    .map(match => matchById.get(match.id) ?? match);
  const bracketGame = (bracket: BracketDraft) =>
    STREAM_GAMES.find(game => publicationGameKey(bracket) === `game-${game.id}`);
  const activeScope = (STREAM_GAMES.some(game => game.id === selectedScope)
    || publishedBrackets.some(bracket => bracket.id === selectedScope) ? selectedScope : '')
    || publishedBrackets.find(bracket => bracketGame(bracket)?.id === lastGameId)?.id
    || lastGameId;
  const activeBracket = publishedBrackets.find(bracket => bracket.id === activeScope);
  const activeGame = activeBracket ? bracketGame(activeBracket) : STREAM_GAMES.find(game => game.id === activeScope);
  const activeGameTitle = activeBracket?.title || activeGame?.title || 'Match brackets';
  const gameBrackets = activeGame
    ? publishedBrackets.filter(bracket => bracketGame(bracket)?.id === activeGame.id)
    : [];
  const publishedIds = new Set(publishedBrackets.flatMap(bracket => bracket.matches.map(match => match.id)));
  const availableMatches = allMatches.filter(match => !match.team1?.isBye && !match.team2?.isBye
    && match.team1?.name !== 'BYE' && match.team2?.name !== 'BYE');
  const gameMatches = activeBracket
    ? bracketMatches(activeBracket).filter(match => availableMatches.some(record => record.id === match.id))
    : availableMatches.filter(match => activeGame && matchesStreamGame(match, activeGame) && !publishedIds.has(match.id));

  const selectedMatch = gameMatches.find(match => match.id === selectedMatchId)
    ?? gameMatches.find(match => match.status === 'live')
    ?? nextScheduledMatch(gameMatches)
    ?? gameMatches[0];
  const activeMatchId = selectedMatch?.id ?? '';

  // URL and Title state
  const [rawUrl, setRawUrl] = useState('');
  const [streamTitle, setStreamTitle] = useState(selectedMatch?.streamTitle || '');

  useEffect(() => {
    if (selectedMatch?.streamTitle) {
      setStreamTitle(selectedMatch.streamTitle);
    }
  }, [selectedMatch?.id, selectedMatch?.streamTitle]);
  const [streams, setStreams] = useState<StreamEntry[]>(() => {
    // initialize from existing matches with streamUrl
    const initial: StreamEntry[] = [];
    allMatches.forEach((m) => {
      if (m.streamUrl) {
        const plat = detectPlatform(m.streamUrl);
        initial.push({
          matchId: m.id,
          platform: plat,
          rawUrl: m.streamUrl,
          embedUrl: m.streamUrl,
          connectedAt: 'Active',
          isActive: true,
        });
      }
    });
    return initial;
  });

  const [previewEntry, setPreviewEntry] = useState<StreamEntry | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [selectedGuide, setSelectedGuide] = useState<Platform>('youtube');
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [setupOpen,setSetupOpen]=useState(false);
  const [destinationsOpen,setDestinationsOpen]=useState(false);

  // Pop-up Feedback Modals
  const [matchToSelect, setMatchToSelect] = useState<Match | null>(null);
  const [streamToDisconnect, setStreamToDisconnect] = useState<StreamEntry | null>(null);
  const [connectSuccessInfo, setConnectSuccessInfo] = useState<{ match: Match; shared: boolean } | null>(null);

  // Two-Step Confirmation States for Pause Live and End Live
  const [pauseConfirmStep, setPauseConfirmStep] = useState<0 | 1 | 2>(0);
  const [endConfirmStep, setEndConfirmStep] = useState<0 | 1 | 2>(0);

  // Canonical match data can change through another organizer's cloud update.
  const savedStream = streams.find(s => s.matchId === activeMatchId && s.isActive && s.embedUrl === selectedMatch?.streamUrl);
  const activeStream: StreamEntry | undefined = selectedMatch?.streamUrl ? {
    matchId: selectedMatch.id, platform: detectPlatform(selectedMatch.streamUrl), rawUrl: selectedMatch.streamUrl,
    embedUrl: buildEmbedUrl(selectedMatch.streamUrl, detectPlatform(selectedMatch.streamUrl)) || '',
    title: selectedMatch.streamTitle || savedStream?.title,
    connectedAt: savedStream?.connectedAt || 'Saved', isActive: true,
  } : undefined;

  const handleSelectScope = (scope: string, gameId = activeGame?.id) => {
    setSelectedScope(scope);
    if (gameId) setLastGameId(gameId);
    setSelectedMatchId('');
    setMatchToSelect(null);
    setUrlError(null);
    setRawUrl('');
  };

  // Connect stream
  const handleConnect = async () => {
    setUrlError(null);
    if (!gameMatches.some(m => m.id === activeMatchId) || !selectedMatch?.team1 || !selectedMatch.team2 || selectedMatch.team1.name === 'TBD' || selectedMatch.team2.name === 'TBD') { setUrlError('Choose a match with two confirmed teams before connecting a broadcast.'); return; }
    const trimmedUrl = rawUrl.trim();
    if (!trimmedUrl) {
      setUrlError('Please paste a stream URL first.');
      return;
    }

    const platform = detectPlatform(trimmedUrl);
    const embedUrl = buildEmbedUrl(trimmedUrl, platform);

    if (!embedUrl) {
      setUrlError(
        'Use a full YouTube or Facebook video link.'
      );
      return;
    }

    // Persist to firestore so spectators immediately see the embed
    firestoreService.updateMatchStream(activeMatchId, embedUrl, selectedMatch.status !== 'completed', streamTitle.trim() || undefined);

    const official = firestoreService.getPublishedBrackets().some(bracket => bracket.matches.some(match => match.id === activeMatchId));
    let shared = false;
    try {
      if (official) { await firestoreService.syncBracketsToCloud(); shared = true; }
    } catch (error) {
      console.error('[ArenaHub] Live stream sync failed:', error);
      showToast('Stream connected on this device, but spectator sync failed. Sign in again as admin and retry.', 'error');
    }

    // Deactivate any previous stream for this match
    setStreams((prev) =>
      prev.map((s) => (s.matchId === activeMatchId ? { ...s, isActive: false } : s))
    );

    const entry: StreamEntry = {
      matchId: activeMatchId,
      platform,
      rawUrl: trimmedUrl,
      embedUrl,
      title: streamTitle.trim() || undefined,
      connectedAt: new Date().toLocaleTimeString(),
      isActive: true,
    };

    setStreams((prev) => [...prev, entry]);
    setPreviewEntry(entry);
    setRawUrl('');

    if (selectedMatch) {
      setConnectSuccessInfo({ match: selectedMatch, shared });
    }

  };

  // Handle Pause Live Broadcast (2-Step Confirmed)
  const handleConfirmPauseLive = async () => {
    if (!selectedMatch) return;
    firestoreService.setMatchStatus(selectedMatch.id, 'pre-match');
    try {
      await firestoreService.syncBracketsToCloud();
    } catch (e) {
      console.warn('Sync warning:', e);
    }
    setPauseConfirmStep(0);
    showToast(`Match ${selectedMatch.matchNumber} live broadcast paused (Pre-Match).`, 'info');
  };

  // Handle End Live Broadcast (2-Step Confirmed)
  const handleConfirmEndLive = async () => {
    if (!selectedMatch) return;
    firestoreService.setMatchStatus(selectedMatch.id, 'completed');
    try {
      await firestoreService.syncBracketsToCloud();
    } catch (e) {
      console.warn('Sync warning:', e);
    }
    setEndConfirmStep(0);
    showToast(`Match ${selectedMatch.matchNumber} live broadcast concluded (Completed).`, 'success');
  };

  // Handle Resume Live Broadcast
  const handleResumeLive = async () => {
    if (!selectedMatch) return;
    firestoreService.setMatchStatus(selectedMatch.id, 'live');
    try {
      await firestoreService.syncBracketsToCloud();
    } catch (e) {
      console.warn('Sync warning:', e);
    }
    showToast(`Match ${selectedMatch.matchNumber} is now LIVE on air!`, 'success');
  };

  // Disconnect stream
  const handleConfirmDisconnect = async () => {
    if (!streamToDisconnect) return;
    firestoreService.removeMatchStream(streamToDisconnect.matchId);
    try {
      await firestoreService.syncBracketsToCloud();
    } catch (error) {
      console.error('[ArenaHub] Stream disconnect sync failed:', error);
      showToast('Stream was removed on this device, but spectator sync failed.', 'error');
    }
    setStreams((prev) => prev.map((s) => (s.matchId === streamToDisconnect.matchId ? { ...s, isActive: false } : s)));
    if (previewEntry?.matchId === streamToDisconnect.matchId) { setPreviewEntry(null); setShowPreviewModal(false); }
    setStreamToDisconnect(null);
    showToast('Stream disconnected. Viewers will see the arena stage placeholder.', 'info');
  };

  const handleCopyEmbed = async (entry: StreamEntry) => {
    try { await navigator.clipboard.writeText(entry.embedUrl); showToast('Embed URL copied to clipboard.', 'info'); }
    catch { showToast('Clipboard access is unavailable. Select and copy the embed URL below.', 'error'); }
  };

  // Handle Match Selection from Visual Bracket
  const handleConfirmSelectMatch = async (match: Match, markAsLive: boolean) => {
    setSelectedMatchId(match.id);
    if (markAsLive) {
      if (!match.team1 || !match.team2 || match.team1.isBye || match.team2.isBye || match.team1.name === 'TBD' || match.team2.name === 'TBD') { showToast('Both teams must be confirmed before a match can go live.', 'error'); return; }
      firestoreService.setMatchStatus(match.id, 'live');
      try {
        await firestoreService.syncBracketsToCloud();
      } catch (error) {
        console.error('[ArenaHub] Live status sync failed:', error);
        showToast('Match was marked live on this device, but spectator sync failed.', 'error');
      }
      showToast(`Match ${match.matchNumber} is now live and selected for broadcast.`, 'success');
    } else {
      showToast(`Selected ${match.matchNumber} (${match.team1?.collegeCode || 'TBD'} vs ${match.team2?.collegeCode || 'TBD'})`, 'info');
    }
    setMatchToSelect(null);
  };

  const platformColor = (p: Platform) => PLATFORM_GUIDE[p]?.color || '#888888';

  // Group game matches by round for bracket view
  const treeMatches = activeBracket ? bracketMatches(activeBracket) : gameMatches;
  const maxRound = Math.max(...treeMatches.map(m => m.round || 1), 1);
  const roundBuckets: Match[][] = [];
  for (let r = 1; r <= maxRound; r++) {
    const roundList = treeMatches.filter((m) => m.round === r);
    if (roundList.length > 0) {
      roundBuckets.push(roundList);
    }
  }

  return (
    <div className="space-y-6">
      <header className="dashboard-page-heading">
        <h1>Broadcast desk</h1>
        <p>Manage simultaneous matches and the platforms carrying each broadcast.</p>
      </header>
      <section className="broadcast-desk-tools"><div><h2>One match. Multiple destinations.</h2><p>Keep each match’s watch links together. Run independent feeds for matches playing at the same time.</p></div><div className="broadcast-desk-actions"><button type="button" className="arena-outline" aria-haspopup="dialog" onClick={()=>setSetupOpen(true)}><Radio size={15}/>Broadcast setup</button>{selectedMatch && <button type="button" className="arena-primary" aria-haspopup="dialog" onClick={()=>setDestinationsOpen(true)}><Link2 size={15}/>Match platforms</button>}</div></section>
      <BroadcastSetupGuide open={setupOpen} onClose={()=>setSetupOpen(false)}/>
      {selectedMatch && <BroadcastDestinationsDialog key={selectedMatch.id} open={destinationsOpen} match={selectedMatch} onClose={()=>setDestinationsOpen(false)} onSaved={()=>showToast('Watch links saved for this match. Its status is unchanged.','success')}/>}

      <section aria-label="Choose a game" className="stream-game-grid">
        {STREAM_GAMES.map(game => {
          const brackets = publishedBrackets.filter(bracket => bracketGame(bracket)?.id === game.id);
          const bracketIds = new Set(brackets.flatMap(bracket => bracket.matches.map(match => match.id)));
          const matches = availableMatches.filter(match => bracketIds.has(match.id) || (!publishedIds.has(match.id) && matchesStreamGame(match, game)));
          const liveCount = matches.filter(match => match.status === 'live').length;
          const next = nextScheduledMatch(matches);
          return (
            <button type="button" key={game.id} className="stream-game-card" aria-pressed={activeGame?.id === game.id}
              onClick={() => handleSelectScope(brackets[0]?.id ?? game.id, game.id)}>
              <img src={game.image} alt="" />
              <span className="stream-game-card-body">
                <strong>{game.title}</strong>
                <span className="studio-muted">{liveCount ? `${liveCount} live · ` : ''}{matches.length} {matches.length === 1 ? 'match' : 'matches'}</span>
                <span className="stream-schedule"><Calendar size={15} /> {next ? `Next: ${matchSchedule(next)}` : 'No upcoming time set'}</span>
              </span>
            </button>
          );
        })}
      </section>

      <section className="arena-panel stream-bracket-panel">
        <header className="stream-bracket-header">
          <div>
            <h2><Trophy size={18} /> {activeGameTitle}</h2>
            <p className="studio-muted">Select a match to manage its broadcast. Times follow the event schedule.</p>
          </div>
          {gameMatches.length > 0 && <a className="arena-outline" href="#stream-match-schedule" onClick={event => {
            event.preventDefault();
            document.getElementById('stream-match-schedule')?.scrollIntoView({ block: 'start' });
          }}><Calendar size={16} /> Edit schedule</a>}
          {(gameBrackets.length > 0 || publishedBrackets.some(bracket => !bracketGame(bracket))) && (
            <label className="stream-bracket-picker">Bracket
              <select value={activeScope} onChange={event => handleSelectScope(event.target.value)}>
                {activeGame && <option value={activeGame.id}>Other {activeGame.title} matches</option>}
                {gameBrackets.map(bracket => <option key={bracket.id} value={bracket.id}>{bracket.title}</option>)}
                {publishedBrackets.filter(bracket => !bracketGame(bracket)).map(bracket => <option key={bracket.id} value={bracket.id}>{bracket.title}</option>)}
              </select>
            </label>
          )}
        </header>

        {roundBuckets.length > 0 ? (
          <div className="stream-connected-board studio-board dashboard-media">
            <TournamentBracketCanvas
              key={activeScope}
              rounds={roundBuckets}
              broadcast={{ selectedMatchId: activeMatchId, schedule: matchSchedule }}
              onSelectMatch={match => { setMatchToSelect(match); setRawUrl(''); setUrlError(null); }}
            />
          </div>
        ) : (
          <p className="p-6 studio-muted">No matches to broadcast for {activeGameTitle}. Published matches will appear here.</p>
        )}
      </section>

      <StreamScheduleEditor key={activeScope} matches={gameMatches} publishedIds={publishedIds} />

      {/* ── Step 2: Stream Connect Panel ── */}
      {selectedMatch && <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Guide */}
        <div className="lg:col-span-4 space-y-4">
          <div className="rounded-[4px] bg-(--surface-soft) border border-(--border) overflow-hidden">
            <div className="px-4 py-3 border-b border-(--border) flex items-center justify-between">
              <span className="text-xs font-bold text-(--text-muted)">Step-by-step guide</span>
              <span className="text-xs text-(--text-muted)">How to get URL</span>
            </div>

            {/* Platform Selector */}
            <div className="flex border-b border-(--border)">
              {(['youtube', 'facebook', 'other'] as Platform[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setSelectedGuide(p)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-all cursor-pointer ${
                    selectedGuide === p
                      ? 'text-(--text-primary) border-b-2'
                      : 'text-(--text-muted) hover:text-(--text-secondary)'
                  }`}
                  style={selectedGuide === p ? { borderBottomColor: platformColor(p) } : {}}
                >
                  <span style={{ color: selectedGuide === p ? platformColor(p) : undefined }}>
                    {PLATFORM_GUIDE[p].icon}
                  </span>
                  <span>{p === 'other' ? 'Other' : PLATFORM_GUIDE[p].title}</span>
                </button>
              ))}
            </div>

            {/* Steps */}
            <div className="p-4 space-y-3">
              {PLATFORM_GUIDE[selectedGuide].steps.map((step, i) => (
                <div key={i} className="flex gap-3 text-xs">
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5"
                    style={{
                      backgroundColor: `${platformColor(selectedGuide)}18`,
                      border: `1px solid ${platformColor(selectedGuide)}40`,
                      color: platformColor(selectedGuide),
                    }}
                  >
                    {i + 1}
                  </div>
                  <p className="text-(--text-secondary) leading-relaxed">{step}</p>
                </div>
              ))}
            </div>

            {selectedGuide === 'facebook' && (
              <div className="mx-4 mb-4 p-3 rounded-[8px] bg-[var(--info-soft)] border border-[var(--info-border)] text-sm text-[var(--info)] leading-relaxed">
                <strong className="text-[var(--info)]"><PlatformLogo platform="facebook" size={15}/> Facebook Live notice:</strong> The video must be set to{' '}
                <strong>Public</strong> on Facebook. Private or group-restricted streams will not render in the iframe embed.
              </div>
            )}
          </div>
        </div>

        {/* Right: URL Input & Active Embed Preview */}
        <div className="lg:col-span-8 space-y-4">
          {/* Target Match Banner */}
          <div className="stream-selected-match">
            <div>
              <div className="text-xs font-bold text-(--brand-ink)">
                Selected match
              </div>
              <div className="text-sm font-bold text-(--text-primary) mt-0.5">
                {selectedMatch?.matchNumber} — {selectedMatch?.team1?.collegeCode || 'TBD'} vs{' '}
                {selectedMatch?.team2?.collegeCode || 'TBD'}
              </div>
              <div className="text-xs text-(--text-muted)">
                {selectedMatch.roundName} · {selectedMatch.matchFormat} · {matchSchedule(selectedMatch)}
              </div>
            </div>

            <button
              onClick={() => setMatchToSelect(selectedMatch)}
              className="arena-outline"
            >
              Match settings
            </button>
          </div>

          {/* Broadcast Configuration: Title & Stream URL Input */}
          <div className="rounded-[4px] bg-(--surface-soft) border border-(--border) p-5 space-y-4">
            <div className="space-y-3">
              {/* Title Input */}
              <div>
                <label htmlFor="broadcast-title" className="text-xs font-bold text-(--text-muted) block mb-1.5">
                  Broadcast Title / Stream Name
                </label>
                <input
                  id="broadcast-title"
                  type="text"
                  value={streamTitle}
                  onChange={(e) => setStreamTitle(e.target.value)}
                  placeholder="e.g. MPL Philippines — Mobile Legends: Bang Bang Live"
                  className="w-full bg-(--surface) border border-(--border) focus:border-(--brand)/60 rounded-[4px] px-3 py-2 text-sm text-(--text-primary) placeholder-(--text-muted) outline-none transition-colors"
                />
              </div>

              {/* URL Input & Sample Button */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="broadcast-url" className="text-xs font-bold text-(--text-muted)">
                    Stream URL (YouTube Live / Facebook Live)<Req />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setStreamTitle('MPL Philippines — Mobile Legends: Bang Bang Live');
                      setRawUrl('https://www.youtube.com/live/m4zQpYzzM0g?si=pNrl1Ja7Ot13PwFu');
                      setUrlError(null);
                    }}
                    className="flex items-center gap-1.5 text-xs font-semibold text-(--brand-ink) hover:text-(--brand-ink) transition-colors cursor-pointer"
                    title="Paste sample MPL live stream for MLBB"
                  >
                    <Radio className="w-3 h-3 animate-pulse" />
                    <span>Paste Sample MPL Live (MLBB)</span>
                  </button>
                </div>

                <div className="broadcast-connect-row flex gap-2">
                  <div className="flex-1 relative min-w-0">
                    <Link2 className="w-4 h-4 text-(--text-muted) absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      id="broadcast-url" aria-required="true" aria-invalid={!!urlError} aria-describedby={urlError ? "broadcast-url-error" : undefined}
                      type="url"
                      value={rawUrl}
                      onChange={(e) => {
                        setRawUrl(e.target.value);
                        setUrlError(null);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                      placeholder="https://www.youtube.com/live/m4zQpYzzM0g?si=... or https://youtube.com/watch?v=…"
                      className={`w-full bg-(--surface) border rounded-[4px] pl-9 pr-3 py-2.5 text-sm text-(--text-primary) placeholder-(--text-muted) outline-none transition-colors ${
                        urlError ? 'border-(--danger)/60' : 'border-(--border) focus:border-(--brand)/60'
                      }`}
                    />
                  </div>
                  <button
                    onClick={handleConnect}
                    className="arena-primary shrink-0"
                  >
                    <Zap className="w-4 h-4" />
                    Connect broadcast
                  </button>
                </div>

                {urlError && (
                  <div id="broadcast-url-error" role="alert" className="flex items-center gap-2 mt-2 text-xs text-(--danger)">
                    <XCircle className="w-3.5 h-3.5 shrink-0" />
                    {urlError}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Active Stream Preview or Empty Placeholder */}
          {activeStream ? (
            <div className="rounded-[4px] bg-(--surface-soft) border border-(--success)/30 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-(--border) flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-(--success) animate-pulse" />
                  <span className="text-sm font-heading font-bold text-(--success)">
                    Broadcast linked — {activeStream.title || selectedMatch?.streamTitle || selectedMatch?.matchNumber}
                  </span>
                  <span
                    className="px-2 py-0.5 rounded-[3px] text-xs font-bold"
                    style={{
                      backgroundColor: `${platformColor(activeStream.platform)}15`,
                      color: platformColor(activeStream.platform),
                      border: `1px solid ${platformColor(activeStream.platform)}35`,
                    }}
                  >
                    {activeStream.platform}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Live Stream Status Control Buttons with 2-Step Confirmation */}
                  {selectedMatch?.status === 'live' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setPauseConfirmStep(1)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[3px] bg-(--warning-soft) hover:bg-(--warning-soft) border border-(--brand) text-xs font-semibold text-(--warning) transition-colors cursor-pointer"
                        title="Pause the live stream for timeouts/breaks (Requires 2 confirmations)"
                      >
                        <PauseCircle className="w-3.5 h-3.5 text-(--warning)" />
                        <span>Pause Live</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setEndConfirmStep(1)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[3px] bg-(--danger-soft) hover:bg-(--danger-soft) border border-(--danger) text-xs font-semibold text-(--danger) transition-colors cursor-pointer"
                        title="Conclude and finalize live broadcast (Requires 2 confirmations)"
                      >
                        <XCircle className="w-3.5 h-3.5 text-(--danger)" />
                        <span>End Live</span>
                      </button>
                    </>
                  ) : selectedMatch?.status === 'pre-match' ? (
                    <button
                      type="button"
                      onClick={handleResumeLive}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-[3px] bg-(--success-soft) hover:bg-(--success-soft) border border-(--success-border) text-xs font-semibold text-(--success) transition-colors cursor-pointer"
                      title="Resume live broadcast transmission"
                    >
                      <Play className="w-3.5 h-3.5 text-(--success)" />
                      <span>Resume Live</span>
                    </button>
                  ) : null}

                  <button
                    onClick={() => setShowPreviewModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-[3px] bg-(--surface) hover:bg-(--surface-soft) border border-(--border) text-xs font-semibold text-(--text-primary) transition-colors cursor-pointer"
                  >
                    <Play className="w-3 h-3 text-(--brand-ink)" />
                    Preview embed
                  </button>
                  <button
                    onClick={() => setStreamToDisconnect(activeStream)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-[3px] bg-(--surface-soft) hover:bg-(--surface-elevated) border border-(--danger-border) text-xs font-semibold text-(--danger) transition-colors cursor-pointer"
                  >
                    <XCircle className="w-3 h-3" />
                    Disconnect
                  </button>
                </div>
              </div>

              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  {[
                    { label: 'Status', value: 'LINK SAVED', color: '#3DD68C' },
                    { label: 'Platform', value: activeStream.platform.toUpperCase(), color: platformColor(activeStream.platform) },
                    { label: 'Connected at', value: activeStream.connectedAt, color: '#FFFFFF' },
                    { label: 'Spectator View', value: 'PLAYER LINKED', color: '#ff6600' },
                  ].map((s) => (
                    <div key={s.label} className="bg-(--surface) border border-(--border) rounded-[4px] p-2.5">
                      <div className="text-xs text-(--text-muted)">{s.label}</div>
                      <div className="tabular-nums font-bold text-xs mt-0.5" style={{ color: s.color }}>
                        {s.value}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-(--text-muted)">Embed URL</span>
                    <button
                      onClick={() => handleCopyEmbed(activeStream)}
                      className="flex items-center gap-1 text-xs text-(--text-muted) hover:text-(--text-primary) transition-colors cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      Copy
                    </button>
                  </div>
                  <div className="bg-(--bg-base) border border-(--border) rounded-[4px] px-3 py-2 tabular-nums text-xs text-(--text-muted) break-all">
                    {activeStream.embedUrl}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-[4px] bg-(--surface) border border-(--border) border-dashed p-8 flex flex-col items-center justify-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-(--surface-soft) border border-(--border) flex items-center justify-center">
                <Radio className="w-6 h-6 text-(--text-muted)" />
              </div>
              <div>
                <div className="text-sm font-semibold text-(--text-muted)">No active stream for {selectedMatch?.matchNumber}</div>
                <div className="text-xs text-(--text-muted) mt-1">
                  Paste the YouTube Live or Facebook Live URL above and click "Connect broadcast".
                </div>
              </div>
            </div>
          )}
        </div>
      </div>}

      {/* ── POPUP MODAL: Match Click in Bracket (Requested by User) ── */}
      {matchToSelect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-(--surface-soft) border border-(--border-strong) rounded-[6px] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-(--border) bg-(--surface-soft)">
              <div>
                <h3 className="text-base font-heading font-bold text-(--text-primary) tracking-tight flex items-center gap-2">
                  <Radio className="w-4 h-4 text-(--brand-ink)" />
                  Select Match for Broadcast
                </h3>
                <span className="text-xs text-(--text-muted) tabular-nums">{matchToSelect.matchNumber} · {matchToSelect.roundName}</span>
              </div>
              <button
                onClick={() => setMatchToSelect(null)}
                className="text-(--text-muted) hover:text-(--text-primary) p-1 rounded-[3px] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Teams Display */}
              <div className="p-4 rounded-[5px] bg-(--surface) border border-(--border) flex items-center justify-between gap-4">
                <div className="text-center flex-1">
                  <div className="text-lg font-heading font-bold text-(--text-primary)">
                    {matchToSelect.team1?.collegeCode || 'TBD'}
                  </div>
                  <div className="text-xs text-(--text-muted) truncate">{matchToSelect.team1?.name}</div>
                  <div className="text-xs font-bold text-(--brand-ink) mt-1">{matchToSelect.score.team1Score} pts</div>
                </div>

                <div className="text-center px-2">
                  <span className="px-2 py-0.5 rounded bg-(--surface-soft) text-xs font-bold text-(--text-muted)">VS</span>
                  <div className="text-xs text-(--text-muted) mt-1">{matchToSelect.matchFormat}</div>
                </div>

                <div className="text-center flex-1">
                  <div className="text-lg font-heading font-bold text-(--text-primary)">
                    {matchToSelect.team2?.collegeCode || 'TBD'}
                  </div>
                  <div className="text-xs text-(--text-muted) truncate">{matchToSelect.team2?.name}</div>
                  <div className="text-xs font-bold text-(--brand-ink) mt-1">{matchToSelect.score.team2Score} pts</div>
                </div>
              </div>

              {/* Match Details */}
              <div className="text-xs space-y-1.5 text-(--text-muted)">
                <div className="flex justify-between">
                  <span>Current Status:</span>
                  <span className={`font-bold ${
                    matchToSelect.status === 'live' ? 'text-(--success)' : 'text-(--text-primary)'
                  }`}>
                    {matchToSelect.status}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Scheduled:</span>
                  <span className="text-(--text-primary)">{matchToSelect.scheduledTime} · {matchToSelect.scheduledDate}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-2">
                <button
                  type="button"
                  onClick={() => handleConfirmSelectMatch(matchToSelect, true)}
                  className="w-full py-2.5 px-4 rounded-[4px] bg-(--danger) hover:bg-(--danger) text-white text-xs font-bold flex items-center justify-center gap-2 shadow-md transition-colors cursor-pointer"
                >
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  <span>Select & Mark LIVE NOW</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleConfirmSelectMatch(matchToSelect, false)}
                  className="w-full py-2.5 px-4 rounded-[4px] bg-(--brand) hover:bg-(--brand-hover) text-black text-xs font-bold flex items-center justify-center gap-2 shadow-md transition-colors cursor-pointer"
                >
                  <Check className="w-4 h-4 stroke-[2.5]" />
                  <span>Select for Broadcast (Keep Status)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── POPUP MODAL: Confirm Disconnect Live Stream ── */}
      {streamToDisconnect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-(--surface-soft) border border-(--danger-border) rounded-[6px] shadow-2xl overflow-hidden p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-(--surface-soft) border border-(--danger-border) text-(--danger) flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-base font-heading font-bold text-(--text-primary)">
                Disconnect Live Stream?
              </h3>
              <p className="text-xs text-(--text-muted) mt-1 leading-relaxed">
                Remove the broadcast link from <strong className="text-(--text-primary)">{streamToDisconnect.matchId}</strong>?
                The original broadcast will keep running on its platform. ArenaHub will show the stream placeholder.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setStreamToDisconnect(null)}
                className="flex-1 py-2 rounded-[4px] bg-(--surface-elevated) hover:bg-(--surface-elevated) text-(--text-primary) text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDisconnect}
                className="flex-1 py-2 rounded-[4px] bg-(--danger) hover:bg-(--danger) text-white text-xs font-bold cursor-pointer"
              >
                Disconnect Stream
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── POPUP MODAL: Stream Connect Success Feedback ── */}
      <SuccessDialog open={Boolean(connectSuccessInfo)}
        title={connectSuccessInfo?.shared ? 'Broadcast connected' : 'Sample broadcast saved'}
        description={connectSuccessInfo?.match.matchNumber} onClose={() => setConnectSuccessInfo(null)} />

      {/* ── Embed Preview Modal ── */}
      {showPreviewModal && previewEntry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm"
          onClick={() => setShowPreviewModal(false)}
        >
          <div
            className="w-full max-w-3xl rounded-[6px] bg-(--surface) border border-(--border) overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-(--border)">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-(--success) animate-pulse" />
                <span className="text-sm font-heading font-bold text-(--text-primary)">
                  Embed Preview — {previewEntry.platform === 'youtube' ? 'YouTube' : 'Facebook'} Live
                </span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={previewEntry.rawUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-[3px] bg-(--surface-soft) hover:bg-(--surface-elevated) border border-(--border-strong) text-xs font-semibold text-(--text-primary) transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  Open original
                </a>
                <button
                  aria-label="Close preview"
                  onClick={() => setShowPreviewModal(false)}
                  className="p-1.5 rounded-[3px] text-(--text-muted) hover:text-(--text-primary) hover:bg-(--surface-elevated) transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="aspect-video bg-black">
              <iframe
                referrerPolicy="strict-origin-when-cross-origin"
                src={buildEmbedUrl(previewEntry.embedUrl, previewEntry.platform) || undefined}
                className="w-full h-full"
                allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                allowFullScreen
                title="Live Stream Preview"
              />
            </div>

            <div className="px-5 py-3 bg-(--bg-base) border-t border-(--border) flex items-center justify-between">
              <span className="text-xs text-(--text-muted) tabular-nums truncate max-w-xs">{previewEntry.rawUrl}</span>
              <div className="flex items-center gap-1.5 text-xs text-(--success) font-semibold">
                <Eye className="w-3 h-3" />
                Viewers see this embedded in the spectator view
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
