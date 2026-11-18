import { PageHeading } from '../ui/PageHeading';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { hasCampusEmail } from '../../lib/campusAccess';
import React, { useState } from 'react';
import { User, UserRole, UserStatus } from '../../lib/types';
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

  const filteredUsers = users.filter((u) => {
    const matchesFilter = filter === 'all' || u.status === filter;
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
      <PageHeading title="Users" description="Find registered accounts, review their status, and manage ArenaHub access." />
      <div className="page-toolbar">
        <div className="ah-chips" role="group" aria-label="Filter users by account status">
          {(['all', 'active', 'suspended', 'banned'] as const).map(tab => (
            <button key={tab} type="button" className="ah-chip capitalize" aria-pressed={filter === tab} onClick={() => setFilter(tab)}>{tab}</button>
          ))}
        </div>
        <label className="page-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" aria-label="Search users" value={search}
            onChange={event => setSearch(event.target.value)} placeholder="Search users" />
        </label>
      </div>

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
                    <div className="w-8 h-8 rounded-full bg-(--surface-elevated) border border-(--border-strong) flex items-center justify-center font-heading font-bold text-xs text-(--text-primary) shrink-0">
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
                  <span className="text-xs capitalize" title="Staff permissions are assigned separately by the project administrator.">{user.role}</span>
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
