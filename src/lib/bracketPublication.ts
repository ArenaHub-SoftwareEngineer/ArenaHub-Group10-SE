import type { BracketDraft } from './types';

export function publicationGameKey({ gameName, gameId }: Pick<BracketDraft, 'gameName' | 'gameId'>): string {
  const name = gameName.trim().toLowerCase();
  if (gameId === 'game-mlbb' || /^(mobile legends(?::? bang bang)?|mlbb)$/.test(name)) return 'game-mlbb';
  if (gameId === 'game-dota2' || /^dota[ -]?2$/.test(name)) return 'game-dota2';
  if (gameId === 'game-codm-mp' || /^(codm|call of duty:? mobile) multiplayer$/.test(name)) return 'game-codm-mp';
  if (gameId === 'game-codm-br' || /^(codm|call of duty:? mobile) battle royale$/.test(name)) return 'game-codm-br';
  return name;
}

export function replacePublishedBracket(
  published: BracketDraft[],
  previous: BracketDraft[],
  next: BracketDraft,
) {
  const key = publicationGameKey(next);
  if (published.some(bracket => bracket.id === next.id && publicationGameKey(bracket) !== key)) {
    throw new Error('This bracket is already published under another game. Create a separate bracket for this game.');
  }
  const outgoing = published.find(bracket => publicationGameKey(bracket) === key);
  return {
    published: [...published.filter(bracket => publicationGameKey(bracket) !== key), next],
    previous: outgoing
      ? [...previous.filter(bracket => publicationGameKey(bracket) !== key), outgoing]
      : previous.filter(bracket => publicationGameKey(bracket) !== key),
  };
}
