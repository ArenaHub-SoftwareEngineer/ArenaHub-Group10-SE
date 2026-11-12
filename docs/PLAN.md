# ArenaHub Build Plan (Stage A)

Prepared 12 Nov 2026 for Kerr Zaragoza (Lead Dev). Status: **awaiting `APPROVED`**. No source file was changed in Stage A. The only new file is this one.

Conventions: effort **S** = under 2 hours, **M** = half a day to a day, **L** = 2 or more days. "UNVERIFIED" means I could not confirm it, and the line says what would confirm it.

---

## 1. Verified baseline (run on 12 Nov 2026, this machine)

Environment: Windows 11, Node 24.13.0, npm 11.6.2, Java 25.0.2 (the prompt asked for 21+; 25 works), firebase-tools 15.4.0 (global). Installed packages: firebase 13.1.0, typescript 7.0.2, vite 8.3.4, react 19.3.0, @google/genai 2.28.0, motion 12.43.0, tailwindcss 4.3.3, express 4.22.3. Not installed: firebase-admin, zod, playwright, @axe-core/playwright, gsap.

| Command | Result |
|---|---|
| `npm run lint` (`tsc --noEmit`) | pass, 0 errors |
| `npm test` | 56 / 56 pass |
| `npm run test:api` | 1 / 1 pass |
| `npm run test:video-api` | 1 / 1 pass |
| `vite build` (written to a scratch folder so `dist/` was not touched) | pass, 35 files, 18 MB. Warning: chunks over 500 kB: `notificationService` 580 kB (174 kB gzip) and `index` 464 kB (136 kB gzip) |
| `firebase emulators:exec --only auth,firestore,storage --project demo-arenahub --config firebase.test.json` running: | |
| `npm run test:rules` | 19 / 19 pass |
| `npm run test:storage` | 3 / 3 pass |
| `npm run test:auth` | 1 / 1 pass |
| `npm run test:auth-flow` | 1 / 1 pass |
| `npm run test:stream` | 1 / 1 pass |
| `node --test tests/operations.integration.test.mjs` | 1 / 1 pass |

The emulators logged a harmless Java `NullPointerException` from the Storage rules runtime at shutdown. It came after every suite had passed.

Secret check on the build: the six `VITE_FIREBASE_*` values are in the bundle. That is expected, because the Firebase web config is public by design and protected by rules. `GEMINI_API_KEY` is **not** in the bundle. No `.env` values were printed.

Not run (needs a real account, a real network provider or your approval): real Google OAuth, a real inbox, any production deploy, and a real Gemini or Groq response.

---

## 2. Corrections to the prompt's audit

Every item in the prompt's audit table and defect list was checked against the code. The items not listed below are confirmed as written. These are the differences and the gaps:

