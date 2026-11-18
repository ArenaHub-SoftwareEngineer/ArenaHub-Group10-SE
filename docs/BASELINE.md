# ArenaHub Test Baseline

Every number here comes from a real run on this machine (Windows 11, Node 24.13.0, Java 25.0.2, firebase-tools 15.4.0). Emulator runs use the disposable `demo-arenahub` project only.

## How to run

| What | Command |
|---|---|
| Type check | `npm run lint` |
| Unit tests | `npm test` |
| API tests | `npm run test:api`, `npm run test:video-api` |
| Build | `npm run build` (cleans `dist/` file by file first) |
| All emulator suites | `npm run test:emulators` |
| Browser checks (375 px and 1440 px) | `npm run test:e2e` |
| Everything except browser checks | `npm run test:all` |

If a Firestore emulator is already running on port 8085, `ARENAHUB_EMULATORS=auth,storage npm run test:emulators` reuses it. The Storage suite cannot run in that mode, because the emulator hub does not see an external Firestore.

## Before refactor (12 Nov 2026, commit `69552e0`)

| Suite | Result |
|---|---|
| lint | pass |
| unit | 56 / 56 |
| api | 1 / 1 |
| video-api | 1 / 1 |
| build | pass, 35 files, 18 MB (`dist/` held 1,246 stale files, 93 MB) |
| rules | 19 / 19 |
| storage | 3 / 3 |
| auth | 1 / 1 |
| auth-flow | 1 / 1 |
| stream | 1 / 1 |
| operations integration | 1 / 1 |

## After Phase 0 (12 Nov 2026)

| Suite | Result |
|---|---|
| lint | pass |
| unit | 59 / 59 (56 + 3 emoji guard tests) |
| api | 1 / 1 |
| video-api | 1 / 1 |
| build | pass, 35 files; repeated builds stay at 35 |
| rules | 19 / 19 |
| auth, auth-flow, stream, operations integration | 4 / 4 |
| storage | **not run**: a leftover Firestore emulator process from an earlier session holds port 8085, so the emulator hub cannot host Storage plus Firestore together. It passed 3 / 3 that morning. It will be re-run once that process is stopped. |
| browser (Playwright) | 6 / 6: entry page, organizer sign-in, student sign-in, each at 375 px and 1440 px, with no console errors and no horizontal scroll |

## Root cause found for the stale `dist/` chunks

Node 24's recursive `fs.rmSync` returns without error but deletes nothing on Windows when the path contains a non-ASCII character. This project folder's name contains an em dash. Vite's `emptyOutDir` uses the same call, so `dist/` was never emptied. `scripts/clean-dist.mjs` deletes file by file, which works, and runs before every build.

## After Phase 1 (12 Nov 2026, merge `20c291e`)

| Suite | Result |
|---|---|
| lint | pass |
| unit | 65 / 65 (59 + 6 tournament document tests) |
| api | 1 / 1 |
| video-api | 1 / 1 (now queries published tournaments) |
| build | pass, 31 files; no fictional data strings in the bundle |
| rules | 27 / 27 (19 ported + 8 new for the per-tournament layout) |
| auth, auth-flow, stream, operations integration | 4 / 4 (stream and operations ported to the new documents) |
| migration round trip | 1 / 1 |
| storage | **not run**: same leftover Firestore emulator on port 8085 as in Phase 0 |
| browser (Playwright) | 9 / 9 passed, 1 skipped by design (the propagation check runs at 1440 px only). An organizer change reached an open bracket viewer in 145 ms. |

Main bundle chunks are unchanged in size (`index` 470 kB, the Firebase chunk 581 kB). Code splitting is Phase 4.

## After Phase 2 (15 Nov 2026, branch `phase-2-modules`, not merged)

| Suite | Result |
|---|---|
| lint | pass |
| unit | 108 / 108 |
| api, video-api, integrity-api | 3 / 3, 1 / 1, 7 / 7 |
| build | pass |
| rules | 36 / 36 |
| auth, auth-flow, stream, operations, chat kick, migration, roles | all pass |
| browser (Playwright) | 29 passed, 5 skipped by design (desktop-only tests in the 375 px project) |

## After Phase 3: Arena AI rebuild (15 Nov 2026, branch `phase-2-modules`, not merged)

