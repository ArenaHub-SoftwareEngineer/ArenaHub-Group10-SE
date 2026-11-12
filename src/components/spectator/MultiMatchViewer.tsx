import React, { useEffect, useState } from 'react';
import type { Match } from '../../lib/types';
import { isWatchableLiveMatch } from '../../lib/streamUtils';
import { BroadcastPlayer } from '../common/BroadcastPlayer';
import { Modal } from '../ui/Modal';
import { Check, ArrowUpRight, LayoutGrid, Play } from 'lucide-react';
import '../common/Broadcasting.css';

export interface LiveEntry {match:Match;gameName:string;bracketTitle:string;gameId:string}
export function MultiMatchViewer({open,onClose,entries,onSelectMatch}:{open:boolean;onClose:()=>void;entries:LiveEntry[];onSelectMatch:(match:Match,game:string)=>void}) {
  const available=entries.filter(entry=>isWatchableLiveMatch(entry.match));
  const [ids,setIds]=useState<string[]>([]),[watching,setWatching]=useState(false);
  useEffect(()=>{if(open){setIds(available.slice(0,2).map(entry=>entry.match.id));setWatching(false);}},[open]);
  const selected=available.filter(entry=>ids.includes(entry.match.id));
  return <Modal open={open} onClose={onClose} title="Multi-view" description="Follow up to four matches in one place." className="multi-view-dialog">
    {watching?<><div className="multi-view-toolbar"><p>Press play in each tile. Keep one audio source on to avoid overlapping commentary. Independent broadcasts can have different delays.</p><button type="button" className="arena-outline" onClick={()=>setWatching(false)}><LayoutGrid size={14}/>Change matches</button></div>
      {selected.length?<div className="multi-video-grid">{selected.map(({match,gameName,bracketTitle,gameId})=><article key={match.id} className="multi-video-card"><header className="multi-video-heading"><div><h3>{match.team1?.name} vs {match.team2?.name}</h3><small>{gameName} · {bracketTitle}</small></div><button type="button" onClick={()=>{onClose();onSelectMatch(match,gameId);}}>Full match <ArrowUpRight size={13}/></button></header><BroadcastPlayer match={match} compact/></article>)}</div>:<p className="multi-view-unavailable">The selected matches are no longer live. Choose another match to continue.</p>}
      {selected.length<ids.length && <p className="broadcast-field-hint" role="status">A selected match ended or its watch link was removed.</p>}
    </>:<><p className="broadcast-copy">Choose the live matches you want to follow. Players load only after you select Watch together.</p><div className="multi-select-list" role="group" aria-label="Choose live matches">{available.map(({match,gameName,bracketTitle})=>{const checked=ids.includes(match.id);return <button key={match.id} type="button" aria-pressed={checked} disabled={!checked && ids.length>=4} onClick={()=>setIds(current=>checked?current.filter(id=>id!==match.id):[...current,match.id])}><span className="multi-select-marker">{checked && <Check size={15}/>}</span><span><strong>{match.team1?.name} vs {match.team2?.name}</strong><small>{gameName} · {bracketTitle}</small></span></button>;})}</div>{!available.length && <p className="multi-view-unavailable">No live broadcasts are available right now.</p>}<div className="feature-dialog-actions"><span className="broadcast-field-hint" aria-live="polite">{selected.length} of 4 slots selected</span><button type="button" className="arena-primary" disabled={selected.length===0} onClick={()=>setWatching(true)}><Play size={14}/>Watch together</button></div></>}
  </Modal>;
}
