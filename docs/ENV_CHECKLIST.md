# Environment checklist

ArenaHub runs in three places, and each reads its own settings. "Public" values end up in the browser bundle, which is expected for Firebase web config. Secret values must never use a `VITE_` prefix and must never be committed.

| Variable | Website build | API host | Event laptop | Secret | Notes |
|---|:---:|:---:|:---:|:---:|---|
| `VITE_FIREBASE_API_KEY` | required | required | required | no (public) | Without a service account, the API verifies sign-in through Google's lookup with this key |
| `VITE_FIREBASE_AUTH_DOMAIN` | required | | required | no | |
| `VITE_FIREBASE_PROJECT_ID` | required | required | required | no | The API reads Firestore of this project |
| `VITE_FIREBASE_STORAGE_BUCKET` | required | | required | no | Evidence uploads need the Blaze plan; links work without it |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | required | | required | no | |
| `VITE_FIREBASE_APP_ID` | required | | required | no | |
| `VITE_API_BASE_URL` | only with a separate API host | | | no | For example `https://arenahub-api.example.app`. Empty means the same origin |
| `GEMINI_API_KEY` | **never** | recommended | optional | **yes** | Arena AI's primary model and video review. Without any model key, Arena AI answers from the live records only and video review is off |
| `GEMINI_MODEL` | | optional | optional | no | Defaults to `gemini-3.5-flash-lite` (about 1 s on the free tier when checked on 15 Nov 2026; `gemini-3.8-flash` timed out on every request). Never shown to viewers. Re-check with `npx tsx scripts/ai-eval-live.ts` |
| `GEMINI_FALLBACK_MODEL` | | optional | optional | no | Tried when the first model fails or is silent. Defaults to `gemini-3.1-flash-lite` (18 Nov 2026: `gemini-3.6-flash`, `gemini-3.5-flash` and `gemini-flash-latest` timed out; `gemini-2.5-flash` is retired); `none` disables it |
| `AI_QUICK_MODELS` / `AI_THINK_MODELS` / `AI_DEEP_MODELS` | | optional | optional | no | Comma-separated Gemini models for each mode the viewer can pick, tried in order (Groq, when set, is the last backup). Defaults: Quick uses `GEMINI_MODEL` then the fallback; Think `gemini-3.1-flash-lite,gemini-3.5-flash-lite`; Deep `gemini-3.5-flash-lite,gemini-3.1-flash-lite`. Both lite models returned thought summaries when given a budget (18 Nov 2026) |
| `AI_THINK_BUDGET` / `AI_DEEP_BUDGET` | | optional | optional | no | Thinking tokens per model call for Think (default 2048) and Deep (default 8192). Quick does not think |
| `AI_WINDOW_TOKENS` | | optional | optional | no | Each person's allowance: model tokens per window (default 400000). Measured 18 Nov 2026: a Think answer about 9,000 tokens, Deep about 6,500, Quick about 3,700, so the default is roughly 45 Think answers. Live-records answers, refusals and reused answers are free. Over it, the live records answer until the window ends |
| `AI_WINDOW_HOURS` | | optional | optional | no | Window length in hours (default 5). It starts with a person's first model answer after the previous window ended |
| `AI_STAFF_MULTIPLIER` | | optional | optional | no | Staff allowance as a multiple of the viewer allowance (default 2) |
| `AI_FIRST_TOKEN_MS` | | optional | optional | no | A model that has written nothing after this many milliseconds is skipped for the next one (default 12000) |
| `GROQ_API_KEY` | **never** | optional | optional | **yes** | Backup model, used when Gemini fails or is over quota. Replies are labelled "Arena AI (backup model)" |
| `GROQ_MODEL` | | optional | optional | no | Defaults to `openai/gpt-oss-20b`. Free-tier availability is UNVERIFIED; check GroqCloud, Settings, Limits |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | **never** | recommended | optional | **yes** | The service account JSON itself, for hosts that take only env values. Enables token revocation checks, Firestore rate limits, `@Arena` replies in live chat and the staff `listOpenReports` tool. Without it (and without `GOOGLE_APPLICATION_CREDENTIALS`), `/api/health` reports `firebaseAccess: "rest"` |
| `AI_USER_PER_MINUTE` | | optional | optional | no | Model answers per user per minute on the Arena AI page (default 5). Over it, live records answer |
| `AI_GLOBAL_PER_MINUTE` | | optional | optional | no | Model answers per minute for one server instance (default 12) |
| `AI_BURST_PER_MINUTE` | | optional | optional | no | Requests of any kind per user per minute before a 429 (default 30) |
| `AI_CHAT_USER_INTERVAL_SEC` | | optional | optional | no | Seconds between one viewer's `@Arena` questions (default 30) |
| `AI_CHAT_MATCH_PER_MINUTE` | | optional | optional | no | Model replies per match per minute in live chat (default 6). Over it, the match record answers |
| `LIVEKIT_URL` | | for live screens | for live screens | no | LiveKit address players and staff connect to: `wss://<project>.livekit.cloud`, or `ws://<laptop Wi-Fi IP>:7880` for a self-hosted server. Without the three LiveKit values, the Monitor page says live screens are off. See docs/LIVE_SCREENS.md |
| `LIVEKIT_API_KEY` | **never** | for live screens | for live screens | no | From the LiveKit project (Settings, Keys) |
| `LIVEKIT_API_SECRET` | **never** | for live screens | for live screens | **yes** | Signs the short-lived player and staff tokens |
| `LIVEKIT_API_URL` | | optional | optional | no | Only when this server reaches LiveKit at a different address than players do |
| `GEMINI_VIDEO_MODEL` | | optional | optional | no | Vision model for video review. Defaults to `gemini-3.6-flash` (image analysis on it not yet verified) |
| `CORS_ORIGINS` | | required with a separate API host | | no | The website origins, comma-separated, https only |
| `HOST`, `PORT` | | | optional | no | `HOST=0.0.0.0` opens the laptop to the event Wi-Fi; port defaults to 3210 |
| `INTEGRITY_PUBLIC_URL` | | | player-only tunnel mode | no | Set by `npm run online`; do not combine with hosted mode |
| `INTEGRITY_HOSTED_URL` | | hosted monitor | | no | HTTPS API origin for public staff/player access. Requires persistent `npm start`, not the serverless AI entry |
| `INTEGRITY_DATA_DIR`, `INTEGRITY_DOWNLOAD_DIR` | | required for hosted monitor | optional | no | Private persistent report/recording volume and reviewed companion downloads; never expose the data directory as static files |
| `SITE_DIR` | | | demo only | no | Set by `npm run demo` |
| `VITE_FIREBASE_EMULATORS` | test builds only | | demo only | no | Only in `.env.test`; production builds refuse it |
| `ARENA_AI_PROVIDER` | | | | no | Test only: `fake` selects the scripted provider, honoured only on the `demo-arenahub` emulators. Test mode sets it automatically |
| `GOOGLE_APPLICATION_CREDENTIALS` | **never** | alternative to `FIREBASE_SERVICE_ACCOUNT_JSON` | optional; also for `npm run set-role` | **yes** | Path to a service-account key kept outside the project folder |

