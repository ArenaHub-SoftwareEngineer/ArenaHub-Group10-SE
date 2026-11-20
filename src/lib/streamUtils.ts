import type { BracketDraft, Match } from './types';
export type StreamPlatform = 'youtube' | 'facebook' | 'other';
export type BroadcastPlatform = 'youtube' | 'facebook' | 'tiktok';
export type BroadcastLink = {platform:BroadcastPlatform;url:string};
function safeUrl(input: string): URL | null {
  try {
    const url = new URL(input.trim());
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url : null;
  } catch { return null; }
}
export function detectPlatform(input: string): StreamPlatform {
  const host = safeUrl(input)?.hostname.toLowerCase();
  if (host && ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) return 'youtube';
  if (host && ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.watch', 'fb.com', 'www.fb.com'].includes(host)) return 'facebook';
  return 'other';
}
export function buildEmbedUrl(input: string, platform: StreamPlatform): string | null {
  const url = safeUrl(input);
  if (!url || detectPlatform(input) !== platform) return null;
  if (platform === 'youtube') {
    const id = url.hostname === 'youtu.be' ? url.pathname.split('/')[1] : url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(embed|live|shorts)\//.test(url.pathname) ? url.pathname.split('/')[2] : null;
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1&rel=0` : null;
  }
  if (platform === 'facebook' && url.pathname !== '/') {
    const source = url.pathname === '/plugins/video.php' ? safeUrl(url.searchParams.get('href') || '') : url;
    if (!source || detectPlatform(source.href) !== 'facebook') return null;
    // Profiles, groups and short/share links are not video identifiers. Ask for
    // the full video permalink rather than claiming any Facebook page will play.
    if (!/^\/(?:[^/]+\/)?videos\/\d+\/?$/.test(source.pathname)
      && !/^\/reel\/\d+\/?$/.test(source.pathname)
      && !(/^\/(?:watch\/?|video\.php)$/.test(source.pathname) && /^\d+$/.test(source.searchParams.get('v') || ''))) return null;
    const publicSource=new URL(source.href),videoId=source.searchParams.get('v');
    publicSource.search='';publicSource.hash='';
    if(/^\/(?:watch\/?|video\.php)$/.test(source.pathname) && videoId)publicSource.searchParams.set('v',videoId);
    return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(publicSource.href)}&show_text=false&autoplay=true&allowFullScreen=true`;
  }
  return null;
}

export function isWatchableLiveMatch(match: { status: string; streamUrl?: string; broadcastLinks?:BroadcastLink[] }): boolean {
  return match.status === 'live' && matchBroadcasts(match).some(link=>link.embedUrl);
}

/** Safe external recovery link when a provider refuses embedded playback. */
export function streamWatchUrl(input: string): string | null {
  const platform = detectPlatform(input);
  const embed = buildEmbedUrl(input, platform);
  if (!embed) return null;
  if (platform === 'youtube') return `https://www.youtube.com/watch?v=${new URL(embed).pathname.split('/')[2]}`;
  return new URL(embed).searchParams.get('href');
}

/** Canonical public permalinks strip trackers and never accept encoder credentials. */
export function broadcastWatchUrl(input:string,platform:BroadcastPlatform):string|null {
  if(typeof input!=='string' || input.length>2000)return null;
  const url=safeUrl(input);if(!url)return null;
  if(platform==='tiktok')return ['tiktok.com','www.tiktok.com','m.tiktok.com'].includes(url.hostname.toLowerCase()) && /^\/@[\w.]{1,24}\/live\/?$/.test(url.pathname)?`https://www.tiktok.com${url.pathname.replace(/\/$/,'')}`:null;
  if(detectPlatform(input)!==platform)return null;
  const source=streamWatchUrl(input);if(!source)return null;
  const clean=new URL(source);
  if(platform==='youtube')return source;
  const id=clean.searchParams.get('v');
  return `https://www.facebook.com${clean.pathname}${id?`?v=${id}`:''}`;
}
export function matchBroadcasts(match:{streamUrl?:string;broadcastLinks?:BroadcastLink[]}) {
  const links:Array<BroadcastLink & {embedUrl:string|null}>=[];
  const primary=match.streamUrl && detectPlatform(match.streamUrl);
  const candidates:BroadcastLink[]=[...(primary && primary!=='other'?[{platform:primary,url:match.streamUrl!}]:[]),...(Array.isArray(match.broadcastLinks)?match.broadcastLinks:[])];
  for(const link of candidates){if(!link || !['youtube','facebook','tiktok'].includes(link.platform) || typeof link.url!=='string')continue;const url=broadcastWatchUrl(link.url,link.platform);if(url && !links.some(item=>item.platform===link.platform))links.push({...link,url,embedUrl:link.platform==='tiktok'?null:buildEmbedUrl(url,link.platform)});}
  return links;
}
export function validateBroadcastLinks(links:BroadcastLink[],primary?:BroadcastPlatform) {
  if(!Array.isArray(links)||links.length>3)throw new Error('Save up to one watch link for each platform.');
  const seen=new Set<string>();
  const broadcastLinks=links.map(link=>{
    if(!link || !['youtube','facebook','tiktok'].includes(link.platform)||seen.has(link.platform))throw new Error('Choose each platform only once.');
    const url=typeof link.url==='string'?broadcastWatchUrl(link.url,link.platform):null;
    if(!url)throw new Error(`Use a full public ${link.platform==='tiktok'?'TikTok LIVE profile':'video'} link for ${link.platform==='youtube'?'YouTube':link.platform==='facebook'?'Facebook':'TikTok'}.`);
    seen.add(link.platform);return {platform:link.platform,url};
  });
  const chosen=broadcastLinks.find(link=>link.platform===primary) ?? (!primary?broadcastLinks.find(link=>link.platform!=='tiktok'):undefined);
  if(broadcastLinks.length && (!chosen || chosen.platform==='tiktok'))throw new Error('Choose a saved YouTube or Facebook link as the ArenaHub player. TikTok opens separately.');
  return {broadcastLinks,streamUrl:chosen?buildEmbedUrl(chosen.url,chosen.platform as StreamPlatform)!:undefined};
}
/** Preserve every other match and its status while changing one match's watch links. */
export function updateBroadcastLinks(brackets:BracketDraft[],matchId:string,links:BroadcastLink[],primary?:BroadcastPlatform):BracketDraft[] {
  const clean=validateBroadcastLinks(links,primary);
  if(brackets.flatMap(b=>b.matches).filter(m=>m.id===matchId).length!==1)throw new Error('This published match is unavailable. Reload the broadcast desk.');
  return brackets.map(bracket=>({...bracket,matches:bracket.matches.map(match=>{
    if(match.id!==matchId)return match;
    const next:Match={...match,broadcastLinks:clean.broadcastLinks};
    if(clean.streamUrl)next.streamUrl=clean.streamUrl;else delete next.streamUrl;
    return next;
  })}));
}

/**
 * Real thumbnails for match cards, like a streaming site: YouTube serves a frame of the broadcast.
 * hqdefault.jpg is the stream's own cover; hqdefault_live.jpg is not used because a finished stream returns a black end frame.
 * Facebook and TikTok offer no public thumbnail, so those cards keep the game artwork.
 */
export function broadcastThumbnails(match:{status:string;streamUrl?:string;broadcastLinks?:BroadcastLink[]}):string[] {
  const youtube=matchBroadcasts(match).find(link=>link.platform==='youtube' && link.embedUrl);
  const id=youtube?.embedUrl?new URL(youtube.embedUrl).pathname.split('/')[2]:null;
  if(!id || !/^[A-Za-z0-9_-]{11}$/.test(id))return [];
  return [`https://i.ytimg.com/vi/${id}/hqdefault.jpg`,`https://i.ytimg.com/vi/${id}/mqdefault.jpg`];
}