| Suite | Result |
|---|---|
| lint | pass |
| unit | 174 / 174, including the Arena AI eval (`tests/ai-eval.test.ts`, 63 cases) and the build-check test |
| api, video-api, integrity-api | 4 / 4, 1 / 1, 7 / 7 |
| build | pass, 41 files. The build check compared the actual server key values (1 configured) against every file in `dist/`: absent |
| rules | 38 / 38 (2 new: Arena AI replies are server-only; the chat AI switch is staff-only and audited) |
| auth, auth-flow, stream, operations, chat kick, migration, roles, server auth | all pass (server auth is new: firebase-admin verification and the published reader, 3 tests) |
| storage | **not run**: no Storage emulator on port 9198 in this session (connection refused) |
| browser (Playwright) | 31 passed, 6 skipped by design, 1 failed: "organizer creates a match monitor pairing code" at 1440 px. That page never got past "Loading ArenaHub…" (sign-in and profile load), so no monitor code ran. It passes alone and right after the test that precedes it. In the full run the shared emulator had slowed (the timeline test took 1.5 min instead of 21 s). Recorded as an environment issue, not hidden with a longer timeout. Re-check on fresh emulators with `npm run test:e2e`. |

Arena AI eval (63 cases, scripted model, fixture built through the public-document converters): every reply is checked for grounding (each "X vs Y" team and each score exists in the fixture), private roster values, emoji and markdown tables. It covers 11 live-records answers, 5 model answers through the tools, 19 refusals (off-topic, injection, private data) with the model never called, output cleaning, the backup model, a broken stream, the rate limit, the cache, tool privacy, staff-only tools, live chat (budget, interval, refusals, access) and bracket drafts.

