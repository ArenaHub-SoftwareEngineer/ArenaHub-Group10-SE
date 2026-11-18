// Types, layout constants and helpers shared by the Bracket Studio parts.

// ── Types ────────────────────────────────────────────────────────────────────

export type BracketFormat = 'Single Elimination' | 'Double Elimination' | 'Round Robin' | 'Swiss';

export function getBracketSyncErrorMessage(error: unknown, action: 'Saved' | 'Published' | 'Unpublished'): string {
  const details = error && typeof error === 'object'
    ? `${'code' in error ? String(error.code) : ''} ${'message' in error ? String(error.message) : ''}`.toLowerCase()
    : String(error || '').toLowerCase();

  // Unpublishing changes nothing on this device until the cloud write succeeds, so say what viewers still see.
  const lead = action === 'Unpublished' ? 'The bracket is still published:' : `${action} on this device, but`;
  if (details.includes('unauthenticated') || details.includes('not signed in')) {
    return `${lead} live sync requires an active sign-in. Sign in again and retry.`;
  }
  if (details.includes('permission-denied') || details.includes('missing or insufficient permissions')) {
    return `${lead} Firebase denied the write. Sign in again with an admin account and retry.`;
  }
  if (details.includes('newer version')) {
    return `${lead} another organizer changed it first. Reload the bracket list and retry.`;
  }
  if (details.includes('resource-exhausted') || details.includes('too large')) {
    return `${lead} the cloud bracket storage limit was reached. Remove an older published bracket and retry.`;
  }
  if (details.includes('unavailable') || details.includes('network') || details.includes('offline')) {
    return `${lead} Firebase is currently unreachable. Check the connection and retry.`;
  }
  return `${lead} live sync failed. Retry, then check the browser console for the Firebase error.`;
}

export interface StreamMessage {
  id: string;
  sender: 'assistant' | 'user';
  text: string;
}



// ── Constants for Horizontal Tree Layout ──────────────────────────────────────
export const CARD_WIDTH = 210;
export const CARD_HEIGHT = 74;
export const BASE_GAP = 28;
export const CONNECTOR_WIDTH = 40;
export const BRACKET_LINE_COLOR = '#606672';

export function getMatchCenterY(roundIdx: number, matchIdx: number): number {
  const slotHeight = CARD_HEIGHT + BASE_GAP;
  const factor = Math.pow(2, roundIdx);
  const offset = ((factor - 1) * slotHeight) / 2;
  return offset + matchIdx * factor * slotHeight + CARD_HEIGHT / 2;
}
