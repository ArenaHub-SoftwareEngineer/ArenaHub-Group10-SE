import React, { useEffect, useMemo, useState } from 'react';
import { bracketScheduleLabel } from '../../lib/calendar';
import { firestoreService } from '../../lib/firestore';
import { matchName } from '../../lib/matchName';
import { workspaceHref } from '../../lib/navigation';
import { publicationGameKey } from '../../lib/bracketPublication';
import { isWatchableLiveMatch, matchBroadcasts } from '../../lib/streamUtils';
import type { BracketDraft, GameTitle, Match, User } from '../../lib/types';
import { BroadcastSetupGuide } from '../common/BroadcastSetupGuide';
import { GAME_ARTWORK, GameArtworkTiles } from '../common/GameArtworkTiles';
import { matchTitle } from '../common/MatchPicker';
import { bracketArt } from '../common/TournamentPicker';
import { TournamentBracketCanvas } from '../spectator/TournamentBracketCanvas';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Gamepad2, Link2, PauseCircle, XCircle } from '../ui/Icons';
import { useToast } from '../ui/Toast';
import { BroadcastWizard } from './broadcast/BroadcastWizard';
import { AdminBroadcastMonitor } from './broadcast/AdminBroadcastMonitor';
import { readBroadcastPosition, saveBroadcastPosition } from './broadcast/broadcastDraft';
const ACTIONS = {
  pause: { title: 'Pause this broadcast?', label: 'Pause broadcast', status: 'pre-match' },
  end: { title: 'End this broadcast?', label: 'End broadcast', status: 'completed' },
  disconnect: { title: 'Disconnect this stream?', label: 'Disconnect', status: null },
} as const;
type Action = keyof typeof ACTIONS;

const gameOf = (bracket: BracketDraft) => {
  const key = publicationGameKey(bracket);
  return GAME_ARTWORK.find(game => `game-${game.id}` === key)?.id ?? key;
};

