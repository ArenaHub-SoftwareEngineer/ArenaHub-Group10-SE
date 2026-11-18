# Main module status

Reviewed 17 November 2026. This describes the current repository; the missing-feature inventory in PLAN.md is a historical audit from before the subsequent implementation work.

## Core application

- Authentication and campus access: implemented. Email verification/reset, trusted staff claims, student admission and restricted-account gates have emulator integration coverage. Google OAuth and email delivery still require real-account release checks.
- Brackets and tournament formats: implemented. Single elimination, double elimination with reset, round robin, arbitrary entrant counts within the supported limits, seeded BYEs, manual/CSV/prompt setup, match edits and PNG downloads are present. CODM Battle Royale uses the separate lobby placement module. Swiss supports 2–128 teams, round-by-round pairings, automatic byes, result corrections and Buchholz rankings. Both manual and prompt setup enforce format-specific limits.
- Publication and live synchronization: implemented with per-tournament storage, revision checks, previous-version restoration and spectator updates. The browser suite measured an organizer change reaching an open viewer in 227 ms in this run; this is a local test result, not a production latency guarantee.
- Match scoring and analytics: implemented. Score validation, advancement, timeline events, MVP selection and public player statistics have unit and browser coverage.
- Broadcasts and schedules: implemented for the supported YouTube/Facebook links, multi-stream viewing, schedules and broadcast destinations. Actual stream availability depends on the supplied publisher links.
- Live chat: implemented. Staff badges, timestamps, pinned messages, slow mode, timed mute, unmute, kick, auditing and Arena AI replies have rules/integration/browser coverage.
- Arena AI: implemented. Streaming, conversation history, grounded tournament tools, contextual follow-ups, cancellation, provider fallback, rate limits and chat replies are present. Automated browser tests use a scripted provider; they do not prove a production model account's availability.
- Teams and players: implemented from published/approved tournament records, with game ranks and public/private profile boundaries. No fictional production directory is loaded.
- Tournament operations: implemented. Registration, duplicate checks, approval, roster locks, match windows, check-ins, referee review, no-shows and sanctions have service/rules coverage.
- Standings: implemented for head-to-head tournaments and Battle Royale placement events.
- Player leaderboard (M10): implemented. One table per game across current and archived (past) tournaments, ranked by KDA, kills, assists, MVP awards or series wins, with a per-player match breakdown. See "Player leaderboard" below.
- Notifications: implemented with private inboxes, read/unread status, announcements and links to related records. System (desktop or phone) alerts for new inbox items are opt-in in Settings and appear while an ArenaHub tab is open (M11). Background push through a push service is not implemented, by decision.
- Fair Play: implemented. Private evidence, link/file submission, human decisions, appeals, history and video review are present. File storage requires the appropriate Firebase storage plan; evidence links are supported separately.
- Match monitor / anti-cheat indicators: implemented for a persistent public Node API or event laptop, including single-use pairing, consent, recordings, review, scoped Dota telemetry and inspection-coverage notices. Windows 3.1 checks registered installed software and loaded Dota libraries, and optionally fingerprints accessible executables and game libraries; native Windows collector tests pass. Android 3.1 includes configured signer matches and incomplete-inspection reporting and builds with HTTPS required. Android physical-device and iPhone Safari checks remain release work. This is a known-indicator collector, not publisher anti-cheat or proof that a device has no cheats. See INTEGRITY_SETUP.md and ANTI_CHEAT_COVERAGE.md.
- Administration: implemented. Account restrictions, game catalog, spotlight, community moderation and audit records are present. Staff claims are assigned using the trusted role-management script.
- Institution branding: implemented through institution configuration and generated theme tokens with contrast checks.

## Gaps corrected during this review

The Swiss implementation was partially integrated but had no dedicated regression suite. Its setup, public-document round trip, automatic progression, correction handling and shared viewer/AI rankings now have coverage. Metadata-only changes preserve later-round schedules. Impossible scores do not contribute to Swiss standings. Changing an unstarted round's series format keeps automatic bye scores valid. Setup controls have accessible labels and selected states; score buttons have larger mobile tap targets. Round status and format explanations describe Swiss accurately.

The main Standings page now renders Battle Royale placement points instead of an empty head-to-head table. Its selected tournament is part of the URL, so refresh, sharing and browser history preserve the selection. Battle Royale result entry waits for the selected event to arrive, pins the displayed game and updates each field from the latest row state. This prevents background synchronization from substituting another event or dropping a neighboring field's value. Bracket setup descriptions and unread notification counts use accessible contrast. Route accessibility tests explicitly create an unread notification so the badge is always checked.

