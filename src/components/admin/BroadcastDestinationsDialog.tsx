import React, { useEffect, useState } from 'react';
import type { Match } from '../../lib/types';
import { matchBroadcasts, validateBroadcastLinks, type BroadcastLink, type BroadcastPlatform } from '../../lib/streamUtils';
import { firestoreService } from '../../lib/firestore';
import { Modal } from '../ui/Modal';
import { PlatformLogo, PLATFORM_NAMES } from '../ui/PlatformLogo';
import { Check, Link2 } from 'lucide-react';
import '../common/Broadcasting.css';

export function BroadcastDestinationsDialog({open,match,onClose,onSaved}:{open:boolean;match:Match;onClose:()=>void;onSaved:()=>void}) {
  const [fields,setFields]=useState({youtube:'',facebook:'',tiktok:''});
  const [primary,setPrimary]=useState<'youtube'|'facebook'>('youtube');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(!open)return;const links=matchBroadcasts(match),next={youtube:'',facebook:'',tiktok:''};for(const link of links)next[link.platform]=link.url;setFields(next);setPrimary(links.find(link=>link.embedUrl)?.platform==='facebook'?'facebook':'youtube');setError('');},[open,match.id]);
  const effective=fields[primary].trim()?primary:fields.youtube.trim()?'youtube':fields.facebook.trim()?'facebook':undefined;
  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();setError('');
    const links=(Object.entries(fields).filter(([,url])=>url.trim()).map(([platform,url])=>({platform:platform as BroadcastPlatform,url:url.trim()}))) as BroadcastLink[];
    try{validateBroadcastLinks(links,effective);}catch(err){setError(err instanceof Error?err.message:'Check the watch links.');return;}
    setBusy(true);
    try{await firestoreService.saveMatchBroadcastLinks(match.id,links,effective);onSaved();onClose();}catch(err){setError(err instanceof Error?err.message:'The watch links could not be saved.');}finally{setBusy(false);}
  };
  return <Modal open={open} onClose={onClose} busy={busy} title="Match platforms" description={`${match.team1?.name || 'Team 1'} vs ${match.team2?.name || 'Team 2'}`} className="broadcast-links-dialog"><form className="broadcast-link-form" onSubmit={submit}><p className="broadcast-copy">Add the public watch links for this match. Your main player appears first; viewers can switch platforms.</p><fieldset disabled={busy}>
    {(['youtube','facebook','tiktok'] as const).map(platform=><label className="broadcast-platform-field" key={platform}><span><PlatformLogo platform={platform} size={22}/><strong>{PLATFORM_NAMES[platform]}</strong><small>{platform==='tiktok'?'Opens separately':'In-app player'}</small></span><input aria-label={`${PLATFORM_NAMES[platform]} public watch link`} type="url" autoComplete="off" maxLength={2000} placeholder={platform==='youtube'?'https://youtube.com/watch?v=…':platform==='facebook'?'https://facebook.com/page/videos/…':'https://tiktok.com/@yourchannel/live'} value={fields[platform]} onChange={e=>setFields(current=>({...current,[platform]:e.target.value}))}/></label>)}
    <legend className="sr-only">Broadcast platforms</legend><div className="broadcast-primary-label">Main ArenaHub player</div><div className="broadcast-primary-picker" role="group" aria-label="Main player">{(['youtube','facebook'] as const).map(platform=><button type="button" key={platform} disabled={!fields[platform].trim()} aria-pressed={effective===platform} onClick={()=>setPrimary(platform)}><PlatformLogo platform={platform} size={18}/>{PLATFORM_NAMES[platform]}{effective===platform && <Check size={14}/>}</button>)}</div>
    </fieldset><p className="broadcast-field-hint"><Link2 size={13}/> Public watch links only. Keep encoder stream keys in your broadcasting software.</p><p className="broadcast-field-hint">Saving preserves the match status. Use the match’s live controls when the broadcast starts or ends. Leave all fields empty to remove its watch links.</p>{error && <p className="auth-flow-error" role="alert">{error}</p>}<div className="feature-dialog-actions"><button type="button" className="arena-outline" disabled={busy} onClick={onClose}>Cancel</button><button className="arena-primary" disabled={busy}>{busy?'Saving…':'Save watch links'}</button></div></form></Modal>;
}
