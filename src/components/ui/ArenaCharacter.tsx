import React, { useEffect, useState } from 'react';
export function ArenaCharacter() {
  const [playing,setPlaying]=useState(false);
  useEffect(()=>{
    const timers: ReturnType<typeof setTimeout>[]=[];
    const play=()=>{if(document.visibilityState==='hidden' || window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion==='reduced')return;setPlaying(true);timers.push(setTimeout(()=>setPlaying(false),1600));};
    timers.push(setTimeout(play,10000),setTimeout(play,20000));
    return ()=>timers.forEach(clearTimeout);
  },[]);
  return <img className={`arena-character ${playing?'is-playing':''}`} src="/arenahub-logo.svg" alt="Arena AI" width="90" height="106"/>;
}
