import React, { useState, type CSSProperties } from 'react';
import { Bed, Bird, Castle, Coins, Flame, Footprints, Glasses, HatGlasses, Hourglass, Leaf, Skull, Frown, Swords, Turtle, VenetianMask, Wifi, Zap, type LucideIcon } from 'lucide-react';
import { teamBadgeColor, teamBadgeImage, teamInitials, type TeamBadgeStyle } from '../../lib/bracketAppearance';
import './bracketAppearance.css';

const MOTIFS: Array<[RegExp, LucideIcon]> = [
    [/lightning|thunder|bolt/i, Zap],
    [/turtle|shell/i, Turtle],
    [/leaf|leaves/i, Leaf],
    [/potato|sunglass/i, Glasses],
    [/tower|castle/i, Castle],
    [/fedora|minion/i, HatGlasses],
    [/claw|monster/i, Swords],
    [/boot|flicker/i, Footprints],
    [/coin/i, Coins],
    [/wi-?fi|signal/i, Wifi],
    [/sleep/i, Bed],
    [/load|pending/i, Hourglass],
    [/tomb|skull/i, Skull],
    [/sweat|face/i, Frown],
    [/phoenix/i, Bird],
    [/mask/i, VenetianMask],
    [/fire|flame/i, Flame],
];

export function bracketMotif(motif?: string) {
  return MOTIFS.find(([pattern]) => pattern.test(motif || ''))?.[1];
}

export function BracketTeamBadge({ name, badge, empty = false }: { name?: string; badge?: TeamBadgeStyle; empty?: boolean }) {
  const source = teamBadgeImage(badge?.image);
  const color = teamBadgeColor(badge?.color);
  const [failed, setFailed] = useState<string>();
  const Icon = bracketMotif(badge?.motif);
  const style = color ? { '--badge-accent': color } as CSSProperties : undefined;
  return <span className={`bracket-team-badge${empty ? ' is-empty' : ''}`} style={style} aria-hidden="true">
    {!empty && (source && failed !== source
      ? <img alt="" src={source} draggable={false} onError={() => setFailed(source)} />
      : Icon ? <Icon size={15} strokeWidth={2.2} /> : teamInitials(name || ''))}
  </span>;
}
