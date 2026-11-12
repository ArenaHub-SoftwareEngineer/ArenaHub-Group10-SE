/**
 * ArenaHub Auth Service
 * 
 * Thin service layer abstracting authentication.
 * TODO: Replace in-memory state with Firebase Auth (signInWithPopup(auth, googleProvider),
 * sendSignInLinkToEmail(auth, email, actionCodeSettings)) and onAuthStateChanged listener.
 */

import { User, UserRole, UserStatus } from './types';
import { INITIAL_USERS } from './mockData';

const AUTH_STORAGE_KEY = 'arenahub_auth_user';

class AuthService {
  private currentUser: User = INITIAL_USERS[0]; // Riley Rust (organizer)
  private listeners: Array<(user: User) => void> = [];

  constructor() {
    try {
      const saved = localStorage.getItem(AUTH_STORAGE_KEY);
      if (saved) {
        this.currentUser = JSON.parse(saved);
      }
    } catch {
      // fallback to initial user
    }
  }

  public subscribe(listener: (user: User) => void): () => void {
    this.listeners.push(listener);
    listener(this.currentUser);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(): void {
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(this.currentUser));
    } catch {
      // ignore storage failure
    }
    this.listeners.forEach((listener) => listener(this.currentUser));
  }

  public getCurrentUser(): User {
    return this.currentUser;
  }

  /**
   * Validates if email belongs to the permitted school domain
   */
  public isPermittedDomain(email: string, domain: string = 'wmsu.edu.ph'): boolean {
    if (!email) return false;
    const parts = email.trim().toLowerCase().split('@');
    return parts.length === 2 && parts[1] === domain.toLowerCase();
  }

  /**
   * Sign in with Google (School Domain Restricted)
   * TODO: Wire up firebase/auth:
   * const provider = new GoogleAuthProvider();
   * provider.setCustomParameters({ hd: 'wmsu.edu.ph' });
   * const result = await signInWithPopup(auth, provider);
   */
  public async signInWithGoogle(email: string = 'riley.rust@wmsu.edu.ph'): Promise<{ success: boolean; error?: string }> {
    if (!this.isPermittedDomain(email)) {
      return {
        success: false,
        error: 'Only Western Mindanao State University emails (@wmsu.edu.ph) are permitted.',
      };
    }

    // Locate existing user or create temporary student profile
    const existing = INITIAL_USERS.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      this.currentUser = existing;
    } else {
      const initials = email.split('@')[0].split('.').map(p => p[0]?.toUpperCase() || '').join('') || 'ST';
      this.currentUser = {
        id: `u-${Date.now()}`,
        name: email.split('@')[0].replace('.', ' ').replace(/\b\w/g, c => c.toUpperCase()),
        email,
        role: 'spectator',
        status: 'active',
        collegeId: 'col-ccs',
        collegeName: 'College of Computing Studies',
        avatarInitials: initials,
        joinedDate: 'Today',
      };
    }

    this.notify();
    return { success: true };
  }

  /**
   * Request email verification magic link
   * TODO: Wire up firebase/auth:
   * await sendSignInLinkToEmail(auth, email, { url: window.location.href, handleCodeInApp: true });
   */
  public async requestEmailVerification(email: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isPermittedDomain(email)) {
      return {
        success: false,
        error: 'Please enter a valid @wmsu.edu.ph student or faculty email address.',
      };
    }
    return { success: true };
  }

  /**
   * Verify and complete login
   */
  public async completeVerification(email: string): Promise<{ success: boolean; error?: string }> {
    return this.signInWithGoogle(email);
  }

  /**
   * Switch active user role for testing Spectator, Player, Moderator, Organizer, School Admin
   */
  public switchRole(role: UserRole): void {
    this.currentUser = {
      ...this.currentUser,
      role,
    };
    this.notify();
  }

  /**
   * Switch user identity
   */
  public switchUser(userId: string): void {
    const found = INITIAL_USERS.find((u) => u.id === userId);
    if (found) {
      this.currentUser = found;
      this.notify();
    }
  }

  /**
   * Log out
   * TODO: Wire up firebase/auth signOut(auth)
   */
  public async logout(): Promise<void> {
    this.currentUser = {
      id: 'guest',
      name: 'Guest Spectator',
      email: 'guest@wmsu.edu.ph',
      role: 'spectator',
      status: 'active',
      collegeId: 'col-ccs',
      collegeName: 'Western Mindanao State University',
      avatarInitials: 'GS',
      joinedDate: 'Today',
    };
    this.notify();
  }
}

export const authService = new AuthService();