| # | Finding | Evidence |
|---|---|---|
| C1 | **The emulator suites did run, and they pass.** Java 25 is installed, not missing. | Section 1 |
| C2 | **There is a second single-document store, `arenahub/workspace`.** It holds games, categories, featured items and **tournaments**, and has the same 1 MiB and read-amplification problem as `arenahub/brackets`. The rules cap each list at 100 items. | `lib/firestore.ts:134-160`, `firestore.rules:169-178` |
| C3 | **Cloud Storage needs Blaze for certain, not "may".** Since 3 Feb 2026, both new and existing default buckets require the Blaze plan. Fair Play file uploads are therefore `COST: needs card`. The evidence-by-link fallback already exists. | [Firebase Storage FAQ](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024) |
| C4 | **A Firebase Hosting rewrite cannot proxy to Vercel, Render or Cloudflare.** Hosting rewrites only target Cloud Functions and Cloud Run, and both need Blaze. A free API host therefore has to be a different origin with an explicit CORS allowlist. UNVERIFIED against today's docs; confirm with Context7 on the Firebase Hosting `rewrites` reference in Phase 2. | `firebase.json` |
| C5 | **`gemini-3.8-flash` is a real model ID with a free tier.** Google's pricing page lists it as "Free of charge". The real defect: `src/lib/ai.ts:142` hard-codes the label "Gemini 3.8 Flash" no matter what `GEMINI_MODEL` is set to. | [Gemini pricing](https://aistudio.google.com/docs/pricing) |
| C6 | **The proposal documents contradict the cleanup.** `ArenaHub-What-Needs-To-Be-Changed.md` presents the `mockData.ts` offline mode, Event Pass (`EventPassModal`/`VenuePassModal`), match timeline logging and Match MVP as **implemented features for the defense**. In the code, Event Pass, `MatchTimeline` and `MVPCard` are imported nowhere. The same document's costing table makes Groq primary, Gemini secondary and Firebase RTDB part of the stack. RTDB is not used anywhere in the code. See open question Q1. | parent folder `ArenaHub-What-Needs-To-Be-Changed.md` |
| C7 | **All dead files in Defect 8 are confirmed unimported.** That includes `components/common/IntegrityCenter.tsx`; `App.tsx:45` imports `FairPlayCenter` under the alias. There are also dead **methods** in `firestoreService`: `updateUserRole` (changes memory only and writes a misleading audit entry), `sendChatMessage` and `reportChatMessage` (in-memory mock chat). | grep over `src/`, `tests/`, `server/` |
| C8 | **17 of the 21 images in `src/assets/images` (about 7 MB) are unused.** Several show retired games (LoL, Valorant) or official publisher art. The 4 still used are referenced only by `mockData.ts` and `BracketGenerationFeedbackModal.tsx`. | asset grep |
| C9 | **Emoji scan detail.** 35 hits in `mockData.ts` and 8 in `lib/ai.ts`. A naive `\p{Extended_Pictographic}` scan would also flag `©` (HomeScreen footer), `↗` (AuthEntry, SpectatorAIView), `✔` in a Toast regex and `★` in a rank-parsing regex in `playerProfiles.ts`. The test design (Phase 0) handles this. | node scan |
| C10 | **Test scripts:** `tests/operations.integration.test.mjs` is in no npm script, and `test:auth-flow` exists but is not in the prompt's list. `npm run lint` is only `tsc`; there is no ESLint. The `clean` script uses `rm -rf`, which fails in npm's default Windows shell. | `package.json` |
| C11 | **Why `dist/` holds 1,246 files (93 MB):** Vite empties an in-root `outDir` by default, yet chunks from 30 Oct to 10 Nov accumulated (64 copies of `index-*.js`). The cause is UNVERIFIED. A likely candidate is a Windows file lock from a running `vite preview` or `firebase serve`. Setting `emptyOutDir: true` explicitly plus a cross-platform clean fixes it either way. | `ls dist/assets` |
| C12 | **No Firestore persistent cache.** `getFirestore(app)` uses the memory cache, so every page reload re-reads every listened document. | `lib/firebase.ts:53` |
| C13 | **Privacy: public bracket documents carry player `name`, `department`, `program`, `yearLevel` and `bio`.** Spectators admitted by QR, who may not be students, can read these. Student IDs are correctly excluded. See Q4 (RA 10173). | `lib/playerProfiles.ts:65-73` |
| C14 | **Chat spoofing:** a user whose profile `name` is "Arena AI" passes the current chat rule. The name must be reserved in both the `users` and `matchChat` rules. | `firestore.rules:103-105` |
| C15 | `.env` declares `GEMINI_API_KEY` twice. Values were not read; dotenv keeps the last one. Which key is live is ambiguous. | `.env` key names only |
| C16 | Admins listen to the whole `users` collection, so read cost grows with every registered account. | `lib/firestore.ts:98` |
| C17 | If the cloud sync fails after an unpublish, the bracket is gone locally but still published. The failure is only `console.error`'d; nothing tells the user. | `BracketStudioView.tsx:1507-1512` |
| C18 | Team roles differ: the prompt makes Kerr Lead Dev; the October revision guide makes Kerr PM/Main Presenter. This only matters for docs and commit attribution. | revision guide section C |

---

## 3. Phase plan

Every phase ends with the same gate: `npm run lint`, `npm test`, `npm run test:api`, `npm run test:video-api`, `npm run build`, every emulator suite through `npm run test:emulators` (added in Phase 0), the emoji scan, and a Playwright pass at 375 px and 1440 px. The report gives real counts. A phase that fails its gate is fixed before the next one starts, or I stop and ask.

