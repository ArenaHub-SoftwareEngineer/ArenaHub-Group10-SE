import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { PlatformLogo, PLATFORM_NAMES } from '../ui/PlatformLogo';
import { ArrowRight, MonitorPlay, Radio, ExternalLink, Layers } from 'lucide-react';
import './Broadcasting.css';

export function BroadcastSetupGuide({open,onClose}:{open:boolean;onClose:()=>void}) {
  const [multiple,setMultiple]=useState(false);
  return <Modal open={open} onClose={onClose} title="Plan your broadcast" description="One production flow. A clear place for every match." className="broadcast-guide-dialog">
    <div className="broadcast-segments" role="group" aria-label="Broadcast workflow"><button type="button" aria-pressed={!multiple} onClick={()=>setMultiple(false)}><Radio size={15}/>Several platforms</button><button type="button" aria-pressed={multiple} onClick={()=>setMultiple(true)}><Layers size={15}/>Several matches</button></div>
    <div className="broadcast-flow" key={String(multiple)} aria-label={multiple?'Each match has its own production feed and watch links':'OBS sends one match to a restream service, then to social platforms'}>
      <div className="flow-source"><PlatformLogo platform="obsstudio" size={30}/><strong>{multiple?'Match A / B / C':'Your match'}</strong><small>{multiple?'A separate feed for each match':'Observer view + commentary'}</small></div><ArrowRight className="flow-arrow" size={20}/>
      <div className="flow-hub"><MonitorPlay size={28}/><strong>{multiple?'Separate live inputs':'Restream service'}</strong><small>{multiple?'One input per match':'Send once, distribute to platforms'}</small></div><ArrowRight className="flow-arrow" size={20}/>
      <div className="flow-destinations">{(['youtube','facebook','tiktok'] as const).map(platform=><span key={platform}><PlatformLogo platform={platform} size={17}/>{PLATFORM_NAMES[platform]}</span>)}</div>
    </div>
    <h3 className="broadcast-subheading">{multiple?'Give every match its own feed':'Our recommended starting setup'}</h3>
    <p className="broadcast-copy">{multiple?'Use a separate observer or production setup and provider input for every match running at the same time. Attach those matches to their own public watch links in ArenaHub. Viewers can then choose a match or open Multi-view.':'Produce the match in OBS Studio. Use YouTube as the main ArenaHub player, then a restream service for Facebook and eligible TikTok accounts. Save each public watch link against the same match.'}</p>
    <div className="broadcast-quality-cards"><div><span>Picture</span><strong>1080p · 60 fps</strong><small>Start here if capture and upload can sustain it.</small></div><div><span>Fallback</span><strong>720p · 60 fps</strong><small>Prioritize stable motion when upload is limited.</small></div><div><span>Evidence</span><strong>Record locally</strong><small>Keep the original recording for fair-play review.</small></div></div>
    <div className="broadcast-note"><strong>What ArenaHub does</strong><p>Organizes public watch links and displays the broadcasts. OBS and your streaming provider send the video. Saving a link here does not start a broadcast or improve its resolution.</p></div>
    <p className="broadcast-copy">TikTok access depends on your account. It opens on TikTok rather than inside this player. Separate platforms and matches can have different delays.</p>
    <footer className="broadcast-guide-links"><a href="https://support.google.com/youtube/answer/2853702" target="_blank" rel="noopener noreferrer"><PlatformLogo platform="youtube" size={17}/>Encoder settings <ExternalLink size={12}/></a><a href="https://support.restream.io/en/articles/6721574-stream-to-tiktok" target="_blank" rel="noopener noreferrer"><PlatformLogo platform="tiktok" size={15}/>TikTok eligibility <ExternalLink size={12}/></a></footer>
  </Modal>;
}
