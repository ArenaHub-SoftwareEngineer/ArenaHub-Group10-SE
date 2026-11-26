// Plays one iPhone stream from a laptop relay over HLS. Used when WebRTC cannot reach the laptop (it sits behind a
// Cloudflare tunnel, which carries web requests but not WebRTC media). A few seconds behind live instead of about one.
// hls.js is loaded only when needed. Safari without Media Source plays HLS natively, with the pass in the address.
import type Hls from 'hls.js';

export interface HlsSession { video: HTMLVideoElement; close: () => void; resume: () => void }

export async function playHls(url: string, auth: () => { user: string; pass: string }, onFail: () => void): Promise<HlsSession> {
  const video = document.createElement('video');
  video.className = 'lw-video';
  video.muted = true; video.autoplay = true; video.playsInline = true;
  video.setAttribute('playsinline', '');
  let closed = false, player: Hls | null = null;
  const fail = () => { if (closed) return; close(); onFail(); };
  const close = () => {
    if (closed) return;
    closed = true;
    player?.destroy();
    video.removeAttribute('src'); video.load();
  };
  const resume = () => {
    // A tile that was off screen for a moment falls behind; jump back to live.
    const live = player?.liveSyncPosition;
    if (live && video.currentTime < live - 3) video.currentTime = live;
    void video.play().catch(() => {});
  };
  const { default: HlsPlayer } = await import('hls.js');
  if (HlsPlayer.isSupported()) {
    player = new HlsPlayer({
      lowLatencyMode: true,
      backBufferLength: 10,
      xhrSetup: xhr => { const { user, pass } = auth(); xhr.setRequestHeader('Authorization', 'Basic ' + btoa(user + ':' + pass)); },
    });
    player.on(HlsPlayer.Events.ERROR, (_event, data) => { if (data.fatal) fail(); });
    player.loadSource(url);
    player.attachMedia(video);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    const { user, pass } = auth();
    video.src = `${url}?user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}`;
    video.addEventListener('error', fail);
  } else {
    throw new Error('This browser cannot play the iPhone stream.');
  }
  resume();
  return { video, close, resume };
}
