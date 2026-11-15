# Environment checklist

ArenaHub runs in three places, and each reads its own settings. "Public" values end up in the browser bundle, which is expected for Firebase web config. Secret values must never use a `VITE_` prefix and must never be committed.

| Variable | Website build | API host | Event laptop | Secret | Notes |
|---|:---:|:---:|:---:|:---:|---|
| `VITE_FIREBASE_API_KEY` | required | required | required | no (public) | The API uses it to verify sign-in tokens |
| `VITE_FIREBASE_AUTH_DOMAIN` | required | | required | no | |
| `VITE_FIREBASE_PROJECT_ID` | required | required | required | no | The API reads Firestore of this project |
| `VITE_FIREBASE_STORAGE_BUCKET` | required | | required | no | Evidence uploads need the Blaze plan; links work without it |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | required | | required | no | |
| `VITE_FIREBASE_APP_ID` | required | | required | no | |
| `VITE_API_BASE_URL` | only with a separate API host | | | no | For example `https://arenahub-api.example.app`. Empty means the same origin |
| `GEMINI_API_KEY` | **never** | required for Arena AI and video review | optional | **yes** | Without it, the assistant answers from the local guide and video review is off |
| `GEMINI_MODEL` | | optional | optional | no | Defaults to `gemini-flash-latest` |
| `GEMINI_VIDEO_MODEL` | | optional | optional | no | Vision model for video review |
| `CORS_ORIGINS` | | required with a separate API host | | no | The website origins, comma-separated, https only |
| `HOST`, `PORT` | | | optional | no | `HOST=0.0.0.0` opens the laptop to the event Wi-Fi; port defaults to 3210 |
| `INTEGRITY_PUBLIC_URL` | | | online mode only | no | Set by `npm run online` |
| `INTEGRITY_DATA_DIR`, `INTEGRITY_DOWNLOAD_DIR` | | | optional | no | Match monitor storage on the laptop |
| `SITE_DIR` | | | demo only | no | Set by `npm run demo` |
| `VITE_FIREBASE_EMULATORS` | test builds only | | demo only | no | Only in `.env.test`; production builds refuse it |
| `GOOGLE_APPLICATION_CREDENTIALS` | **never** | **never** | only while running `npm run set-role` | **yes** | Path to a service-account key kept outside the project folder |

## Before each deployment

- [ ] `.env` has one value per variable (the plan found `GEMINI_API_KEY` declared twice; dotenv keeps the last).
- [ ] No secret has a `VITE_` prefix. After `npm run build`, search `dist/` for the real `GEMINI_API_KEY` value; it must not appear.
- [ ] `CORS_ORIGINS` on the API host lists exactly the website origins, for example `https://<site>.web.app,https://<site>.firebaseapp.com`.
- [ ] `VITE_API_BASE_URL` in the website build points at the API host, or is empty when the API runs on the same origin.
- [ ] The API host's `VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_API_KEY` match the website's project.
- [ ] No service-account key is in the project folder (`git status` shows none; `.gitignore` also blocks `service-account*.json`).
