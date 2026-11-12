import type { GameTitle } from './types';

/** The supported titles. Organizers can add more in Games and categories. Team counts are computed, never stored. */
export const DEFAULT_GAMES: GameTitle[] = [
  { id: 'game-mlbb', name: 'Mobile Legends: Bang Bang', registeredTeams: 0, visibility: 'Show everywhere', bannerImage: '/fairplay-mlbb.webp', category: 'MOBA' },
  { id: 'game-dota2', name: 'Dota 2', registeredTeams: 0, visibility: 'Show everywhere', bannerImage: '/fairplay-dota2.jpg', category: 'MOBA' },
  { id: 'game-codm-mp', name: 'CODM Multiplayer', registeredTeams: 0, visibility: 'Show everywhere', bannerImage: '/fairplay-codm.webp', category: 'FPS' },
  { id: 'game-codm-br', name: 'CODM Battle Royale', registeredTeams: 0, visibility: 'Show everywhere', bannerImage: '/fairplay-codm.webp', category: 'Battle Royale' },
];

export const DEFAULT_CATEGORIES = ['MOBA', 'FPS', 'Battle Royale', 'Intramurals', 'Scrims'];