Rollback for every phase: each phase is a series of small commits on a branch named `phase-N-*`, merged to `main` only after its gate passes. Rolling back means `git revert` of the merge commit. Data migrations never delete the source document (see Phase 1).

### Phase 0: Baseline and safety (total: M)

| Task | Files | Effort |
|---|---|---|
| 0.1 `git init`, check that `.gitignore` covers `.env*` (it does, with `!.env.example`), and add `firebase-debug.log`, `firestore-debug.log`, `output/`, `.firebase/`, `*.local`, `service-account*.json`. Then commit the current tree as "Baseline before refactor". Check `git status` before the commit so that no `.env`, log or `dist/` file is staged. | `.gitignore` | S |
| 0.2 Delete `firebase-debug.log` and `firestore-debug.log` from the tree (gitignored afterwards). | root | S |
| 0.3 Add project `.mcp.json` with Firebase MCP (`firebase-tools` pinned to the installed 15.4.0, not `@latest`), Playwright MCP (`@playwright/mcp` pinned) and Context7 (`@upstash/context7-mcp` pinned). The `claude` CLI is not on this shell's PATH, so the config goes in the file and you approve it when the extension reloads. The Firebase MCP is used against `demo-arenahub` only. | `.mcp.json` | S |
| 0.4 Install dev tools: `playwright`, `@playwright/test`, `@axe-core/playwright`. Add the scripts `test:emulators` (one `emulators:exec` that runs all six suites, including the orphaned operations integration test), `test:e2e` and `test:all`. Replace `clean` with a Node one-liner (`fs.rmSync`) that works on Windows. | `package.json`, `tests/run-emulator-suites.mjs`, `playwright.config.ts` | S |
| 0.5 Set `build.emptyOutDir: true`, empty `dist/`, rebuild, and confirm that `dist/assets` holds only the current build. Remove the AI Studio HMR comments and `DISABLE_HMR` from `vite.config.ts`. Rename the package to `arenahub`. | `vite.config.ts`, `package.json` | S |
| 0.6 Emoji guard: `tests/no-emoji.test.ts` scans `src/`, `server/`, `scripts/` and seed fixtures. It fails on `\p{Emoji_Presentation}`, on any pictograph followed by U+FE0F, and on U+1F000 to U+1FAFF. It allows typographic symbols (`©`, `↗`, `★`, `✓`) because they are not emoji. `server/ai/sanitize.ts` (Phase 3) reuses the same function on AI output. Replace the 8 pictographs in `lib/ai.ts` and the `↗` glyphs with SVG icons. `mockData.ts` is handled in Phase 1, because it leaves the production path there. | `tests/no-emoji.test.ts`, `src/lib/emoji.ts` | S |
| 0.7 Dead code. Delete: `IntegrityCenter.tsx`, `AIAssistantModal`, `RoleSwitcherBar`, `ArenaMascot`, `EditorialIllustration`, `SchoolAdminSetupModal`, `lib/auth.ts` (mock `INITIAL_USERS`), the dead `firestoreService` methods (C7), and the 17 unused images (C8). Keep for wiring: `tournamentKnowledge.ts` (Phase 3) and `Skeleton` (Phase 4/5). **Waiting on Q1:** `EventPassModal`, `VenuePassModal`, `eventPassService`, `MatchTimeline`, `MVPCard`, `PlayerPerformanceSection`, `MatchPlayerStatsSummary`. One commit per group, each with a re-grep that proves zero imports. | listed files | S |
| 0.8 Write `docs/BASELINE.md` with the numbers from section 1 plus the post-Phase-0 run. | `docs/BASELINE.md` | S |

Acceptance: git history exists. Suite counts are 56+ / 1 / 1 / 19 / 3 / 1 / 1 / 1 / 1 plus the new emoji test. `dist/` contains exactly one build. The emoji test passes for `src/` minus `mockData.ts`, which is temporarily allowlisted until Phase 1.

### Phase 1: Data layer rebuild (total: L, the largest phase)

Depends on Phase 0.

