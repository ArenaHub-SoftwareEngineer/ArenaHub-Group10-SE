/**
 * ArenaHub forbids emoji in UI text, seed data and AI output.
 * Typographic symbols (copyright, star, check mark, arrows) are text, not emoji, and are allowed.
 * Blocked: characters that render as emoji by default, any pictograph forced to emoji
 * presentation with U+FE0F, keycap sequences, and the supplementary emoji blocks.
 */
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\u{FE0F}|[#*0-9]\u{FE0F}?\u{20E3}|[\u{1F000}-\u{1FAFF}]|[\u{1F1E6}-\u{1F1FF}]/gu;
const JOINERS = /[\u{FE0F}\u{200D}]/gu;

export function findEmoji(text: string): string[] {
  return text.match(EMOJI) ?? [];
}

export function hasEmoji(text: string): boolean {
  return findEmoji(text).length > 0;
}

/** Removes emoji and orphaned variation selectors or joiners, then tidies doubled spaces. */
export function stripEmoji(text: string): string {
  return text.replace(EMOJI, '').replace(JOINERS, '').replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]+/gm, '');
}
