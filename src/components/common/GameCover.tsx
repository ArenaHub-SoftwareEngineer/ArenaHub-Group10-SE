import React, { useState } from 'react';

/** Shown wherever official game art appears (docs/DESIGN_ASSETS.md). */
export const GAME_ART_CREDIT = 'Game art © Moonton, Valve and Activision, shown for school tournament coverage.';

/**
 * Portrait cover art for a game (3:4, like a streaming site's category art).
 * Uses /media/games/<id>.webp when it has been added (see docs/DESIGN_ASSETS.md), otherwise the game's artwork.
 */
export function GameCover({ gameId, fallback, className = '' }: { gameId: string; fallback?: string; className?: string }) {
  const sources = [`/media/games/${gameId}.webp`, ...(fallback ? [fallback] : [])];
  const [index, setIndex] = useState(0);
  const src = sources[index];
  return <span className={`ah-cover ${className}`}>
    {src ? <img key={src} src={src} alt="" loading="lazy" decoding="async" className={src === fallback ? 'is-artwork' : undefined} onError={() => setIndex(i => i + 1)} />
      : <span className="ah-cover-blank" />}
  </span>;
}
