import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { hasCampusEmail } from '../../lib/campusAccess';
import React, { useState } from 'react';
import { User, UserRole, UserStatus } from '../../lib/types';
import { firestoreService } from '../../lib/firestore';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useToast } from '../ui/Toast';
import { Search, Ban, PauseCircle, RotateCcw } from '../ui/Icons';

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

    } catch (error) { showToast(error instanceof Error ? error.message : 'Account status could not be updated.', 'error'); throw error; }
    setSelectedUser(null);
    setActionType(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-heading font-black text-white tracking-tight">
            Users
          </h2>
          <span className="text-xs text-[#888888]">
            Registered accounts · account status changes apply to ArenaHub access
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Segmented Filter Pills */}
          <div className="flex items-center bg-[#222222] p-1 rounded-[4px] border border-[#333333]">
            {(['all', 'active', 'suspended', 'banned'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={`px-3 py-1 rounded-[3px] text-xs font-semibold capitalize transition-colors ${
                  filter === tab
                    ? 'bg-[#191919] text-white shadow-xs'
                    : 'text-[#888888] hover:text-white'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#888888] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users"
              className="bg-[#222222] border border-[#333333] rounded-[4px] pl-8 pr-3 py-1.5 text-xs text-white placeholder-[#666666] outline-hidden w-48 sm:w-60"
            />
          </div>
        </div>
      </div>

      {/* Users Table */}
      <div className="rounded-[4px] border border-[#333333] bg-[#222222] overflow-x-auto shadow-xl">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[#2E2E2E] text-[10px] font-bold text-[#888888] uppercase tracking-wider">
              <th className="py-3 px-4">USER</th>
              <th className="py-3 px-4">COLLEGE</th>
              <th className="py-3 px-4">STATUS</th>
              <th className="py-3 px-4">ROLE</th>
              <th className="py-3 px-4">JOINED</th>
              <th className="py-3 px-4 text-right">ACTIONS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#282828]">
            {filteredUsers.map((user) => (
              <tr key={user.id} className="hover:bg-[#282828] transition-colors">
                {/* User Info */}
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#3B3B36] border border-[#4C4C46] flex items-center justify-center font-heading font-bold text-xs text-[#EDEDEB] shrink-0">
                      {user.avatarInitials}
                    </div>
                    <div>
                      <span className="font-semibold text-white block">
                        {user.name}
                      </span>
                      <span className="text-[11px] text-[#888888] block">
                        {user.email}
                      </span>
                    </div>
                  </div>
                </td>

                {/* College */}
                <td className="py-3 px-4 font-semibold text-white">
                  {user.collegeName.replace('College of ', '')}
                </td>

                {/* Status Badge */}
                <td className="py-3 px-4">
                  <span
                    className={`inline-block px-2.5 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wider ${
                      user.status === 'active'
                        ? 'bg-[#18281E] border border-[#234A30] text-[#3DD68C]'
                        : user.status === 'suspended'
                        ? 'bg-[#292815] border border-[#47431B] text-[#ff6600]'
                        : 'bg-[#2E1818] border border-[#522525] text-[#E8544B]'
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
                <td className="py-3 px-4 text-[#888888] font-mono text-[11px]">
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
                        className="px-2.5 py-1 rounded-[3px] bg-[#191919] hover:bg-[#252525] border border-[#333333] text-[11px] font-semibold text-[#B3B3B3] hover:text-white transition-colors"
                      >
                        <PauseCircle className="w-3 h-3 inline mr-1 text-[#ff6600]" />
                        Suspend
                      </button>

                      <button
                        onClick={() => {
                          setSelectedUser(user);
                          setActionType('ban');
                        }}
                        className="px-2.5 py-1 rounded-[3px] bg-[#191919] hover:bg-[#252525] border border-[#333333] text-[11px] font-semibold text-[#E8544B] transition-colors"
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
                      className="px-2.5 py-1 rounded-[3px] bg-[#18281E] hover:bg-[#203628] border border-[#234A30] text-[11px] font-semibold text-[#ff6600] transition-colors"
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