export function AdminLiveStreamManager({ userId, currentUser, brackets, games, initialBracketId, initialMatchId }: {
  userId: string;
  currentUser: User;
  brackets: BracketDraft[];
  games: GameTitle[];
  initialBracketId?: string | null;
  initialMatchId?: string | null;
}) {
  const { showToast } = useToast();
  const entry = initialBracketId || initialMatchId ? JSON.stringify([initialBracketId, initialMatchId]) : null;
  const [remembered] = useState(() => {
    const saved = readBroadcastPosition(userId);
    return !entry || saved?.entry === entry ? saved : undefined;
  });
  const [gameId, setGameId] = useState(remembered?.gameId || '');
  const [bracketId, setBracketId] = useState(remembered?.scope || initialBracketId || '');
  const [matchId, setMatchId] = useState(remembered?.matchId || initialMatchId || '');
  const [editorOpen, setEditorOpen] = useState(remembered ? remembered.step === 3 : Boolean(initialMatchId));
  const [guideOpen, setGuideOpen] = useState(false);
  const [pending, setPending] = useState<{ action: Action; id: string }>();

  const groups = useMemo(() => {
    const byGame = new Map<string, BracketDraft[]>();
    for (const bracket of brackets) {
      const game = gameOf(bracket);
      const group = byGame.get(game) ?? [];
      group.push(bracket);
      byGame.set(game, group);
    }
    return byGame;
  }, [brackets]);
  const allMatches = brackets.flatMap(bracket => bracket.matches);
  const rememberedBracket = brackets.find(bracket => bracket.id === bracketId)
    ?? brackets.find(bracket => bracket.matches.some(match => match.id === matchId));
  const activeGame = gameId || (rememberedBracket ? gameOf(rememberedBracket) : '');
  const gameBrackets = groups.get(activeGame) ?? [];
  const bracket = gameBrackets.find(bracket => bracket.id === bracketId) ?? gameBrackets[0];
  const rounds = useMemo(() => bracket ? [bracket.matches] : [], [bracket]);
  const selected = bracket?.matches.find(match => match.id === matchId);
  const artwork = (bracket: BracketDraft) => bracketArt(bracket)
    || games.find(game => (bracket.gameId !== 'game-custom' && game.id === bracket.gameId) || game.name.trim().toLowerCase() === bracket.gameName.trim().toLowerCase())?.bannerImage;
  const liveCount = allMatches.filter(isWatchableLiveMatch).length;
  const confirmation = pending && ACTIONS[pending.action];
  const target = pending && allMatches.find(match => match.id === pending.id);
  const gameMeta = Object.fromEntries(GAME_ARTWORK.map(game => [game.id, groups.has(game.id) ? 'Published bracket' : 'No published bracket']));

  useEffect(() => {
    saveBroadcastPosition(userId, { entry, scope: bracket?.id || bracketId, gameId: activeGame, matchId, step: editorOpen ? 3 : activeGame ? 2 : 1 });
  }, [userId, entry, bracket?.id, bracketId, activeGame, matchId, editorOpen]);

  function selectGame(id: string) {
    if (id === activeGame) return;
    setGameId(id);
    setBracketId('');
    setMatchId('');
    setEditorOpen(false);
  }

  async function runAction() {
    if (!target || !confirmation) throw new Error('Choose an available match.');
    if (confirmation.status) await firestoreService.setMatchStatus(target.id, confirmation.status);
    else await firestoreService.removeMatchStream(target.id);
    setPending(undefined);
    showToast(`${matchName(target)} updated.`, 'success');
  }

  const request = (action: Action) => selected && setPending({ action, id: selected.id });
  const linked = selected && matchBroadcasts(selected).length > 0;

  return <div className="desk broadcast-desk">
    <header className="desk-head">
      <div>
        <h1>Broadcast desk</h1>
        <p className={`watch-live-summary${liveCount ? ' is-live' : ''}`}><i aria-hidden="true" />{liveCount ? `${liveCount} ${liveCount === 1 ? 'match' : 'matches'} live` : 'Nothing live right now'}</p>
      </div>
      <div className="desk-head-actions">
        <button type="button" className="arena-outline" onClick={() => setGuideOpen(true)}>Setup guide</button>
      </div>
    </header>

    <section className="broadcast-games" aria-labelledby="broadcast-games-title">
      <h2 id="broadcast-games-title">Choose a game</h2>
      <GameArtworkTiles label="Broadcast games" selected={activeGame} onSelect={selectGame} meta={gameMeta}>
        {[...groups].filter(([id]) => !GAME_ARTWORK.some(game => game.id === id)).map(([id, entries]) =>
          <button key={id} type="button" className="schedule-game-tile" aria-pressed={activeGame === id} onClick={() => selectGame(id)}>
            <span className="artwork-media">{artwork(entries[0]) ? <img src={artwork(entries[0])} alt="" /> : <Gamepad2 size={32} aria-hidden="true" />}</span>
            <span className="artwork-caption"><strong>{entries[0].gameName}</strong><small>Published bracket</small></span>
          </button>
        )}
      </GameArtworkTiles>
    </section>

    {activeGame && <section className="broadcast-bracket" aria-labelledby="published-broadcast-title">
      <header>
        <div><h2 id="published-broadcast-title">{bracket?.title || 'Published bracket'}</h2>
          {bracket && <p>{bracket.gameName} · Published bracket</p>}</div>
        {gameBrackets.length > 1 && <label className="bw-field">Tournament<select value={bracket?.id} onChange={event => {
          setBracketId(event.target.value);
          setMatchId('');
          setEditorOpen(false);
        }}>{gameBrackets.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
      </header>
      {bracket?.matches.length ? <TournamentBracketCanvas key={bracket.id} rounds={rounds} appearance={bracket.appearance} onSelectMatch={match => {
        setBracketId(bracket.id);
        setMatchId(match.id);
        setEditorOpen(true);
      }} broadcast={{ selectedMatchId: matchId, schedule: bracketScheduleLabel }} />
        : <p className="bw-empty">{bracket ? 'This published bracket has no matches yet.' : 'Publish a bracket for this game to set up a broadcast.'}</p>}
    </section>}

    <BroadcastSetupGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    {selected && bracket && <>
      <BroadcastWizard key={selected.id} userId={userId} selected={selected} artwork={artwork(bracket)} open={editorOpen}
        bracketTitle={bracket.title} onClose={() => setEditorOpen(false)}
        onConnect={input => firestoreService.publishMatchBroadcast(selected.id, input)}>
        {(linked || selected.status === 'live') && <details className="bw-controls" open>
          <summary>Match controls</summary>
          <div className="desk-controls" role="toolbar" aria-label="Broadcast controls">
            {selected.status === 'live' && <>
              <button type="button" className="desk-control is-warn" onClick={() => request('pause')}><PauseCircle size={18} /> Pause</button>
              <button type="button" className="desk-control is-danger" onClick={() => request('end')}><XCircle size={18} /> End broadcast</button>
            </>}
            {linked && <button type="button" className="desk-control is-subtle-danger" onClick={() => request('disconnect')}><Link2 size={18} /> Disconnect</button>}
            <a className="desk-link" href={workspaceHref('admin', 'schedule', { bracket: bracket.id })}>Manage schedule</a>
          </div>
        </details>}

      </BroadcastWizard>
      {/* Admin broadcast monitor: shown below the wizard when match is on-air */}
      <AdminBroadcastMonitor match={selected} currentUser={currentUser} />
    </>}
    <ConfirmModal isOpen={Boolean(pending)} title={confirmation?.title || ''} confirmLabel={confirmation?.label || ''}
      description={target ? `${matchName(target)} · ${matchTitle(target)}${pending?.action === 'end' ? '. Save the final score first.' : ''}` : ''}
      isDestructive={pending?.action === 'end' || pending?.action === 'disconnect'} onConfirm={runAction} onCancel={() => setPending(undefined)} />
  </div>;
}
