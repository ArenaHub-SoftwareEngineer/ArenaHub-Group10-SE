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
