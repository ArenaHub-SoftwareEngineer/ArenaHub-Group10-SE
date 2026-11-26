import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { hasCampusEmail } from '../../lib/campusAccess';
import type { User, UserRole } from '../../lib/types';
import { ROLE_LABEL, STAFF_ROLES, summarizeUsers } from '../../lib/adminInsights';
import { firestoreService } from '../../lib/firestore';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';
import { Ban, ChevronRight, PauseCircle, QrCode, RotateCcw, Search, X } from '../ui/Icons';
import { errorMessage } from '../../lib/errors';
import { StatusRing, type StatusPart } from '../three/StatusRing';
import './adminPoster.css';

type StatusFilter = 'all' | 'active' | 'suspended' | 'banned' | 'pending';
type RoleFilter = UserRole | 'all' | 'staff';
type Action = 'suspend' | 'ban' | 'restore' | 'qr';

const STATUS: Record<User['status'], { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  active: { label: 'Active', tone: 'success' }, suspended: { label: 'Suspended', tone: 'warning' }, banned: { label: 'Banned', tone: 'danger' },
};
/**
 * Where someone is in getting access. Campus accounts only need a verified email; personal-email
 * guests also need to join with a student's invite QR or code. Nobody waits on an admin.
 */
type Access = { pending: boolean; label: string; hint: string };
function accessOf(user: User, admitted: Set<string>, admissionsKnown: boolean): Access {
  const campus = hasCampusEmail(user.email);
  if (user.emailVerified === false) return { pending: true, label: 'Pending · verify email', hint: 'Signed up but has not opened the verification email yet.' };
  if (campus) return { pending: false, label: 'Campus', hint: 'Verified campus account.' };
  if (!admissionsKnown) return { pending: false, label: 'Guest', hint: 'Personal email.' };
  return admitted.has(user.id)
    ? { pending: false, label: 'Guest', hint: 'Joined with a student invite. Can watch and comment only.' }
    : { pending: true, label: 'Pending · needs invite', hint: 'Personal email that has not entered a student invite QR or code yet.' };
}
const shortCollege = (name: string) => name.replace(/^College of /, '') || 'No college';

