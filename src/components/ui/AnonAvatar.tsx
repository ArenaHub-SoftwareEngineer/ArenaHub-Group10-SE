import React from 'react';
import { aliasAvatar } from '../../lib/anonAlias';

/** A generated picture for an anonymous chat alias: a mirrored 5 x 5 pattern in the alias's own colour. */
export function AnonAvatar({ alias, size = 28, className = '' }: { alias: string; size?: number; className?: string }) {
  const { hue, cells } = aliasAvatar(alias);
  return <svg className={`anon-avatar ${className}`} width={size} height={size} viewBox="0 0 7 7" aria-hidden="true" focusable="false">
    <rect width="7" height="7" rx="3.5" fill={`hsl(${hue} 45% 18%)`} />
    {cells.map(([x, y]) => <rect key={`${x}-${y}`} x={x + 1} y={y + 1} width="1" height="1" fill={`hsl(${hue} 80% 64%)`} />)}
  </svg>;
}
