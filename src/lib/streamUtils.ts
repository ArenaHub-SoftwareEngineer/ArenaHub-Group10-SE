import type { BracketDraft, Match } from './types';
import { isScheduleMatch } from './streamSchedule';

export const canBroadcastMatch = (match: Match) => isScheduleMatch(match) && match.status !== 'completed';
export type StreamPlatform = 'youtube' | 'facebook' | 'other';
export type BroadcastPlatform = StreamPlatform | 'tiktok';
export type BroadcastLink = {platform:BroadcastPlatform;url:string};
const BROADCAST_PLATFORMS: readonly BroadcastPlatform[] = ['youtube', 'facebook', 'tiktok', 'other'];
const TIKTOK_HOSTS = ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'];
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
  return match.status === 'live' && matchBroadcasts(match).length > 0;
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
  if (detectBroadcastPlatform(input) !== platform) return null;
  if (platform === 'tiktok') {
    return /^\/@[\w.]{1,24}\/live\/?$/.test(url.pathname) ? `https://www.tiktok.com${url.pathname.replace(/\/$/, '')}` : null;
  }
  if (platform === 'other') {
    if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname) || /\.(?:localhost|local|internal|lan|test|invalid|onion|example)$/i.test(url.hostname)) return null;
    if (['studio.youtube.com', 'business.facebook.com', 'dashboard.twitch.tv', 'livecenter.tiktok.com'].includes(url.hostname)) return null;
    for (const key of [...url.searchParams.keys()]) {
      if (/token|password|secret|signature|stream.?key|^key$|^auth$|^sig$|^code$/i.test(key)) return null;
      if (/^utm_|^(?:fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = '';
    return url.href;
  }
  const source=streamWatchUrl(input);if(!source)return null;
  const clean=new URL(source);
  if(platform==='youtube')return source;
  const id=clean.searchParams.get('v');
  return `https://www.facebook.com${clean.pathname}${id?`?v=${id}`:''}`;
}

export function detectBroadcastPlatform(input: string): BroadcastPlatform {
  return TIKTOK_HOSTS.includes(safeUrl(input)?.hostname ?? '') ? 'tiktok' : detectPlatform(input);
}

export function parseBroadcastLink(input: string) {
  const platform = detectBroadcastPlatform(input);
  const url = broadcastWatchUrl(input, platform);
  return url ? { platform, url, embedUrl: buildEmbedUrl(url, detectPlatform(url)) } : null;
}

export function embeddedBroadcastSource(input: string) {
  const source = parseBroadcastLink(input);
  return source?.embedUrl ? { ...source, embedUrl: source.embedUrl } : null;
}

/** Validate the link and uploaded thumbnail together before putting a match on air. */
export function liveBroadcastFields(link: string, thumbnailUrl: string) {
  const source = embeddedBroadcastSource(link);
  if (!source) throw new Error('Use a public YouTube or Facebook video link that can play in ArenaHub.');
  const url = safeThumbnailUrl(thumbnailUrl);
  if (!url) throw new Error('Upload a thumbnail before going live.');
  return {
    status: 'live' as const,
    streamUrl: source.embedUrl,
    broadcastLinks: [{ platform: source.platform, url: source.url }],
    thumbnail: { source: 'custom' as const, url },
  };
}

export function broadcastPlatformLabel({ platform, url }: BroadcastLink) {
  const names = { youtube: 'YouTube', facebook: 'Facebook', tiktok: 'TikTok LIVE' };
  return platform === 'other' ? (safeUrl(url)?.hostname.replace(/^www\./, '') || 'External platform') : names[platform];
}

export function matchBroadcasts(match:{streamUrl?:string;broadcastLinks?:BroadcastLink[]}) {
  const links:Array<BroadcastLink & {embedUrl:string|null}>=[];
  const primary=match.streamUrl && detectPlatform(match.streamUrl);
  const candidates:BroadcastLink[]=[...(primary && primary!=='other'?[{platform:primary,url:match.streamUrl!}]:[]),...(Array.isArray(match.broadcastLinks)?match.broadcastLinks:[])];
  for (const link of candidates) {
    if (!link || !BROADCAST_PLATFORMS.includes(link.platform) || typeof link.url !== 'string' || links.some(item => item.platform === link.platform)) continue;
    const url = broadcastWatchUrl(link.url, link.platform);
    if (url) links.push({ platform: link.platform, url, embedUrl: buildEmbedUrl(url, detectPlatform(url)) });
  }
  return links;
}

export function preferredMatchBroadcast(match: Pick<Match, 'streamUrl' | 'broadcastLinks'>) {
  const links = matchBroadcasts(match);
  return links.find(link => link.embedUrl) ?? links[0];
}
export function validateBroadcastLinks(links:BroadcastLink[],primary?:BroadcastPlatform) {
  if(!Array.isArray(links)||links.length>BROADCAST_PLATFORMS.length)throw new Error('Save up to one watch link for each platform.');
  const seen=new Set<string>();
  const broadcastLinks=links.map(link=>{
    if(!link || !BROADCAST_PLATFORMS.includes(link.platform)||seen.has(link.platform))throw new Error('Choose each platform only once.');
    const url=typeof link.url==='string'?broadcastWatchUrl(link.url,link.platform):null;
    if(!url)throw new Error(`Use a public ${broadcastPlatformLabel(link)} watch link.`);
    seen.add(link.platform);return {platform:link.platform,url};
  });
  const chosen = primary
    ? broadcastLinks.find(link => link.platform === primary)
    : broadcastLinks.find(link => ['youtube', 'facebook'].includes(link.platform)) ?? broadcastLinks[0];
  if (broadcastLinks.length && !chosen) throw new Error('Choose one of the saved links as the primary broadcast.');
  const ordered = chosen ? [chosen, ...broadcastLinks.filter(link => link !== chosen)] : broadcastLinks;
  return { broadcastLinks: ordered, streamUrl: chosen ? buildEmbedUrl(chosen.url, detectPlatform(chosen.url)) ?? undefined : undefined };
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

/** Uploaded thumbnails come from Firebase Storage (or a small JPEG kept on the match when Firebase is off). */
export function safeThumbnailUrl(url?:string):string|null {
  if(typeof url!=='string' || url.length>200000)return null;
  if(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(url))return url;
  const parsed=safeUrl(url);
  if(parsed && parsed.hostname==='firebasestorage.googleapis.com')return parsed.href;
  try { const local=new URL(url); if(local.protocol==='http:' && local.hostname==='127.0.0.1')return local.href; } catch { /* not a URL */ }
  return null;
}

/** Card pictures in the order to try, following the organizer's choice. `artwork` is the game image. */
export function matchThumbnails(match:{status:string;streamUrl?:string;broadcastLinks?:BroadcastLink[];thumbnail?:{source:string;url?:string}},artwork?:string):string[] {
  const art=artwork?[artwork]:[];
  if(match.thumbnail?.source==='artwork')return art;
  if(match.thumbnail?.source==='custom'){const custom=safeThumbnailUrl(match.thumbnail.url);return [...(custom?[custom]:[]),...broadcastThumbnails(match),...art];}
  return [...broadcastThumbnails(match),...art];
}
