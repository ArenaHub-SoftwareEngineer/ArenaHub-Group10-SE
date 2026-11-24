// The page the PC agent shows in the player's browser. Self-contained (no network but its own agent),
// written without template placeholders or backticks so it can sit inside String.raw unchanged.
export const agentPage = () => PAGE;

const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>ArenaHub Anti-cheat</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0e0e10; --card: #18181b; --raise: #1f1f23; --text: #efeff1; --muted: #a1a1aa; --line: #2e2e33; --line-strong: #3f3f46;
    --brand: #ff6600; --brand-hover: #ff7a1f; --brand-ink: #ff8a3d; --on-brand: #1a0b00;
    --ok: #4ade80; --ok-soft: rgba(74, 222, 128, .12); --bad: #f87171; --bad-soft: rgba(248, 113, 113, .12);
    --warn: #fbbf24; --warn-soft: rgba(251, 191, 36, .12); --info-soft: rgba(255, 102, 0, .12);
  }
  @media (prefers-color-scheme: light) {
    :root {
      color-scheme: light;
      --bg: #f4f4f5; --card: #ffffff; --raise: #fafafa; --text: #18181b; --muted: #52525b; --line: #e4e4e7; --line-strong: #d4d4d8;
      --brand: #ff6600; --brand-hover: #ea580c; --brand-ink: #c2410c; --on-brand: #1a0b00;
      --ok: #15803d; --ok-soft: rgba(21, 128, 61, .1); --bad: #b91c1c; --bad-soft: rgba(185, 28, 28, .08);
      --warn: #a16207; --warn-soft: rgba(161, 98, 7, .1); --info-soft: rgba(255, 102, 0, .1);
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--text); }
  body { font: 15px/1.55 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 620px; margin: 0 auto; padding: 28px 16px 48px; }
  .top { display: flex; align-items: center; gap: 10px; margin-bottom: 22px; }
  .top svg.logo { width: 24px; height: 29px; flex: none; }
  .top strong { font-size: 15px; font-weight: 650; }
  .chip { margin-left: auto; font-size: 12px; font-weight: 600; color: var(--muted); border: 1px solid var(--line-strong); border-radius: 999px; padding: 3px 10px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 24px; }
  .card + .card { margin-top: 14px; }
  h1 { font-size: 26px; line-height: 1.2; margin: 0 0 6px; font-weight: 700; letter-spacing: -.01em; }
  h2 { font-size: 15px; margin: 0 0 12px; font-weight: 650; }
  p { margin: 0 0 10px; }
  .sub { color: var(--muted); margin: 0 0 20px; }
  .muted { color: var(--muted); }
  .small { font-size: 13px; }
  svg.i { width: 20px; height: 20px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
  .row { display: flex; gap: 14px; align-items: flex-start; padding: 12px 0; border-top: 1px solid var(--line); }
  .row:first-child { border-top: 0; padding-top: 0; }
  .row .ic { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--raise); border: 1px solid var(--line); color: var(--muted); flex: none; }
  .row b { display: block; font-weight: 600; }
  .row span { color: var(--muted); font-size: 13.5px; }
  .never { display: flex; gap: 10px; align-items: flex-start; margin-top: 16px; padding: 12px 14px; border-radius: 12px; background: var(--raise); border: 1px solid var(--line); color: var(--muted); font-size: 13.5px; }
  .server { margin-top: 12px; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--line-strong); display: flex; gap: 10px; align-items: center; }
  .server code { font: 600 14px ui-monospace, "Cascadia Mono", Consolas, monospace; overflow-wrap: anywhere; }
  .server small { display: block; color: var(--muted); font-size: 12.5px; }
  .actions { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; }
  button { font: inherit; font-weight: 650; border-radius: 10px; min-height: 46px; padding: 10px 18px; cursor: pointer; border: 1px solid transparent; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
  .primary { background: var(--brand); color: var(--on-brand); flex: 1 1 220px; }
  .primary:hover:not(:disabled) { background: var(--brand-hover); }
  .ghost { background: transparent; color: var(--text); border-color: var(--line-strong); }
  .ghost:hover:not(:disabled) { background: var(--raise); }
  .danger { background: transparent; color: var(--bad); border-color: var(--line-strong); }
  .danger:hover:not(:disabled) { background: var(--bad-soft); }
  button:disabled { opacity: .55; cursor: default; }
  :is(button, input, summary):focus-visible { outline: 2px solid var(--brand-ink); outline-offset: 2px; }
  details { margin-top: 16px; }
  summary { cursor: pointer; color: var(--brand-ink); font-weight: 600; font-size: 14px; }
  pre { white-space: pre-wrap; font: 13px/1.55 inherit; color: var(--muted); margin: 10px 0 0; }
  .hero { text-align: center; padding: 8px 0 4px; }
  .badge { width: 72px; height: 72px; border-radius: 50%; display: grid; place-items: center; margin: 0 auto 16px; }
  .badge svg.i { width: 34px; height: 34px; stroke-width: 2.4; }
  .ok .badge { background: var(--ok-soft); color: var(--ok); }
  .bad .badge { background: var(--bad-soft); color: var(--bad); }
  .warn .badge { background: var(--warn-soft); color: var(--warn); }
  .info .badge { background: var(--info-soft); color: var(--brand-ink); }
  .hero h1 { font-size: 30px; }
  .hero p { color: var(--muted); max-width: 46ch; margin-left: auto; margin-right: auto; }
  .meta { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 14px; }
  .pill { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px; }
  .pill svg.i { width: 14px; height: 14px; }
  .live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }
  .finding { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border-radius: 12px; background: var(--bad-soft); border: 1px solid var(--line); margin-top: 8px; }
  .finding svg.i { color: var(--bad); margin-top: 1px; }
  .finding b { display: block; font-weight: 600; overflow-wrap: anywhere; }
  .finding b.plain { font-weight: 500; }
  .finding span { display: block; color: var(--muted); font-size: 13.5px; }
  .card.hero { padding-top: 32px; padding-bottom: 28px; }
  .finding.soft { background: var(--raise); }
  .finding.soft svg.i { color: var(--warn); }
  .steps .row .ic.done { color: var(--ok); background: var(--ok-soft); border-color: transparent; }
  .steps .row .ic.warn { color: var(--warn); background: var(--warn-soft); border-color: transparent; }
  .steps .row .ic.failed { color: var(--bad); background: var(--bad-soft); border-color: transparent; }
  .steps .row .ic.running { color: var(--brand-ink); }
  .steps .row .ic.skipped { opacity: .6; }
  .spin { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid currentColor; border-right-color: transparent; animation: spin .8s linear infinite; }
  .badge .spin { width: 34px; height: 34px; border-width: 3px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation-duration: 2.4s; } }
  .options { display: grid; gap: 12px; }
  .option { border: 1px solid var(--line-strong); border-radius: 14px; padding: 18px; }
  .option h2 { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 12px 0 6px; }
  input { width: 100%; font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--line-strong); border-radius: 10px; padding: 11px 12px; min-height: 46px; }
  input.code { font: 600 20px ui-monospace, "Cascadia Mono", Consolas, monospace; letter-spacing: .2em; text-transform: uppercase; }
  .err { color: var(--bad); font-size: 13.5px; font-weight: 600; margin-top: 10px; }
  .foot { margin-top: 18px; text-align: center; color: var(--muted); font-size: 13px; }
  .section-title { font-size: 13px; color: var(--muted); font-weight: 600; margin: 22px 0 4px; }
  [hidden] { display: none !important; }
  @media (max-width: 480px) { .card { padding: 18px; } h1 { font-size: 23px; } .hero h1 { font-size: 26px; } }
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <svg class="logo" viewBox="0 0 424 508" aria-hidden="true"><path fill="#ff6600" fill-rule="evenodd" d="M212 0 288 18V134L340 179V30L424 51V315C424 372 366 425 212 508C58 425 0 372 0 315V51L84 30V179L136 134V18ZM20 67 40 61V368Q20 343 20 315ZM384 61 404 67V315Q404 343 384 368ZM195 144H229Q239 144 244 156L276 234Q282 251 296 251H314Q329 251 332 267L346 338Q350 356 334 356H295Q282 356 278 343L262 305Q256 289 243 289H181Q168 289 162 305L146 343Q142 356 129 356H90Q74 356 78 338L92 267Q95 251 110 251H128Q142 251 148 234L180 156Q185 144 195 144ZM212 190 188 251H236Z"/></svg>
    <strong>ArenaHub Anti-cheat</strong>
    <span class="chip" id="chip">This PC</span>
  </div>
  <main id="view" aria-live="polite"><div class="card hero info"><div class="badge"><div class="spin"></div></div><h1>Starting</h1></div></main>