## Before each deployment

- [ ] `.env` has one value per variable (the plan found `GEMINI_API_KEY` declared twice; dotenv keeps the last).
- [ ] No secret has a `VITE_` prefix. `npm run build` now checks this itself: it compares the actual `GEMINI_API_KEY`, `GROQ_API_KEY` and service-account values against every file in `dist/` and fails the build if one appears (`scripts/check-production-build.mjs`).
- [ ] `CORS_ORIGINS` on the API host lists exactly the website origins, for example `https://<site>.web.app,https://<site>.firebaseapp.com`.
- [ ] `VITE_API_BASE_URL` in the website build points at the API host, or is empty when the API runs on the same origin.
- [ ] The API host's `VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_API_KEY` match the website's project.
- [ ] No service-account key is in the project folder (`git status` shows none; `.gitignore` also blocks `service-account*.json`).
- [ ] `/api/health` on the API host reports `firebaseAccess: "service-account"`. With `"rest"`, rate limits are per instance and Arena AI cannot reply in live chat.

## Public match-monitor host

The confirmed target is a public website and API. Use a persistent Node 24 process and private persistent disk for the monitor; its current SQLite/uploads/tickets support one active instance. Set `INTEGRITY_HOSTED_URL`, exact `CORS_ORIGINS`, TLS ingress and Firebase authorized sign-in domains. Verify ingress rate limits, body/concurrency limits, disk quotas, backups, service-account scope and staff revocation. Rebuild/re-pair v2 clients and distribute signed artifacts through a trusted channel. See INTEGRITY_SETUP.md for supported layouts and device verification. Local tests do not verify these external settings.