Draft Save and Delete previously updated the interface before the account write succeeded. Both now await Firebase confirmation. A denied save/delete leaves the saved copy available, and the confirmation dialog can display the error and retry. Publishing waits for its draft save. Draft copy now correctly describes account storage rather than browser-only storage.

## Release work still required

The deployable server entry, environment checklist, role-management script and smoke checker exist. A public deployment is not established by these local tests. Before a real event, follow DEPLOY.md and ENV_CHECKLIST.md to verify the chosen API host, CORS, Firebase rules, account claims, real Google sign-in, real email delivery and configured AI/video providers. Production deployment and real-account mutations were not performed in this review.

Capacity planning for a large audience remains in READ_BUDGET.md. Passing local emulator tests does not establish a production concurrency limit.

## Verification evidence

See BASELINE.md for the dated command results. Run `npm run test:emulators` for rules, storage, identity, registration/check-in, notifications, migration, role, chat and draft-persistence checks. Run `npm run test:e2e` for desktop/mobile browser workflows, including Fair Play evidence, organizer decisions and reporter notifications.

## Security hardening, 17 November 2026

Implemented separate device/GSI credentials, scanner-only liveness, server-enforced recording permissions before upload parsing, bounded lookup/throttle state, unsafe pairing-origin rejection, native-client redirect rejection, production browser headers/CSP, generic API errors and public-host monitor/CORS support. Standard Android builds now require TLS, disable debugging and exclude monitoring data from backup/device transfer. SECURITY_REVIEW.md records the verification and remaining hosting/release conditions.

## Required anti-cheat admission (17 November 2026)

The v3 companions run a required pre-match scan. Staff can view every published roster slot, generate its code and see current readiness. The admission API rejects missing/stale/incomplete/blocked scans, unsupported iPhone check-ins, old policy/session stamps and changed rosters. Restricted tools can be closed and cleared on the next valid scan. Official live transitions wait for this gate and a successful cloud save; stream/status/disconnect controls no longer claim success before persistence. The player Anti-cheat page puts app scanning first and keeps disputes/appeals secondary.

CODM BR registration approval now recognizes placement squads. Public roster hydration preserves every squad's players and excludes private names/student IDs. BR lobby admission covers all squads. The subsequent lobby operations update below extends readiness windows and referee confirmation to every squad.

This is basic known-indicator scanning, not publisher-integrated protection, hardware attestation or a guarantee against private cheats. Real Android/iPhone and game compatibility tests and signed distribution remain release work.


## Battle Royale operations completed (17 November 2026)

The remaining CODM BR integration gaps were lobby check-in, referee decisions, evidence selection and event notifications. These now use the same published lobby game and all participating squad IDs throughout the player and organizer interfaces.

- Staff can schedule check-in for 2 to 25 squads. Every participating squad requires a distinct eligible locked roster. Incomplete or duplicated assignments are rejected. All captains receive private notifications.
- Captains submit their own squad lineup during the server-enforced window. Referees confirm the locked roster, request corrections and record no-shows through the existing private history and inbox workflow. Lobby membership is checked during confirmation.
- Resolved lobby cases can support recorded team eligibility decisions. Battle Royale games appear in the existing secondary evidence and video review selectors with lobby labels.
- Schedule edits, live starts, results and result corrections publish event notifications. Unchanged results and reordered result rows avoid duplicate announcements.

The core module inventory above is implemented in source. Remaining optional extensions include background push delivery and a separate venue admission-pass service (both declined: the open-tab alerts and spectator QR cover them). Spectator invitation access, private inbox notifications and tournament team standings already serve their respective current workflows. Public deployment, provider availability, signed anti-cheat distribution and real-device verification remain release work.


## Anti-cheat collector 3.1 (17 November 2026)

Windows supports direct address/code entry on launch and configured restricted-library inspection for Dota 2. Name and optional file-hash matches feed current scan admission. Inspection failures and inventory overflow retain incomplete status. Android fixes the session/policy JSON stamp, has executable JVM serialization regressions and shows current scan status in its ongoing notification. The server requires actual Android game-certificate evidence, and the staff page clears outdated admission notices when a player loses readiness.

Both native artifacts are built locally. Windows native tests use harmless fixtures and the actual executable. Android hardware and publisher compatibility remain unverified, and release signing and deployment remain pending.


