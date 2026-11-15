# Deploying ArenaHub

**Nothing in this guide has been run against a real project.** Production deploys need Kerr's typed approval (plan Rule 5). The API host choice (plan question Q3) is still open; this guide uses the plan's recommendation.

## What runs where

| Part | Where | Why |
|---|---|---|
| Website | Firebase Hosting (`firebase.json`, site `arenahub-platform`) | Free Spark plan, and Google sign-in keeps working on its own auth domain |
| Database and file rules | Firebase (`firestore.rules`, `storage.rules`) | |
| API: Arena AI and video review (`/api/ai`, `/api/fair-play`, `/api/health`) | A Node host on a separate origin | Firebase Hosting rewrites can reach only Cloud Functions and Cloud Run, which need the Blaze plan (plan C4) |
| Match monitor (`/api/integrity`, `join.html`) | The event laptop (`npm start`, `npm run online`) | Recordings and sessions stay on local disk by design |

Without an API host, the website still works. Arena AI answers from the live records on the viewer's device, `@Arena` in live chat is unavailable, and so is video review.

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

Still open: plan question Q5 (staff AI tools on the free Gemini tier). Until it is answered, `summarizeCase` does not exist and `listOpenReports` returns case ids, status, match and evidence count only.

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
