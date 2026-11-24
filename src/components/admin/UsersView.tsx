import { PageHeading } from '../ui/PageHeading';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { hasCampusEmail } from '../../lib/campusAccess';
import React, { useMemo, useState } from 'react';
import { User, UserRole, UserStatus } from '../../lib/types';
import { ROLE_LABEL, STAFF_ROLES, summarizeUsers } from '../../lib/adminInsights';
import { SegmentBar } from './AdminOverview';
import './adminOverview.css';

type RoleFilter = UserRole | 'all' | 'staff';
import { firestoreService } from '../../lib/firestore';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useToast } from '../ui/Toast';
import { Search, Ban, PauseCircle, RotateCcw } from '../ui/Icons';
import { errorMessage } from '../../lib/errors';

interface UsersViewProps {
  users: User[];
}

export const UsersView: React.FC<UsersViewProps> = ({ users }) => {
  const { showToast } = useToast();
  const [filter, setFilter] = useState<'all' | 'active' | 'suspended' | 'banned'>('all');
  const [search, setSearch] = useState('');
  const [inviteApprovalUser, setInviteApprovalUser] = useState<User | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [actionType, setActionType] = useState<'suspend' | 'ban' | 'restore' | null>(null);

  const [role, setRole] = useState<RoleFilter>('all');
  const summary = useMemo(() => summarizeUsers(users, Date.now()), [users]);
  const statusTiles = [
    { id: 'all', label: 'All accounts', value: summary.total, note: summary.newThisWeek ? `${summary.newThisWeek} joined this week` : `${summary.colleges.length} colleges`, tone: 'neutral' },
    { id: 'active', label: 'Active', value: summary.active, note: 'Can watch and chat', tone: 'success' },
    { id: 'suspended', label: 'Suspended', value: summary.suspended, note: 'Waiting for review', tone: summary.suspended ? 'warning' : 'neutral' },
    { id: 'banned', label: 'Banned', value: summary.banned, note: 'No access', tone: summary.banned ? 'danger' : 'neutral' },
  ] as const;

  const filteredUsers = users.filter((u) => {
    const matchesFilter = (filter === 'all' || u.status === filter)
      && (role === 'all' || (role === 'staff' ? STAFF_ROLES.includes(u.role) : u.role === role));
    const matchesSearch =
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.collegeName.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const handleConfirmAction = async () => {
    if (!selectedUser || !actionType) return;

    try {
    if (actionType === 'ban') {
      await firestoreService.updateUserStatus(selectedUser.id, 'banned');
      showToast(`User ${selectedUser.name} has been banned from ArenaHub`, 'error');
    } else if (actionType === 'suspend') {
      await firestoreService.updateUserStatus(selectedUser.id, 'suspended');
      showToast(`User ${selectedUser.name} suspended pending organizer review`, 'info');
    } else if (actionType === 'restore') {
      await firestoreService.updateUserStatus(selectedUser.id, 'active');
      showToast(`User ${selectedUser.name} status restored to active`, 'success');
    }

    } catch (error) { showToast(errorMessage(error, 'Account status could not be updated.'), 'error'); throw error; }
    setSelectedUser(null);
    setActionType(null);
  };

  return (
    <div className="space-y-6">
      <PageHeading title="Users" description="Who is on ArenaHub, their status and role. Select a tile to filter, then suspend, ban or restore an account." />
      <nav className="ov-kpis" aria-label="Filter accounts by status">
        {statusTiles.map(tile => (
          <button key={tile.id} type="button" className={`ov-kpi is-link ov-tone is-${tile.tone}`} aria-pressed={filter === tile.id} onClick={() => setFilter(tile.id)}>
            <span>{tile.label}</span><strong>{tile.value}</strong><small>{tile.note}</small>
          </button>
        ))}
        <button type="button" className="ov-kpi is-link ov-tone is-brand" aria-pressed={role === 'staff'} onClick={() => setRole(role === 'staff' ? 'all' : 'staff')}>
          <span>Staff</span><strong>{summary.staff}</strong><small>Admins, organizers, moderators</small>
        </button>
      </nav>
      <SegmentBar label="Accounts by status" parts={[
        { tone: 'success', value: summary.active, label: 'Active' },
        { tone: 'warning', value: summary.suspended, label: 'Suspended' },
        { tone: 'danger', value: summary.banned, label: 'Banned' },
      ]} />
      <div className="page-toolbar">
        <label className="ov-role-select">
          <span className="sr-only">Filter by role</span>
          <select value={role} onChange={event => setRole(event.target.value as RoleFilter)}>
            <option value="all">All roles</option>
            <option value="staff">Staff only</option>
            {summary.roles.map(item => <option key={item.role} value={item.role}>{ROLE_LABEL[item.role] || item.role} ({item.count})</option>)}
          </select>
        </label>
        <label className="page-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" aria-label="Search users" value={search}
            onChange={event => setSearch(event.target.value)} placeholder="Search users" />
        </label>
      </div>

      <p className="ov-count-line" role="status">Showing {filteredUsers.length} of {users.length} accounts{search.trim() ? ` matching "${search.trim()}"` : ''}</p>
      <div className="page-panel overflow-x-auto" role="region" aria-label="Registered accounts" tabIndex={0}>
        <table className="users-table w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-(--border) text-xs font-semibold text-(--text-muted)">
              <th className="py-3 px-4">User</th>
              <th className="py-3 px-4">College</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Role</th>
              <th className="py-3 px-4">Joined</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-(--border)">
            {!filteredUsers.length && <tr><td colSpan={6} className="p-6 text-(--text-secondary)">
              <span role="status">{users.length ? 'No users match these filters.' : 'No registered accounts yet.'}</span>
            </td></tr>}
            {filteredUsers.map((user) => (
              <tr key={user.id} className="hover:bg-(--surface-elevated) transition-colors">
                {/* User Info */}
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className={`ov-avatar shrink-0${STAFF_ROLES.includes(user.role) ? ' is-staff' : ''}`}>
                      {user.avatarInitials}
                    </div>
                    <div>
                      <span className="font-semibold text-(--text-primary) block">
                        {user.name}
                      </span>
                      <span className="text-xs text-(--text-muted) block">
                        {user.email}
                      </span>
                    </div>
                  </div>
                </td>

                {/* College */}
                <td className="py-3 px-4 font-semibold text-(--text-primary)" data-label="College">
                  {user.collegeName.replace('College of ', '')}
                </td>

                {/* Status Badge */}
                <td className="py-3 px-4" data-label="Status">
                  <span className={`status-pill ${user.status === 'active' ? 'is-success' : user.status === 'suspended' ? 'is-warning' : 'is-danger'}`}>
                    {user.status === 'suspended'
                      ? `Suspended · ${user.suspendedUntil || 'temporary'}`
                      : user.status === 'active' ? 'Active' : 'Banned'}
                  </span>
                </td>

                {/* Role Dropdown */}
                <td className="py-3 px-4" data-label="Role">
                  <span className={`ov-role-pill${STAFF_ROLES.includes(user.role) ? ' is-staff' : ''}`} title="Staff permissions are assigned separately by the project administrator.">{ROLE_LABEL[user.role] || user.role}</span>
                </td>

                {/* Joined Date */}
                <td className="py-3 px-4 text-(--text-muted) tabular-nums text-xs" data-label="Joined">
                  {user.joinedDate}
                </td>

                {/* Actions */}
                <td className="py-3 px-4 text-right">
                  <div className="user-row-actions">
                  {hasCampusEmail(user.email) && (user.status === 'active' || user.spectatorInviteApproved) && (
                    <button type="button" className="arena-outline arena-sm whitespace-nowrap" onClick={() => setInviteApprovalUser(user)}>
                      {user.spectatorInviteApproved ? 'Revoke QR access' : 'Approve student QR'}
                    </button>
                  )}
                  {user.status === 'active' ? (
                    <div className="user-row-buttons">
                      <button
                        onClick={() => {
                          setSelectedUser(user);
                          setActionType('suspend');
                        }}
                        type="button" className="arena-outline arena-sm"
                      >
                        <PauseCircle size={14} aria-hidden="true" />
                        Suspend
                      </button>

                      <button
                        onClick={() => {
                          setSelectedUser(user);
                          setActionType('ban');
                        }}
                        type="button" className="arena-outline arena-sm arena-danger-text"
                      >
                        <Ban size={14} aria-hidden="true" />
                        Ban
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setSelectedUser(user);
                        setActionType('restore');
                      }}
                      type="button" className="arena-outline arena-sm"
                    >
                      <RotateCcw size={14} aria-hidden="true" />
                      Restore
                    </button>
                  )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmModal
        isOpen={Boolean(inviteApprovalUser)}
        title={inviteApprovalUser?.spectatorInviteApproved ? 'Revoke student QR access?' : 'Approve student QR access?'}
        description={inviteApprovalUser?.spectatorInviteApproved
          ? `Disable new spectator invitations from ${inviteApprovalUser.name} and expire their current QR.`
          : `Approve ${inviteApprovalUser?.name || 'this account'} after confirming their enrollment with the school. Their WMSU email must also be verified before they can display a QR.`}
        confirmLabel={inviteApprovalUser?.spectatorInviteApproved ? 'Revoke access' : 'Approve student'}
        onCancel={() => setInviteApprovalUser(null)}
        onConfirm={async () => {
          if (!inviteApprovalUser) return;
          const approved = !inviteApprovalUser.spectatorInviteApproved;
          await updateDoc(doc(db, 'users', inviteApprovalUser.id), { spectatorInviteApproved: approved });
          setInviteApprovalUser(null);
          showToast(approved ? 'Student QR access approved.' : 'Student QR access revoked.', 'success');
        }}
      />
      {/* Confirmation Modal */}
      <ConfirmModal
        isOpen={!!selectedUser && !!actionType}
        title={
          actionType === 'ban'
            ? `Ban User ${selectedUser?.name}?`
            : actionType === 'suspend'
            ? `Suspend User ${selectedUser?.name}?`
            : `Restore User ${selectedUser?.name}?`
        }
        description={
          actionType === 'ban'
            ? `Are you sure you want to permanently ban ${selectedUser?.name} (${selectedUser?.email}) from WMSU Palaro? They will lose access to team rosters and match chat.`
            : actionType === 'suspend'
            ? `Are you sure you want to suspend ${selectedUser?.name} pending organizer review? They will be unable to participate in team chat.`
            : `Restore ${selectedUser?.name} to Active status? They will regain all access.`
        }
        confirmLabel={actionType === 'ban' ? 'Ban User' : actionType === 'suspend' ? 'Suspend User' : 'Restore'}
        isDestructive={actionType === 'ban' || actionType === 'suspend'}
        onConfirm={handleConfirmAction}
        onCancel={() => {
          setSelectedUser(null);
          setActionType(null);
        }}
      />
    </div>
  );
};
