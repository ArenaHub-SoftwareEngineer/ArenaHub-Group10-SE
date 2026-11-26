// Admin Teams page. One crest per college; tap it to open that college:
//   - a 3D medallion of its logo with a Change logo button (one upload is used in every game, same field as Bracket Studio),
//   - a tab per game the college plays, each with that game's team name and roster status,
//   - the players for the chosen game, edited in place: photo, full name, in-game name, role and school email.
// Teams come from the published brackets, so there is nothing to type twice.
import React, { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import type { BracketDraft, Team } from '../../lib/types';
import { bracketTeams, type PrivateRosterDoc } from '../../lib/data/tournamentDocs';
import { readPrivateRoster, saveTeamRoster } from '../../lib/data/teamRosterStore';
import { firestoreService } from '../../lib/firestore';
import { isFirebaseConfigured } from '../../lib/firebase';
import { CAMPUS_DOMAIN } from '../../lib/institution';
import { INSTITUTION_COLLEGES } from '../../lib/colleges';
import { prepareTeamImage, preparePlayerPhoto, TEAM_IMAGE_TYPES } from '../../lib/teamImage';
import { blankRows, emptyRow, gameRoles, maxPlayersFor, nextRole, rosterProblem, rosterStatus, rowsFromRosters, startersFor, type RosterRow } from '../../lib/teamRoster';
import { errorMessage } from '../../lib/errors';
import { bracketArt } from '../common/TournamentPicker';
import { TeamCrest } from '../three/TeamCrest';
import { ArrowLeft, Camera, Check, LoaderCircle, Plus, Trash2, Upload, X } from '../ui/Icons';
import { Req } from '../ui/Req';
import { useToast } from '../ui/Toast';
import './adminPoster.css';
import './teamsManager.css';

const codeOf = (team: Pick<Team, 'collegeCode'>) => (team.collegeCode || '').trim().toUpperCase();
const byName = (a: Team, b: Team) => a.name.localeCompare(b.name);
const FALLBACK_COLOR = '#ff6600';
const DISCARD = 'Discard the player changes you have not saved?';

type Status = 'empty' | 'partial' | 'ready';
interface GameEntry { event: BracketDraft; team: Team; status: Status }
interface College {
  key: string; code: string; name: string; teamName: string; color: string; logo?: string;
  /** Where a logo upload goes. Battle Royale squads cannot carry a badge, so this is a bracket game's team. */
  logoTarget?: { bracketId: string; teamId: string };
  games: GameEntry[];
}

/** The name a college uses most across its games ("CA Blueprints"), so the crest shows one name. */
function commonName(teams: Team[]) {
  const counts = new Map<string, number>();
  for (const team of teams) counts.set(team.name, (counts.get(team.name) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '';
}

function buildColleges(events: BracketDraft[], pendingLogos: Record<string, string>): College[] {
  // Bracket games first; Battle Royale squads last.
  const ordered = [...events].sort((a, b) => Number(!!a.placement) - Number(!!b.placement));
  const groups = new Map<string, { code: string; entries: GameEntry[]; logo?: string; logoTarget?: College['logoTarget'] }>();
  for (const event of ordered) for (const team of bracketTeams(event).sort(byName)) {
    const code = codeOf(team);
    const key = code || `team:${team.id}`;
    const group = groups.get(key) || { code: code || team.name.slice(0, 3).toUpperCase(), entries: [] };
    if (group.entries.some(entry => entry.event.id === event.id)) continue;
    group.entries.push({ event, team, status: rosterStatus(team.players?.length || 0, event) });
    const image = event.appearance?.teams?.[team.id]?.image;
    if (image && !group.logo) group.logo = image;
    if (!event.placement && !group.logoTarget) group.logoTarget = { bracketId: event.id, teamId: team.id };
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => {
    const college = INSTITUTION_COLLEGES.find(c => c.code.toUpperCase() === group.code);
    return {
      key, code: group.code, name: college?.name || group.entries[0].team.name,
      teamName: commonName(group.entries.map(entry => entry.team)), color: college?.color || FALLBACK_COLOR,
      // A pending '' means the logo was just removed.
      logo: key in pendingLogos ? pendingLogos[key] || undefined : group.logo, logoTarget: group.logoTarget, games: group.entries,
    };
  }).sort((a, b) => a.code.localeCompare(b.code));
}

const gameLabel = (event: BracketDraft) => event.gameName || event.title;
const readyCount = (college: College) => college.games.filter(game => game.status === 'ready').length;

export function TeamsManager({ events }: { events: BracketDraft[] }) {
  const { showToast } = useToast();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [pendingLogos, setPendingLogos] = useState<Record<string, string>>({});
  const colleges = useMemo(() => buildColleges(events, pendingLogos), [events, pendingLogos]);
  const open = colleges.find(college => college.key === openKey);
  const rosters = colleges.reduce((sum, college) => sum + college.games.length, 0);
  const ready = colleges.reduce((sum, college) => sum + readyCount(college), 0);
  const logos = colleges.filter(college => college.logo).length;

  // Once the published brackets carry the new logo, stop overriding them (a later Bracket Studio change wins).
  useEffect(() => { setPendingLogos({}); }, [events]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }); }, [openKey]);

  async function uploadLogo(college: College, file: File) {
    if (!college.logoTarget) throw new Error('Add this college to a bracket game first. Battle Royale squads use the logo from a bracket game.');
    const image = await prepareTeamImage(file);
    await firestoreService.saveTeamLogo(college.logoTarget.bracketId, college.logoTarget.teamId, image);
    setPendingLogos(current => ({ ...current, [college.key]: image }));
    showToast(`${college.code} logo saved for every game.`);
  }

  async function removeLogo(college: College) {
    if (!college.logoTarget) throw new Error('This college has no bracket game to remove the logo from.');
    await firestoreService.saveTeamLogo(college.logoTarget.bracketId, college.logoTarget.teamId, undefined);
    setPendingLogos(current => ({ ...current, [college.key]: '' }));
    showToast(`${college.code} logo removed from every game.`);
  }

  return <div className="teams-page adp module-page">
    <LayoutGroup>
      {!events.length ? <>
        <header className="adp-head"><span className="adp-giant" aria-hidden="true">Teams</span>
          <div className="adp-title"><h2>Teams</h2></div></header>
        <p className="module-notice">Publish a bracket first. Its teams appear here.</p>
      </> : open ? <CollegeView key={open.key} college={open} onBack={() => setOpenKey(null)} onUploadLogo={uploadLogo} onRemoveLogo={removeLogo} />
        : <>
          <header className="adp-head">
            <span className="adp-giant" aria-hidden="true">Teams</span>
            <div className="adp-title">
              <h2><span className="adp-count">{colleges.length}</span> <span className="is-thin">teams</span></h2>
              <p>{ready} of {rosters} rosters ready · {logos} of {colleges.length} logos</p>
            </div>
          </header>
          <ul className="tm-grid" aria-label="Teams">
            {colleges.map((college, index) => <li key={college.key} style={{ '--i': index } as CSSProperties}>
              <CrestCard college={college} onOpen={() => setOpenKey(college.key)} />
            </li>)}
          </ul>
        </>}
    </LayoutGroup>
  </div>;
}

