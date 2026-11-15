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
