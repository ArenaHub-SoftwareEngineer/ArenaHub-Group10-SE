import React, { useId, useState } from 'react';
import { Modal } from '../ui/Modal';
import { ArrowUpRight, Star, Trophy, ChevronRight } from '../ui/Icons';
import { codmRank, mythicTier, RANK_GAMES, DOTA_MMR_REFERENCE, rankTiers, rankUnit, type RankGame, type RankTier } from '../../lib/gameRanks';
import type { DisplayRank } from '../../lib/playerProfiles';
import './RankGuide.css';
import { GameArtworkTiles } from '../common/GameArtworkTiles';

type Selection = { index:number; division:string; value:string };
const initial: Record<RankGame,Selection> = {mlbb:{index:0,division:'III',value:'0'},dota2:{index:0,division:'I',value:''},'codm-mp':{index:0,division:'I',value:'1'},'codm-br':{index:0,division:'I',value:'1'}};
const roman=['I','II','III','IV','V'];
const fmt=(value:number)=>value.toLocaleString('en-US');
export function Medal({tier,className=''}:{tier:Pick<RankTier,'name'|'image'>;className?:string}) {
  const [failed,setFailed]=useState(false);
  return <span className={`rank-medal ${className}`} aria-hidden="true">{!failed?<img src={tier.image} alt="" onError={()=>setFailed(true)}/>:<Trophy size={42}/>}</span>;
}
export function RankGuide({open,onClose,initialGame='mlbb',recorded}:{open:boolean;onClose:()=>void;initialGame?:RankGame;recorded?:DisplayRank|null}) {
  const [game,setGame]=useState<RankGame>(initialGame);
  const [selections,setSelections]=useState<Record<RankGame,Selection>>(()=>{
    const next=structuredClone(initial);
    if(recorded){const tiers=rankTiers(initialGame);const index=tiers.findIndex(t=>t.name===recorded.tier);if(index>=0)next[initialGame]={index,division:tiers[index].divisions.includes(recorded.division || '')?recorded.division!:tiers[index].divisions[0] || '',value:String(recorded.value ?? tiers[index].min ?? 0)};}
    return next;
  });
  const controlId=useId();
  const selected=selections[game], tiers=rankTiers(game), tier=tiers[selected.index];
  const numeric=selected.value.trim()===''?NaN:Number(selected.value);
  const valid=Number.isSafeInteger(numeric) && numeric>=0 && numeric<=1000000;
  const codm=game.startsWith('codm');
  const pointRank=codm && valid?codmRank(numeric):null;
  const nextPointRank=pointRank?.next===undefined?null:codmRank(pointRank.next);
  const displayTier=pointRank?.tier || tier;
  const displayIndex=tiers.indexOf(displayTier);
  const division=pointRank?.division || selected.division;
  const mythic=game==='mlbb' && selected.index>=6;
  const nextTier=tiers[displayIndex+1];
  const unit=rankUnit(game);
  const update=(patch:Partial<Selection>)=>setSelections(current=>({...current,[game]:{...current[game],...patch}}));
  const choose=(index:number)=>{const target=tiers[index];update({index,division:target.divisions[0] || '',value:String(target.min ?? 0)});};
  const changeValue=(value:string)=>{
    const n=Number(value), detected=mythic && value.trim()!==''?mythicTier(n):undefined;
    update({value,...(detected?{index:tiers.indexOf(detected)}:{})});
  };
  const currentDivision=tier.divisions.indexOf(division);
  const nextDivision=tier.divisions[currentDivision+1];
  const nextLabel=codm?pointRank?.next!==undefined?`${fmt(pointRank.next-numeric)} ${unit} to ${nextPointRank?.tier.name}${nextPointRank?.division?` ${nextPointRank.division}`:''}`:'Highest point tier':mythic?nextTier?`${fmt(nextTier.min!-numeric)} stars to ${nextTier.name}`:'Highest star tier':nextDivision?`Next: ${tier.name} ${nextDivision}`:nextTier?`Next: ${nextTier.name} ${nextTier.divisions[0] || ''}`:'Highest medal';
  const progress=codm?pointRank?.progress ?? 0:mythic?nextTier && valid?((numeric-tier.min!)/(nextTier.min!-tier.min!))*100:100:game==='dota2'?((currentDivision+1)/5)*100:valid?numeric/(tier.stars || 1)*100:0;
  const valueValid=valid && (!mythic || numeric>=tier.min!) && (game!=='mlbb' || mythic || numeric<=tier.stars!);
  const note=game==='mlbb'?'Divisions count down to I. From Mythic onward, stars continue across the 25, 50, and 100-star milestones.':game==='dota2'?'Herald through Divine have five medal stars. Immortal uses a medal and, when eligible, a regional leaderboard position. Match the medal shown in game; MMR alone is not a verified medal.':`${game==='codm-br'?'Battle Royale':'Multiplayer'} has its own ranked record. Top 5000 is a regional leaderboard distinction within Legendary; points alone do not award it.`;
  return <Modal open={open} onClose={onClose} title="Explore the ranks" description="Your game. Your climb." className="rank-guide-dialog">
    <GameArtworkTiles compact label="Rank game" selected={game} onSelect={id=>setGame(id as RankGame)}/>
    <div className="rank-guide-hero" style={{'--rank-accent':displayTier.color} as React.CSSProperties}>
      <Medal key={displayTier.image} tier={displayTier} className="rank-hero-medal"/>
      <div className="rank-hero-copy"><span className="rank-eyebrow">{RANK_GAMES.find(g=>g.id===game)?.name} · rank preview</span>
        <h3>{displayTier.name}{displayTier.divisions.length>0 && <span> {division}</span>}</h3>
        {game==='dota2' ? displayIndex<7?<div className="rank-star-row" aria-label={`${roman.indexOf(division)+1} of 5 medal stars`}>{roman.map((r,i)=><Star key={r} size={17} className={i<=roman.indexOf(division)?'earned':''}/>)}</div>:<p className="rank-next">Regional leaderboard distinction</p>:<p className="rank-hero-value">{valueValid?fmt(numeric):'—'} <span>{unit}</span></p>}
        {(codm || mythic || game==='mlbb') && <><div className="rank-progress" role="progressbar" aria-label="Progress within this rank" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(valueValid?Math.min(100,Math.max(0,progress)):0)}><span style={{width:`${valueValid?Math.min(100,Math.max(0,progress)):0}%`}}/></div><p className="rank-next">{valueValid?nextLabel:'Enter a valid value to preview progress.'}</p></>}
        {game==='dota2' && <><p className="rank-next">{nextLabel}</p><p className="rank-next">≈{fmt(DOTA_MMR_REFERENCE[displayIndex][Math.max(0,roman.indexOf(division))])}{displayIndex===7?'+':''} MMR · approximate reference</p></>}
      </div>
    </div>
    <section className="rank-controls" aria-label="Preview rank details">
      {codm?<label htmlFor={controlId}>{game==='codm-br'?'Battle Royale RP':'Multiplayer Rank XP'}<input id={controlId} inputMode="numeric" type="number" min="0" max="1000000" step="1" value={selected.value} onChange={e=>changeValue(e.target.value)} aria-invalid={!valid}/><small>Preview only · MP and BR values stay separate.</small></label>:<>
        {tier.divisions.length>0 && <fieldset><legend>{game==='dota2'?'Medal stars':'Division'}</legend><div className="rank-division-buttons">{tier.divisions.map(d=><button key={d} type="button" aria-pressed={division===d} onClick={()=>update({division:d})}>{game==='dota2'?<><Star size={12}/>{roman.indexOf(d)+1}</>:d}</button>)}</div></fieldset>}
        {game==='mlbb' && <label htmlFor={controlId}>{mythic?'Total Mythic stars':`Stars in this division · 0–${tier.stars}`}<input id={controlId} inputMode="numeric" type="number" min="0" max={mythic?1000000:tier.stars} step="1" value={selected.value} onChange={e=>changeValue(e.target.value)} aria-invalid={!valueValid}/></label>}
      </>}
    </section>
    <div className="rank-ladder-heading"><h3>Rank ladder</h3><span>Lowest <ChevronRight size={12}/> Highest</span></div>
    <div className="rank-ladder" role="group" aria-label={`${game} rank tiers`}>{tiers.map((t,i)=><button key={t.name} type="button" aria-pressed={displayIndex===i} onClick={()=>choose(i)} style={{'--rank-accent':t.color} as React.CSSProperties}>
      <Medal tier={t}/><span><strong>{t.name}</strong><small>{t.divisions.length?game==='dota2'?'1–5 medal stars':`${t.divisions[0]} → ${t.divisions.at(-1)}${t.stars?` · ${t.stars} stars`:''}`:game==='dota2'?'Regional leaderboard':`${fmt(t.min!)}${t.max!==undefined?`–${fmt(t.max)}`:'+'} ${unit}`}{codm && t.max!==undefined && <><br/>{fmt(t.min!)}–{fmt(t.max)} {unit}</>}</small></span>
    </button>)}</div>
    <p className="rank-guide-note">{note}</p><footer className="rank-guide-footer"><span><Trophy size={14}/> Explore only · no profile changes</span><button type="button" onClick={onClose}>Done <ArrowUpRight size={14}/></button></footer>
  </Modal>;
}
