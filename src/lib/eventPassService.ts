/**
 * ArenaHub Event Pass & Anti-Bot Verification Service
 *
 * Provides cryptographically secure, randomized event codes and QR payloads
 * for multi-school intramural segregation with brute-force / bot protection.
 */

export interface EventPass {
  code: string;            // e.g. "WMSU-7K9P2X"
  schoolCode: string;      // e.g. "WMSU"
  schoolName: string;      // e.g. "Western Mindanao State University"
  generatedAt: number;     // epoch ms
  expiresAt: number;       // epoch ms
  nonce: string;           // random cryptographic nonce
  activeUses: number;      // track check-ins
}

export interface VerificationResult {
  success: boolean;
  error?: string;
  pass?: EventPass;
  rateLimited?: boolean;
  lockoutSeconds?: number;
}

const STORAGE_KEY_PASSES = 'arenahub_event_passes_v1';
const STORAGE_KEY_ATTEMPTS = 'arenahub_pass_attempts_v1';
const MAX_FAILED_ATTEMPTS = 4;
const LOCKOUT_DURATION_MS = 60 * 1000; // 60 seconds lockout

// Unambiguous letters & digits (excluding easily confused 0/O and 1/I/L)
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const DIGITS = '23456789';

/**
 * Generate a cryptographically secure 6-digit combined alphanumeric code (e.g. WSI319)
 */
function generate6DigitCode(prefix?: string): string {
  const bytes = new Uint8Array(6);
  if (typeof window !== 'undefined' && window.crypto) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 6; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  // Build a 6-character string like WSI319 (campus letters + random digits)
  let lettersPart = '';
  if (prefix && prefix.length >= 2) {
    lettersPart = prefix.slice(0, 2).toUpperCase();
    lettersPart += LETTERS[bytes[0] % LETTERS.length];
  } else {
    for (let i = 0; i < 3; i++) {
      lettersPart += LETTERS[bytes[i] % LETTERS.length];
    }
  }

  // 3 random digits
  let digitsPart = '';
  for (let i = 0; i < 3; i++) {
    digitsPart += DIGITS[bytes[3 + i] % DIGITS.length];
  }

  return (lettersPart + digitsPart).slice(0, 6);
}

function generateRandomNonce(length = 12): string {
  const values = new Uint8Array(length);
  if (typeof window !== 'undefined' && window.crypto) {
    window.crypto.getRandomValues(values);
  } else {
    for (let i = 0; i < length; i++) values[i] = Math.floor(Math.random() * 256);
  }
  let result = '';
  const hex = '0123456789abcdef';
  for (let i = 0; i < length; i++) {
    result += hex[values[i] % hex.length];
  }
  return result;
}

/**
 * Default initial active passes for live campuses
 */
const DEFAULT_PASSES: Record<string, EventPass> = {
  WMSU: {
    code: 'WSI319',
    schoolCode: 'WMSU',
    schoolName: 'Western Mindanao State University',
    generatedAt: Date.now() - 3600000,
    expiresAt: Date.now() + 86400000, // 24 hours
    nonce: '8c92a170bfe3',
    activeUses: 142,
  },
  UP: {
    code: 'UPK742',
    schoolCode: 'UP',
    schoolName: 'University of the Philippines',
    generatedAt: Date.now() - 7200000,
    expiresAt: Date.now() + 86400000,
    nonce: '10df7a29e4b1',
    activeUses: 89,
  },
  DLSU: {
    code: 'DLS815',
    schoolCode: 'DLSU',
    schoolName: 'De La Salle University',
    generatedAt: Date.now() - 1800000,
    expiresAt: Date.now() + 86400000,
    nonce: '4ba609f8c213',
    activeUses: 64,
  },
};

class EventPassService {
  private passes: Record<string, EventPass>;

  constructor() {
    this.passes = this.loadPasses();
  }

  private loadPasses(): Record<string, EventPass> {
    if (typeof window === 'undefined') return { ...DEFAULT_PASSES };
    try {
      const saved = localStorage.getItem(STORAGE_KEY_PASSES);
      if (saved) {
        return { ...DEFAULT_PASSES, ...JSON.parse(saved) };
      }
    } catch {
      // fallback
    }
    return { ...DEFAULT_PASSES };
  }

