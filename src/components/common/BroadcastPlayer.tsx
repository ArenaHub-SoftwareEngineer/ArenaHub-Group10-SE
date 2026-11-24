import React, { useState } from 'react';
import type { Match } from '../../lib/types';
import { broadcastPlatformLabel, preferredMatchBroadcast } from '../../lib/streamUtils';
import { ExternalLink, RotateCcw, VideoOff } from 'lucide-react';
import './Broadcasting.css';
import { ArenaHero } from '../three/ArenaHero';

/** Uses the provider's adaptive player directly. Old external-only records retain their watch link. */
export function BroadcastPlayer({ match, compact = false, preview = false }: { match: Match; compact?: boolean; preview?: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const [loadedKey, setLoadedKey] = useState('');
  const current = preferredMatchBroadcast(match);
  const provider = current && broadcastPlatformLabel(current);
  const source = current?.embedUrl ? new URL(current.embedUrl) : null;
  // Multi-view loads only the matches selected by the viewer, with manual playback.
  if (source && compact) source.searchParams.set('autoplay', current?.platform === 'youtube' ? '0' : 'false');
  const playerKey = source ? `${source.href}:${attempt}` : '';
  const teams = `${match.team1?.name || 'Team 1'} vs ${match.team2?.name || 'Team 2'}`;
  return <section className="broadcast-player-shell" aria-label={`Broadcast player for ${teams}`}>
    <header className="ah-player-bar">
      <span className="ah-player-brand"><img src="/arenahub-logo.svg" alt="" width="20" height="24" /><strong>ArenaHub</strong>{preview && <span>Preview</span>}</span>
      {!preview && match.status === 'live' && <span className="ah-player-live"><i aria-hidden="true" />LIVE</span>}
    </header>
    <div className="broadcast-video">{source
      ? <iframe key={playerKey} src={source.href} title={`${teams} · ArenaHub ${preview ? 'preview' : 'live'}`}
        loading={compact ? 'lazy' : 'eager'} onLoad={preview ? () => setLoadedKey(playerKey) : undefined}
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      : current ? <div className="broadcast-video-empty broadcast-external-video">
        <ExternalLink size={25} aria-hidden="true" />
        <strong>{provider}</strong>
        <a className="arena-primary" href={current.url} target="_blank" rel="noopener noreferrer">
          {preview ? 'Open source preview' : 'Watch stream'} <ExternalLink size={14} aria-hidden="true" />
        </a>
      </div> : <div className="broadcast-video-empty"><ArenaHero className="broadcast-slate" decorative /><VideoOff size={29} /><strong>{match.status === 'live' ? 'Broadcast starting soon' : 'Broadcast unavailable'}</strong><p>{match.status === 'live' ? 'The match is on. The organizer is attaching the video now.' : 'The organizer has not attached a broadcast link to this match.'}</p></div>}</div>
    {current && source && <footer className="broadcast-player-footer">
      <p role={preview ? 'status' : undefined}>{preview
        ? (playerKey === loadedKey ? 'Check playback here before going live.' : `Opening the ${provider} player…`)
        : `Streaming from ${provider}.`}</p><div>
      <button type="button" onClick={() => setAttempt(value => value + 1)} aria-label={`Reload ${teams} video`}><RotateCcw size={12} />Reload</button>
    </div></footer>}
  </section>;
}
