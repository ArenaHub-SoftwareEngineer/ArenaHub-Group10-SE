import React, { useState } from 'react';
import { SchoolSettings, User } from '../../lib/types';
import { useToast } from '../ui/Toast';
import { firestoreService } from '../../lib/firestore';
import { X, Building2, Palette, ShieldCheck, UserPlus, Check } from '../ui/Icons';

interface SchoolAdminSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: User[];
}

export const SchoolAdminSetupModal: React.FC<SchoolAdminSetupModalProps> = ({
  isOpen,
  onClose,
  users,
}) => {
  const { showToast } = useToast();
  const [schoolName, setSchoolName] = useState('Western Mindanao State University');
  const [domain, setDomain] = useState('wmsu.edu.ph');
  const [brandAccent, setBrandAccent] = useState('#ff6600');
  const [adminAccent, setAdminAccent] = useState('#ff6600');
  const [inviteEmail, setInviteEmail] = useState('');

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    firestoreService.addAuditLog(`School settings updated by Dean Abubakar: domain @${domain}`);
    showToast('School workspace and branding configuration saved!', 'success');
    onClose();
  };

  const handleSendInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    if (!inviteEmail.endsWith(`@${domain}`)) {
      showToast(`Email must end with @${domain}`, 'error');
      return;
    }

    firestoreService.addAuditLog(`Organizer invite sent to ${inviteEmail}`);
    showToast(`Organizer invitation sent to ${inviteEmail}`, 'success');
    setInviteEmail('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
      <div className="w-full max-w-2xl bg-[#222222] border border-[#3A3A3A] rounded-[4px] shadow-2xl p-6 overflow-hidden max-h-[90vh] flex flex-col justify-between">
        <div className="flex items-center justify-between border-b border-[#2E2E2E] pb-4 mb-4">
          <div className="flex items-center gap-2.5">
            <Building2 className="w-5 h-5 text-[#ff6600]" />
            <div>
              <h3 className="text-base font-heading font-black text-white tracking-tight">
                School Admin Console
              </h3>
              <span className="text-[11px] text-[#888888]">
                Western Mindanao State University Workspace Setup
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-[#888888] hover:text-white p-1 rounded-[4px]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-6 overflow-y-auto pr-2 text-xs">
          {/* Section 1: Domain & Security */}
          <div className="p-4 rounded-[4px] bg-[#1A1A1A] border border-[#2B2B2B] space-y-3">
            <span className="text-xs font-semibold text-white block">
              1. Institutional Domain Verification
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[#888888] block mb-1">School / University</label>
                <input
                  type="text"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  className="w-full bg-[#141414] border border-[#333333] rounded-[4px] px-3 py-2 text-white outline-hidden"
                />
              </div>

              <div>
                <label className="text-[#888888] block mb-1">Restricted Email Domain</label>
                <div className="flex items-center bg-[#141414] border border-[#333333] rounded-[4px] px-3 py-2">
                  <span className="text-[#666666]">@</span>
                  <input
                    type="text"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    className="w-full bg-transparent text-white outline-hidden ml-1"
                  />
                </div>
              </div>
            </div>

            <p className="text-[11px] text-[#888888]">
              All student registrations and Google logins are strictly locked to this domain.
            </p>
          </div>

          {/* Section 2: Branding Tokens */}
          <div className="p-4 rounded-[4px] bg-[#1A1A1A] border border-[#2B2B2B] space-y-3">
            <span className="text-xs font-semibold text-white flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-[#ff6600]" />
              <span>2. Role & Campus Accents</span>
            </span>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[#888888] block mb-1">Brand Accent (Spectators & Players)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={brandAccent}
                    onChange={(e) => setBrandAccent(e.target.value)}
                    className="w-8 h-8 rounded-[4px] bg-transparent border-0 cursor-pointer"
                  />
                  <span className="font-mono text-white text-[11px]">{brandAccent}</span>
                </div>
              </div>

              <div>
                <label className="text-[#888888] block mb-1">Admin Role Accent</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={adminAccent}
                    onChange={(e) => setAdminAccent(e.target.value)}
                    className="w-8 h-8 rounded-[4px] bg-transparent border-0 cursor-pointer"
                  />
                  <span className="font-mono text-white text-[11px]">{adminAccent}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Organizer Accounts */}
          <div className="p-4 rounded-[4px] bg-[#1A1A1A] border border-[#2B2B2B] space-y-3">
            <span className="text-xs font-semibold text-white flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#ff6600]" />
              <span>3. Authorized Tournament Organizers</span>
            </span>

            <div className="space-y-2">
              {users.filter((u) => u.role === 'organizer' || u.role === 'school-admin').map((u) => (
                <div key={u.id} className="flex items-center justify-between p-2 rounded-[3px] bg-[#222222]">
                  <div>
                    <span className="font-semibold text-white block">{u.name}</span>
                    <span className="text-[10px] text-[#888888]">{u.email}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-[2px] bg-[#ff6600]/15 text-[#ff6600] text-[10px] font-bold uppercase">
                    {u.role}
                  </span>
                </div>
              ))}
            </div>

            <form onSubmit={handleSendInvite} className="flex items-center gap-2 pt-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder={`organizer@${domain}`}
                className="flex-1 bg-[#141414] border border-[#333333] rounded-[4px] px-3 py-1.5 text-xs text-white placeholder-[#666666] outline-hidden"
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded-[4px] bg-[#ff6600] hover:bg-[#e65c00] text-white font-semibold text-xs flex items-center gap-1 cursor-pointer"
              >
                <UserPlus className="w-3 h-3" />
                <span>Invite</span>
              </button>
            </form>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#2E2E2E] mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-[4px] bg-[#1A1A1A] hover:bg-[#252525] border border-[#333333] text-xs font-semibold text-[#CCCCCC]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 rounded-[4px] bg-[#ff6600] hover:bg-[#e65c00] text-white text-xs font-bold flex items-center gap-1.5 shadow-md cursor-pointer"
          >
            <Check className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Save Configuration</span>
          </button>
        </div>
      </div>
    </div>
  );
};
