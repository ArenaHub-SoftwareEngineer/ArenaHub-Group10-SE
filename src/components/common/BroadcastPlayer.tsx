import React, { useState } from 'react';
import type { Match } from '../../lib/types';
import { matchBroadcasts, type BroadcastPlatform } from '../../lib/streamUtils';
import { PlatformLogo, PLATFORM_NAMES } from '../ui/PlatformLogo';
import { ExternalLink, RotateCcw, VideoOff } from 'lucide-react';
import './Broadcasting.css';

export function BroadcastPlayer({match,compact=false}:{match:Match;compact?:boolean}) {
  const links=matchBroadcasts(match),embedded=links.filter(link=>link.embedUrl);
  const [platform,setPlatform]=useState<BroadcastPlatform|null>(null);
  const [attempt,setAttempt]=useState(0);
  const current=embedded.find(link=>link.platform===platform) || embedded[0];
  const source=current?.embedUrl?new URL(current.embedUrl):null;
  // Multi-view loads only the matches selected by the viewer, with manual playback.
  if(source && compact)source.searchParams.set('autoplay',current?.platform==='youtube'?'0':'false');
  return <section className="broadcast-player-shell" aria-label={`Broadcast player for ${match.team1?.name || 'Team 1'} versus ${match.team2?.name || 'Team 2'}`}>
    {links.length>0 && <div className="broadcast-player-tabs" role="group" aria-label="Watch platform">{links.map(link=>link.embedUrl?<button type="button" key={link.platform} aria-pressed={current?.platform===link.platform} onClick={()=>setPlatform(link.platform)}><PlatformLogo platform={link.platform} size={17}/>{PLATFORM_NAMES[link.platform]}</button>:<a key={link.platform} href={link.url} target="_blank" rel="noopener noreferrer"><PlatformLogo platform={link.platform} size={17}/>{PLATFORM_NAMES[link.platform]}<span className="broadcast-external-label">opens separately</span><ExternalLink size={12}/></a>)}</div>}
    <div className="broadcast-video">{source?<iframe key={`${source.href}:${attempt}`} src={source.href} title={`${match.team1?.name || 'Team 1'} vs ${match.team2?.name || 'Team 2'} · ${current && PLATFORM_NAMES[current.platform]}`} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>:<div className="broadcast-video-empty"><VideoOff size={29}/><strong>Broadcast unavailable</strong><p>The organizer has not attached a supported player to this match.</p></div>}</div>
    {current && <footer className="broadcast-player-footer"><p>Playback and quality are controlled by {PLATFORM_NAMES[current.platform]}.</p><div><button type="button" onClick={()=>setAttempt(value=>value+1)} aria-label={`Reload ${match.team1?.name || 'match'} video`}><RotateCcw size={12}/>Reload</button><a href={current.url} target="_blank" rel="noopener noreferrer"><PlatformLogo platform={current.platform} size={13}/>Open <ExternalLink size={11}/></a></div></footer>}
  </section>;
}
