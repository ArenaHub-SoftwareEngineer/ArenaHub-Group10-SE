// Facilitators: invite by school email, then choose their matches. The role is set on the server
// (server/facilitators.ts); a facilitator sees only Anti-cheat and only the matches picked here.
import React, { useMemo, useState } from 'react';
import { antiCheatCall } from '../../lib/antiCheatApi';
import { errorMessage } from '../../lib/errors';
import { GAME_LABEL } from '../../lib/integrityRisk';
import type { BracketDraft } from '../../lib/types';
import { Modal } from '../ui/Modal';
import { Check, Plus, Send, Swords, Trash2, X } from '../ui/Icons';
import { CrestBadge, emailInitials, scheduledCards, type ScreenCard } from './ScreenWall';
import './watchScreens.css';

export interface Facilitator { email: string; status: 'invited' | 'active' | 'staff'; invitedAt: number; matches: string[] }
export interface FacilitatorList { facilitators: Facilitator[]; canInvite: boolean }

const CAN = ['Watch player screens', 'Open check-in and QR codes', 'Review scans', 'Report a player'];
const CANNOT = ['Edit brackets or teams', 'Change users or roles', 'Change anti-cheat rules', 'See unassigned matches'];

const dayLabel = (day: string) => day ? new Date(day + 'T00:00').toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }) : 'No date';

