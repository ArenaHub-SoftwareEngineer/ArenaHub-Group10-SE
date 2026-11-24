# Deploying ArenaHub

## Deployment log

| Date | What | Commit | By |
|---|---|---|---|
| 20 Nov 2026 | Firestore rules (first deploy from this repository) and the website to Firebase Hosting site `arenahub-platform` (https://arenahub-platform.web.app), project `wmsu-arl-hub` | `02eb76d` | Kerr's typed approval; checked first with lint, 294 unit, API, video, integrity, pre-match and 40 rules tests, and the build |
| 20 Nov 2026 | Redeploy of rules (adds anonymous chat names) and the website (redesign, viewer counts, sharing, app icons, anti-cheat practice scan) | `2ad0e55` | Kerr's typed approval; checked with lint, 308 unit, API, integrity, pre-match and 41 rules tests, and the build; live page opened on phone and desktop with no browser errors |

Not yet done: storage rules (Blaze only), an API host (step 3), staff claims (step 6), the TTL policies below, and migrating any data left in the old single-document store (`scripts/migrate-brackets.ts`, dry run first). Until there is an API host, Arena AI on the live site answers from the live records on the viewer's device, and video review, `@Arena` in chat and the Match monitor are unavailable there. Until staff claims are granted, nobody can publish or manage tournaments on the live site.

Roll back: website from Firebase Console → Hosting → Release history; rules from Firebase Console → Firestore → Rules (history), or by deploying an earlier `firestore.rules`.

Updated 17 November 2026: the intended deployment is a publicly hosted website and API. For the full Match monitor, use the persistent Node deployment below; the older serverless layout is suitable only for AI/video endpoints.

## What runs where

| Part | Where | Why |
|---|---|---|
| Website | Firebase Hosting (`firebase.json`, site `arenahub-platform`) | Free Spark plan, and Google sign-in keeps working on its own auth domain |
| Database and file rules | Firebase (`firestore.rules`, `storage.rules`) | |
| API: Arena AI and video review (`/api/ai`, `/api/fair-play`, `/api/health`) | A Node host on a separate origin | Firebase Hosting rewrites can reach only Cloud Functions and Cloud Run, which need the Blaze plan (plan C4) |
| Match monitor (`/api/integrity`, `join.html`) | Event laptop (SQLite, recordings), or Vercel with `INTEGRITY_STORE=firestore` (no recordings) | See "Hosted match monitor on Vercel" below |

Without an API host, the website still works. Arena AI answers from the live records on the viewer's device, `@Arena` in live chat is unavailable, and so is video review.

## Full public deployment with the match monitor

Follow [INTEGRITY_SETUP.md](INTEGRITY_SETUP.md). A persistent Node 24 host runs `npm start`, serves `dist/` and keeps `INTEGRITY_DATA_DIR` on a private mounted volume. Use `INTEGRITY_HOSTED_URL=https://<api-host>` for public staff/player access, including behind Cloudflare. Do not set the player-only tunnel variable `INTEGRITY_PUBLIC_URL` on that host. Use one active monitor process until its SQLite, pending-upload and ticket state is migrated for replicas.

If the website stays on Firebase Hosting, set its `VITE_API_BASE_URL` to that persistent API and list the exact website origins in the API's `CORS_ORIGINS`. The monitor now honors that base for settings, sessions and media playback. Build/copy the complete site and reviewed `dist-agent/` artifacts to the API host so its player pairing URLs work. HTTPS, host secret management, private disk permissions, storage quotas, backups and ingress limits need verification on the chosen host. No hosting account or domain has been selected or provisioned by these local changes.

## Hosted match monitor on Vercel (room codes)

Decided 23 Nov 2026: players join from one fixed address, with no event laptop. The website stays on Firebase Hosting. The API, the match monitor and the join page run on Vercel (`vercel.json`, `api/index.ts`), and the monitor keeps its data in Firestore (`server/firestoreIntegrityStore.ts`). **None of this has been deployed yet.** It has been tested locally against the Firestore emulator (`tests/firestore-monitor.integration.test.ts`, plus `tests/room-codes.test.ts` for the room flow).

How players join:
1. Staff open **Anti-cheat → Room code** and choose a match (or Scrim). The panel shows a 6-character code that changes every 5 minutes. The previous code keeps working for 1 more minute. Only signed-in staff can see it. Players are never shown the code; **Show on screen** puts it up large for a projector.
2. Players type the Vercel address (for example `arenahub-scan.vercel.app`), type the code, check their device, and register: their name from the roster (or "I am not on the list"), email and college.
3. The server issues an ordinary single-use pairing code, and the existing Android app, PC agent and iPhone check-in take over unchanged.
4. **Scanned players** under the code lists every roster player: Passed (with the time it first passed, kept as proof), Flagged, Waiting, Not reporting, Declined, or Not registered. It flags an email that does not match the staff-only roster email (only a hash of that email is stored), the same email used by two players, typed names that are not on the roster, and staff resets of a player.

Each roster player can join once. Staff **Reset** ends that session and lets them join again, and the reset stays on record.

Differences from the event laptop:
- No screen recordings or uploads, because the server has no disk. Recording is switched off for every code; the referee records from the observer slot instead.
- Devices report every 30 s instead of 15 s, and are marked "not reporting" after 100 s. Dota live data is stored at most every 30 s per player.
- Firestore free-plan budget (50,000 reads and 20,000 writes a day): each device costs about 120 writes an hour, so 20 devices for 3 hours is about 7,200 writes. The staff list re-reads only sessions that changed.

Setup (Kerr does each step; nothing here has been run):
1. Firebase Console → Project settings → Service accounts → Generate new private key. Keep the file out of git.
2. Upload `dist-agent/arenahub-agent.exe` and `dist-agent/arenahub-companion.apk` to a public HTTPS folder, for example a GitHub release of the public repo. The API streams them under its own `/api/integrity/downloads/` address, so the PC agent still knows which server it came from and the `arenahub-scan-<CODE>.exe` name still works.
3. Import the repository into Vercel (Hobby), keeping the `vercel.json` settings. `.vercelignore` keeps the upload under the 100 MB Hobby limit.
4. Vercel environment variables:
   - `INTEGRITY_STORE=firestore`
   - `FIREBASE_SERVICE_ACCOUNT_JSON` = the whole key file
   - `VITE_FIREBASE_PROJECT_ID=wmsu-arl-hub`, plus `VITE_FIREBASE_API_KEY`
   - `INTEGRITY_HOSTED_URL=https://<your-project>.vercel.app`
   - `INTEGRITY_DOWNLOAD_BASE=https://github.com/<owner>/<repo>/releases/download/<tag>`
   - `CORS_ORIGINS=https://arenahub-platform.web.app`
   - Optional AI keys: `GEMINI_API_KEY`, `GROQ_API_KEY`
5. Website: set `VITE_API_BASE_URL=https://<your-project>.vercel.app`, rebuild, and deploy hosting. Continue with Google keeps working because sign-in stays on the Firebase website.
6. Check: `https://<your-project>.vercel.app/` shows "Type the room code", and `/api/health` reports `firebaseAccess: "service-account"`. Open a room and join it from a phone on mobile data.

Still unverified on real Vercel: streaming the 90 MB agent through the function (Vercel allows streamed responses beyond 4.5 MB, up to the 300 s function limit), and cold-start time.

## 1. Check before deploying

```powershell
npm run test:all
```

This runs lint, unit, API and video-API tests, the build, and every emulator suite. Then work through [ENV_CHECKLIST.md](ENV_CHECKLIST.md).

## 2. Security rules

```powershell
firebase deploy --only firestore:rules --project <project-id>
firebase deploy --only storage --project <project-id>    # Blaze plan only (plan C3)
```

Rules have never been deployed. The rules tests (`npm run test:emulators`) are the only proof of what they allow. Roll back by deploying the previous `firestore.rules` from git.

## 3. API host

The server is one Express app, `createApp()` in `server/app.ts`. `api/index.ts` exports it without the website or the match monitor, as a request handler that any Node serverless platform can run.

Plan recommendation: Vercel Hobby (free, non-commercial). **The steps below are not yet verified on Vercel**; confirm them with a preview deployment and the smoke test before using production:

1. Import the repository as a new project with the framework preset "Other" and no build command, so no website is published there.
2. Route every `/api/*` path to the `api/index.ts` function. On Vercel this is a rewrite from `/api/(.*)` to `/api` in `vercel.json`. The repository deliberately ships no `vercel.json` until that is verified, because a wrong output directory would publish source files.
3. Set the API-host variables from [ENV_CHECKLIST.md](ENV_CHECKLIST.md): the Firebase project id and web API key, `GEMINI_API_KEY` (and optionally `GROQ_API_KEY`), `CORS_ORIGINS`, and a service account in `FIREBASE_SERVICE_ACCOUNT_JSON`.

Why the service account matters: with it, the API checks sign-in tokens with `verifyIdToken(token, true)` (revoked sessions are refused), keeps Arena AI's per-user limits in Firestore (`aiRate/*`, one read and one write per model answer), and can post `@Arena` replies in live chat. Without it, the API still works: it verifies tokens through Google's lookup, keeps limits in memory per instance, and `@Arena` in chat answers 503. Use a dedicated service account, not a personal key.

Add a Firestore TTL policy on the `aiRate` collection group, field `expiresAt` (Firebase Console, Firestore, TTL), so old counters are deleted automatically. Each counter expires an hour after its minute ends.

The per-person Arena AI allowance (tokens per 5-hour window, `AI_WINDOW_TOKENS`) is kept in `aiUsage/{uid}` with the service account: one read before and one transaction after each model answer, plus one read when the Arena AI page opens. Add the same TTL policy on `aiUsage`, field `expiresAt` (a day after the window ends). Without the service account the allowance is held in memory: it resets when the API restarts and is not shared between instances, so a serverless host without it does not enforce a reliable limit.

The case-summary route now uses a scrubbed case digest with its configured provider/fallback. Validate provider configuration and data handling on the selected host; automated tests do not establish a live account's availability.

## 4. Website

```powershell
# .env: set VITE_API_BASE_URL to the API host from step 3 (or leave it empty for a same-origin API)
npm run build
firebase deploy --only hosting --project <project-id>
```

Roll back from Firebase Console → Hosting → Release history.

## 5. Smoke test

```powershell
npm run smoke -- https://<api-host> --origin https://<site>.web.app
```

The smoke test checks that `/api/health` answers, that the website origin passes CORS and an unrelated one does not, and that the assistant and video review refuse calls without sign-in. It is read-only and never calls a model. Then, by hand: sign in with a school account, open a published bracket and a live match, post in chat, and ask Arena AI a question.

## 6. Staff accounts

Grant organizer, moderator and school-admin access with `npm run set-role` ([ROLES.md](ROLES.md)).
