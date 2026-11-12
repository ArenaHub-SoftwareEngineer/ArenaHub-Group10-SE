/**
 * ArenaHub Event Pass Verification Modal
 *
 * Provides personal email users and on-site spectators with:
 * 1. Alphanumeric Event Pass Code entry
 * 2. QR Code scan simulation / image upload
 * 3. Anti-bot human verification slider and brute-force rate limit protection
 */

import React, { useState, useEffect } from 'react';
import { eventPassService, EventPass } from '../../lib/eventPassService';
import {
  X,
  QrCode,
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Camera,
  Upload,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Lock,
} from '../ui/Icons';
import { useToast } from '../ui/Toast';

interface EventPassModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (pass: EventPass) => void;
  defaultEmail?: string;
}

export const EventPassModal: React.FC<EventPassModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  defaultEmail = '',
}) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'code' | 'qr'>('code');
  const [passCode, setPassCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Anti-Bot Slider State
  const [isHumanVerified, setIsHumanVerified] = useState(false);
  const [sliderPosition, setSliderPosition] = useState(0);

  // Rate Limiting State
  const [isLocked, setIsLocked] = useState(false);
  const [lockSeconds, setLockSeconds] = useState(0);

  // QR Scanning Simulation State
  const [isScanning, setIsScanning] = useState(false);

  // Check rate limit on mount and interval
  useEffect(() => {
    if (!isOpen) return;

    const checkLock = () => {
      const status = eventPassService.getRateLimitStatus();
      setIsLocked(status.isLocked);
      setLockSeconds(status.remainingSeconds);
    };

    checkLock();
    const interval = setInterval(checkLock, 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSliderDrag = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setSliderPosition(val);
    if (val >= 95) {
      setIsHumanVerified(true);
      setError(null);
    }
  };

  const handleVerifyCode = (codeToVerify?: string) => {
    setError(null);
    const targetCode = codeToVerify || passCode;

    if (!targetCode.trim()) {
      setError('Please enter your event pass code.');
      return;
    }

    if (!isHumanVerified) {
      setError('Anti-Bot Security: Please drag the slider to verify you are a human attendee.');
      return;
    }

    setLoading(true);

    setTimeout(() => {
      const result = eventPassService.validatePass(targetCode, isHumanVerified);
      setLoading(false);

      if (!result.success) {
        if (result.rateLimited) {
          setIsLocked(true);
          setLockSeconds(result.lockoutSeconds || 60);
        }
        setError(result.error || 'Invalid code.');
      } else if (result.pass) {
        showToast(`Pass verified! Welcome to ${result.pass.schoolName} Intramurals.`, 'success');
        onSuccess(result.pass);
      }
    }, 450);
  };

  const handleSimulateScan = () => {
    setIsScanning(true);
    setError(null);

    setTimeout(() => {
      setIsScanning(false);
      // Auto-grab active WMSU pass payload for smooth demonstration
      const active = eventPassService.getActivePass('WMSU');
      const payload = eventPassService.getQRPayload(active);
      setPassCode(active.code);
      setIsHumanVerified(true);
      handleVerifyCode(payload);
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-[#222222] border border-[#3A3A3A] rounded-[8px] max-w-md w-full p-6 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2E2E2E] pb-3.5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[4px] bg-[#ff6600]/10 border border-[#ff6600]/30 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-[#ff6600]" />
            </div>
            <div>
              <h3 className="text-base font-heading font-black text-white">
                Intramural Event Pass
              </h3>
              <p className="text-xs text-[#888888]">
                Authenticate your campus tournament bracket view
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-[#888888] hover:text-white p-1 rounded-[4px] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* User Identity Hint */}
        {defaultEmail && (
          <div className="p-2.5 rounded-[4px] bg-[#1A1A1A] border border-[#2D2D2D] flex items-center justify-between text-xs">
            <span className="text-[#888888]">Spectator Email:</span>
            <span className="font-mono text-white text-[11px] truncate max-w-[200px]">
              {defaultEmail}
            </span>
          </div>
        )}

        {/* Tab Toggle: Code vs QR */}
        <div className="flex rounded-[4px] bg-[#191919] p-1 border border-[#2E2E2E]">
          <button
            type="button"
            onClick={() => setActiveTab('code')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-[3px] text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'code'
                ? 'bg-[#2A2A2A] text-white shadow-xs'
                : 'text-[#888888] hover:text-[#CCCCCC]'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Enter Pass Code</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('qr')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-[3px] text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'qr'
                ? 'bg-[#2A2A2A] text-white shadow-xs'
                : 'text-[#888888] hover:text-[#CCCCCC]'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Scan Venue QR</span>
          </button>
        </div>

        {/* Lockout Notice */}
        {isLocked && (
          <div className="p-3 bg-[#331414] border border-[#5E2424] rounded-[4px] flex items-center gap-2 text-xs text-[#FF8585]">
            <Lock className="w-4 h-4 shrink-0 text-[#FF5454]" />
            <span>
              Security Lockout Active: Too many failed attempts. Try again in{' '}
              <strong className="font-mono text-white">{lockSeconds}s</strong>.
            </span>
          </div>
        )}

        {/* Error message */}
        {error && !isLocked && (
          <div className="p-3 bg-[#331C16] border border-[#52291F] rounded-[4px] flex items-start gap-2 text-xs text-[#FFA07A]">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#ff6600]" />
            <span>{error}</span>
          </div>
        )}

        {/* TAB 1: Pass Code Input */}
        {activeTab === 'code' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#B3B3B3] mb-1.5">
                6-Digit Event Pass Code (from Gym Screen / Poster):
              </label>
              <input
                type="text"
                value={passCode}
                maxLength={6}
                disabled={isLocked || loading}
                onChange={(e) => setPassCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())}
                placeholder="WSI319"
                className="w-full bg-[#181818] border border-[#3A3A3A] focus:border-[#ff6600] rounded-[4px] px-3.5 py-3 font-mono font-bold text-center text-xl tracking-widest text-[#ff6600] placeholder-[#555555] outline-none transition-colors uppercase disabled:opacity-50"
              />
              <span className="block text-[11px] text-[#777777] mt-1 text-center">
                Example active 6-digit code for WMSU: <span className="font-mono text-[#CCCCCC] font-bold">WSI319</span>
              </span>
            </div>

            {/* Anti-Bot Slide to Verify */}
            <div className="p-3 bg-[#1A1A1A] border border-[#2B2B2B] rounded-[4px] space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#888888] flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#3DD68C]" />
                  <span>Anti-Bot Verification</span>
                </span>
                <span className={`font-semibold ${isHumanVerified ? 'text-[#3DD68C]' : 'text-[#888888]'}`}>
                  {isHumanVerified ? 'Human Verified' : 'Slide to verify'}
                </span>
              </div>

              {isHumanVerified ? (
                <div className="py-2.5 px-3 rounded-[3px] bg-[#18281E] border border-[#234A30] flex items-center justify-center gap-2 text-xs text-[#3DD68C] font-semibold">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Verified Venue Attendee</span>
                </div>
              ) : (
                <div className="relative flex items-center bg-[#131313] border border-[#333333] rounded-[3px] p-1">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={sliderPosition}
                    onChange={handleSliderDrag}
                    className="w-full h-8 opacity-0 cursor-ew-resize absolute inset-0 z-10"
                  />
                  <div
                    className="h-7 rounded-[2px] bg-[#ff6600] flex items-center justify-center transition-all shadow-sm"
                    style={{ width: `${Math.max(sliderPosition, 18)}%` }}
                  >
                    <span className="font-heading font-black text-[11px] text-black tracking-wider">
                      →
                    </span>
                  </div>
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-[#666666] pointer-events-none">
                    Slide right to unlock →
                  </span>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => handleVerifyCode()}
              disabled={isLocked || loading || !isHumanVerified || !passCode.trim()}
              className="w-full py-2.5 px-4 rounded-[4px] bg-[#ff6600] hover:bg-[#ff8533] text-black font-heading font-black text-xs uppercase tracking-wider transition-all shadow-md hover:shadow-lg hover:shadow-[#ff6600]/20 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying Pass...</span>
                </>
              ) : (
                <span>Confirm & Access Brackets</span>
              )}
            </button>
          </div>
        )}

        {/* TAB 2: Scan QR Code */}
        {activeTab === 'qr' && (
          <div className="space-y-4 text-center">
            <div className="p-6 bg-[#181818] border-2 border-dashed border-[#383838] rounded-[6px] flex flex-col items-center justify-center space-y-3">
              <div className="w-14 h-14 rounded-full bg-[#242424] flex items-center justify-center text-[#ff6600]">
                {isScanning ? (
                  <Loader2 className="w-7 h-7 animate-spin text-[#ff6600]" />
                ) : (
                  <Camera className="w-7 h-7" />
                )}
              </div>

              <div>
                <span className="text-xs font-semibold text-white block">
                  {isScanning ? 'Decoding ArenaHub QR Token...' : 'Point camera at the gym screen QR'}
                </span>
                <span className="text-[11px] text-[#777777] block mt-0.5">
                  Or test simulated scanner with the active WMSU session
                </span>
              </div>

              <button
                type="button"
                onClick={handleSimulateScan}
                disabled={isScanning || isLocked}
                className="px-4 py-2 rounded-[4px] bg-[#2A2A2A] hover:bg-[#333333] border border-[#3E3E3E] text-xs font-semibold text-white flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#ff6600]" />
                <span>{isScanning ? 'Scanning...' : 'Simulate Camera Scan'}</span>
              </button>
            </div>

            <p className="text-[11px] text-[#777777]">
              The QR code contains an encrypted token with school ID, random nonce, and anti-bot verification.
            </p>
          </div>
        )}

        {/* Footer info */}
        <div className="pt-2 text-center border-t border-[#2B2B2B]">
          <span className="text-[10px] text-[#666666]">
            Enrolled students can log in with <strong className="text-[#888888]">@wmsu.edu.ph</strong> for direct automatic access without needing a pass code.
          </span>
        </div>
      </div>
    </div>
  );
};