/** A big crest: tilts toward the pointer, a light follows it, and a shine sweeps across now and then. */
function CrestCard({ college, onOpen }: { college: College; onOpen: () => void }) {
  const card = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion();
  const done = readyCount(college);
  const move = (e: React.PointerEvent) => {
    const el = card.current;
    if (!el || reduced || e.pointerType !== 'mouse') return;
    const box = el.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width, y = (e.clientY - box.top) / box.height;
    el.style.setProperty('--rx', `${(0.5 - y) * 14}deg`);
    el.style.setProperty('--ry', `${(x - 0.5) * 18}deg`);
    el.style.setProperty('--mx', `${x * 100}%`);
    el.style.setProperty('--my', `${y * 100}%`);
  };
  const leave = () => { const el = card.current; if (el) { el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); } };
  return <button ref={card} type="button" className="tm-card" style={{ '--crest': college.color } as CSSProperties}
    onPointerMove={move} onPointerLeave={leave} onClick={onOpen}
    aria-label={`${college.teamName}, ${college.name}. ${done} of ${college.games.length} games ready. Open`}>
    <span className="tm-card-glare" aria-hidden="true" />
    <motion.span layoutId={`crest-${college.key}`} className={`tm-badge${college.logo ? '' : ' is-empty'}`} aria-hidden="true">
      {college.logo ? <img src={college.logo} alt="" draggable={false} /> : <b>{college.code}</b>}
      <i className="tm-badge-shine" />
    </motion.span>
    <span className="tm-card-name" aria-hidden="true">
      <strong>{college.teamName}</strong>
      <small>{college.code}{college.logo ? '' : ' · No logo yet'}</small>
    </span>
    <span className="tm-card-games" aria-hidden="true">
      {college.games.map(game => <span key={game.event.id} className={`tm-game-dot is-${game.status}`} title={gameLabel(game.event)}>
        {bracketArt(game.event) ? <img src={bracketArt(game.event)} alt="" /> : null}
      </span>)}
    </span>
  </button>;
}

