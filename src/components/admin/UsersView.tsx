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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-heading font-bold text-(--text-primary) tracking-tight">
            Users
          </h2>
          <span className="text-xs text-(--text-muted)">
            Registered accounts · account status changes apply to ArenaHub access
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Segmented Filter Pills */}
          <div className="flex items-center bg-(--surface-soft) p-1 rounded-[4px] border border-(--border)">
            {(['all', 'active', 'suspended', 'banned'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={`px-3 py-1 rounded-[3px] text-xs font-semibold capitalize transition-colors ${
                  filter === tab
                    ? 'bg-(--surface) text-(--text-primary) shadow-xs'
                    : 'text-(--text-muted) hover:text-(--text-primary)'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-(--text-muted) absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users"
              className="bg-(--surface-soft) border border-(--border) rounded-[4px] pl-8 pr-3 py-1.5 text-xs text-(--text-primary) placeholder-(--text-muted) outline-hidden w-48 sm:w-60"
            />
          </div>
        </div>
      </div>

      {/* Users Table */}
      <div className="rounded-[4px] border border-(--border) bg-(--surface-soft) overflow-x-auto shadow-xl">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-(--border) text-xs font-bold text-(--text-muted)">
              <th className="py-3 px-4">USER</th>
              <th className="py-3 px-4">COLLEGE</th>
              <th className="py-3 px-4">STATUS</th>
              <th className="py-3 px-4">ROLE</th>
              <th className="py-3 px-4">JOINED</th>
              <th className="py-3 px-4 text-right">ACTIONS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-(--border)">
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
                <td className="py-3 px-4 font-semibold text-(--text-primary)">
                  {user.collegeName.replace('College of ', '')}
                </td>

                {/* Status Badge */}
                <td className="py-3 px-4">
                  <span
                    className={`inline-block px-2.5 py-0.5 rounded-[3px] text-xs font-bold ${
                      user.status === 'active'
                        ? 'bg-(--surface-soft) border border-(--success-border) text-(--success)'
                        : user.status === 'suspended'
                        ? 'bg-(--surface-soft) border border-(--warning-border) text-(--brand-ink)'
                        : 'bg-(--surface-soft) border border-(--danger-border) text-(--danger)'
                    }`}
                  >
                    {user.status === 'suspended'
                      ? `SUSPENDED · ${user.suspendedUntil || 'TEMP'}`
                      : user.status.toUpperCase()}
                  </span>
                </td>

                {/* Role Dropdown */}
                <td className="py-3 px-4">
                  <span className="text-xs capitalize" title="Staff permissions are assigned separately by the project administrator.">{user.role}</span>
                </td>

                {/* Joined Date */}
                <td className="py-3 px-4 text-(--text-muted) tabular-nums text-xs">
                  {user.joinedDate}
                </td>

                {/* Actions */}
                <td className="py-3 px-4 text-right">
                  {hasCampusEmail(user.email) && (user.status === 'active' || user.spectatorInviteApproved) && (
                    <button type="button" className="arena-outline mb-2" onClick={() => setInviteApprovalUser(user)}>
                      {user.spectatorInviteApproved ? 'Revoke QR access' : 'Approve student QR'}
                    </button>
                  )}
                  {user.status === 'active' ? (
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          setSelectedUser(user);
                          setActionType('suspend');
                        }}
                        className="px-2.5 py-1 rounded-[3px] bg-(--surface) hover:bg-(--surface-soft) border border-(--border) text-xs font-semibold text-(--text-secondary) hover:text-(--text-primary) transition-colors"
                      >
                        <PauseCircle className="w-3 h-3 inline mr-1 text-(--brand-ink)" />
                        Suspend
                      </button>

                      <button
                        onClick={() => {
                          setSelectedUser(user);
                          setActionType('ban');
                        }}
                        className="px-2.5 py-1 rounded-[3px] bg-(--surface) hover:bg-(--surface-soft) border border-(--border) text-xs font-semibold text-(--danger) transition-colors"
                      >
                        <Ban className="w-3 h-3 inline mr-1" />
                        Ban
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setSelectedUser(user);
                        setActionType('restore');
                      }}
                      className="px-2.5 py-1 rounded-[3px] bg-(--surface-soft) hover:bg-(--surface-elevated) border border-(--success-border) text-xs font-semibold text-(--brand-ink) transition-colors"
                    >
                      <RotateCcw className="w-3 h-3 inline mr-1" />
                      Restore
                    </button>
                  )}
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
