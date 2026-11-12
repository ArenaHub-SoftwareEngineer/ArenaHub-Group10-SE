/**
 * ArenaHub Venue Pass & Big Screen QR Display
 *
 * Designed for Gym Organizers and Tournament Admins to project onto arena screens,
 * generate new randomized passes, and revoke compromised codes.
 */

import React, { useState, useEffect } from 'react';
import { QRCode } from '../ui/QRCode';
import { eventPassService, EventPass } from '../../lib/eventPassService';
import { useToast } from '../ui/Toast';
import {
  X,
  QrCode,
  RefreshCw,
  Copy,
  Check,
  ShieldAlert,
  Clock,
  Sparkles,
  Maximize2,
  Tv,
} from '../ui/Icons';

interface VenuePassModalProps {
  isOpen: boolean;
  onClose: () => void;
  schoolCode?: string;
}

export const VenuePassModal: React.FC<VenuePassModalProps> = ({
  isOpen,
  onClose,
  schoolCode = 'WMSU',
}) => {
  const { showToast } = useToast();
  const [pass, setPass] = useState<EventPass>(() => eventPassService.getActivePass(schoolCode));
  const [copied, setCopied] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState('');
  const [isFullScreen, setIsFullScreen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const current = eventPassService.getActivePass(schoolCode);
    setPass(current);

    const updateTimer = () => {
      const diff = current.expiresAt - Date.now();
      if (diff <= 0) {
        setTimeRemaining('Expired (Rotation needed)');
      } else {
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        setTimeRemaining(`${hours}h ${minutes}m`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 60000);
    return () => clearInterval(interval);
  }, [isOpen, schoolCode]);

  if (!isOpen) return null;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(pass.code);
    setCopied(true);
    showToast(`Pass Code ${pass.code} copied to clipboard!`, 'info');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRotate = () => {
    setIsRotating(true);
    setTimeout(() => {
      const fresh = eventPassService.rotatePass(schoolCode, pass.schoolName);
      setPass(fresh);
      setIsRotating(false);
      showToast('Fresh random pass generated! Previous code invalidated.', 'success');
    }, 400);
  };

  const qrPayload = eventPassService.getQRPayload(pass);

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
      <div
        className={`bg-[#1E1E1E] border border-[#383838] rounded-[8px] shadow-2xl transition-all duration-300 flex flex-col justify-between overflow-hidden ${
          isFullScreen ? 'w-full h-full max-w-5xl p-8' : 'w-full max-w-lg p-6'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2C2C2C] pb-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[4px] bg-[#ff6600]/10 border border-[#ff6600]/30 flex items-center justify-center">
              <Tv className="w-5 h-5 text-[#ff6600]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-heading font-black text-white">
                  Venue QR preview
                </h3>
                <span className="px-2 py-0.5 rounded-[2px] bg-[#3DD68C]/15 border border-[#3DD68C]/30 text-[#3DD68C] text-[10px] font-mono font-bold uppercase">
                  ACTIVE
                </span>
              </div>
              <p className="text-xs text-[#888888]">
                {pass.schoolName} · Gym Big-Screen Broadcast
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsFullScreen(!isFullScreen)}
              className="p-1.5 rounded-[4px] text-[#888888] hover:text-white hover:bg-[#2A2A2A] transition-colors"
              title="Toggle Big Screen Mode"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-[4px] text-[#888888] hover:text-white hover:bg-[#2A2A2A] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Center: QR Code & Random Pass Code */}
        <div className="flex flex-col items-center justify-center space-y-5 my-2">
          {/* SVG QR Code */}
          <div className="p-4 bg-white rounded-[8px] shadow-2xl relative group">
            <QRCode value={qrPayload} size={isFullScreen ? 280 : 200} />
            <div className="absolute inset-x-0 bottom-1 text-center">
              <span className="text-[9px] font-mono font-black text-black uppercase tracking-wider">
                SCAN FOR INTRAMURALS BRACKET
              </span>
            </div>
          </div>

          {/* Large Alphanumeric Pass Code */}
          <div className="text-center space-y-1">
            <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider block">
              Sample venue code:
            </span>
            <div className="flex items-center justify-center gap-2">
              <span className="font-mono font-black text-3xl sm:text-4xl text-[#ff6600] tracking-widest bg-[#151515] border border-[#333333] px-4 py-1.5 rounded-[4px] shadow-inner select-all">
                {pass.code}
              </span>
              <button
                onClick={handleCopyCode}
                className="p-2.5 rounded-[4px] bg-[#2A2A2A] hover:bg-[#333333] text-[#CCCCCC] hover:text-white transition-colors cursor-pointer"
                title="Copy Pass Code"
              >
                {copied ? <Check className="w-4 h-4 text-[#ff6600]" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 gap-3 w-full max-w-md pt-2">
            <div className="bg-[#171717] border border-[#2B2B2B] rounded-[4px] p-2.5 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] text-[#888888] mb-0.5">
                <Clock className="w-3 h-3 text-[#ff6600]" />
                <span>Validity</span>
              </div>
              <span className="font-heading font-black text-sm text-white">
                {timeRemaining}
              </span>
            </div>

            <div className="bg-[#171717] border border-[#2B2B2B] rounded-[4px] p-2.5 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] text-[#888888] mb-0.5">
                <ShieldAlert className="w-3 h-3 text-[#3DD68C]" />
                <span>Local preview</span>
              </div>
              <span className="font-heading font-black text-xs text-[#3DD68C]">
                ENFORCED
              </span>
            </div>
          </div>

          <p className="text-[11px] text-[#777777] text-center max-w-sm">
            Local projector preview. This QR does not grant access or record attendance.
          </p>
        </div>

        {/* Footer Controls */}
        <div className="flex items-center justify-between pt-4 border-t border-[#2C2C2C] mt-4">
          <button
            onClick={handleRotate}
            disabled={isRotating}
            className="flex items-center gap-1.5 px-3 py-2 rounded-[4px] bg-[#2A2A2A] hover:bg-[#353535] border border-[#3E3E3E] text-xs font-semibold text-white transition-colors cursor-pointer disabled:opacity-50"
            title="Generate a new randomized pass code"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#ff6600] ${isRotating ? 'animate-spin' : ''}`} />
            <span>Rotate / Generate New Code</span>
          </button>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-[4px] bg-[#ff6600] hover:bg-[#ff8533] text-black font-heading font-bold text-xs transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
