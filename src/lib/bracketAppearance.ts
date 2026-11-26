export interface TeamBadgeStyle {
  color?: string;
  motif?: string;
  image?: string;
}

export interface BracketAppearance {
  theme?: 'navy-gold';
  wideImage?: boolean;
  exportFooter?: boolean;
  teams?: Record<string, TeamBadgeStyle>;
}

// Logos travel inline on the bracket document, so each is capped. 48k characters (~36 KB) holds a sharp 512 px
// WebP logo; 14 of them still leave the 1 MB Firestore document limit plenty of room for the matches.
export const MAX_TEAM_IMAGE_LENGTH = 48_000;

export function teamBadgeImage(value?: string) {
  return typeof value === 'string' && value.length <= MAX_TEAM_IMAGE_LENGTH
    && /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : undefined;
}

export function teamBadgeColor(value?: string) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
}

export function teamInitials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0] || '').join('').toUpperCase();
}
