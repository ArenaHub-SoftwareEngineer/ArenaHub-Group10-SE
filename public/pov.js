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
    el('pausedNote').textContent = (state.note ? 'Reason: ' + state.note + '. ' : '') + 'Pause your game now. Keep sharing.';
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
  // The key is removed from the address bar on load, so copying the address bar never works: use these buttons.
  document.querySelectorAll('[data-copy-link]').forEach(button => { button.onclick = async () => {
    const label = button.textContent;
    try {
      await navigator.clipboard.writeText(original);
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = label; }, 1800);
      status(button.id === 'androidCopy' ? 'Link copied. Open the ArenaHub Companion, tap Share game screen, then Paste my link.' : 'Private link copied. Open it only on your own playing or capture device.');
    } catch { status('Clipboard unavailable. Return to check-in and copy the screen sharing link.'); }
  }; });

  // iPhones send their screen from a free streaming app to the ArenaHub relay (see server/iphoneRelay.ts).
  // The setup is a 5-step wizard. The step is kept per tab, because players switch to PRISM and back.
  const wizard = el('iosWizard');
  const steps = [...wizard.querySelectorAll('.wiz-step')];
  const stepKey = 'arenahub-pov-ios-step';
  let step = 1, relayReady = false, liveTimer = 0;
  function showStep(next, back) {
    step = Math.min(Math.max(next, 1), steps.length);
    try { sessionStorage.setItem(stepKey, String(step)); } catch { /* private mode */ }
    steps.forEach(panel => {
      const on = Number(panel.dataset.step) === step;
      panel.hidden = !on;
      panel.classList.toggle('back', !!back);
    });
    wizard.querySelectorAll('.wiz-bar i').forEach((bar, i) => { bar.className = i + 1 < step ? 'done' : i + 1 === step ? 'now' : ''; });
    el('wizCount').textContent = 'Step ' + step + ' of ' + steps.length;
    clearTimeout(liveTimer);
    if (step === steps.length) checkLive();
  }
  function moveTo(next, back) {
    showStep(next, back);
    const heading = steps[step - 1].querySelector('h2');
    wizard.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    heading.focus({ preventScroll: true });
  }
  function liveState(text, kind) {
    el('liveState').textContent = text;
    el('liveState').className = 'live-state' + (kind ? ' ' + kind : '');
    el('liveLink').classList.toggle('is-live', kind === 'ok');
    el('liveLink').classList.toggle('is-off', kind === 'off');
  }
  // While the last step is open, ask every 4 s whether the relay sees this player's broadcast.
  async function checkLive() {
    if (!relayReady) { liveState('Waiting for the organizer to turn on iPhone sharing', 'off'); return; }
    try {
      const state = await api('relay/status');
      if (step !== steps.length) return;
      // This phone's broadcast reached ArenaHub: it is set up, and next time it skips the steps.
      if (state.live) { remember(); liveState('Your screen is live. Facilitators can see you.', 'ok'); }
      else liveState(state.error || 'Waiting for your broadcast');
    } catch (e) {
      if (step !== steps.length) return;
      liveState(e.message, 'off');
    }
    if (step === steps.length && !document.hidden) liveTimer = setTimeout(checkLive, 4000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && step === steps.length && !el('ios').hidden) { clearTimeout(liveTimer); checkLive(); } });
  wizard.addEventListener('click', event => {
    const target = event.target instanceof Element && event.target.closest('[data-next],[data-back],[data-restart]');
    if (!target) return;
    if (target.hasAttribute('data-next')) moveTo(step + 1);
    else if (target.hasAttribute('data-back')) moveTo(step - 1, true);
    else moveTo(1, true);
  });
  // The two codes come from the relay. Until the organizer turns it on, step 4 shows empty boxes and keeps asking.
  // A relay on the organizer's laptop gets a new address each time it starts, so the codes are checked again every
  // 10 s and whenever the player comes back from PRISM; a changed address is shown at once and called out.
  let codesTimer = 0, shownServer = '', shownPlayer = '', decided = false;
  // The stream key is the player's own and never changes, so PRISM is set up once. The server says whether the relay
  // has already received this player's screen; this phone remembers that it was the one (a different iPhone, or
  // PRISM reinstalled, needs the steps again).
  const ask = el('iosAsk'), markerKey = 'arenahub-iphone-setup';
  const marker = () => { try { return localStorage.getItem(markerKey) || ''; } catch { return ''; } };
  const remember = () => { try { if (shownPlayer) localStorage.setItem(markerKey, shownPlayer); } catch { /* private mode */ } };
  function savedStep() { try { return Number(sessionStorage.getItem(stepKey)) || 1; } catch { return 1; } }
  function showWizard(at, ready) {
    el('iosLoading').hidden = true; ask.hidden = true; wizard.hidden = false;
    wizard.classList.toggle('is-ready', !!ready);
    showStep(at);
  }
  function showReady() { showWizard(steps.length, true); }
  function showAsk(setup) {
    el('iosLoading').hidden = true; wizard.hidden = true; ask.hidden = false;
    const when = setup.verifiedAt ? new Date(setup.verifiedAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
    el('iosAskNote').textContent = 'ArenaHub already received your screen from PRISM' + (setup.device ? ' on ' + setup.device : '') + (when ? ' (' + when + ')' : '') + '. If PRISM on this iPhone has your codes, just go live.';
    ask.querySelector('h2').focus({ preventScroll: true });
  }
  function decide(target) {
    decided = true;
    const setup = target.setup || {};
    if (setup.verified) { if (marker() === shownPlayer) showReady(); else showAsk(setup); }
    else if (setup.serverChanged) {
      // Set up before, but the organizer's relay moved: only the Stream URL needs pasting again.
      showWizard(4);
      el('iosCodesChanged').textContent = 'The Stream URL changed since you set up PRISM. Copy it, paste it over the old one in PRISM, tap Save, then go live.';
      el('iosCodesChanged').hidden = false;
      el('rtmpServer').closest('.copy-box').classList.add('changed');
    } else showWizard(savedStep());
  }
  document.addEventListener('click', event => {
    const target = event.target instanceof Element && event.target.closest('[data-same],[data-redo]');
    if (!target || el('ios').hidden) return;
    if (target.hasAttribute('data-same')) { remember(); showReady(); }
    else { showWizard(1); steps[0].querySelector('h2').focus({ preventScroll: true }); }
  });
  function fillCodes(target) {
    relayReady = true;
    shownPlayer = target.streamKey.slice(0, 20);
    if (!decided) decide(target);
    const changed = !!shownServer && shownServer !== target.server;
    shownServer = target.server;
    el('rtmpServer').value = target.server;
    el('rtmpKey').value = target.streamKey;
    wizard.querySelectorAll('[data-copy]').forEach(button => { button.disabled = false; });
    el('iosCodesOff').hidden = true;
    if (changed) {
      el('iosCodesChanged').hidden = false;
      el('rtmpServer').closest('.copy-box').classList.add('changed');
      // Players may be on another step (or the "already set up" view): bring them back to the codes.
      if (step !== 4 || !ask.hidden || wizard.classList.contains('is-ready')) showWizard(4);
    }
  }
  function relayOff(message) {
    relayReady = false;
    el('rtmpServer').value = ''; el('rtmpKey').value = '';
    wizard.querySelectorAll('[data-copy]').forEach(button => { button.disabled = true; });
    el('iosCodesOff').hidden = false;
    el('iosCodesOff').textContent = /not set up/.test(message) ? 'Your codes will show up here when the organizer turns on iPhone sharing.' : message;
  }
  function loadCodes() {
    clearTimeout(codesTimer);
    return api('relay').then(fillCodes, e => {
      // A dropped request (Safari says "Load failed" when the player switches to PRISM mid-request) is not an answer:
      // keep any codes already shown and ask again on the next round.
      const network = e instanceof TypeError || e.name === 'TimeoutError' || e.name === 'AbortError';
      if (network && relayReady) return;
      relayOff(network ? 'Could not reach ArenaHub. Checking again...' : e.message);
      // No answer about the setup yet: show the steps, with the codes still waiting.
      if (!decided && wizard.hidden && ask.hidden) showWizard(savedStep());
    }).finally(() => {
      if (!document.hidden && !el('ios').hidden) codesTimer = setTimeout(loadCodes, 10000);
    });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !el('ios').hidden) void loadCodes(); });
  // Copying the new address clears the warning.
  el('rtmpServer').closest('.copy-box').querySelector('[data-copy]').addEventListener('click', () => {
    el('iosCodesChanged').hidden = true;
    el('rtmpServer').closest('.copy-box').classList.remove('changed');
  });
  function showIphoneSetup() {
    el('mirror').hidden = true; el('copy').hidden = true;
    status('');
    // Wait for the server's answer first: an iPhone that is already set up skips the steps.
    void loadCodes();
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
      // Older iOS: copy through a selected field.
      const field = document.createElement('textarea');
      field.value = text; field.setAttribute('readonly', ''); field.style.cssText = 'position:fixed;opacity:0;top:0';
      document.body.append(field); field.select(); field.setSelectionRange(0, text.length);
      let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
      field.remove();
      return ok;
    }
  }
  document.addEventListener('click', async event => {
    const button = event.target instanceof Element && event.target.closest('[data-copy]');
    if (!button) return;
    const field = el(button.dataset.copy), label = button.querySelector('span'), box = button.closest('.copy-box');
    if (await copyText(field.value)) {
      label.textContent = 'Copied'; button.classList.add('copied'); box.classList.add('copied');
      setTimeout(() => { label.textContent = 'Copy'; button.classList.remove('copied'); box.classList.remove('copied'); }, 1800);
    } else {
      field.focus(); field.select();
      status('Copy did not work here. The code is selected: press and hold it, then tap Copy.');
    }
  });
  // Tapping a code selects all of it, so press-and-hold copy also works.
  ['rtmpServer', 'rtmpKey'].forEach(id => el(id).addEventListener('focus', event => event.target.select()));

  const ios = /iPhone|iPad/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // "Desktop site" mode hides "Android" from the user agent; a touch-screen Linux browser is an Android phone.
  const android = /Android/i.test(navigator.userAgent + ' ' + (navigator.userAgentData?.platform || ''))
    || (!ios && navigator.maxTouchPoints > 0 && /Linux/i.test(navigator.userAgent + ' ' + navigator.platform) && !/CrOS/.test(navigator.userAgent));
  api('info').then(info => {
    el('identity').textContent = info.name + (info.team ? ' · ' + info.team : '');
    el('match').textContent = info.gameLabel + ' · ' + info.match;
    el('match').hidden = ios;
    el('controls').hidden = false;
    // iPhones go through the relay, not LiveKit, so they get the setup steps either way.
    el('ios').hidden = !ios;
    if (ios) { showIphoneSetup(); return; }
    if (!info.ready) { status('Live screens are not switched on for this event yet. Tell your organizer.'); return; }
    el('android').hidden = !android;
    // Phone browsers cannot share the screen (no getDisplayMedia), so only desktops get the button.
    el('pc').hidden = android || ios || !navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || !window.LivekitClient;
    // No app installed: Chrome falls back to the APK download instead of an empty Play Store page.
    if (android) el('androidApp').href = 'intent://pov?s=' + encodeURIComponent(location.origin) + '&key=' + encodeURIComponent(key) + '#Intent;scheme=arenahub;package=ph.edu.wmsu.arenahub.companion;S.browser_fallback_url=' + encodeURIComponent(location.origin + '/api/integrity/downloads/arenahub-companion.apk') + ';end';
    el('copy').hidden = android;
    status(android ? 'Three steps to go live.' : el('pc').hidden ? 'Open this link in Chrome or Edge on your playing PC.' : 'Ready to share.');
  }).catch(e => status(e.message));
})();