Time to first token, Arena AI page, measured by the browser test with the scripted provider (so this is ArenaHub's own overhead: sign-in check, record read, rate-limit transaction, streaming; a real model adds its own latency):

| Run | First token | Complete answer |
|---|---|---|
| 1440 px, warm server | 420 ms | 441 ms |
| 1440 px and 375 px, late in the full suite (emulator under load) | 2124 ms, 2005 ms | 2215 ms, 2029 ms |
| 375 px, first request after the server started | 1495 ms | 2405 ms |

Real-provider run: **not done yet.** It sends public tournament data to the Gemini free tier and uses Kerr's quota, so it waits for his go-ahead. Record the result here when it runs.

## Main module verification (15 Nov 2026)

The current module inventory is in MODULE_STATUS.md. This run used disposable `demo-arenahub` emulators; no production rules, accounts or hosting were changed.

- Unit suite: 192 passed, zero failed.
- AI/API suite: 4 passed; video API: 1 passed; match-monitor API: 7 passed.
- Type checking and production build: passed. The build's credential scan passed across 41 output files.
- Database rules: 38 passed. Storage evidence permissions: 3 passed, including real emulator uploads and private reads. The prior Storage connection-refused gap is resolved in this run.
- Authentication, account flows, broadcasts, tournament operations, chat kick and migration: one integration test each passed.
- Trusted-role script: 3 passed. Server authentication/public-record reader: 3 passed.
- Existing desktop/mobile browser suite: 33 passed, 7 deliberately skipped. The match-monitor pairing check that previously failed passed in the complete clean run. A tournament update reached a viewer in 227 ms locally.
- Added draft-persistence regression: 1 passed. Denied save/delete operations preserve the confirmed draft, and successful writes are read back from the server. This runs in `test:emulators` now.
- Added Fair Play browser workflow: 1 passed. A mobile reporter submits evidence, a separate staff account records its decision, and the reporter receives the updated case and private notification.

Draft saves/deletes now await the account write before reporting success. Publication waits for its draft save; confirmation errors stay available for retry. Browser-only storage wording was corrected to account storage.

The full browser suite and the additional Fair Play test were run separately (34 passing browser checks in total). Broad accessibility/performance certification, a production load test, live model-provider availability and real-device installation were not established by these tests. Production release setup remains documented in DEPLOY.md.

## Main module continuation (16 Nov 2026)

Local checks use the disposable `demo-arenahub` project. Existing work in the checkout was preserved.

- Type checking and production build: passed. The production scan checked 56 output files and found no demo credentials, emulator links or configured server key values.
- Unit tests: 214 passed, zero failed. Ten Swiss regression tests cover field sizes through 128, one appearance per team per round, rematch avoidance in the tested fields, byes, valid results, corrections, schedule preservation, round format changes, document round trips, prompt limits and consistent AI/viewer rankings.
- API tests: 4 AI/API, 1 video and 7 match-monitor checks passed.
- Final emulator run: 57 passed, zero failed: 39 database rules, 3 Storage, 1 authentication, 1 account flow, 1 broadcast, 1 tournament operations, 1 draft persistence, 1 chat kick, 1 migration, 4 trusted-role and 4 server-auth checks.
- Focused browser verification: Swiss setup, scoring, publication, reload and viewer standings passed at 375 px and 1440 px. Account-email verification/reset passed at both widths. After fixing result-entry synchronization, the Battle Royale workflow passed three consecutive runs, including exact aggregate points, invalid placement correction, public standings, scheduling, refresh and unpublishing.
- Complete browser run after the module fixes: 52 passed, 9 intentionally skipped, 1 failed. The failure was the organizer route accessibility scan: white unread-count text on the orange notification badge had insufficient contrast. The badge now uses the institution's contrasting `--on-brand` foreground, and the accessibility suite seeds an unread inbox item before each signed-in scan. Every functional browser workflow passed in that full run, including both Swiss workflows and the updated Battle Royale workflow.
- Accessibility follow-up after the badge fix: all 6 checks passed. This covers all 12 spectator routes, 15 organizer routes and the signed-out page at both 375 px and 1440 px, with unread badges explicitly present for signed-in scans. No serious or critical WCAG A/AA violations were reported. Together with the full browser run, all 53 distinct runnable browser checks have passing results; the other 9 are intentional skips for workflows exercised in the desktop project. Responsive layout checks also passed at 320 px and 768 px.

The Firebase Storage emulator still logs its known Java rules-runtime shutdown exception after the test script exits, and can leave a Firestore process behind. Browser runner results are recorded above separately from that emulator teardown issue. Test-server cleanup verifies the demo project and workspace command line before stopping a leftover process. Production deployment, real Google OAuth, real inbox delivery, live model availability, event-device installation and a production load test remain unverified.

The initial browser attempts exposed low-contrast setup descriptions and intermittent form resets. The setup contrast and Battle Royale event/game selection were corrected. Test-mode hot reload is disabled, and generated reports/runtime files are excluded from the development watcher, so background test output does not interrupt forms.

Swiss standings now use the same ranking function in the interface and Arena AI. Automatic byes count as series wins, but never as played games. The main Standings page also renders Battle Royale placement points and preserves tournament selection in the URL. See MODULE_STATUS.md for the module inventory and remaining real-event release checks.

## Security and anti-cheat continuation (17 Nov 2026)

The deployment assumption was confirmed as a public website and API, with Windows and iPhone available and Android physical testing deferred. Local findings were fixed in the working tree; no production deploy or real-account change was performed. See SECURITY_REVIEW.md, ANTI_CHEAT_COVERAGE.md and INTEGRITY_SETUP.md.

- Type checking: passed (`npm.cmd run lint`).
- Unit tests: 225 passed, zero failed (`npm.cmd test`). Includes 8 new known-indicator/coverage/origin tests and 3 production HTTP security checks.
- API tests: 4 AI/API, 1 video and 10 monitor tests passed. New monitor coverage verifies GSI/device capability isolation, scanner-only freshness, recording-off rejection, unsafe destination rejection and allowlisted hosted access behind Cloudflare.
- Emulator suites: 57 passed, zero failed: 39 database rules, 3 Storage, and 15 identity/operations/draft/chat/migration/role/server-auth checks. Every write targeted disposable demo-arenahub services.
- Full desktop/mobile browser run: 57 passed, 9 intentional skips, zero failed. This includes all six serious/critical accessibility scans, existing tournament/AI/Fair Play/account workflows and four new security cases across 375 px and 1440 px. The new cases verify real CSP enforcement, configured fingerprint persistence, installed/running findings, incomplete-coverage notices and no horizontal overflow. Screenshots were visually inspected.
- Final targeted browser follow-up: 4 passed at both widths after the monitor display refinement.
- Native Windows collector tests: 3 passed, zero failed. A harmless live process is fingerprinted and reaches server findings; actual Uninstall metadata is locally filtered to one selected test entry without logging the full inventory; the real agent source stops at its local consent deadline without a server expiry response. No registry entries were created or changed.
- Web production build: passed. The postbuild scan checked 57 files for demo identities, emulator links and configured server key values. Two existing dynamic-import optimization warnings remain non-blocking.
- Windows agent: final bundled script and standalone executable built. The executable starts in usage-only mode without scanning. Authenticode status is NotSigned; it remains a controlled-test artifact pending organization-owned release signing.
- Android v2: final HTTPS-only APK built (about 2 MB). Android lint: zero errors, 9 non-security localization/resource warnings, zero security-category findings. Debugging is disabled; backup/device transfer is excluded. Configured signer policy reaches the first report; local consent expiry stops collection even without connectivity. Actual Android device behavior is not verified.
- `npm.cmd audit --omit=dev --json`: zero known production dependency vulnerabilities. This does not establish application security or the absence of unknown supply-chain flaws.
- `git -c core.whitespace=cr-at-eol diff --check`: passed.

The first browser startup exposed a JSON import missing Node's required import attribute. It was corrected in playerProfiles.ts before the complete passing browser run. An earlier unit run exposed two stale assertions about signature wording/Kotlin field extraction; those tests now reflect the actual report boundary and final tests pass. Firebase Storage still emits a Java rules-runtime exception during emulator teardown after the browser script succeeds; the runner summary and .last-run.json both confirm passing tests. This is recorded separately from application failures.

Final native download fingerprints are generated in dist-agent/SHA256SUMS.txt. Fingerprints identify these exact test files; they do not replace a trusted distribution channel or release signatures. Source-backed cheat categories and coverage limits are in ANTI_CHEAT_COVERAGE.md. User-mode collectors can be forged and do not detect every installed, hidden, injected, portable or external cheat. Real iPhone Safari, Android hardware, native game compatibility, production hosting/rules/IAM, load capacity and signed releases remain release checks.

## Required pre-match scanning in v3 (17 Nov 2026)

The Anti-cheat entry now runs the required companion scan flow. Staff admission is computed from every published roster slot and current device observations. Official live transitions await scan admission and confirmed cloud persistence. CODM BR roster registration, approval and public hydration now support all lobby squads.

- Type checking and production web build passed. The production scan checked 58 files.
- Unit tests passed all 236 cases. Eleven pre-match regressions cover current findings, recovery, required inspection coverage, stale or old clients, session and policy binding, Android game trust, device-state warnings and Battle Royale roster hydration.
- API checks passed 24 cases across 10 existing monitor, 9 required-scan, 4 general AI/API and 1 video check. Admission tests cover all four game modes, every BR squad, omitted or fabricated ready flags, fresh policy, replaced sessions and roster changes that reuse a player slot.
- Native Windows checks passed all 4 cases, including actual execution of the built v3 executable against an isolated local API. The compiled-app test used empty fixture blocklists, disabled capture and omitted optional GSI setup to avoid changing Steam files. Separate harmless-fixture tests verify real executable hashes and registered-software filtering.
- Firebase emulator suites passed all 58 cases. The added BR service test exercises squad registration, approval, locking and private-safe public roster hydration.
- Browser checks passed all 61 runnable cases across mobile and desktop. Nine mobile duplicates were deliberately skipped. The first full run completed the mobile project and began desktop before the session interruption. Desktop then passed all 35 cases on fresh emulators. Counts are unique cases across those runs. Both widths exercised the real Go live control, blocked restricted software, recovery to all players ready, current published roster selection, access rules and accessibility checks.
- Android v3 built successfully. Static lint reported zero errors and zero security-category findings, with 9 localization/resource warnings. The compiled manifest identifies version 3.0.0 and disables cleartext traffic. Physical Android and game compatibility checks remain pending device availability.
- Final native download fingerprints are in dist-agent/SHA256SUMS.txt. The native files remain development artifacts pending organization-controlled release signing.

Earlier browser attempts exposed imprecise fixture/navigation selectors and an expected third-party video capability warning. The final tests select the published fixture directly and keep browser permissions restricted. The existing Firebase rules-runtime teardown exception occurs after successful test scripts and remains separate from application test outcomes.

Readiness blocks configured restricted-software matches and incomplete essential checks. Root, emulator and debugging indicators remain visible warnings by themselves. Installed dual-use tools remain subject to their configured severity. The gate covers ArenaHub's official admission controls. Independent game launches, modified clients and unknown cheat signatures remain outside reliable enforcement. iPhone check-in requires a supported organizer device for scan admission.


## Battle Royale main-module completion (17 Nov 2026)

Completed lobby check-in, referee eligibility decisions, lobby evidence selection and schedule/live/result notifications through the existing application entry points. Staff readiness windows support 2 to 25 distinct squad rosters. Scheduling validates the complete current published lobby and eligible locks in a transaction. The shared lobby representation retains squad membership before player rosters are hydrated.

- TypeScript checking and the production build passed. The production artifact scan checked 57 files and found no demo accounts, emulator links or configured server-key values. Two existing dynamic-import optimization advisories remain.
- All 238 unit tests passed, including third-squad referee validation and lobby notification changes, corrections and duplicate suppression.
- All 9 combined operations rules/service tests and the full 25-squad BR integration test passed. The latter covers 100 registered players, private-safe roster hydration, complete window assignment, captain notifications, actual check-in, referee confirmation, no-shows, resolved-case team decisions and durable schedule/result notifications.
- All 9 existing admission API cases passed. The video API test passed with an added real lobby fixture, rejecting a wrong CODM mode and an ordinary user's model-review request. The model itself is simulated in this test.
- All 7 runnable desktop/mobile browser cases passed. One intentional mobile duplicate of the existing two-account evidence workflow was skipped. Both widths exercised real lobby scheduling, third-squad check-in and confirmation, BR evidence selectors, required anti-cheat admission and accessibility/layout checks. The existing head-to-head evidence decision and reporter notification workflow also passed. Results are in output/modules-v4-browser-verified/.last-run.json.

The browser regression initially exposed the missing lobby route input and server video lookup. Both now use published schedule entries. A required-field selector was also corrected. Firebase's existing Storage rules-runtime exception appears during emulator teardown after the successful script.

All mutations in this verification used disposable demo-arenahub emulator projects. Updated Firestore rules, the website and API still need deployment together. Physical anti-cheat device verification, release signing and live provider checks retain the limitations recorded above.


## Anti-cheat collector 3.1 verification (17 Nov 2026)

The Android audit found a shadowed scan-stamp parameter that could serialize cached inventory into the protocol stamp. The collector now separates observations from a typed JSON-stamp writer, with executable JVM regressions. The API also rejects a missing game certificate despite optimistic coverage flags. Windows adds normal OS-reported Dota library inspection, configurable module-name indicators, optional module fingerprints, honest truncation/failure coverage and interactive address/code entry. Staff admission notices clear when current readiness is lost.

- TypeScript checking passed. All 243 unit cases passed.
- All 20 anti-cheat API cases passed across the existing 10 monitor API cases and 10 admission API cases, including the new missing-certificate regression.
- All 6 native Windows cases passed, including the actual built executable scanning against an isolated API, interactive address/code entry and consent decline, local expiry, real loaded-module enumeration from a harmless child, a real harmless executable fingerprint and registered-software filtering. No cheat sample was downloaded or executed.
- Android JVM tests passed both JSON-wire cases with zero failures/errors. Android lint reported zero errors and 9 existing localization/resource warnings. The corrected Android sources match the build copy. APK manifest verification confirmed versionCode 4, versionName 3.1.0 and cleartext traffic disabled.
- All 18 desktop/mobile browser cases passed, with no skips, covering policy persistence/reload, restricted DLL blocking, recovery, cleared admission notices, the actual Go live gate, existing monitor workflows and privacy/access controls. Accessibility/layout assertions passed in the admission flow. The final browser record is output/anti-cheat-31-browser/.last-run.json.
- Production build passed. Its artifact scan checked 57 files and found no demo accounts, emulator links or configured server-key values. Two existing dynamic-import optimization advisories remain.
- Windows CJS/EXE and Android APK builds passed. Exact current fingerprints are in dist-agent/SHA256SUMS.txt. The Windows executable remains NotSigned and the APK uses development signing.

Physical Android validation, real-game compatibility, organization-owned release signing and public deployment remain pending. Known-indicator and normal-module inspection can be evaded by unknown/hidden cheats and modified collectors. The server gate controls ArenaHub admission while independent game launches remain possible. Firebase's existing Storage rules-runtime teardown exception appears after successful emulator scripts.
