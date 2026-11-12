import React from 'react';
import { UserRole } from '../../lib/types';
import { Shield, Eye, Gamepad2, Settings, CheckCircle2 } from './Icons';

interface RoleSwitcherBarProps {
  currentRole: UserRole;
  onRoleChange: (role: UserRole) => void;
  onOpenSchoolSetup?: () => void;
}

export const RoleSwitcherBar: React.FC<RoleSwitcherBarProps> = ({
  currentRole,
  onRoleChange,
  onOpenSchoolSetup,
}) => {
  const roles: Array<{ role: UserRole; label: string; icon: React.ReactNode; desc: string }> = [
    { role: 'spectator', label: 'Spectator', icon: <Eye className="w-3.5 h-3.5" />, desc: 'Live viewer' },
    { role: 'player', label: 'Player', icon: <Gamepad2 className="w-3.5 h-3.5" />, desc: 'Athletic roster' },
    { role: 'moderator', label: 'Moderator', icon: <Shield className="w-3.5 h-3.5" />, desc: 'Chat & audit' },
    { role: 'organizer', label: 'Organizer', icon: <Shield className="w-3.5 h-3.5 text-[#ff6600]" />, desc: 'Dashboard & Brackets' },
    { role: 'school-admin', label: 'School Admin', icon: <Settings className="w-3.5 h-3.5" />, desc: 'Domain & branding' },
  ];

  return (
    <div className="bg-[#141414] border-b border-[#2A2A2A] px-4 py-1.5 flex items-center justify-between text-xs z-40 select-none">
      <div className="flex items-center gap-2">
        <span className="text-[#888888] font-medium tracking-wider text-[11px] uppercase">Role Shell:</span>
        <div className="flex items-center bg-[#1F1F1F] p-0.5 rounded-[4px] border border-[#2F2F2F]">
          {roles.map((r) => {
            const isActive = currentRole === r.role;
            return (
              <button
                key={r.role}
                onClick={() => onRoleChange(r.role)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[3px] font-medium transition-colors text-[11px] ${
                  isActive
                    ? r.role === 'organizer' || r.role === 'school-admin'
                      ? 'bg-[#ff6600] text-white shadow-xs'
                      : 'bg-[#ff6600] text-white shadow-xs'
                    : 'text-[#B3B3B3] hover:text-white hover:bg-[#2A2A2A]'
                }`}
                title={r.desc}
              >
                {r.icon}
                <span>{r.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3 text-[11px] text-[#B3B3B3]">
        <span className="flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#3DD68C]" />
          <span>WMSU Palaro 2026 (@wmsu.edu.ph)</span>
        </span>
        {onOpenSchoolSetup && (
          <button
            onClick={onOpenSchoolSetup}
            className="text-[#ff6600] hover:underline font-medium hover:text-white transition-colors"
          >
            School Setup
          </button>
        )}
      </div>
    </div>
  );
};