## Anti-cheat collector 3.2 (17 November 2026)

Windows 3.2.0 audits the Dota 2 install against Valve's shipped SHA-1 list (`game/bin/win64/dota.signatures`). It also reports binaries Valve does not list beside the game, non-Valve content packs and search paths, restricted launch options (`-insecure`, `sv_cheats`, non-Valve `-language`), and unsigned libraries loaded into Dota from user folders. An opt-in, permission-gated folder check (Desktop, Downloads, Documents, Temp) finds Cheat Engine tables and AutoHotkey scripts that target Dota, portable copies of listed tools and fingerprint matches. Staff can pin the SHA-256 of Valve's list from a Steam-verified reference PC.

Android 3.2.0 adds hooking-framework and cloned/virtual-space indicators. iPhone inspection records six sideload and jailbreak indicators, and any indicator marked found blocks approval.

Verified locally: the audit of the real Steam install on the development PC (build 26632873) reported no findings; the built `arenahub-agent.exe` completed a scan through the real API; fixture tests cover each tampering case; the Android APK builds and passes lint. Android physical-device and iPhone Safari checks remain release work. See INTEGRITY_SETUP.md ("Using collector 3.2") and ANTI_CHEAT_COVERAGE.md (coverage matrix).


## Anti-cheat collector 3.3 (17 November 2026)

PC agent 3.3.0 judges files and running programs by content instead of name: internal program identity (renamed listed tools), unsigned programs that target dota2.exe, DLL-injection functions, cheat-loader protectors, Cheat Engine tables and macro scripts under any extension, and ZIP contents. The cheat-file folder check is now required by default and covers the user profile and other drives in the background. Harmless gcc-built simulators (`tests/fixtures/cheat-sim`, run by `npm run test:collector`) verify detection of renamed, re-extensioned, zipped, buried, running and DLL-loaded cheats with real Windows signature checks. A real-PC run showed no blocking false positives. See INTEGRITY_SETUP.md ("Collector 3.3").


## Player leaderboard (M10, 18 November 2026)

Viewers open **Player leaderboard** in the Arena navigation (`#/arena/leaderboard?game=…&sort=…`). The page is computed in the browser from the live tournament feeds (`src/lib/playerLeaderboard.ts`), so a saved result, stat sheet, MVP or correction appears without a refresh.

Counting rules:
- Only finished series with a valid result count (the same check as team standings). Live, upcoming, "if needed", BYE, demo and withdrawn (unpublished) brackets never count.
- Per-game stat sheets (`statGames`) are added up across the games actually played. `playerStats` holds only the last sheet an organizer saved, so it is used only for older records without per-game sheets, as one game. Sheets for games beyond the series score are ignored.
- A stat line is credited only when it resolves to exactly one player in the two published rosters. Invalid numbers, unknown players and duplicate lines are skipped, not guessed.
- Players are merged across tournaments by game, college code and in-game name (case and spacing ignored), because each tournament's roster has new player IDs. Private roster data is never used.
- KDA = (kills + assists) ÷ deaths, with zero deaths counted as one, compared exactly. A KDA rank needs 3 games with stats. Ties share a rank.
- CODM Battle Royale records squads, not players, so its tab points to Standings.

Past events: publishing a new bracket for a game archives the previous one. `firestore.rules` now lets admitted viewers read archived tournaments (the same public fields they had while published); unpublished brackets stay staff-only. **The updated rules must be deployed** before the live site shows past events; until then the page shows current tournaments and a load warning.

Verification: `tests/player-leaderboard.test.ts` (14 cases), `tests/data.rules.test.mjs` (archived readable, withdrawn hidden), and `tests/e2e/leaderboard.spec.ts` (an archived and a current tournament merge into one row; a game saved while the page is open updates the totals within 5 seconds; the phone layout keeps the player column pinned). The route is in the axe accessibility scan.

Match page series totals (18 November 2026): the Player Performance Summary on a match page previously read `playerStats`, which is only the last game saved, so a Bo3 showed one game's numbers. It now shows series totals by default with a Series / Game 1 / Game 2… switch, using the same helper as the leaderboard (`src/lib/matchStats.ts`). The MVP picker's K/D/A (stored on the MVP card) is also the series total. Gold and damage are summed only when every game recorded them as plain numbers. Covered by `tests/match-stats.test.ts` and the match-page steps in `tests/e2e/leaderboard.spec.ts`.