export const UsersView: React.FC<{ users: User[] }> = ({ users }) => {
  const { showToast } = useToast();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [role, setRole] = useState<RoleFilter>('all');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [action, setAction] = useState<{ user: User; type: Action } | null>(null);

  const summary = useMemo(() => summarizeUsers(users, Date.now()), [users]);
  // Which personal-email accounts have joined with a student invite (admins can list admissions).
  const [admitted, setAdmitted] = useState<Set<string> | null>(null);
  useEffect(() => onSnapshot(collection(db, 'spectatorAdmissions'), snap => setAdmitted(new Set(snap.docs.map(d => d.id))), () => setAdmitted(null)), []);
  const access = (user: User) => accessOf(user, admitted || new Set(), admitted !== null);
  const pendingCount = users.filter(user => access(user).pending).length;
  const parts: StatusPart[] = [
    { id: 'active', label: 'Active', value: summary.active, tone: 'success' },
    { id: 'suspended', label: 'Suspended', value: summary.suspended, tone: 'warning' },
    { id: 'banned', label: 'Banned', value: summary.banned, tone: 'danger' },
  ];
  const needle = search.trim().toLowerCase();
  const shown = users.filter(user => (status === 'all' || (status === 'pending' ? access(user).pending : user.status === status))
    && (role === 'all' || (role === 'staff' ? STAFF_ROLES.includes(user.role) : user.role === role))
    && (!needle || `${user.name} ${user.email} ${user.collegeName}`.toLowerCase().includes(needle)));
  const person = users.find(user => user.id === openId) || null;
  const roleChips: { id: RoleFilter; label: string; count: number }[] = [
    { id: 'all', label: 'Everyone', count: users.length },
    { id: 'staff', label: 'Staff', count: summary.staff },
    ...summary.roles.filter(item => !STAFF_ROLES.includes(item.role)).map(item => ({ id: item.role as RoleFilter, label: ROLE_LABEL[item.role] || item.role, count: item.count })),
  ];

  async function confirm() {
    if (!action) return;
    const { user, type } = action;
    try {
      if (type === 'qr') {
        const approved = !user.spectatorInviteApproved;
        await updateDoc(doc(db, 'users', user.id), { spectatorInviteApproved: approved });
        showToast(approved ? 'Student QR restored.' : 'Student QR revoked.', 'success');
      } else {
        const next = type === 'ban' ? 'banned' : type === 'suspend' ? 'suspended' : 'active';
        await firestoreService.updateUserStatus(user.id, next);
        showToast(type === 'restore' ? `${user.name} restored.` : `${user.name} ${next}.`, type === 'restore' ? 'success' : 'info');
      }
    } catch (error) { showToast(errorMessage(error, 'The account could not be updated.'), 'error'); throw error; }
    setAction(null);
  }

  const copy: Record<Action, (user: User) => { title: string; body: string; label: string; danger: boolean }> = {
    suspend: user => ({ title: `Suspend ${user.name}?`, body: 'They cannot chat or join a team until restored.', label: 'Suspend', danger: true }),
    ban: user => ({ title: `Ban ${user.name}?`, body: 'They lose all access to ArenaHub. You can restore them later.', label: 'Ban', danger: true }),
    restore: user => ({ title: `Restore ${user.name}?`, body: 'Their account becomes active again.', label: 'Restore', danger: false }),
    qr: user => user.spectatorInviteApproved
      ? { title: 'Revoke student QR?', body: 'Their current spectator QR stops working.', label: 'Revoke QR', danger: true }
      : { title: 'Restore student QR?', body: 'They can show a spectator QR again.', label: 'Restore QR', danger: false },
  };
  const dialog = action ? copy[action.type](action.user) : null;

  return (
    <div className="adp">
      <header className="adp-head">
        <span className="adp-giant" aria-hidden="true">Players</span>
        <div className="adp-title">
          <h2><span className="adp-count">{summary.total}</span> <span className="is-thin">accounts</span></h2>
          <p>{summary.newThisWeek ? `+${summary.newThisWeek} this week` : `${summary.colleges.length} colleges`}</p>
        </div>
      </header>

      <section className="adp-people-hero" aria-label="Accounts by status">
        <StatusRing parts={parts} total={summary.total} caption="accounts" selected={status === 'all' ? null : status}
          onSelect={id => setStatus(status === id ? 'all' : id as StatusFilter)} />
        <nav className="adp-stat-list" aria-label="Filter accounts by status">
          <button type="button" className="adp-stat" aria-pressed={status === 'all' && role === 'all'} onClick={() => { setStatus('all'); setRole('all'); }}>
            <span className="adp-dot is-neutral" aria-hidden="true" /><span>All</span><strong>{summary.total}</strong>
          </button>
          {parts.map(part => <button key={part.id} type="button" className={`adp-stat is-${part.tone}`} aria-pressed={status === part.id}
            onClick={() => setStatus(status === part.id ? 'all' : part.id as StatusFilter)}>
            <span className="adp-dot" aria-hidden="true" /><span>{part.label}</span><strong>{part.value}</strong>
          </button>)}
          <button type="button" className="adp-stat is-info" aria-pressed={status === 'pending'} title="Accounts still verifying their email or entering a student invite"
            onClick={() => setStatus(status === 'pending' ? 'all' : 'pending')}>
            <span className="adp-dot" aria-hidden="true" /><span>Pending</span><strong>{pendingCount}</strong>
          </button>
          <button type="button" className="adp-stat is-brand" aria-pressed={role === 'staff'} onClick={() => setRole(role === 'staff' ? 'all' : 'staff')}>
            <span className="adp-dot" aria-hidden="true" /><span>Staff</span><strong>{summary.staff}</strong>
          </button>
        </nav>
      </section>

      <div className="adp-toolbar">
        <div className="ah-chips" role="group" aria-label="Filter by role">
          {roleChips.map(chip => <button key={chip.id} type="button" className="ah-chip" aria-pressed={role === chip.id} onClick={() => setRole(chip.id)}>
            {chip.label} <span className="ah-chip-count">{chip.count}</span>
          </button>)}
        </div>
        <label className="page-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" aria-label="Search users" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, email or college" />
        </label>
      </div>

      <p className="adp-results" role="status">{shown.length} of {users.length}{status !== 'all' || role !== 'all' || needle ? <button type="button" className="arena-text-button" onClick={() => { setStatus('all'); setRole('all'); setSearch(''); }}>Clear <X size={13} aria-hidden="true" /></button> : null}</p>

      {shown.length ? <ul className="adp-people" aria-label="Registered accounts">
        {shown.map(user => {
          const s = STATUS[user.status] || STATUS.active;
          const staff = STAFF_ROLES.includes(user.role);
          const a = access(user);
          return <li key={user.id}>
            <button type="button" className="adp-person" aria-haspopup="dialog" onClick={() => setOpenId(user.id)}>
              <span className={`adp-avatar${staff ? ' is-staff' : ''}`} aria-hidden="true">{user.avatarInitials}<i className={`is-${s.tone}`} /></span>
              <span className="adp-person-name"><strong>{user.name}</strong><small>{user.email}</small></span>
              <span className="adp-person-college">{shortCollege(user.collegeName)}</span>
              <span className={`adp-pill is-${a.pending ? 'info' : s.tone}`} title={a.pending ? a.hint : undefined}>{a.pending ? a.label : s.label}</span>
              <span className={`adp-pill${staff ? ' is-brand' : ''}`}>{staff || user.role !== 'user' ? ROLE_LABEL[user.role] || user.role : hasCampusEmail(user.email) ? 'Campus' : 'Guest'}</span>
              <ChevronRight size={18} className="adp-log-go" aria-hidden="true" />
            </button>
          </li>;
        })}
      </ul> : <p className="adp-empty">{users.length ? 'No one matches.' : 'No accounts yet.'}</p>}

      <Modal open={Boolean(person)} title={person?.name || 'Account'} onClose={() => setOpenId(null)} className="feature-dialog">
        {person && (() => {
          const s = STATUS[person.status] || STATUS.active;
          const staff = STAFF_ROLES.includes(person.role);
          return <div className="adp-card">
            <div className="adp-card-top">
              <span className={`adp-avatar is-lg${staff ? ' is-staff' : ''}`} aria-hidden="true">{person.avatarInitials}<i className={`is-${s.tone}`} /></span>
              <div>
                <p className="adp-card-email">{person.email}</p>
                <div className="adp-card-pills">
                  <span className={`adp-pill is-${s.tone}`}>{s.label}{person.status === 'suspended' && person.suspendedUntil ? ` · ${person.suspendedUntil}` : ''}</span>
                  <span className={`adp-pill${staff ? ' is-brand' : ''}`}>{ROLE_LABEL[person.role] || person.role}</span>
                  {(a => a.pending && <span className="adp-pill is-info">{a.label}</span>)(access(person))}
                  {hasCampusEmail(person.email) && !person.spectatorInviteApproved && <span className="adp-pill is-danger">QR revoked</span>}
                </div>
              </div>
            </div>
            <dl className="adp-card-facts">
              <div><dt>College</dt><dd>{person.collegeName || 'No college'}</dd></div>
              <div><dt>Joined</dt><dd>{person.joinedDate}</dd></div>
              <div><dt>Access</dt><dd>{access(person).hint}</dd></div>
            </dl>
            <div className="adp-card-actions">
              {hasCampusEmail(person.email) && (person.status === 'active' || person.spectatorInviteApproved) && (
                <button type="button" className="adp-act" onClick={() => setAction({ user: person, type: 'qr' })}>
                  <QrCode size={18} aria-hidden="true" /><span>{person.spectatorInviteApproved ? 'Revoke QR' : 'Restore QR'}</span>
                </button>
              )}
              {person.status === 'active' ? <>
                <button type="button" className="adp-act is-remove" onClick={() => setAction({ user: person, type: 'suspend' })}><PauseCircle size={18} aria-hidden="true" /><span>Suspend</span></button>
                <button type="button" className="adp-act is-ban" onClick={() => setAction({ user: person, type: 'ban' })}><Ban size={18} aria-hidden="true" /><span>Ban</span></button>
              </> : <button type="button" className="adp-act is-restore" onClick={() => setAction({ user: person, type: 'restore' })}><RotateCcw size={18} aria-hidden="true" /><span>Restore</span></button>}
            </div>
            {staff && <p className="adp-note">Staff roles are set by the project administrator.</p>}
          </div>;
        })()}
      </Modal>

      <ConfirmModal
        isOpen={Boolean(action)}
        title={dialog?.title || ''}
        description={dialog?.body || ''}
        confirmLabel={dialog?.label || 'Confirm'}
        isDestructive={dialog?.danger}
        onConfirm={confirm}
        onCancel={() => setAction(null)}
      />
    </div>
  );
};
