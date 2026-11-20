import React, { useState } from 'react';
import type { Match } from '../../lib/types';
import { matchBroadcasts, type BroadcastPlatform } from '../../lib/streamUtils';
import { PLATFORM_NAMES } from '../ui/PlatformLogo';
import { ExternalLink, RotateCcw, VideoOff } from 'lucide-react';
import './Broadcasting.css';
import { ArenaHero } from '../three/ArenaHero';

/**
 * The ArenaHub player. It carries ArenaHub's own branding; the platform behind the stream (YouTube, Facebook)
 * only appears as a plain-text source switch when a match has more than one, and in the "Open original" link.
 */
export function BroadcastPlayer({ match, compact = false }: { match: Match; compact?: boolean }) {
  const links = matchBroadcasts(match), embedded = links.filter(link => link.embedUrl);
  const [platform, setPlatform] = useState<BroadcastPlatform | null>(null);
  const [attempt, setAttempt] = useState(0);
  const current = embedded.find(link => link.platform === platform) || embedded[0];
  const source = current?.embedUrl ? new URL(current.embedUrl) : null;
  // Multi-view loads only the matches selected by the viewer, with manual playback.
  if (source && compact) source.searchParams.set('autoplay', current?.platform === 'youtube' ? '0' : 'false');
  const teams = `${match.team1?.name || 'Team 1'} vs ${match.team2?.name || 'Team 2'}`;
  return <section className="broadcast-player-shell" aria-label={`Broadcast player for ${teams}`}>
    <header className="ah-player-bar">
      <span className="ah-player-brand"><img src="/arenahub-logo.svg" alt="" width="20" height="24" /><strong>ArenaHub</strong><span>Live</span></span>
      {match.status === 'live' && <span className="ah-player-live"><i aria-hidden="true" />LIVE</span>}
      {embedded.length > 1 && <div className="ah-player-sources" role="group" aria-label="Video source">
        {embedded.map(link => <button type="button" key={link.platform} aria-pressed={current?.platform === link.platform} onClick={() => setPlatform(link.platform)}>{PLATFORM_NAMES[link.platform]}</button>)}
      </div>}
    </header>
    <div className="broadcast-video">{source
      ? <iframe key={`${source.href}:${attempt}`} src={source.href} title={`${teams} · ArenaHub Live`} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      : <div className="broadcast-video-empty"><ArenaHero className="broadcast-slate" decorative /><VideoOff size={29} /><strong>{match.status === 'live' ? 'Broadcast starting soon' : 'Broadcast unavailable'}</strong><p>{match.status === 'live' ? 'The match is on. The organizer is attaching the video now.' : 'The organizer has not attached a supported player to this match.'}</p></div>}</div>
    {current && <footer className="broadcast-player-footer"><p>Streaming from {PLATFORM_NAMES[current.platform]}. Quality and captions are in the player's settings.</p><div>
      <button type="button" onClick={() => setAttempt(value => value + 1)} aria-label={`Reload ${teams} video`}><RotateCcw size={12} />Reload</button>
      <a href={current.url} target="_blank" rel="noopener noreferrer">Open original <ExternalLink size={11} /></a>
    </div></footer>}
  </section>;
}
