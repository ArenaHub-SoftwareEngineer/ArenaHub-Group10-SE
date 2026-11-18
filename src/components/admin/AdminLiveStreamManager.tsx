import { errorMessage } from '../../lib/errors';
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
import { BroadcastPlayer } from '../common/BroadcastPlayer';
import { BroadcastIllustration } from '../ui/Illustrations';
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
    try { await firestoreService.updateMatchStream(activeMatchId, embedUrl, selectedMatch.status !== 'completed', streamTitle.trim() || undefined); }
    catch (error) { setUrlError(errorMessage(error, 'Complete every required player scan before going live.')); return; }

    const shared = true;

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
    try { await firestoreService.setMatchStatus(selectedMatch.id, 'pre-match'); } catch (error) { showToast(errorMessage(error, 'The broadcast could not pause.'), 'error'); return; }
    setPauseConfirmStep(0);
    showToast(`Match ${selectedMatch.matchNumber} live broadcast paused (Pre-Match).`, 'info');
  };

  // Handle End Live Broadcast (2-Step Confirmed)
  const handleConfirmEndLive = async () => {
    if (!selectedMatch) return;
    try { await firestoreService.setMatchStatus(selectedMatch.id, 'completed'); } catch (error) { showToast(errorMessage(error, 'The broadcast could not end.'), 'error'); return; }
    setEndConfirmStep(0);
    showToast(`Match ${selectedMatch.matchNumber} live broadcast concluded (Completed).`, 'success');
  };

  // Handle Resume Live Broadcast
  const handleResumeLive = async () => {
    if (!selectedMatch) return;
    try { await firestoreService.setMatchStatus(selectedMatch.id, 'live'); } catch (error) { showToast(errorMessage(error, 'Complete all player scans before going live.'), 'error'); return; }
    showToast(`Match ${selectedMatch.matchNumber} is now LIVE on air!`, 'success');
  };

  // Disconnect stream
  const handleConfirmDisconnect = async () => {
    if (!streamToDisconnect) return;
    try { await firestoreService.removeMatchStream(streamToDisconnect.matchId); }
    catch (error) { showToast(errorMessage(error, 'The stream could not disconnect. It remains published.'), 'error'); return; }
    setStreams(prev => prev.map(stream => stream.matchId === streamToDisconnect.matchId ? { ...stream, isActive: false } : stream));
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
      try { await firestoreService.setMatchStatus(match.id, 'live'); } catch (error) { showToast(errorMessage(error, 'Complete all player scans before going live.'), 'error'); return; }
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

  // Queue order: live first, then paused, then upcoming by schedule, then the rest.
  const statusRank = (m: Match) => m.status === 'live' ? 0 : m.status === 'pre-match' ? 1 : m.status === 'upcoming' ? 2 : 3;
  const queue = [...gameMatches].filter(m => m.team1 && m.team2).sort((a, b) => statusRank(a) - statusRank(b)
    || (scheduleDate(a.scheduledDate || '') ?? '9999').localeCompare(scheduleDate(b.scheduledDate || '') ?? '9999') || timeOrder(a.scheduledTime || '') - timeOrder(b.scheduledTime || ''));
  const totalLive = availableMatches.filter(m => m.status === 'live').length;
  const onAir = (m: Match) => m.status === 'live' ? (m.streamUrl ? 'On air' : 'Live · no broadcast') : m.status === 'pre-match' ? 'Paused' : m.status === 'completed' ? 'Ended' : 'Off air';
  const pill = (m: Match) => m.status === 'live' ? (m.streamUrl ? 'is-live' : 'is-warn') : m.status === 'pre-match' ? 'is-paused' : 'is-off';
  const guide = PLATFORM_GUIDE[selectedGuide];

  return (
    <div className="desk">
      <header className="desk-head">
        <div>
          <h1>Broadcast desk</h1>
          <p className={`watch-live-summary${totalLive ? ' is-live' : ''}`}><i aria-hidden="true" />{totalLive ? `${totalLive} ${totalLive === 1 ? 'match' : 'matches'} live across all games` : 'Nothing live right now'}</p>
        </div>
        <div className="desk-head-actions">
          <button type="button" className="arena-outline" aria-haspopup="dialog" onClick={() => setSetupOpen(true)}><Radio size={16} />Setup guide</button>
          {selectedMatch && <button type="button" className="arena-primary" aria-haspopup="dialog" onClick={() => setDestinationsOpen(true)}><Link2 size={16} />Match platforms</button>}
        </div>
      </header>
      <BroadcastSetupGuide open={setupOpen} onClose={() => setSetupOpen(false)} />
      {selectedMatch && <BroadcastDestinationsDialog key={selectedMatch.id} open={destinationsOpen} match={selectedMatch} onClose={() => setDestinationsOpen(false)} onSaved={() => showToast('Watch links saved for this match. Its status is unchanged.', 'success')} />}

      <div className="desk-filters">
        <div className="ah-chips" role="toolbar" aria-label="Choose a game">
          {STREAM_GAMES.map(game => {
            const brackets = publishedBrackets.filter(bracket => bracketGame(bracket)?.id === game.id);
            const bracketIds = new Set(brackets.flatMap(bracket => bracket.matches.map(match => match.id)));
            const matches = availableMatches.filter(match => bracketIds.has(match.id) || (!publishedIds.has(match.id) && matchesStreamGame(match, game)));
            const live = matches.filter(match => match.status === 'live').length;
            return <button type="button" key={game.id} className="ah-chip" aria-pressed={activeGame?.id === game.id} onClick={() => handleSelectScope(brackets[0]?.id ?? game.id, game.id)}
              title={`${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`}>
              <img src={game.image} alt="" className="ah-chip-img" />{game.title}{live > 0 && <span className="desk-chip-live">{live}</span>}
            </button>;
          })}
        </div>
        {(gameBrackets.length > 0 || publishedBrackets.some(bracket => !bracketGame(bracket))) && (
          <label className="desk-bracket-picker"><span className="sr-only">Bracket</span>
            <select value={activeScope} onChange={event => handleSelectScope(event.target.value)} aria-label="Bracket">
              {activeGame && <option value={activeGame.id}>Other {activeGame.title} matches</option>}
              {gameBrackets.map(bracket => <option key={bracket.id} value={bracket.id}>{bracket.title}</option>)}
              {publishedBrackets.filter(bracket => !bracketGame(bracket)).map(bracket => <option key={bracket.id} value={bracket.id}>{bracket.title}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="desk-grid">
        <section className="desk-main" aria-label="Control room">
          {selectedMatch ? <>
            <div className="desk-preview">
              {activeStream ? <BroadcastPlayer match={selectedMatch} /> : <div className="desk-preview-empty stage">
                <BroadcastIllustration />
                <strong>No broadcast connected</strong>
                <p>Paste the match's YouTube Live or Facebook Live link below, then press Connect.</p>
              </div>}
            </div>

            <div className="desk-titlebar">
              <div className="desk-title">
                <span className={`desk-pill ${pill(selectedMatch)}`}><i aria-hidden="true" />{onAir(selectedMatch)}</span>
                <h2>{selectedMatch.team1?.name || 'TBD'} <span>vs</span> {selectedMatch.team2?.name || 'TBD'}</h2>
                <p>{[selectedMatch.matchNumber, selectedMatch.roundName, selectedMatch.matchFormat, matchSchedule(selectedMatch)].filter(Boolean).join(' · ')}</p>
              </div>
              <div className="desk-score" aria-label={`Score ${selectedMatch.score.team1Score} to ${selectedMatch.score.team2Score}`}>{selectedMatch.score.team1Score}<span>–</span>{selectedMatch.score.team2Score}</div>
            </div>

            <div className="desk-controls" role="toolbar" aria-label="Broadcast controls">
              {selectedMatch.status !== 'live' && selectedMatch.status !== 'completed' && selectedMatch.status !== 'pre-match' &&
                <button type="button" className="desk-control is-live" onClick={() => void handleConfirmSelectMatch(selectedMatch, true)}><i className="desk-dot" aria-hidden="true" />Go live</button>}
              {selectedMatch.status === 'live' && activeStream && <button type="button" className="desk-control is-warn" onClick={() => setPauseConfirmStep(1)} title="Needs two confirmations"><PauseCircle size={18} />Pause</button>}
              {selectedMatch.status === 'pre-match' && <button type="button" className="desk-control is-ok" onClick={handleResumeLive}><Play size={18} />Resume</button>}
              {selectedMatch.status === 'live' && activeStream && <button type="button" className="desk-control is-danger" onClick={() => setEndConfirmStep(1)} title="Needs two confirmations"><XCircle size={18} />End broadcast</button>}
              {activeStream && <>
                <button type="button" className="desk-control" onClick={() => setShowPreviewModal(true)}><Eye size={18} />Preview</button>
                <button type="button" className="desk-control" onClick={() => void handleCopyEmbed(activeStream)}><Copy size={18} />Copy embed link</button>
                <button type="button" className="desk-control is-subtle-danger" onClick={() => setStreamToDisconnect(activeStream)}><Link2 size={18} />Disconnect</button>
              </>}
              <button type="button" className="desk-control" onClick={() => setMatchToSelect(selectedMatch)}><Info size={18} />Match details</button>
            </div>

            <section className="desk-card" aria-labelledby="desk-source-title">
              <header><h3 id="desk-source-title">Stream source</h3>
                {activeStream && <span className="desk-linked"><CheckCircle2 size={16} />Linked {activeStream.connectedAt}</span>}
              </header>
              <label className="desk-field"><span className="field-label">Broadcast title</span>
                <input id="broadcast-title" type="text" value={streamTitle} onChange={e => setStreamTitle(e.target.value)} placeholder="e.g. MPL Philippines, MLBB playoffs day 1" />
              </label>
              <div className="desk-field">
                <label htmlFor="broadcast-url"><Req>Live link (YouTube Live or Facebook Live)</Req></label>
                <div className="desk-url-row">
                  <span className="desk-url-input"><Link2 size={16} aria-hidden="true" />
                    <input id="broadcast-url" aria-required="true" aria-invalid={!!urlError} aria-describedby={urlError ? 'broadcast-url-error' : 'broadcast-url-help'} type="url" value={rawUrl}
                      onChange={e => { setRawUrl(e.target.value); setUrlError(null); }} onKeyDown={e => e.key === 'Enter' && handleConnect()}
                      placeholder="https://www.youtube.com/live/…" /></span>
                  <button type="button" onClick={handleConnect} className="arena-primary"><Zap size={16} />Connect</button>
                </div>
                {urlError ? <p id="broadcast-url-error" role="alert" className="desk-error"><XCircle size={14} />{urlError}</p>
                  : <p id="broadcast-url-help" className="field-hint">Viewers watch it inside ArenaHub. <button type="button" className="desk-link" onClick={() => {
                    setStreamTitle('MPL Philippines — Mobile Legends: Bang Bang Live');
                    setRawUrl('https://www.youtube.com/live/m4zQpYzzM0g?si=pNrl1Ja7Ot13PwFu'); setUrlError(null);
                  }}>Use the sample MPL stream</button></p>}
              </div>
              <details className="desk-howto">
                <summary><Info size={16} />How to get the live link</summary>
                <div className="desk-howto-tabs" role="tablist" aria-label="Platform">
                  {(['youtube', 'facebook', 'other'] as Platform[]).map(p => <button key={p} type="button" role="tab" aria-selected={selectedGuide === p} onClick={() => setSelectedGuide(p)}>{p === 'other' ? 'Other' : PLATFORM_GUIDE[p].title}</button>)}
                </div>
                <ol>{guide.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
                {selectedGuide === 'facebook' && <p className="desk-note">The Facebook video must be set to <strong>Public</strong>, or it will not play inside ArenaHub.</p>}
              </details>
            </section>
          </> : <div className="ah-empty desk-empty"><BroadcastIllustration /><h3>Choose a match</h3><p>Pick a match from the queue to connect its broadcast and run it from here.</p></div>}
        </section>

        <aside className="desk-queue" aria-labelledby="desk-queue-title">
          <header><h2 id="desk-queue-title">Match queue</h2><span>{queue.length}</span></header>
          {queue.length ? <ul>{queue.map(m => <li key={m.id}>
            <button type="button" aria-pressed={m.id === activeMatchId} className={`desk-queue-item${m.id === activeMatchId ? ' is-selected' : ''}`}
              onClick={() => { setSelectedMatchId(m.id); setRawUrl(''); setUrlError(null); }}>
              <span className={`desk-queue-dot ${pill(m)}`} aria-hidden="true" />
              <span className="desk-queue-text"><strong>{m.team1?.collegeCode || m.team1?.name || 'TBD'} vs {m.team2?.collegeCode || m.team2?.name || 'TBD'}</strong>
                <small>{[m.matchNumber, m.roundName].filter(Boolean).join(' · ')}</small>
                <small>{m.status === 'live' || m.status === 'pre-match' ? onAir(m) : matchSchedule(m)}</small></span>
              {(m.status === 'live' || m.status === 'completed') && <span className="desk-queue-score">{m.score.team1Score}–{m.score.team2Score}</span>}
            </button>
          </li>)}</ul> : <p className="field-hint desk-queue-empty">No matches for {activeGameTitle} yet. Published matches appear here.</p>}
        </aside>
      </div>

      <details className="desk-section" open={!selectedMatch}>
        <summary><Trophy size={18} /><span><strong>{activeGameTitle}</strong><small>Bracket view. Click a match to select it or mark it live.</small></span></summary>
        {roundBuckets.length > 0 ? <div className="stream-connected-board studio-board dashboard-media">
          <TournamentBracketCanvas key={activeScope} rounds={roundBuckets} broadcast={{ selectedMatchId: activeMatchId, schedule: matchSchedule }}
            onSelectMatch={match => { setMatchToSelect(match); setRawUrl(''); setUrlError(null); }} />
        </div> : <p className="field-hint">No matches to broadcast for {activeGameTitle}. Published matches will appear here.</p>}
      </details>

      <details className="desk-section" id="stream-match-schedule">
        <summary><Calendar size={18} /><span><strong>Schedule</strong><small>Set match times from a CSV or plain instructions.</small></span></summary>
        <StreamScheduleEditor key={activeScope} matches={gameMatches} publishedIds={publishedIds} />
      </details>

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