Target model (prompt's design, with the changes marked **+**):

```
tournaments/{tId}                     title, gameId, format, matchFormat, status, revision, publishedAt, institution
tournaments/{tId}/matches/{mId}       round, bracketType, team1Ref, team2Ref, score, status, nextMatchId, schedule, stream
tournaments/{tId}/teams/{teamId}      public roster only (field list fixed by Q4)
tournaments/{tId}/revisions/{rev}   + replaces previousPublishedBrackets (restore = copy a revision back)
liveBoard/{tId}                       live match ids + scores only
liveBoard/_index                    + one small doc: which tournaments have live matches (the home page listens to this, not N docs)
colleges/{collegeId}                  name, code, logo, colors
config/catalog                      + games and categories (small, rarely changes; replaces part of arenahub/workspace)
featured/{id}                       + title, link, author, createdAt, kind (replaces featuredHighlights/featuredPosts)
matchChat/{mId}/messages/{msgId}      unchanged, plus optional isAI (server only)
chatState/{mId}                       slowModeSec, pinned, aiEnabled
chatMutes/{mId}_{uid}                 until, reason, by
chatPace/{mId}_{uid}                + lastMessageAt (slow-mode enforcement, Phase 2)
```

| Task | Files | Effort |
|---|---|---|
| 1.1 Split `lib/firestore.ts` (829 lines) by responsibility: `lib/data/tournaments.ts`, `matches.ts`, `liveBoard.ts`, `catalog.ts`, `featured.ts`, `audit.ts`, `users.ts`. Keep a thin `firestoreService` facade during the transition so the components keep compiling. | `src/lib/data/*` | L |
| 1.2 Publish, score and restore as batched writes: a score save writes the match doc, `liveBoard/{tId}`, `liveBoard/_index` (only if live state changed) and `tournaments/{tId}.revision`, in one transaction with an optimistic revision check. Keeps today's "A newer bracket was published" conflict behavior. | `lib/data/*`, `bracketPublication.ts` | L |
| 1.3 Viewer listeners: the home page listens to `liveBoard/_index`; the match center to one `liveBoard/{tId}`; the live page to one match doc and its chat; the bracket page to `tournaments/{tId}/matches` for **one** tournament. Turn on `persistentLocalCache` (C12). | `lib/firebase.ts`, views | M |
| 1.4 Migration script `scripts/migrate-brackets.mjs`. It reads `arenahub/brackets` and `arenahub/workspace` with firebase-admin and writes the new collections. It is idempotent, has a dry run, and **never deletes the source documents** (they stay as the rollback). Run against the emulator only. A round-trip test: seed the existing QA bracket from `stream.integration.test.mjs`, migrate, then rebuild a `BracketDraft` and deep-compare. | `scripts/migrate-brackets.mjs`, `tests/migration.integration.test.mjs` | M |
| 1.5 Remove `mockData.ts` from production paths. It moves to `tests/fixtures/demo-data.ts`. Add `scripts/seed-demo.mjs` ("Load demo data", emulator or explicit `--project` only). Demo records carry `demo: true` and the UI shows a DEMO badge. Teams come from published brackets and registrations only. The AI context loses mock teams and colleges. | `lib/mockData.ts`, `FeaturedView`, `GamesCategoriesView`, `lib/ai.ts`, `bracketUtils.ts`, `firestore.ts` | M |
| 1.6 `localStorage` only for per-device preferences (`arenahub_compact_layout`, `arenahub_reduced_motion`, AI chat history, bracket draft handoff). Remove the shared keys (`arenahub_matches`, `_chat`, `_tournaments`, `_categories`, `_games`, `_featured_*`, `_published_brackets`). Saved bracket drafts move to `users/{uid}/drafts/{id}`. A one-time cleanup deletes the stale keys on load. | `firestore.ts`, `main.tsx` | M |
| 1.7 Rewrite `firestore.rules` for the new paths: field allowlists, size caps, `revision` monotonic, server-time checks. Keep the old `arenahub/*` paths readable but write-locked after migration. Port all 19 + ops rules tests, then add tests for each new path (read by admitted only; write by active staff only; no private fields; `liveBoard` writes only together with a match write). | `firestore.rules`, `tests/*.rules.test.mjs` | L |
| 1.8 Write `docs/READ_BUDGET.md`. The draft numbers are in section 5 of this plan, R1. Published prices go in once confirmed. | `docs/READ_BUDGET.md` | S |

Acceptance: all rules tests pass (old ported plus new). The migration round-trip is equal. `grep -r "mockData" src/` returns nothing. Two-browser Playwright check: a score saved in browser A shows in browser B within 2 seconds. An emulator request-count check (Firestore emulator `/emulator/v1/projects/demo-arenahub:ruleCoverage`, or counting snapshot callbacks in the test) shows that one score update costs a viewer 1 or 2 reads, not a re-read of every tournament.

Rollback: revert the merge. The old `arenahub/*` documents still exist and the old client still reads them.

### Phase 2: Core module completion (total: L)

Depends on Phase 1.

| Task | Files | Effort |
|---|---|---|
| 2.1 **M1** `scripts/set-role.mjs`: grant or revoke `admin` and `role` claims with firebase-admin. Refuses to run unless `FIREBASE_AUTH_EMULATOR_HOST` is set **or** `--project <id> --confirm-production` is passed. The service-account path comes from env and is gitignored. Documented in `docs/ROLES.md`. Tested against the emulator only. | `scripts/set-role.mjs`, `tests/set-role.integration.test.mjs` | S |
| 2.2 **M2** CODM BR placement format: lobbies, placement points table (configurable), kill points, aggregate standings and tiebreakers (total placement points, then best single placement, then total kills). New `lib/formats/placement.ts` with unit tests. Remove the "uses placement scoring" refusal. Swiss is optional and stays out unless you ask. | `lib/formats/placement.ts`, `tournamentFormats.ts`, standings | M |
| 2.3 **M2** Split `BracketStudioView.tsx` (2,175 lines) into `BracketSetup`, `BracketCanvasEditor`, `BracketPublishPanel` and `BracketAIDraft`. This is a pure refactor commit first; behavior changes come in later commits. Also fix C17: show a toast with retry when the unpublish sync fails. | `components/admin/bracket-studio/*` | L |
| 2.4 **M6** Chat moderation. Timed mute with presets of 5/10/20/60 min (default 20) and kick (= mute until the match ends, plus message removal). Rules: `create` on messages is denied while `chatMutes/{mId}_{uid}.until > request.time`. Slow mode: a `chatPace` doc is written in the same batch; the rule requires `request.time > lastMessageAt + duration.value(slowModeSec, 's')`. Also: pinned message, staff badge (stored as `badge` and checked in rules against the token role), visible timestamps, and an `auditEvents` write for every action. Reserve "Arena AI" (C14). | `lib/matchChat.ts`, `LiveMatchView.tsx`, rules, tests | L |
| 2.5 **M8** The Teams directory shows only real teams, with game-specific empty states ("No teams registered for Dota 2 yet"). `directoryTeams` stops merging samples. College stats are computed from completed matches through `lib/standings.ts`. | `playerProfiles.ts`, `TeamsView.tsx`, `standings.ts` | M |
| 2.6 **M13** Featured items need real fields (title, link, author, createdAt). Delete the fake "2.1k views" and "312 reactions". | `FeaturedView.tsx`, `lib/data/featured.ts` | S |
| 2.7 **M14** Theming: add `logo`, `primary`, `primaryInk`, `accent` to `institution.config.json`. `sync-institution.mjs` writes `src/generated/institution.css` (CSS custom properties) and checks WCAG AA contrast (4.5:1 for text pairs, 3:1 for UI accents). The build fails if a pair does not pass. Unit test with a failing palette. | `institution.config.json`, `scripts/sync-institution.mjs`, `tests/institution-config.test.mjs` | M |
| 2.8 **M15** Deployment readiness: an API host adapter (see section 4), `docs/DEPLOY.md`, `docs/ENV_CHECKLIST.md`, `scripts/smoke.mjs` (hits `/api/health`, checks CORS, checks that the API refuses unauthenticated calls). **No deploy** without your typed approval (Rule 5). | `server/*`, `api/*`, docs | M |

Acceptance: unit, rules and integration tests for each item. Playwright mute flow on the emulator: staff mutes student B for 1 minute (a test-only preset), B's send is rejected with a countdown, and after expiry B's send succeeds. Rules tests prove that the mute and slow mode hold even when the UI is bypassed.

### Phase 3: Arena AI rebuild (total: L)

Depends on Phase 1 (tools read the new collections) and Phase 2.8 (host).

| Task | Files | Effort |
|---|---|---|
| 3.1 Install `firebase-admin` and `zod`. Replace the identitytoolkit REST lookup with `verifyIdToken(token, true)` plus an `active` status check through admin Firestore. Apply the same change to `server/fairPlay.ts`. | `server/auth.ts` | S |
| 3.2 `server/ai/`: `provider.ts` (interface: `stream(messages, tools, signal)`), `gemini.ts`, `groq.ts` (OpenAI-compatible), `tools.ts`, `prompt.ts`, `guard.ts`, `cache.ts`, `sanitize.ts`. Read Context7 docs for `@google/genai` function calling and streaming before writing them. | `server/ai/*` | L |
| 3.3 Read-only tools backed by admin queries: `listTournaments`, `getBracket`, `getMatch`, `getLiveMatches`, `getSchedule`, `getStandings`, `getTeam`, `explainFormat`, `getPlatformHelp`, `getRules`. Staff-only tools (`listOpenReports`, `summarizeCase`) are registered only when the token claims allow them. Each tool returns already-scrubbed public fields plus `references`. | `server/ai/tools.ts` | M |
| 3.4 Pipeline: guard, then cache (key = normalized question + data revision), then the deterministic fast path (`tournamentKnowledge.answerTournamentQuestion` when `needsModel` is false), then the LLM with tools, then the Groq fallback, then a deterministic help answer. The response carries `source`: "Live records", "Arena AI" or "Arena AI (backup model)". The model name is never hard-coded (C5). | `server/ai/index.ts` | M |
| 3.5 Real SSE streaming with stop (AbortController) and retry. The client replaces the fake `streamAnswer` and keeps the existing history and retention features. Measure time to first token in the e2e test. | `lib/ai.ts`, `SpectatorAIView.tsx` | M |
| 3.6 Durable rate limit: a Firestore doc `aiRate/{uid}_{yyyymmddhhmm}` incremented in a transaction (1 read + 1 write per request), in-memory only when `NODE_ENV=development`. Limits are set in config, not the code. | `server/ai/guard.ts` | S |
| 3.7 Bracket from a prompt: the model returns JSON validated by zod (`{title, game, format, matchFormat, finalMatchFormat, teams[], seeding, constraints[]}`). When the game or the teams are missing, the response is a clarifying question; there is no silent MLBB default. The organizer sees and confirms the parsed parameters before `createBracketFromTeams` builds the graph. The regex parser remains the offline fallback, also without a silent default. | `server/ai/bracketDraft.ts`, `BracketAIDraft.tsx` | M |
| 3.8 AI in live chat: an `@Arena` prefix or an "Ask Arena AI" tab. The server posts the reply through firebase-admin with `isAI: true` and author "Arena AI". Rules deny client writes with either. Context is only this match. Replies are at most 280 characters. Limits: 1 request per user per 30 s, about 6 per match per minute, a shared cache keyed by match revision; over budget, the deterministic engine answers. `chatState.aiEnabled` toggle for staff. The optional recap on completion is included only if the free quota allows. | `server/ai/chat.ts`, rules, `LiveMatchView` | L |
| 3.9 `tests/ai-eval.test.ts`: 40+ scripted cases against a mocked provider and a fixture database. Asserts grounding (every team or score in a reply exists in the fixture), refusals, no private fields, no emoji, no markdown tables, and that injection prompts do not change scope. A manual run against the real free provider happens once, and the result is recorded in `docs/BASELINE.md`. | `tests/ai-eval.test.ts`, `tests/fixtures/ai/*` | M |

Acceptance: the eval passes. Time to first token is measured (number reported). Playwright: viewer A asks `@Arena what's the score`, and viewer B sees the reply with the AI badge. The bundle check searches `dist/` for the **actual** `GEMINI_API_KEY` and `GROQ_API_KEY` values, not just the `AIza` prefix, which also matches the public Firebase key. Result: absent.

Privacy note: Google's pricing page says free-tier prompts **are used to improve Google products**. The tool layer must therefore send only public tournament data, never names beyond the public roster (Q4), emails, IDs or case details. The staff tools in 3.3 are the exception, and Q5 asks whether to allow them on the free tier at all.

### Phase 4: Hardening and QA (total: M)

| Task | Effort |
|---|---|
| 4.1 axe scan of every route through Playwright: zero serious or critical issues. | M |
| 4.2 E2E flows on the emulators: sign-in gate, organizer create, publish and score, QR spectator admission, live match with chat, mute, AI in chat, fair-play submission (link evidence, plus file evidence on the Storage emulator), notifications. | M |
| 4.3 Every network call gets a shared error helper: offline, `permission-denied`, `resource-exhausted` (quota), timeout. Each shows a human message and a retry. Unit tests per mapping. | M |
| 4.4 Code-split: Firebase SDK into its own chunk, admin routes lazy, the QR reader (`jsQR`, 130 kB) only on the admission route. Target: no chunk over 500 kB. | S |
| 4.5 Update `docs/BASELINE.md`. | S |

### Phase 5: UI/UX redesign (total: L; starts only after Phases 0 to 4 pass)

The scope is as written in the prompt: a Kaggle-inspired editorial system, rail navigation, Ctrl+K search, tournament tabs, a YouTube-style live page, and motion with reduced-motion support. Additions:

- The `frontend-design` and `webapp-testing` skills are **not installed** in this session (UNVERIFIED whether they are available through the Anthropic skills plugin marketplace). I check at the start of Phase 5. If they are not available, I follow the same spec without them.
- `index.css` (1,008 lines, 76 KB) and `dashboard.css` (47 KB) are split into token, layout and component layers during the redesign, not before. Splitting them earlier creates churn the redesign would throw away.
- Fonts: Google Sans Flex (OFL, confirmed in `google/fonts/ofl/googlesansflex`) for UI text and Jost (OFL) for display. Self-hosted subset woff2 in `public/fonts`, with Inter as the fallback.
- No publisher art (C8). The hero and the game tints are original SVG.

Acceptance (as in the prompt): screenshots at 375, 768 and 1440 px in light and dark in `output/redesign/`, zero serious or critical axe issues, Lighthouse mobile performance 85 or higher on Home and Live, the emoji scan clean, and every earlier suite passing.

---

## 4. Free-tool choices (checked 12 Nov 2026)

| Need | Choice | Why | Source |
|---|---|---|---|
| Primary LLM | Gemini API free tier. Model from `GEMINI_MODEL`; proposed default `gemini-3.5-flash-lite` for chat (cheapest, free), with `gemini-3.8-flash` as the option. | Both are listed "Free of charge". **Quota UNVERIFIED:** the rate-limits page lists free RPM/RPD for only one model and points to AI Studio. Confirm with AI Studio, Rate limits, under your key. `gemini-2.5-flash` is deprecated and reroutes on 1 Dec 2026; do not use it. | [pricing](https://aistudio.google.com/docs/pricing), [rate limits](https://aistudio.google.com/docs/rate-limits) |
| Fallback LLM | Groq free tier, OpenAI-compatible, model from `GROQ_MODEL`. | No card needed. **Limits UNVERIFIED:** Groq's public page shows only the Developer plan. Third-party reports (Sep to Oct 2026) say Llama left the free tier and that `gpt-oss-120b` / `gpt-oss-20b` get about 30 RPM and 1,000 RPD. Confirm in the GroqCloud console, Settings, Limits. Note: the proposal's costing table (Llama 3.3 70B, 14,400 RPD) is probably out of date. | [Groq rate limits](https://console.groq.com/docs/rate-limits), [secondary report](https://klymentiev.com/blog/groq-pricing) |
| API host | **Vercel Hobby** for `/api/*`, with the frontend staying on Firebase Hosting (Spark) and an explicit CORS allowlist. | Free with no card. 300 s max function duration is enough for SSE. 1M invocations per month. It is non-commercial only, which fits a school project. The API uses Bearer ID tokens, not cookies, so cross-origin requests carry no CSRF risk. The frontend stays on Firebase so the Google `signInWithRedirect` fallback (`authContext.tsx:328`) keeps working on its own `authDomain`. Rejected: Cloudflare Workers (10 ms CPU, and firebase-admin needs Node), Render free (cold starts after idle, bad during a live match), Firebase Functions (Blaze). | [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Rate-limit store | Firestore via firebase-admin | No extra service. Costs 1 read + 1 write per AI request, which counts against Spark (see R1). | |
| Fonts | Google Sans Flex + Jost, self-hosted | Both OFL. | [google/fonts ofl/googlesansflex](https://github.com/google/fonts/tree/main/ofl/googlesansflex) |
| MCP | Firebase MCP, Playwright MCP, Context7 | Free and open source. Pinned versions. | |
| Libraries | firebase-admin, zod, playwright, @axe-core/playwright. GSAP only if Phase 5 needs a timeline. | All free. | |

---

## 5. Risks and open questions for Kerr

**R1, scale versus Spark (decision needed before the finals).** Spark allows 50,000 reads, 20,000 writes and 20,000 deletes per day ([Firebase pricing](https://firebase.google.com/pricing)). A live chat costs 1 read per viewer for every message, whatever the data model. A 2-hour final with 2,000 viewers, 100 score updates and 1,000 chat messages costs about 2,000 x (1 initial + 100 + 1,000 + 60 initial chat) = **about 2.3 M reads**. That is 46 times the Spark day. Phase 1 cuts the score side to 1 or 2 reads per update, but chat dominates and cannot be designed away on Firestore. Firebase RTDB on Spark caps at 100 simultaneous connections, so it does not help either. Spark fits the defense demo and small events (under about 40 viewers chatting actively).
Blaze cost for that final: 2.3 M reads at **$0.03 to $0.06 per 100k** = **about $0.70 to $1.40**, plus negligible writes. The price is UNVERIFIED: the official table did not load, and secondary sources disagree on $0.03 (single region) versus $0.06 (multi-region). Confirm on [cloud.google.com/firestore/pricing](https://cloud.google.com/firestore/pricing) for your database's location.

**Q1. Defense features versus cleanup.** Your revision guide presents offline mock mode, Event Pass, match timeline and Match MVP as implemented, but in the code Event Pass, MatchTimeline and MVPCard are not wired in. Options: (a) wire Event Pass, Timeline and MVP into the new data model (adds about M to Phase 2) and replace offline mock mode with "emulators + `seed-demo`", which also runs without internet; or (b) delete them and update the defense document. **My recommendation:** (a) for Timeline and MVP, which are cheap to wire, and delete Event Pass, because spectator QR admission already covers it.

**Q2. Blaze for finals week?** It means a card, but the read cost estimate is about $1 to $2 per final (UNVERIFIED price). It also re-enables Storage uploads for Fair Play (C3). Set a budget alert; note that alerts do not cap spending. If not: keep chat for campus students only during finals and point other viewers to the YouTube or Facebook native chat.

**Q3. API host:** approve Vercel Hobby + CORS allowlist, with the frontend staying on Firebase Hosting?

**Q4. Public roster fields (RA 10173).** Today, admitted QR spectators can read player real `name`, `department`, `program`, `yearLevel` and `bio`. Keep only `ign`, `role`, `rank` and `collegeCode` public, and show real names only to signed-in students?

**Q5. Staff AI tools on the free Gemini tier.** Free-tier prompts may be used by Google. Allow `summarizeCase` (integrity case details) on the free tier, or limit it to Groq, or drop it?

**Q6. Which `GEMINI_API_KEY` is live?** `.env` defines it twice (C15). Please remove the duplicate yourself; I will not open `.env`.

**Q7. Emoji rule detail.** OK to allow typographic symbols (`©`, `★`, `✓`) and to block only emoji-presentation characters? I will still replace the UI arrows with SVG icons.

---

Reply **`APPROVED`** or **`APPROVED with changes: ...`**, including answers to Q1 to Q7 where you have them. Unanswered questions take the recommended option, and Rule 5 (no production changes) stays in force regardless.
