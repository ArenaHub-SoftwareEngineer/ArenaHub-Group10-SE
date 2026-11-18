# Deploying ArenaHub

**No production deployment was performed in this review.** Updated 17 November 2026: the intended deployment is a publicly hosted website and API. For the full Match monitor, use the persistent Node deployment below; the older serverless layout is suitable only for AI/video endpoints.

## What runs where

| Part | Where | Why |
|---|---|---|
| Website | Firebase Hosting (`firebase.json`, site `arenahub-platform`) | Free Spark plan, and Google sign-in keeps working on its own auth domain |
| Database and file rules | Firebase (`firestore.rules`, `storage.rules`) | |
| API: Arena AI and video review (`/api/ai`, `/api/fair-play`, `/api/health`) | A Node host on a separate origin | Firebase Hosting rewrites can reach only Cloud Functions and Cloud Run, which need the Blaze plan (plan C4) |
| Match monitor (`/api/integrity`, `join.html`) | Persistent Node host (`npm start`) or an event laptop | Requires private persistent disk and one active monitor process; ephemeral serverless instances do not provide this module |

Without an API host, the website still works. Arena AI answers from the live records on the viewer's device, `@Arena` in live chat is unavailable, and so is video review.

## Full public deployment with the match monitor

Follow [INTEGRITY_SETUP.md](INTEGRITY_SETUP.md). A persistent Node 24 host runs `npm start`, serves `dist/` and keeps `INTEGRITY_DATA_DIR` on a private mounted volume. Use `INTEGRITY_HOSTED_URL=https://<api-host>` for public staff/player access, including behind Cloudflare. Do not set the player-only tunnel variable `INTEGRITY_PUBLIC_URL` on that host. Use one active monitor process until its SQLite, pending-upload and ticket state is migrated for replicas.

If the website stays on Firebase Hosting, set its `VITE_API_BASE_URL` to that persistent API and list the exact website origins in the API's `CORS_ORIGINS`. The monitor now honors that base for settings, sessions and media playback. Build/copy the complete site and reviewed `dist-agent/` artifacts to the API host so its player pairing URLs work. HTTPS, host secret management, private disk permissions, storage quotas, backups and ingress limits need verification on the chosen host. No hosting account or domain has been selected or provisioned by these local changes.

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
