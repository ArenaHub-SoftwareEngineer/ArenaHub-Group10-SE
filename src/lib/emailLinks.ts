import type { ActionCodeSettings } from 'firebase/auth';

/**
 * Account emails (verification, password reset, email change) are Firebase links. Each carries a return
 * address so the page that confirms the action offers "Continue" back to ArenaHub, where `?account=`
 * tells the welcome page what just happened.
 */
export type AccountReturn = 'verified' | 'password-reset' | 'email-changed';

export function returnLink(after: AccountReturn): ActionCodeSettings | undefined {
  if (typeof window === 'undefined' || !/^https?:$/.test(window.location.protocol)) return undefined;
  const url = new URL(window.location.pathname === '/player-check-in' ? window.location.href : '/', window.location.origin);
  url.searchParams.set('account', after);
  return { url: url.href };
}

const REJECTED_RETURN = new Set(['auth/unauthorized-continue-uri', 'auth/invalid-continue-uri', 'auth/missing-continue-uri']);

/**
 * Sends with a return link. If Firebase refuses the return address (a domain not on the project's
 * authorized list), it sends again without one, so the email still goes out.
 */
export async function sendWithReturn<T>(send: (settings?: ActionCodeSettings) => Promise<T>, after: AccountReturn): Promise<T> {
  const settings = returnLink(after);
  if (!settings) return send(undefined);
  try { return await send(settings); }
  catch (error) {
    if (REJECTED_RETURN.has(String((error as { code?: string })?.code))) return send(undefined);
    throw error;
  }
}

/** Reads and clears `?account=` once, so a refresh does not repeat the message. */
export function takeAccountReturn(): AccountReturn | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const value = url.searchParams.get('account');
  if (value !== 'verified' && value !== 'password-reset' && value !== 'email-changed') return null;
  url.searchParams.delete('account');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  return value;
}

export const ACCOUNT_RETURN_MESSAGE: Record<AccountReturn, string> = {
  verified: 'Your email is verified. Sign in to continue.',
  'password-reset': 'Your password was changed. Sign in with your new password.',
  'email-changed': 'Your email address was changed. Sign in with your new email.',
};