  private savePasses(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY_PASSES, JSON.stringify(this.passes));
    } catch {
      // ignore
    }
  }

  /**
   * Get the active event pass for a school (or WMSU by default)
   */
  public getActivePass(schoolCode = 'WMSU'): EventPass {
    const upper = schoolCode.toUpperCase();
    if (!this.passes[upper] || Date.now() > this.passes[upper].expiresAt) {
      return this.rotatePass(upper);
    }
    return this.passes[upper];
  }

  /**
   * Rotate and generate a fresh cryptographically random event code
   * (invalidates any compromised or older pass)
   */
  public rotatePass(schoolCode = 'WMSU', schoolName?: string): EventPass {
    const upper = schoolCode.toUpperCase();
    const token = generate6DigitCode(upper);
    const resolvedName =
      schoolName ||
      this.passes[upper]?.schoolName ||
      (upper === 'WMSU'
        ? 'Western Mindanao State University'
        : upper === 'UP'
        ? 'University of the Philippines'
        : `${upper} Campus Hub`);

    const newPass: EventPass = {
      code: token, // 6-digit alphanumeric code e.g. WSI319
      schoolCode: upper,
      schoolName: resolvedName,
      generatedAt: Date.now(),
      expiresAt: Date.now() + 12 * 3600 * 1000, // 12 hours validity
      nonce: generateRandomNonce(12),
      activeUses: 0,
    };

    this.passes[upper] = newPass;
    this.savePasses();
    return newPass;
  }

  /**
   * Build the QR code payload URL / JSON
   */
  public getQRPayload(pass: EventPass): string {
    const payload = {
      app: 'ArenaHub',
      school: pass.schoolCode,
      code: pass.code,
      nonce: pass.nonce,
      exp: pass.expiresAt,
    };
    return JSON.stringify(payload);
  }

  /**
   * Anti-Bot Rate Limiting Check
   */
  public getRateLimitStatus(): { isLocked: boolean; remainingSeconds: number; attempts: number } {
    if (typeof window === 'undefined') {
      return { isLocked: false, remainingSeconds: 0, attempts: 0 };
    }

    try {
      const raw = sessionStorage.getItem(STORAGE_KEY_ATTEMPTS);
      if (!raw) return { isLocked: false, remainingSeconds: 0, attempts: 0 };

      const { count, lockUntil } = JSON.parse(raw);
      const now = Date.now();

      if (lockUntil && now < lockUntil) {
        return {
          isLocked: true,
          remainingSeconds: Math.ceil((lockUntil - now) / 1000),
          attempts: count,
        };
      }

      // If lock has passed, reset
      if (lockUntil && now >= lockUntil) {
        sessionStorage.removeItem(STORAGE_KEY_ATTEMPTS);
        return { isLocked: false, remainingSeconds: 0, attempts: 0 };
      }

      return { isLocked: false, remainingSeconds: 0, attempts: count || 0 };
    } catch {
      return { isLocked: false, remainingSeconds: 0, attempts: 0 };
    }
  }

  private recordFailedAttempt(): { isLocked: boolean; remainingSeconds: number } {
    if (typeof window === 'undefined') return { isLocked: false, remainingSeconds: 0 };

    try {
      const raw = sessionStorage.getItem(STORAGE_KEY_ATTEMPTS);
      let count = 0;
      if (raw) {
        const parsed = JSON.parse(raw);
        count = parsed.count || 0;
      }

      count += 1;
      const now = Date.now();

      if (count >= MAX_FAILED_ATTEMPTS) {
        const lockUntil = now + LOCKOUT_DURATION_MS;
        sessionStorage.setItem(STORAGE_KEY_ATTEMPTS, JSON.stringify({ count, lockUntil }));
        return { isLocked: true, remainingSeconds: Math.ceil(LOCKOUT_DURATION_MS / 1000) };
      }

      sessionStorage.setItem(STORAGE_KEY_ATTEMPTS, JSON.stringify({ count, lockUntil: null }));
      return { isLocked: false, remainingSeconds: 0 };
    } catch {
      return { isLocked: false, remainingSeconds: 0 };
    }
  }

  private resetFailedAttempts(): void {
    if (typeof window === 'undefined') return;
    try {
      sessionStorage.removeItem(STORAGE_KEY_ATTEMPTS);
    } catch {
      // ignore
    }
  }

  /**
   * Validate an entered code or scanned QR payload
   */
  public validatePass(rawInput: string, botCheckPassed: boolean): VerificationResult {
    // 1. Anti-Bot: rate limit check
    const rateCheck = this.getRateLimitStatus();
    if (rateCheck.isLocked) {
      return {
        success: false,
        rateLimited: true,
        lockoutSeconds: rateCheck.remainingSeconds,
        error: `Security Lockout: Too many failed attempts. Try again in ${rateCheck.remainingSeconds}s.`,
      };
    }

    // 2. Anti-Bot: human challenge check
    if (!botCheckPassed) {
      return {
        success: false,
        error: 'Anti-Bot Security: Please complete the human verification slide before continuing.',
      };
    }

    if (!rawInput || !rawInput.trim()) {
      return { success: false, error: 'Please enter or scan an event pass code.' };
    }

    let searchCode = rawInput.trim();

    // Check if input is a JSON payload from a QR scan
    if (searchCode.startsWith('{') && searchCode.endsWith('}')) {
      try {
        const parsed = JSON.parse(searchCode);
        if (parsed.code) {
          searchCode = parsed.code;
        }
      } catch {
        // use raw string
      }
    }

    // Normalize code (case-insensitive, remove spaces)
    const normalized = searchCode.replace(/\s+/g, '').toUpperCase();

    // Find matching active pass
    for (const key of Object.keys(this.passes)) {
      const pass = this.passes[key];
      const passNorm = pass.code.replace(/\s+/g, '').toUpperCase();

      if (normalized === passNorm) {
        // Check expiration
        if (Date.now() > pass.expiresAt) {
          return {
            success: false,
            error: 'This event pass has expired. Please ask the gym organizer for a refreshed pass.',
          };
        }

        // Increment active uses
        pass.activeUses += 1;
        this.savePasses();
        this.resetFailedAttempts();

        return {
          success: true,
          pass,
        };
      }
    }

    // Code didn't match: record failed attempt
    const lock = this.recordFailedAttempt();
    if (lock.isLocked) {
      return {
        success: false,
        rateLimited: true,
        lockoutSeconds: lock.remainingSeconds,
        error: `Security Lockout: Too many failed attempts. Protected against bots. Locked for ${lock.remainingSeconds}s.`,
      };
    }

    return {
      success: false,
      error: 'Invalid Event Pass Code. Check the gym screen or banner for the correct code.',
    };
  }
}

export const eventPassService = new EventPassService();