function MatchPicker({ person, cards, onClose, onSaved }: { person: Facilitator; cards: ScreenCard[]; onClose: () => void; onSaved: (list: Facilitator[]) => void }) {
  const [picked, setPicked] = useState<string[]>(person.matches);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const days = [...new Set(cards.map(card => card.day))].sort();
  const toggle = (key: string) => setPicked(list => list.includes(key) ? list.filter(item => item !== key) : [...list, key]);
  const save = async () => {
    setBusy(true); setError('');
    try { onSaved((await antiCheatCall<{ facilitators: Facilitator[] }>(`/facilitators/${encodeURIComponent(person.email)}/matches`, { method: 'PUT', body: { matches: picked } })).facilitators); onClose(); }
    catch (err) { setError(errorMessage(err, 'Matches could not be saved.')); }
    finally { setBusy(false); }
  };
  return <Modal open title="Their matches" description={person.email} busy={busy} onClose={onClose} className="feature-dialog feature-dialog-wide">
    <div className="feature-dialog-body">
      {!cards.length ? <p className="adp-empty">No upcoming matches yet.</p> : <div className="fx-picker">
        {days.map(day => <section key={day}><h4>{dayLabel(day)}</h4><ul>
          {cards.filter(card => card.day === day).map(card => { const on = picked.includes(card.key); return <li key={card.key}>
            <button type="button" className="fx-pick" aria-pressed={on} onClick={() => toggle(card.key)}>
              <span className="fx-pick-time">{card.live ? 'Live' : card.time || '—'}</span>
              <span className="fx-pick-crests">{card.crests.map(crest => <CrestBadge key={crest.name} crest={crest} size="sm" />)}</span>
              <span className="fx-pick-name">{card.crests.length === 2 ? `${card.crests[0].name} vs ${card.crests[1].name}` : card.title}<small>{[card.short, card.game ? GAME_LABEL[card.game] : ''].filter(Boolean).join(' · ')}</small></span>
              <span className="ws-tick" aria-hidden="true">{on ? <Check size={14} /> : <Plus size={14} />}</span>
            </button></li>; })}
        </ul></section>)}
      </div>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="feature-dialog-actions"><span className="ws-count">{picked.length} picked</span><button type="button" className="arena-outline" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="arena-primary" onClick={() => void save()} disabled={busy}>Save</button></div>
    </div>
  </Modal>;
}

export function FacilitatorsPanel({ brackets, data, onChange }: { brackets: BracketDraft[]; data: FacilitatorList | null; onChange: (list: Facilitator[]) => void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [picking, setPicking] = useState<Facilitator | null>(null);
  const [removing, setRemoving] = useState<Facilitator | null>(null);
  const cards = useMemo(() => scheduledCards(brackets).sort((a, b) => a.order.localeCompare(b.order)), [brackets]);
  const byKey = useMemo(() => new Map(cards.map(card => [card.key, card])), [cards]);

  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await antiCheatCall<{ email: string; status: Facilitator['status']; facilitators: Facilitator[] }>('/facilitators', { body: { email } });
      onChange(result.facilitators); setEmail('');
      setNotice(result.status === 'active' ? `${result.email} is a facilitator now. Pick their matches.`
        : result.status === 'staff' ? `${result.email} is already staff. Assign them on a match card.`
        : `Invited ${result.email}. They become a facilitator when they sign in with that email.`);
      const added = result.facilitators.find(person => person.email === result.email);
      if (added && result.status !== 'staff') setPicking(added);
    } catch (err) { setError(errorMessage(err, 'The invite could not be sent.')); }
    finally { setBusy(false); }
  };
  const remove = async (person: Facilitator) => {
    setBusy(true); setError('');
    try { onChange((await antiCheatCall<{ facilitators: Facilitator[] }>(`/facilitators/${encodeURIComponent(person.email)}`, { method: 'DELETE' })).facilitators); setRemoving(null); setNotice(`${person.email} is no longer a facilitator.`); }
    catch (err) { setError(errorMessage(err, 'They could not be removed.')); }
    finally { setBusy(false); }
  };

  return <section className="fx" aria-label="Facilitators">
    <div className="fx-top">
      <div className="fx-invite">
        <h3>Invite a facilitator</h3>
        <form onSubmit={invite}>
          <input type="email" required aria-label="School email" maxLength={160} value={email} placeholder="name@wmsu.edu.ph" onChange={event => setEmail(event.target.value)} disabled={busy || data?.canInvite === false} />
          <button className="arena-primary" disabled={busy || !email.trim() || data?.canInvite === false}><Send size={16} aria-hidden="true" />Invite</button>
        </form>
        {data?.canInvite === false && <p className="field-error" role="alert">The server cannot give roles yet. Add the Firebase service account to the API.</p>}
        {error && <p className="field-error" role="alert">{error}</p>}
        {notice && <p className="adp-note" role="status">{notice}</p>}
      </div>
      <div className="fx-can">
        <h4>What facilitators can do</h4>
        <ul>
          {CAN.map(item => <li key={item} className="is-yes"><Check size={15} aria-label="Can" />{item}</li>)}
          {CANNOT.map(item => <li key={item} className="is-no"><X size={15} aria-label="Cannot" />{item}</li>)}
        </ul>
      </div>
    </div>

    {!data ? <div className="fx-list" aria-busy="true">{[0, 1].map(i => <div key={i} className="ws-card is-skeleton" style={{ minHeight: 150 }} />)}</div>
      : !data.facilitators.length ? <p className="adp-empty">No facilitators yet. Invite one with their school email.</p>
      : <ul className="fx-list">{data.facilitators.map(person => {
        const mine = person.matches.map(key => byKey.get(key)).filter((card): card is ScreenCard => !!card);
        return <li key={person.email} className="fx-person">
          <div className="fx-person-head">
            <span className="ws-avatar" aria-hidden="true">{emailInitials(person.email)}</span>
            <span><span className="fx-mail" title={person.email}>{person.email}</span>
              <span className={`adp-pill ${person.status === 'active' ? 'is-success' : 'is-warning'}`}>{person.status === 'active' ? 'Active' : 'Invited · not signed in yet'}</span></span>
          </div>
          <div className="fx-person-matches">
            {mine.slice(0, 4).flatMap(card => card.crests.slice(0, 1)).map((crest, i) => <CrestBadge key={i} crest={crest} size="sm" />)}
            <small>{person.matches.length ? `${person.matches.length} match${person.matches.length === 1 ? '' : 'es'}` : 'No matches yet'}</small>
          </div>
          <div className="fx-person-actions">
            <button type="button" className="arena-outline" onClick={() => setPicking(person)} disabled={busy}><Swords size={15} aria-hidden="true" />Matches</button>
            <button type="button" className="arena-outline is-remove" onClick={() => setRemoving(person)} disabled={busy} aria-label={`Remove ${person.email}`}><Trash2 size={15} aria-hidden="true" /></button>
          </div>
        </li>;
      })}</ul>}

    {picking && <MatchPicker person={picking} cards={cards} onClose={() => setPicking(null)} onSaved={list => { onChange(list); setNotice(`Saved ${picking.email}'s matches.`); }} />}
    {removing && <Modal open title="Remove facilitator?" description={removing.email} busy={busy} onClose={() => setRemoving(null)} className="feature-dialog">
      <div className="feature-dialog-body">
        <p className="field-hint">They lose Anti-cheat access and come off every match.</p>
        <div className="feature-dialog-actions"><button type="button" className="arena-outline" onClick={() => setRemoving(null)} disabled={busy}>Cancel</button><button type="button" className="arena-primary" onClick={() => void remove(removing)} disabled={busy}>Remove</button></div>
      </div>
    </Modal>}
  </section>;
}
