import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BracketDraft } from '../../lib/types';
import { firestoreService } from '../../lib/firestore';
import {
  computeStandings, createPlacementEvent, MAX_GAMES, MAX_KILLS, MAX_LOBBY_TEAMS, POINT_PRESETS, recordGame,
  type PlacementConfig, type PlacementGame, type PlacementResult,
} from '../../lib/formats/placement';
import { publicationGameKey } from '../../lib/bracketPublication';
import { fingerprint } from '../../lib/data/tournamentDocs';
import { PlacementStandingsView } from '../spectator/PlacementStandingsView';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useToast } from '../ui/Toast';
import { Req } from '../ui/Req';
import { Plus, Save, Trophy } from '../ui/Icons';
import { errorMessage } from '../../lib/errors';
import { TimeField } from '../ui/TimeField';
import '../spectator/placement.css';

type Row = { placement: string; kills: string };

/** Parses "Squad name, CCS" lines. The college code is optional. */
function parseSquads(text: string) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const [name, college = ''] = line.split(/\s*[,|]\s*/);
    return { name, collegeCode: college };
  });
}

/** Organizer page for CODM Battle Royale: create a lobby event, then enter each game's placements and eliminations. */
export const PlacementEventsView: React.FC<{ brackets: BracketDraft[] }> = ({ brackets }) => {
  const { showToast } = useToast();
  const events = brackets.filter(b => b.placement);
  const occupying = brackets.find(b => publicationGameKey(b) === 'game-codm-br');
  const [selectedId, setSelectedId] = useState<string>('');
  // A just-published event may arrive after the confirmation. Never substitute the outgoing
  // event while waiting: results typed into that form would disappear when the new event arrives.
  const event = selectedId ? events.find(e => e.id === selectedId) : events[0];

  // --- Create form ---
  const [creatingRequested, setCreating] = useState(false);
  // With no event yet, the create form is the page. Once an event has been seen, a snapshot that
  // briefly omits it (as one can right after publishing) must not flash the create form back.
  const [seenEvent, setSeenEvent] = useState(false);
  useEffect(() => { if (events.length) setSeenEvent(true); }, [events.length > 0]);
  const loaded = firestoreService.isPublishedLoaded();
  const creating = creatingRequested || (loaded && !events.length && !seenEvent);
  const [title, setTitle] = useState('');
  const [squads, setSquads] = useState('');
  const [games, setGames] = useState(6);
  const [presetId, setPresetId] = useState(POINT_PRESETS[0].id);
  const [config, setConfig] = useState<PlacementConfig>(POINT_PRESETS[0].config);
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState<BracketDraft | null>(null);

  const choosePreset = (id: string) => { setPresetId(id); const preset = POINT_PRESETS.find(p => p.id === id); if (preset) setConfig({ ...preset.config, pointsTable: [...preset.config.pointsTable] }); };
  const setPlacePoints = (index: number, value: string) => { setPresetId('custom'); setConfig(c => ({ ...c, pointsTable: c.pointsTable.map((p, i) => i === index ? Math.max(0, Math.floor(Number(value) || 0)) : p) })); };

  const review = (e: React.FormEvent) => {
    e.preventDefault(); setFormError('');
    try { setPending(createPlacementEvent({ title, teams: parseSquads(squads), games, config })); }
    catch (error) { setFormError(errorMessage(error, 'Check the event details.')); }
  };
  const publish = async () => {
    if (!pending) return;
    const published = await firestoreService.publishBracket(pending, 'Call of Duty: Mobile Battle Royale', 'game-codm-br');
    setPending(null); setCreating(false); setTitle(''); setSquads(''); setSelectedId(published.id);
    showToast('Battle Royale event published. Enter results as each game ends.', 'success');
  };

  // --- Results entry ---
  const [gameId, setGameId] = useState('');
  const game = event?.placement?.games.find(g => g.id === gameId) || event?.placement?.games.find(g => g.status !== 'completed') || event?.placement?.games[0];
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [status, setStatus] = useState<PlacementGame['status']>('upcoming');
  const [when, setWhen] = useState({ date: '', time: '' });
  const [entryError, setEntryError] = useState('');
  const [saving, setSaving] = useState(false);

  // Reload the form only when this game's saved data changes. Snapshots of other tournaments
  // create new objects too, and must not wipe results an organizer is still typing.
  // A snapshot that briefly omits the event yields no key; that is skipped rather than treated as a change.
  // fingerprint sorts keys: a snapshot from the local cache and one from the server can list the same fields in a different order.
  const savedGameKey = event && game ? fingerprint([event.id, event.placement?.teams.map(t => t.id), game]) : '';
  const loadedKey = useRef('');
  // Which game the form shows, and whether the organizer has typed into it since it was loaded or saved.
  // A late snapshot of the same game (a slow publish or save confirmation) must never overwrite those edits.
  const loadedGame = useRef('');
  const dirty = useRef(false);
  const edit = (update: (rows: Record<string, Row>) => Record<string, Row>) => { dirty.current = true; setRows(update); };
  // Layout effect: the saved values load before the form paints, so nothing typed can land in between.
  useLayoutEffect(() => {
    if (!event?.placement || !game || !savedGameKey || savedGameKey === loadedKey.current) return;
    loadedKey.current = savedGameKey;
    const gameKey = `${event.id}|${game.id}`;
    if (gameKey === loadedGame.current && dirty.current) return;
    loadedGame.current = gameKey; dirty.current = false;
    // Pin the displayed game instead of letting a late completion snapshot change the form implicitly.
    if (gameId !== game.id) setGameId(game.id);
    setRows(Object.fromEntries(event.placement.teams.map(team => {
      const result = game.results.find(r => r.teamId === team.id);
      return [team.id, { placement: result ? String(result.placement) : '', kills: result ? String(result.kills) : '' }];
    })));
    setStatus(game.status); setWhen({ date: game.scheduledDate || '', time: game.scheduledTime || '' }); setEntryError('');
  }, [savedGameKey]);

  const preview = useMemo(() => {
    if (!event?.placement || !game) return null;
    try { return computeStandings(recordGame(event.placement, game.id, toResults(), 'completed')).slice(0, 3); }
    catch { return null; }
  }, [rows, event?.placement, game?.id]);

  function toResults(): PlacementResult[] {
    if (!event?.placement) return [];
    return event.placement.teams.flatMap(team => {
      const row = rows[team.id];
      if (!row || row.placement.trim() === '') return [];
      return [{ teamId: team.id, placement: Number(row.placement), kills: row.kills.trim() === '' ? 0 : Number(row.kills) }];
    });
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event?.placement || !game || saving) return;
    setEntryError(''); setSaving(true);
    try {
      const next = recordGame(event.placement, game.id, toResults(), status);
      const withSchedule = { ...next, games: next.games.map(g => g.id === game.id ? { ...g, scheduledDate: when.date || undefined, scheduledTime: when.time || undefined } : g) };
      await firestoreService.savePlacementEvent(event.id, withSchedule, `Battle Royale "${event.title}": ${game.label} saved as ${status}`);
      dirty.current = false;
      // Move to the next game now. Waiting for the snapshot would switch the form later, possibly
      // after the organizer has started typing the next results, and wipe them.
      if (status === 'completed') {
        const nextGame = withSchedule.games.find(g => g.id !== game.id && g.status !== 'completed');
        if (nextGame) setGameId(nextGame.id);
      }
      showToast(`${game.label} saved${status === 'completed' ? ' and standings updated' : ''}.`, 'success');
    } catch (error) { setEntryError(errorMessage(error, 'Could not save these results.')); }
    finally { setSaving(false); }
  };

  const teamCount = event?.placement?.teams.length || 0;
  const usedPlaces = Object.values(rows).map(r => r.placement).filter(Boolean);
  const duplicatePlace = (value: string) => !!value && usedPlaces.filter(v => v === value).length > 1;

  return <div className="module-page placement-admin">
    <header className="dashboard-page-heading with-actions"><div><h1>Battle Royale</h1>
      <p>For CODM Battle Royale. Every squad plays every game in one lobby. Standings add placement points and eliminations across all final games.</p></div>
      {loaded && !creating && <button type="button" className="arena-primary" onClick={() => setCreating(true)}><Plus size={16} />New event</button>}
    </header>

    {!loaded && !events.length && <p className="studio-muted" role="status">Loading published events…</p>}
    {creating && <form className="arena-panel module-form" onSubmit={review} aria-labelledby="placement-create-title">
      <h2 id="placement-create-title">New Battle Royale event</h2>
      <label><Req>Event title</Req><input required minLength={3} maxLength={160} value={title} onChange={e => setTitle(e.target.value)} placeholder="Intramurals 2026 CODM BR Finals" /></label>
      <label><Req>Squads, one per line</Req>
        <textarea required rows={8} value={squads} onChange={e => setSquads(e.target.value)} placeholder={'Byte Brigade, CCS\nCircuit Breakers, COE\nNight Owls, CN'} />
        <span className="field-hint">Add a comma and the college code after each squad name. Up to {MAX_LOBBY_TEAMS} squads in one lobby. {parseSquads(squads).length} entered.</span>
      </label>
      <label><Req>Games</Req>
        <select value={games} onChange={e => setGames(Number(e.target.value))}>{Array.from({ length: MAX_GAMES }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n} game{n === 1 ? '' : 's'}</option>)}</select>
      </label>
      <label>Points system
        <select value={presetId} onChange={e => choosePreset(e.target.value)}>
          {POINT_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          {presetId === 'custom' && <option value="custom">Custom</option>}
        </select>
      </label>
      <fieldset className="placement-points-grid"><legend className="field-hint">Points by placement (edit to customise)</legend>
        {config.pointsTable.map((points, i) => <label key={i}>#{i + 1}<input type="number" inputMode="numeric" min={0} max={100} value={points} onChange={e => setPlacePoints(i, e.target.value)} /></label>)}
        <button type="button" className="arena-text-button" disabled={config.pointsTable.length >= MAX_LOBBY_TEAMS} onClick={() => { setPresetId('custom'); setConfig(c => ({ ...c, pointsTable: [...c.pointsTable, 0] })); }}>Add place</button>
        {config.pointsTable.length > 1 && <button type="button" className="arena-text-button" onClick={() => { setPresetId('custom'); setConfig(c => ({ ...c, pointsTable: c.pointsTable.slice(0, -1) })); }}>Remove last</button>}
      </fieldset>
      <label>Points per elimination
        <input type="number" inputMode="numeric" min={0} max={10} value={config.killPoints} onChange={e => { setPresetId('custom'); setConfig(c => ({ ...c, killPoints: Math.max(0, Math.floor(Number(e.target.value) || 0)) })); }} />
      </label>
      {formError && <p className="module-error" role="alert">{formError}</p>}
      <div className="dialog-actions">
        {events.length > 0 && <button type="button" className="arena-outline" onClick={() => setCreating(false)}>Cancel</button>}
        <button className="arena-primary"><Trophy size={16} />Review and publish</button>
      </div>
    </form>}

    {events.length > 1 && <label className="module-form">Event
      <select value={event?.id} onChange={e => { setSelectedId(e.target.value); setGameId(''); }}>{events.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}</select>
    </label>}

    {loaded && selectedId && !event && <p className="studio-muted" role="status">Waiting for the selected event to sync. If it was unpublished, create a new event.</p>}
    {event?.placement && game && <form className="arena-panel module-form placement-admin-entry" onSubmit={save} aria-labelledby="placement-entry-title">
      <h2 id="placement-entry-title">{event.title}: results</h2>
      <div className="operations-two-fields">
        <label>Game
          <select value={game.id} onChange={e => setGameId(e.target.value)}>
            {event.placement.games.map(g => <option key={g.id} value={g.id}>{g.label} · {g.status === 'completed' ? 'Final' : g.status === 'live' ? 'Live' : 'Upcoming'}</option>)}
          </select>
        </label>
        <label>Status
          <select value={status} onChange={e => { dirty.current = true; setStatus(e.target.value as PlacementGame['status']); }}>
            <option value="upcoming">Upcoming</option><option value="live">Live</option><option value="completed">Final (counts toward standings)</option>
          </select>
        </label>
        <label>Date<input type="date" value={when.date} onChange={e => { dirty.current = true; setWhen(w => ({ ...w, date: e.target.value })); }} /></label>
        <label>Time<TimeField value={when.time} onChange={time => { dirty.current = true; setWhen(w => ({ ...w, time })); }} /></label>
      </div>
      <table className="placement-entry-table">
        <thead><tr><th scope="col">Squad</th><th scope="col">Placement (1 to {teamCount})</th><th scope="col">Eliminations</th></tr></thead>
        <tbody>{event.placement.teams.map(team => {
          const row = rows[team.id] || { placement: '', kills: '' };
          const dup = duplicatePlace(row.placement);
          return <tr key={team.id}>
            <th scope="row">{team.name}{team.collegeCode && <small className="studio-muted"> · {team.collegeCode}</small>}</th>
            <td><input type="number" inputMode="numeric" min={1} max={teamCount} aria-label={`${team.name} placement`} aria-invalid={dup || undefined} title={dup ? 'Another squad already has this placement' : undefined} value={row.placement}
              onChange={e => { const value = e.target.value; edit(r => ({ ...r, [team.id]: { ...(r[team.id] || { placement: '', kills: '' }), placement: value } })); }} /></td>
            <td><input type="number" inputMode="numeric" min={0} max={MAX_KILLS} aria-label={`${team.name} eliminations`} value={row.kills}
              onChange={e => { const value = e.target.value; edit(r => ({ ...r, [team.id]: { ...(r[team.id] || { placement: '', kills: '' }), kills: value } })); }} /></td>
          </tr>;
        })}</tbody>
      </table>
      <p className="field-hint">Leave placement empty for a squad that did not play. Empty eliminations count as 0.</p>
      {preview && status === 'completed' && <p className="field-hint">After saving, the top three will be: {preview.map(r => `${r.rank}. ${r.name} (${r.total})`).join(', ')}.</p>}
      {entryError && <p className="module-error" role="alert">{entryError}</p>}
      <div className="dialog-actions"><button className="arena-primary" disabled={saving}><Save size={16} />{saving ? 'Saving…' : `Save ${game.label}`}</button></div>
    </form>}

    {event?.placement && <PlacementStandingsView event={event.placement} />}

    <ConfirmModal isOpen={!!pending} title="Publish this Battle Royale event?"
      description={`${pending?.teamsCount || 0} squads, ${pending?.placement?.games.length || 0} games. ${occupying ? `This replaces "${occupying.title}" as the published CODM Battle Royale event. The replaced version stays restorable from Bracket Studio.` : 'Viewers will see it on the Brackets page.'}`}
      confirmLabel="Publish event" onConfirm={publish} onCancel={() => setPending(null)} />
  </div>;
};