function CollegeView({ college, onBack, onUploadLogo, onRemoveLogo }: {
  college: College; onBack: () => void; onUploadLogo: (college: College, file: File) => Promise<void>;
  onRemoveLogo: (college: College) => Promise<void>;
}) {
  const [gameId, setGameId] = useState(() => (college.games.find(game => game.status !== 'ready') || college.games[0]).event.id);
  const [dirty, setDirty] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState('');
  const [spinKey, setSpinKey] = useState(0);
  const tabs = useRef<HTMLDivElement>(null);
  const game = college.games.find(entry => entry.event.id === gameId) || college.games[0];
  const guard = (then: () => void) => { if (!dirty || window.confirm(DISCARD)) { setDirty(false); then(); } };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open]')) return;
      if ((e.target as HTMLElement)?.closest('input, select, textarea')) return;
      guard(onBack);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function changeLogo(file?: File) {
    if (!file || logoBusy) return;
    setLogoBusy(true); setLogoError('');
    try { await onUploadLogo(college, file); setSpinKey(key => key + 1); }
    catch (problem) { setLogoError(errorMessage(problem, 'The logo could not be saved.')); }
    finally { setLogoBusy(false); }
  }

  async function removeLogo() {
    if (logoBusy || !window.confirm(`Remove the ${college.code} logo from every game?`)) return;
    setLogoBusy(true); setLogoError('');
    try { await onRemoveLogo(college); }
    catch (problem) { setLogoError(errorMessage(problem, 'The logo could not be removed.')); }
    finally { setLogoBusy(false); }
  }

  const pick = (id: string) => guard(() => setGameId(id));
  const keyMove = (e: React.KeyboardEvent, index: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = college.games[(index + step + college.games.length) % college.games.length];
    pick(next.event.id);
    tabs.current?.querySelector<HTMLButtonElement>(`[data-game="${CSS.escape(next.event.id)}"]`)?.focus();
  };

  return <div className="tm-detail" style={{ '--crest': college.color } as CSSProperties}>
    <button type="button" className="arena-outline arena-sm tm-back" onClick={() => guard(onBack)}><ArrowLeft size={16} aria-hidden="true" /> All teams</button>

    <section className="tm-hero" aria-labelledby="tm-hero-name">
      <motion.div layoutId={`crest-${college.key}`} className="tm-hero-crest">
        <TeamCrest logo={college.logo} monogram={college.code} color={college.color} spinKey={spinKey} />
      </motion.div>
      <div className="tm-hero-text">
        <span className="tm-hero-college">{college.name}</span>
        <h2 id="tm-hero-name">{college.teamName}</h2>
        <p className="tm-hero-stat"><strong>{readyCount(college)}</strong>/{college.games.length} games ready</p>
        <div className="tm-hero-actions">
          <label className={`arena-outline tm-logo-button${logoBusy ? ' is-busy' : ''}`} title={college.logoTarget ? undefined : 'Battle Royale squads use the logo from a bracket game.'}>
            {logoBusy ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
            {logoBusy ? 'Saving logo' : college.logo ? 'Change logo' : 'Add logo'}
            <input type="file" accept={TEAM_IMAGE_TYPES} disabled={logoBusy || !college.logoTarget}
              onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; void changeLogo(file); }} />
          </label>
          {college.logo && <button type="button" className="arena-outline tm-logo-remove" disabled={logoBusy || !college.logoTarget} onClick={() => void removeLogo()}>
            <Trash2 size={16} aria-hidden="true" /> Remove logo
          </button>}
          <span className="tm-hero-hint">Used in every game · PNG with a clear background looks best</span>
        </div>
        {logoError && <p className="field-error" role="alert">{logoError}</p>}
      </div>
    </section>

    <div ref={tabs} className="tm-games" role="tablist" aria-label="Games">
      {college.games.map((entry, index) => {
        const selected = entry.event.id === game.event.id;
        const art = bracketArt(entry.event);
        const players = entry.team.players?.length || 0;
        return <button key={entry.event.id} type="button" role="tab" data-game={entry.event.id} id={`tm-tab-${entry.event.id}`}
          aria-selected={selected} aria-controls="tm-roster" tabIndex={selected ? 0 : -1}
          className={`tm-game is-${entry.status}`} onClick={() => pick(entry.event.id)} onKeyDown={e => keyMove(e, index)}>
          {art && <img className="tm-game-art" src={art} alt="" />}
          <span className="tm-game-text">
            <strong>{gameLabel(entry.event)}</strong>
            <small>{entry.team.name}</small>
          </span>
          <span className="tm-game-status">{entry.status === 'ready' ? <Check size={13} aria-hidden="true" /> : null}{players ? `${players} players` : 'No players'}</span>
        </button>;
      })}
    </div>

    <section id="tm-roster" role="tabpanel" aria-labelledby={`tm-tab-${game.event.id}`} className="tm-roster">
      <RosterEditor key={`${game.event.id}:${game.team.id}`} event={game.event} team={game.team} onDirty={setDirty} />
    </section>
  </div>;
}

