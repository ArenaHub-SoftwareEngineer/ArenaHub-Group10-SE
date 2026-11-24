'use strict';
// A player's PC shares its screen to LiveKit (WebRTC). The PC uploads one stream; LiveKit forwards it to each
// facilitator, so more watchers never slow the player's game down.
(() => {
  const el = id => document.getElementById(id);
  const key = location.hash.slice(1);
  const original = location.href;
  history.replaceState(null, '', location.pathname);
  const status = msg => { el('status').textContent = msg; };
  let room;

  async function api(action) {
    const r = await fetch('/api/integrity/device/pov/' + action, { method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000), headers: { Authorization: 'Bearer ' + key } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || 'Connection interrupted. Try again.');
    return body;
  }
  function showPause(metadata) {
    let state = {};
    try { state = JSON.parse(metadata || '{}'); } catch { state = {}; }
    el('paused').hidden = state.paused !== true;
    el('pausedNote').textContent = (state.note ? 'Reason: ' + state.note + '. ' : '') + 'Stop playing and pause the game now. Keep sharing until the referee resumes.';
  }
  function reset(msg) {
    const current = room;
    room = undefined;
    if (current) void current.disconnect();
    el('preview').srcObject = null;
    el('preview').hidden = true; el('stop').hidden = true; el('start').hidden = false; el('start').disabled = false;
    el('paused').hidden = true;
    status(msg);
  }

  el('start').onclick = async () => {
    const { Room, RoomEvent, ScreenSharePresets, Track } = window.LivekitClient;
    el('start').disabled = true;
    status('Connecting…');
    const next = new Room({
      // Dynacast: when no facilitator needs the sharp layer, the PC stops encoding it.
      dynacast: true,
      publishDefaults: {
        // H.264 lets most PCs use the graphics card's video encoder instead of the CPU the game needs.
        // Browsers built without H.264 (some Chromium builds) fall back to VP8.
        videoCodec: (window.RTCRtpSender?.getCapabilities?.('video')?.codecs || []).some(codec => /h264/i.test(codec.mimeType)) ? 'h264' : 'vp8',
        screenShareEncoding: { maxBitrate: 1_700_000, maxFramerate: 15 },
        // The small layer feeds the grid; the 720p layer is sent only while someone enlarges this player.
        screenShareSimulcastLayers: [ScreenSharePresets.h360fps15],
        degradationPreference: 'maintain-framerate',
      },
    });
    room = next;
    next.on(RoomEvent.RoomMetadataChanged, showPause);
    next.on(RoomEvent.LocalTrackUnpublished, publication => {
      if (room === next && publication.source === Track.Source.ScreenShare) reset('Sharing stopped.');
    });
    next.on(RoomEvent.Disconnected, () => { if (room === next) reset('Sharing stopped. The connection closed. Share again to continue.'); });
    next.on(RoomEvent.Reconnecting, () => { if (room === next) status('Connection dropped. Reconnecting…'); });
    next.on(RoomEvent.Reconnected, () => { if (room === next) status('Sharing your screen with match staff.'); });
    try {
      const access = await api('token');
      if (room !== next) return;
      await next.connect(access.url, access.token);
      showPause(next.metadata);
      const publication = await next.localParticipant.setScreenShareEnabled(true, {
        audio: false,
        video: { displaySurface: 'monitor' },
        resolution: { width: 1280, height: 720, frameRate: 15 },
        contentHint: 'motion',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'exclude',
      });
      if (room !== next) return;
      if (!publication || !publication.track) { reset('Screen sharing was cancelled.'); return; }
      el('preview').srcObject = new MediaStream([publication.track.mediaStreamTrack]);
      el('preview').hidden = false; el('stop').hidden = false; el('start').hidden = true;
      await el('preview').play().catch(() => {});
      const surface = publication.track.mediaStreamTrack.getSettings().displaySurface;
      status(surface === 'monitor' ? 'Sharing your screen with match staff.' : 'Sharing one ' + (surface === 'browser' ? 'tab' : 'window') + '. If it turns black in game, stop and share the entire screen.');
    } catch (e) {
      if (room === next) reset(e && e.name === 'NotAllowedError' ? 'Screen sharing was cancelled.' : (e && e.message) || 'Sharing could not start.');
    }
  };
  el('stop').onclick = () => reset('Sharing stopped.');
  addEventListener('pagehide', () => { if (room) reset('Sharing stopped.'); });
  el('copy').onclick = async () => {
    try { await navigator.clipboard.writeText(original); status('Private link copied. Open it only on your own playing or capture device.'); }
    catch { status('Clipboard unavailable. Return to check-in and copy the screen sharing link.'); }
  };

  const ios = /iPhone|iPad/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(navigator.userAgent);
  api('info').then(info => {
    el('identity').textContent = info.name + (info.team ? ' · ' + info.team : '');
    el('match').textContent = info.gameLabel + ' · ' + info.match;
    el('controls').hidden = false;
    if (!info.ready) { status('Live screens are not switched on for this event yet. Tell your organizer.'); return; }
    el('android').hidden = !android;
    el('ios').hidden = !ios;
    // Phone browsers cannot share the screen (no getDisplayMedia), so only desktops get the button.
    el('pc').hidden = android || ios || !navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || !window.LivekitClient;
    if (android) el('androidApp').href = 'intent://pov?s=' + encodeURIComponent(location.origin) + '&key=' + encodeURIComponent(key) + '#Intent;scheme=arenahub;package=ph.edu.wmsu.arenahub.companion;end';
    status(android ? 'Open the Android Companion to share your game.' : ios ? 'Your facilitator watches iPhone players in game.' : el('pc').hidden ? 'Open this link in Chrome or Edge on your playing PC.' : 'Ready to share.');
  }).catch(e => status(e.message));
})();
