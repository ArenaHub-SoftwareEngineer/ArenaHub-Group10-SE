import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play, Volume2, VolumeX } from '../ui/Icons';

const poster = '/hero/arena-loop-poster.webp';
function restrictions() {
 const connection=(navigator as Navigator & {connection?:{saveData?:boolean}}).connection;
 return window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion==='reduced' || !!connection?.saveData;
}
export function ArenaScene() {
 const video=useRef<HTMLVideoElement>(null);const scene=useRef<HTMLDivElement>(null);
 const [restricted,setRestricted]=useState(restrictions);const [small,setSmall]=useState(()=>window.matchMedia('(max-width: 640px)').matches);
 const [visible,setVisible]=useState(()=>document.visibilityState!=='hidden');const [inView,setInView]=useState(true);const [failed,setFailed]=useState(false);
 useEffect(()=>{
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)'),mobile=window.matchMedia('(max-width: 640px)');
  const check=()=>setRestricted(restrictions()),resize=()=>setSmall(mobile.matches),visibility=()=>setVisible(document.visibilityState!=='hidden');
  const observer=new MutationObserver(check);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-motion']});
  const intersection=new IntersectionObserver(entries=>setInView(entries[0]?.isIntersecting??false));if(scene.current)intersection.observe(scene.current);
  const connection=(navigator as Navigator & {connection?:EventTarget}).connection;
  connection?.addEventListener('change',check);motion.addEventListener('change',check);mobile.addEventListener('change',resize);document.addEventListener('visibilitychange',visibility);
  return ()=>{observer.disconnect();intersection.disconnect();connection?.removeEventListener('change',check);motion.removeEventListener('change',check);mobile.removeEventListener('change',resize);document.removeEventListener('visibilitychange',visibility);};
 },[]);
 const [paused, setPaused] = useState(false);
 const [playing, setPlaying] = useState(false);
 const [muted, setMuted] = useState(false);
 const [controlsRevealed, setControlsRevealed] = useState(false);

 useEffect(() => {
  const media = video.current;
  if (!media) return;
  let active = true;
  if (paused || restricted || !visible || !inView) {
   media.pause();
  } else {
   void media.play().catch((error: DOMException) => {
    if (!active || error.name !== 'NotAllowedError') return;
    media.muted = true;
    setMuted(true);
    void media.play().catch(() => {});
   });
  }
  return () => { active = false; };
 }, [paused, restricted, visible, inView, small]);

 function togglePlayback() {
  const media = video.current;
  if (!media) return;
  if (!media.paused) {
   setPaused(true);
   media.pause();
  } else {
   setPaused(false);
   void media.play().catch(() => {});
  }
 }

 function toggleSound() {
  const media = video.current;
  if (!media) return;
  media.muted = !media.muted;
  setMuted(media.muted);
 }

 return <div ref={scene} className="arena-video-scene">
  <img className="arena-video-poster" src={poster} alt="" fetchPriority="high"/>
  {!restricted&&!failed&&<video ref={video} className="arena-hero-video" src={small?'/hero/arena-loop-mobile.mp4':'/hero/arena-loop.mp4'} poster={poster} muted={muted} loop playsInline preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} aria-hidden="true"
   onError={()=>setFailed(true)} disablePictureInPicture/>}
  {!restricted && !failed && <>
   <button
    type="button"
    className="hero-media-reveal"
    tabIndex={-1}
    aria-label={controlsRevealed ? 'Hide video controls' : 'Show video controls'}
    aria-expanded={controlsRevealed}
    onClick={() => setControlsRevealed(revealed => !revealed)}
   />
   <div className="hero-media-controls" data-revealed={controlsRevealed}>
   <button type="button" aria-label={playing ? 'Pause hero video' : 'Play hero video'} title={playing ? 'Pause video' : 'Play video'} onClick={togglePlayback}>
    {playing ? <Pause size={18} /> : <Play size={18} />}
   </button>
   <button type="button" aria-label={muted ? 'Unmute hero video' : 'Mute hero video'} title={muted ? 'Unmute video' : 'Mute video'} onClick={toggleSound}>
    {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
   </button>
   </div>
  </>}
 </div>;
}