function RosterEditor({ event, team, onDirty }: { event: BracketDraft; team: Team; onDirty: (dirty: boolean) => void }) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<RosterRow[] | null>(null);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState('');
  const roles = gameRoles(event);
  const max = maxPlayersFor(event);
  const dirty = !!rows && JSON.stringify(rows) !== saved;

  useEffect(() => {
    let live = true;
    const publicPlayers = (team.players || []).map(p => ({ id: p.id, ign: p.ign, role: p.role, isVerified: p.isVerified, avatarUrl: p.avatarUrl }));
    const fill = (secret: PrivateRosterDoc) => {
      if (!live) return;
      const next = publicPlayers.length ? rowsFromRosters(publicPlayers, secret.teams?.[team.id]?.players) : blankRows(team.id, event);
      setRows(next); setSaved(JSON.stringify(next));
    };
    if (!isFirebaseConfigured) fill({ teams: {} });
    else readPrivateRoster(event.id).then(fill, problem => { if (live) { setError(errorMessage(problem, 'The private roster could not be loaded.')); fill({ teams: {} }); } });
    return () => { live = false; };
  }, [event.id, team.id]);

  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const change = (id: string, patch: Partial<RosterRow>) => { setError(''); setRows(current => current && current.map(row => row.id === id ? { ...row, ...patch } : row)); };

  async function choosePhoto(id: string, file?: File) {
    if (!file) return;
    setPhotoBusy(id);
    try { change(id, { photo: await preparePlayerPhoto(file) }); }
    catch (problem) { setError(errorMessage(problem, 'The photo could not be added.')); }
    finally { setPhotoBusy(''); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!rows) return;
    const problem = rosterProblem(rows, event);
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    try { await saveTeamRoster(event.id, team, rows); setSaved(JSON.stringify(rows)); showToast(`${team.name} players saved.`); }
    catch (failure) { setError(errorMessage(failure, 'The players could not be saved.')); }
    finally { setBusy(false); }
  }

  if (!rows) return <p className="teams-loading"><LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> Loading players</p>;
  return <form className="tm-form" onSubmit={save} noValidate>
    <div className="tm-roster-head">
      <h3>{team.name}</h3>
      <p>{startersFor(event)} starters · up to {max - startersFor(event)} substitutes</p>
    </div>
    <fieldset disabled={busy} className="tm-players">
      <legend className="sr-only">Players</legend>
      {rows.map((row, index) => <div key={row.id} className="tm-player" style={{ '--i': index } as CSSProperties}>
        <label className="tm-photo" title="Photo">
          {photoBusy === row.id ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
            : row.photo ? <img src={row.photo} alt="" /> : <><Camera size={18} aria-hidden="true" /><span>Photo</span></>}
          <input type="file" accept={TEAM_IMAGE_TYPES} aria-label={`Photo for player ${index + 1}`}
            onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; void choosePhoto(row.id, file); }} />
        </label>
        <div className="tm-player-fields">
          <label><Req>Full name</Req><input aria-required="true" value={row.fullName} maxLength={100} autoComplete="off" onChange={e => change(row.id, { fullName: e.target.value })} /></label>
          <label><Req>In-game name</Req><input aria-required="true" value={row.ign} maxLength={40} autoComplete="off" onChange={e => change(row.id, { ign: e.target.value })} /></label>
          <label><Req>Role</Req><select aria-required="true" value={row.role} onChange={e => change(row.id, { role: e.target.value })}>
            {(roles.includes(row.role) ? roles : [row.role, ...roles]).map(role => <option key={role}>{role}</option>)}
          </select></label>
          <label><span>School email <small>optional</small></span><input type="email" value={row.schoolEmail} maxLength={120} autoComplete="off" placeholder={`name@${CAMPUS_DOMAIN}`} onChange={e => change(row.id, { schoolEmail: e.target.value })} /></label>
        </div>
        <button type="button" className="quiet-icon-button tm-remove" aria-label={`Remove player ${index + 1}`} onClick={() => setRows(current => current && current.filter(r => r.id !== row.id))}><X size={16} /></button>
      </div>)}
      {rows.length < max && <button type="button" className="tm-add" onClick={() => setRows(current => current && [...current, emptyRow(team.id, current, nextRole(current, event))])}>
        <Plus size={18} aria-hidden="true" /> Add player
      </button>}
    </fieldset>
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className={`tm-savebar${dirty ? ' is-dirty' : ''}`}>
      <span>{busy ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}</span>
      {dirty && !busy && <button type="button" className="arena-outline arena-sm" onClick={() => { setRows(JSON.parse(saved)); setError(''); }}>Discard</button>}
      <button className="arena-primary arena-sm" disabled={busy || !!photoBusy || !dirty}>{busy ? 'Saving…' : 'Save players'}</button>
    </div>
  </form>;
}
