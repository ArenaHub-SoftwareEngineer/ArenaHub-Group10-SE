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

export const MAX_TEAM_IMAGE_LENGTH = 2300;

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