</div>
<script>
(function () {
  'use strict';
  var ICONS = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
    game: '<line x1="6" x2="10" y1="12" y2="12"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="15" x2="15.01" y1="13" y2="13"/><line x1="18" x2="18.01" y1="11" y2="11"/><rect width="20" height="12" x="2" y="6" rx="2"/>',
    folder: '<path d="M10.7 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v4.1"/><circle cx="17" cy="17" r="3"/><path d="m21 21-1.9-1.9"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    minus: '<path d="M5 12h14"/>',
    server: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>'
  };
  var STEP_ICON = { programs: 'cpu', dota: 'game', folders: 'folder', report: 'cloud', judge: 'shield' };
  function icon(name) { return '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || '') + '</svg>'; }
  function esc(text) { return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function time(ms) { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function post(action) {
    return fetch('action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ArenaHub': '1' }, body: JSON.stringify(action) })
      .then(function (r) { return r.ok; }).catch(function () { return false; });
  }

  var view = document.getElementById('view'), chip = document.getElementById('chip');
  var state = null, shown = '', fails = 0, closed = false, offset = 0, formError = '';

  function hero(kind, badge, title, text, extra) {
    return '<section class="card hero ' + kind + '"><div class="badge">' + badge + '</div><h1>' + esc(title) + '</h1>' + (text ? '<p>' + esc(text) + '</p>' : '') + (extra || '') + '</section>';
  }
  var SPIN = '<div class="spin" aria-hidden="true"></div>';

  function stepsCard(steps, title) {
    if (!steps || !steps.length) return '';
    return '<section class="card"><h2>' + esc(title) + '</h2><ul class="list steps">' + steps.map(function (s) {
      var mark = s.status === 'running' ? SPIN : icon(s.status === 'done' ? 'check' : s.status === 'failed' ? 'x' : s.status === 'warn' ? 'alert' : s.status === 'skipped' ? 'minus' : STEP_ICON[s.key] || 'shield');
      return '<li class="row"><span class="ic ' + esc(s.status) + '">' + mark + '</span><div><b>' + esc(s.label) + '</b><span>' + esc(s.detail || (s.status === 'waiting' ? 'Waiting' : s.status === 'running' ? 'Checking now' : '')) + '</span></div></li>';
    }).join('') + '</ul></section>';
  }
  // "Temp: tool.exe - Renamed copy of ..." reads better as the file name first, then why and where.
  function findings(list, soft) {
    return list.map(function (text) {
      // Fingerprints are for staff; the player needs the file and the reason.
      text = String(text).replace(/ SHA-256 [0-9a-f]{64}/g, '');
      var m = /^([A-Za-z][A-Za-z ]{1,20}): (.+?) - (.+)$/.exec(text);
      var body = m ? '<b>' + esc(m[2]) + '</b><span>' + esc(m[3]) + ' · ' + esc(m[1]) + '</span>' : '<b class="plain">' + esc(text) + '</b>';
      return '<div class="finding' + (soft ? ' soft' : '') + '">' + icon(soft ? 'alert' : 'x') + '<div>' + body + '</div></div>';
    }).join('');
  }

  function render() {
    var s = state;
    chip.textContent = s.mode === 'practice' ? 'Practice scan' : s.mode === 'official' ? 'Match scan' : 'This PC';
    var html = '';
    var title = 'ArenaHub Anti-cheat';

    if (s.phase === 'choose') {
      html = '<section class="card"><h1>Scan this PC</h1><p class="sub">Check for cheats before you play. Pick what you came to do.</p><div class="options">' +
        '<div class="option"><h2>' + icon('shield') + 'Practice scan</h2><p class="muted small">Check this PC now, with no code. The result stays on this PC and does not count for a match.</p><div class="actions"><button class="primary" data-act="practice">Start practice scan</button></div></div>' +
        '<form class="option" id="official" novalidate><h2>' + icon('lock') + 'Official match scan</h2><p class="muted small">Use the 8-character scan code your organizer gave you.</p>' +
        '<label for="code">Scan code</label><input id="code" class="code" maxlength="8" autocomplete="off" spellcheck="false" placeholder="ABCD2345">' +
        '<label for="server">Tournament server</label><input id="server" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://..." value="' + esc(s.server || '') + '">' +
        (formError ? '<p class="err" role="alert">' + esc(formError) + '</p>' : '') +
        '<div class="actions"><button class="primary" type="submit">Continue</button></div></form></div></section>';
    } else if (s.phase === 'connecting') {
      html = hero('info', SPIN, 'Checking your scan code', s.server ? 'Contacting ' + s.server : '');
    } else if (s.phase === 'consent') {
      var p = s.player || {};
      var items = [['cpu', 'Programs on this PC', 'Running and installed programs, compared with the tournament list. A renamed cheat is still caught by what the file contains.']];
      if (s.dota) items.push(['game', 'Dota 2 game files', 'Every program file against the list Valve ships with the game, plus launch options such as -insecure.']);
      if (s.folderCheck) items.push(['folder', 'Folder check', 'Desktop, Downloads, Documents and other drives. Files are read without running or changing them.']);
      if (s.record) items.push(['camera', 'A screenshot every 20 seconds', 'Close private apps first. Notifications can appear in screenshots.']);
      html = '<section class="card"><h1>Scan for ' + esc(p.name || 'this player') + '</h1><p class="sub">' + esc([p.match, p.game].filter(Boolean).join(' · ')) + '</p>' +
        '<h2>This scan checks</h2><ul class="list">' + items.map(function (it) { return '<li class="row"><span class="ic">' + icon(it[0]) + '</span><div><b>' + esc(it[1]) + '</b><span>' + esc(it[2]) + '</span></div></li>'; }).join('') + '</ul>' +
        '<div class="never">' + icon('lock') + '<div>Never touched: your messages, photos, passwords, browser history and webcam. Only findings leave this PC, never your list of programs or files. A referee, not software, decides any outcome.</div></div>' +
        '<div class="server">' + icon('server') + '<div><small>Results go to</small><code>' + esc(s.server) + '</code><small>Check this address with your referee before you agree.</small></div></div>' +
        '<div class="actions"><button class="primary" data-act="yes">' + icon('shield') + 'Agree and start scan</button><button class="ghost" data-act="no">Decline</button></div>' +
        (s.notice ? '<details><summary>Read the full monitoring notice</summary><pre>' + esc(s.notice.trim()) + '</pre></details>' : '') +
        '</section>';
      title = 'Agree to scan · ArenaHub';
    } else if (s.phase === 'scanning') {
      html = hero('info', SPIN, s.mode === 'practice' ? 'Checking this PC' : 'Scanning this PC', 'This usually takes under two minutes. You can leave this tab open and get ready.') + stepsCard(s.steps, 'Progress');
      title = 'Scanning · ArenaHub';
    } else if (s.phase === 'result') {
      html = resultView(s);
      title = (s.verdict ? s.verdict.label : 'Result') + ' · ArenaHub';
    } else if (s.phase === 'declined') {
      html = hero('warn', icon('alert'), 'You declined', s.message || 'The referee has been told. Go to the referee desk before your match.', '<p class="small">You can close this tab and the ArenaHub window.</p>');
    } else if (s.phase === 'ended') {
      html = hero('info', icon('power'), 'Scan stopped', s.message || 'Monitoring has ended.', '<p class="small">You can close this tab.</p>');
    } else if (s.phase === 'error') {
      html = hero('bad', icon('x'), 'Something went wrong', s.message || 'The scan could not continue.', '<p class="small">Close this tab, then open your scan again from the ArenaHub page.</p>');
    }
    document.title = title;
    view.innerHTML = html;
    bind();
    tick();
  }

  function resultView(s) {
    var v = s.verdict || { status: 'scanning', label: 'Checking', detail: '', blockers: [], warnings: [] };
    var practice = s.mode === 'practice';
    var kind = v.status === 'ready' ? 'ok' : v.status === 'blocked' ? 'bad' : (v.status === 'scanning' || v.status === 'incomplete') ? 'warn' : 'info';
    var badge = v.status === 'ready' ? icon('check') : v.status === 'blocked' ? icon('x') : (v.status === 'scanning' ? SPIN : icon('alert'));
    var title = v.label;
    var text = v.detail;
    if (!practice && v.status === 'ready') text = 'You are clear to play' + (s.player && s.player.match ? ' ' + s.player.match : '') + '. Keep the ArenaHub window open until your match ends. Closing it tells the referee.';
    if (!practice && v.status === 'blocked') text = 'Close, uninstall or delete what is listed below. The scan checks again by itself, so you do not need to restart it. If you think a file is wrongly flagged, show this screen to the referee.';
    var meta = '';
    if (!practice) {
      meta = '<div class="meta"><span class="pill"><span class="live-dot" aria-hidden="true"></span><span data-ago>Checking</span></span>' +
        (s.expiresAt ? '<span class="pill">' + icon('clock') + 'Monitoring until ' + esc(time(s.expiresAt)) + '</span>' : '') + '</div>';
    } else if (s.listsFrom) meta = '<p class="small">Checked against ' + esc(s.listsFrom) + '.</p>';
    var html = hero(kind, badge, title, text, meta);
    if (v.blockers.length) html += '<section class="card"><h2>' + (practice ? 'Found on this PC' : 'Blocking your match') + '</h2>' + findings(v.blockers, false) + '</section>';
    if (v.warnings.length) html += '<section class="card"><h2>Review notes</h2><p class="muted small">These items are informational.</p>' + findings(v.warnings, true) + '</section>';
    html += stepsCard(s.steps, 'What was checked');
    if (practice) {
      html += '<div class="actions"><button class="primary" data-act="rescan">' + icon('refresh') + 'Scan again</button><button class="ghost" data-act="close">Done</button></div>';
      if (s.note) html += '<p class="foot">' + esc(s.note) + '</p>';
    } else {
      html += '<div class="actions"><button class="danger" data-act="stop">' + icon('power') + 'Stop scan</button></div><p class="foot">Stopping before the match ends is reported to the referee.</p>';
    }
    return html;
  }

  function tick() {
    var el = view.querySelector('[data-ago]');
    if (!el || !state) return;
    if (!state.lastCheck) { el.textContent = 'Live'; return; }
    var seconds = Math.max(0, Math.round((Date.now() + offset - state.lastCheck) / 1000));
    el.textContent = 'Live · checked ' + (seconds < 5 ? 'just now' : seconds + ' s ago');
  }

  function bind() {
    Array.prototype.forEach.call(view.querySelectorAll('[data-act]'), function (button) {
      button.addEventListener('click', function () {
        var act = button.getAttribute('data-act');
        if (act === 'stop' && !confirm('Stop the scan? The referee will be told, and you will need a new code to scan again.')) return;
        button.disabled = true;
        var action = act === 'practice' ? { type: 'choose', mode: 'practice' } : act === 'yes' ? { type: 'consent', answer: 'yes' } : act === 'no' ? { type: 'consent', answer: 'no' } : { type: act };
        post(action).then(function (ok) {
          if (act === 'close') { view.innerHTML = hero('info', icon('check'), 'All done', 'You can close this tab.'); closed = true; return; }
          if (!ok) button.disabled = false;
        });
      });
    });
    var form = document.getElementById('official');
    if (form) form.addEventListener('submit', function (event) {
      event.preventDefault();
      var code = document.getElementById('code').value.trim().toUpperCase(), server = document.getElementById('server').value.trim();
      formError = !/^[A-Z2-9]{8}$/.test(code) ? 'Enter the 8-character scan code from your organizer.' : !/^https?:\/\/[^\s]+$/.test(server) ? 'Enter the tournament server address, starting with https://' : '';
      if (formError) { render(); return; }
      post({ type: 'choose', mode: 'official', code: code, server: server });
    });
  }

  function poll() {
    if (closed) return;
    fetch('state', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('state'); return r.json(); }).then(function (next) {
      fails = 0;
      offset = next.now - Date.now();
      delete next.now;
      var key = JSON.stringify(next);
      state = next;
      if (key !== shown) { shown = key; render(); }
    }).catch(function () {
      if (++fails === 3) {
        closed = true;
        var stopped = state && state.mode === 'official' && state.phase === 'result';
        view.innerHTML = hero(stopped ? 'bad' : 'info', icon('power'), 'The ArenaHub window closed', stopped ? 'Monitoring stopped and the referee can see that. Open your scan again from the ArenaHub page to continue.' : 'You can close this tab.');
        document.title = 'Closed · ArenaHub';
      }
    }).then(function () { if (!closed) setTimeout(poll, 1000); });
  }
  setInterval(tick, 1000);
  poll();
})();
</script>
</body>
</html>`;
