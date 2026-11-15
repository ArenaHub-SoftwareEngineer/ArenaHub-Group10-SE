# ArenaHub

Campus esports arena with the supplied ArenaHub shield logo, an orange (#FF6600) and graphite design system, accessible animated settings dialogs, game artwork, brackets, match views, roster checks, and private match-integrity reports.

## Run

Use Node.js 22 or newer.

```powershell
npm install
npm run dev
```

For a built version with the secure AI endpoint:

```powershell
npm run build
npm start
```

The production server listens on `http://localhost:3210`. The Vite development server includes the same AI endpoint. Static Firebase hosting alone does not run the Node API; it falls back to the local arena guide unless an API server is separately configured. See [docs/DEPLOY.md](docs/DEPLOY.md), [docs/ENV_CHECKLIST.md](docs/ENV_CHECKLIST.md) and, for staff access, [docs/ROLES.md](docs/ROLES.md).

## Configuration

Copy `.env.example` to `.env` and set this project's Firebase web configuration. Set `GEMINI_API_KEY` for the online assistant. Provider keys must never use a `VITE_` prefix, because that makes them visible to browsers. `GEMINI_MODEL` can override the server's default `gemini-flash-latest` model.

Email verification uses Firebase's real verification links. Staff access comes from trusted Firebase custom claims (`admin: true`, or an authorized `role` claim), never email text or profile labels. Registered account status changes are restricted to project administrators. Users receive profile status updates during their session.

### School name, domain and colours

`institution.config.json` holds the school's name, short name, email domain, colleges and `theme`:

| Field | Used for | Contrast rule (WCAG AA) |
|---|---|---|
| `primary` | primary buttons, active navigation, highlights | 3:1 against every dark surface |
| `accent` | hover state of primary buttons | `onPrimary` must read on it at 4.5:1 |
| `primaryInk` | text, links and focus rings in the school colour | 4.5:1 against every dark surface |
| `onPrimary` | text on `primary` and `accent` fills | 4.5:1 |
| `logo` | small logo in the school chip, a file in `public/` such as `/school-logo.svg`, or `""` | |

`npm run configure:institution` (also run by `npm run dev` and `npm run build`) writes the email rules into `firestore.rules` and `storage.rules` and the colours into `src/generated/institution.css`. It stops with the failing colour pairs and their ratios when a palette does not pass. Dark school colours, such as a deep maroon, usually need a lighter `primaryInk` for text.

## Data and module boundaries

- Signed-out visitors can see the welcome page. The event workspace requires a verified campus account or spectator admission.
- Official published brackets use the existing Firebase bracket document. Single elimination supports 2–256 teams and automatic byes. Double elimination includes upper/lower paths, corrections and a conditional reset final. Round robin supports 2–32 teams with one meeting per pair. Publication still enforces the existing database document size limit.
- Verified active accounts submit integrity reports to `integrityCases`. Evidence and reporter identity cannot be edited after submission. Reports are private to the reporter and trusted tournament staff.
- Report creation and per-account cooldowns are enforced atomically by database rules, not only browser checks. Staff must record a review note. Closed cases cannot be reopened or edited by the client.
- Roster checks identify missing registration verification, missing identifiers, duplicates within a game, and college mismatches. These checks use loaded records and are not proof of cheating.
- ArenaHub does not inspect game clients, device processes, or game memory. Publisher anti-cheat remains responsible for in-game detection. Reports require human review and never trigger automatic sanctions.
- Game/category settings and spotlight configuration use a shared transaction-backed workspace. Published match statistics save to the bracket document. Match chat reports now use a private shared moderation queue. Legacy sample chat and unpublished bracket drafts remain local; private moderation and activity records are no longer written to the global browser cache.
- Profile name and campus edits save to the account document. Email changes require Firebase verification of the new address; the profile mirrors the authenticated email on the next sign-in. Password resets use Firebase email links. Account roles remain controlled by trusted claims.
- Display preferences (motion and spacing) save in this browser. Settings, game editing, bracket setup, and confirmation dialogs support keyboard focus containment and Escape/cancel behavior. Match and tournament selections are encoded in navigation links so reload and browser history preserve the selected record.
- Venue/event passes are an existing local demonstration, not server-backed admission credentials. A shared, revocable admission service remains future work.
- The online assistant validates Firebase identity and account status on the server, applies a request limit, and keeps provider credentials out of client assets. Public/offline queries use a labeled local guide based on loaded records. Bracket prompt parsing uses the local rules engine.

## Arena AI history and visual system

Arena AI has one general chat interface for viewer and organizer workspaces. There are no separate Matches/Reports chat modes. Recent prior turns are sent to the authenticated provider for follow-up questions; the offline guide identifies its limited local source.

- The default is **delete after 30 days without a new message**. Each conversation's clock uses the most recent message sent or received. Reading, opening, and renaming do not reset it.
- Cleanup runs on opening Arena AI, returning to the tab, and every minute while it is visible. Closed browsers do not run background cleanup; expired chats are removed on reopening.
- History settings also offer 90 days, 180 days, or Keep until I delete. Shortening retention previews how many chats will be removed before applying it.
- Conversations and the chosen policy persist per account in this browser, shared between viewer and organizer interfaces. They do **not** sync across devices. Signing out keeps them; clearing browser site data or private browsing can remove them.
- Manual per-chat/all-chat deletion requires confirmation. Search, rename, JSON download, retry, and stop controls are included. Retry replaces the last assistant reply without duplicating the user's message.
- Older viewer/organizer histories migrate into one store. Migration commits the new copy before removing old keys. Storage failures are visible; quota pressure never silently evicts older chats. Unreadable originals remain untouched and can be included in an export before explicitly resetting all history.
- Model context is bounded separately from saved history. Long conversations remain saved even when only recent messages fit the request. ArenaHub retention applies to the browser copy; the configured online provider has its own data policy.

Navigation and controls use original monochrome ink-style SVG icons, with a restrained notebook illustration and the supplied orange shield. [Flaticon](https://www.flaticon.com/free-icons/web) and [Overflow](https://www.overflow.design/) were visual references; no third-party icon pack assets were copied. Feedback uses small graphite notices and shared animated native dialogs, including publishing and broadcast success. Dialogs contain keyboard focus, support Escape/cancel, and respect reduced-motion preferences.

## Checks

```powershell
npm run lint
npm test
npm run test:api
npm run build
```

`lint` is the existing TypeScript check. `test:api` opens an ephemeral loopback listener and never calls a provider.

Database rules tests use Firebase CLI and Java 21+:

```powershell
firebase emulators:exec --only firestore --project demo-arenahub --config firebase.test.json "npm run test:rules"
```

For disposable organizer browser checks, run both emulators, seed them, and start the test preview in separate terminals:

```powershell
firebase emulators:start --only 'auth,firestore' --project demo-arenahub --config firebase.test.json
node tests/seed-emulators.mjs
npm run dev -- --mode test --port 5176
```

Click Connect with Google at http://localhost:5176 and select the mock account organizer@wmsu.edu.ph (Admin) or student@wmsu.edu.ph (User with spectator QR access). No password is required. These accounts exist only in the local emulator, restricted to development builds with the demo-arenahub project ID. The test mode disables the online AI provider.

## Verified on November 1, 2026

- TypeScript check and production build passed. Vite reports the existing large main-bundle advisory.
- 10 core tests passed: stream URL safety, profile/email validation, scores, evidence validation, roster checks, arbitrary single-elimination brackets/byes, corrected-winner propagation, CSV import, and schedule export escaping.
- 11 Firestore rules tests passed: evidence creation/privacy, query scope, inactive/unverified accounts, forged submissions, rate limits, privilege escalation, evidence immutability, token-backed verification, profile ownership/verified email changes, and bracket publishing permissions.
- 1 authentication integration test passed against disposable Auth + Firestore emulators: weak-password rejection, registration, email verification, profile persistence, wrong-password rejection, password reset, verified email change, and signed-out access denial.
- 10 additional chat-history regression tests passed: legacy migration, exact inactivity boundary, keep-until-delete, storage failure preservation, unreadable data protection, explicit deletion, account isolation, interrupted replies, bounded model context without truncating saved history, and committed expiry.
- 1 API test passed: missing configuration, authentication, cross-origin rejection, malformed requests, and role/size/count validation for conversation context.
- The editorial refresh was checked on desktop and phone layouts, including search, rename, reload, export, retry without duplicate prompts, viewer/organizer history continuity, account isolation, retention selection and reload, canceling deletion, mobile navigation, and publishing the disposable test bracket against local emulators.
- Browser checks at desktop and mobile sizes covered navigation and settings access, invalid/valid sign-in, personal-email registration/affiliation, unverified-account gating, signed-out password recovery, sign-out, persisted profile edits, motion/spacing save/reload, native dialog focus and close behavior, game add/edit/remove with preset artwork, 13-team bracket save/publish and spectator visibility, unsafe/valid broadcast links, per-game stat entry and summaries, generated-team stat isolation, local chat save/reload, moderation, self-restriction protection, disposable account suspension/restoration, spotlight persistence/display, local assistant answers/history, schedule filtering, and match selection preserved across reload and Back/Forward.
- Actual Google OAuth, delivery to real inboxes, external broadcast playback, and a successful online AI-provider response have not been end-to-end verified. Emulator emails remain local and are not delivered.
- This is scoped verification of the exercised flows, not a claim that every possible button/state combination or external service was exhaustively tested.

To run the authentication integration test while both emulators are running:

```powershell
npm run test:auth
```

The rules test suite resets only the disposable demo Firestore database. Seed the local organizer again after running it if you need browser tests. The seed script can be rerun safely.

## Deployment status

The source, supplied logo asset (`public/arenahub-logo.png`), and production build are local. This update did not publish the website or deploy live database rules. Deployment of the tested `firestore.rules` to `wmsu-arl-hub` was blocked by automatic approval review because it changes live database access control. It was not retried. Explicit approval for that live rules deployment is required before the report module can be enabled against the existing production database.

## Artwork

Existing project artwork was retained. Added local assets:

- Dota 2: Valve's official social artwork, referenced by [the Dota 2 website](https://www.dota2.com/home), from `https://cdn.steamstatic.com/apps/dota2/images/dota2_social.jpg`.
- Call of Duty: Mobile: official publisher artwork from the Apple-hosted asset reached through [the official mobile website](https://www.callofduty.com/mobile).

Game marks and artwork belong to their respective owners; ArenaHub is an independent campus platform. The notebook illustration and interface icons are original local SVGs. Existing game-stage depth and lighting use CSS. The earlier robot and full-screen AI entrance are no longer rendered.

## Player profiles and calendar refresh

Player rows use photos, IGN, role, and game-specific rank artwork. Explicit peakRank records remain separate from current ranks. Missing peak data is labelled recorded rank. Mobile profiles open as native bottom sheets; desktop uses centered dialogs. Public profiles allowlist school/esports fields and omit student IDs, age, address, email, and phone. New bracket document writes strip registration IDs from nested players; existing live documents have not been rewritten. Example portraits and school/peak details are explicitly fictional fixtures, not live game-account information.

Schedule displays published brackets by game, with Philippine dates and times on match cards. Cards for live matches display scores and an orange border and open the match broadcast and chat. Double-elimination views now show the upper/lower stages and conditional reset final; the advancement engine was added in the November 8 update below.

The supplied orange shield has been recreated as a transparent SVG without its caption. Arena AI uses it as its character; two 1.6-second motions are scheduled at 10 and 20 seconds per feature visit, suppressed for reduced motion or a hidden tab. Navigation uses a subtle neutral active outline.

Original sample portraits were generated with the built-in image tool using a six-person, 3×2 fictional student portrait prompt. The supplied MLBB emblem received a transparent-background edit with the same tool. Project assets: public/sample-player-portraits.png and public/ranks/mlbb-immortal-reference.png. Other game-rank asset origins are recorded in public/ranks/sources.json (MOONTON/Riot artwork, community mirrors). No player-account rank synchronization is implied.

## Game-specific Fair Play

Fair Play supports MLBB, Dota 2, CODM Battle Royale and CODM Multiplayer with scoped roster checks, evidence guidance and private organizer review. CODM modes use recorded gameMode (br/mp) or mode-specific game IDs where supplied. Unspecified CODM modes remain reporter-selected context for human confirmation. Default roster targets are 5/5/4/5 and can be adjusted locally to the tournament rules. No device scanning, replay parsing, automatic cheating verdicts, publisher reporting integration or automatic bans are implemented. Report metadata is stored as a labelled context prefix within the existing immutable details field; database field/schema and security rules are unchanged. Existing verified-account, cooldown, access and review-note enforcement remains in effect. New Dota/CODM matches and rosters must be added by organizers; the interface does not invent them. Live rules deployment remains a separate prerequisite documented above.

## Hero video

The home hero now uses a silent 24-second H.264 MP4 cinematic artwork loop, composed locally with FFmpeg from the existing MLBB, Dota 2, and CODM art. CODM BR and MP are separate camera treatments of the same existing CODM artwork; this is not gameplay footage or character-generated video. Source transitions run at 0/6/12/18 seconds and the end dissolves into the opening image. public/hero/arena-loop.mp4 is 720p; arena-loop-mobile.mp4 is a lighter 360p version. The background is decorative, with no visible playback controls and a static poster fallback. It pauses outside the viewport and in hidden tabs. Reduced-motion and data-saving preferences prevent video loading. No audio or third-party player requests are used.

Hero controls were simplified: game labels/selectors, playback progress and the game-name strip are removed. The artwork loop runs automatically with no visible controls. Signed-in hero navigation uses two explicit, large touch targets.


## Required sign-in entry

Signed-out visitors see a minimal animated welcome page with a Sign in button opening a compact dialog. Connect with Google is the only sign-in option. Personal Google accounts need an admission from a current student invitation. Deep links stay in the URL, but application modules do not mount until authentication completes; existing account-status and email-verification gates still apply. This UI gate does not replace Firestore security rules. No authentication or database rules were deployed by this change.


## Livestream verification (2 November 2026)

Local-only checks ran against demo-arenahub Auth/Firestore emulators; no production broadcasts or rules were changed. Thirty application tests, eleven database-rule tests, one authentication integration test, and one dedicated cross-viewer broadcast integration test passed. Reproduce the last test with `npm run test:stream` while both emulators are running; it leaves a clearly labelled disposable QA bracket.

Browser checks: organizer sign-in; invalid Facebook-profile rejection; attach and replace a published match broadcast; save confirmation; copy embed; actual spectator propagation without reload; disconnect cancel/confirm; disconnected placeholder after reload; mobile player and reload control. NASA public YouTube LIVE `ROboUHfPUrU` played in the app on desktop and mobile (video paused=false, readyState=4). An older NASA ID returned a private-video notice, confirming provider restrictions remain independent of saved-link success. Meta's public sample video `10152454700553553` played after tapping Play (paused=false, readyState=4); this verifies Facebook video embedding, not an active Facebook LIVE broadcast. TikTok LIVE remains unsupported, with a clear guide instead of a false playback claim. Real student accounts, production deployment, Facebook LIVE availability and every device/browser combination are outside these local checks.

Fixes from verification: reject Facebook profile/group/share URLs; round-trip supported saved embeds; muted inline YouTube autoplay; preserve completed match status when attaching a replay; safe external watch link and video reload; accessible stream-input labels/errors; concise link validation; phone-friendly connect controls; distinguish saved links from verified broadcasting and clarify that disconnecting does not stop the provider's stream.


## WMSU access pilot

Use a verified WMSU email to sign in as a campus member. Administrators confirm enrollment against the school's records and use **Users → Approve student QR** to enable the invitation under **Settings → Profile**. Approval only grants invitation access and leaves tournament rosters under school control.

Spectators scan a current invitation QR with their phone camera and connect with Google. The invitation must still be valid when they redeem admission with their verified Google email. A successful redemption persists for that verified address. The QR can admit multiple spectators during its 20-minute window. A new QR invalidates the old link. The timer starts when the QR is issued and the profile refreshes it while open.

Test with the Auth and Firestore emulators and the seeded organizer above. A phone needs an ArenaHub URL reachable from that phone. A localhost invitation only works on the machine hosting the preview. The invitation flow requires the updated Firestore rules in the environment where it is used.


Published match chat is shared between admitted viewers. Verified WMSU members can post with their profile name or as Anonymous. Spectators with personal email are read-only. Public message documents contain the display label, message, and timestamp. Author account IDs are stored separately and readable only by authorized school staff. Legacy local chat records do not become shared messages.


## Tournament operations, notifications and video review — 8 November 2026

- **Tournament desk / My team:** staff open registration for a published bracket; captains submit a private roster for their existing team slot. Staff approve and lock it. Student and game-account identifiers remain private; published player profiles omit both. Approvals reserve identifiers in a transaction to prevent duplicates across teams in the same tournament. Account ownership and enrollment still require staff verification.
- **Match readiness:** staff set a Philippine-time check-in window for two eligible locked rosters. Captains submit their observed lobby lineup and evidence. The explainable checker flags unknown players, duplicate identifiers, mismatched game accounts, stale roster revisions and incorrect team assignments. Referees confirm actual players. Corrections requested by a referee can be resubmitted before the deadline; earlier lineups remain in immutable history. No-shows and tournament restrictions require an explicit staff decision and do not automatically change match results.
- **Personal notifications:** the bell opens a responsive, warm-neutral dropdown with an unread badge, All/Unread filters, mark-all-read, individual read/unread controls and case links. Each account has its own private inbox and read state. Public tournament announcements and staff-only review events are copied once into the eligible user's inbox, including on the next sign-in after being offline. The interface shows the latest 100 inbox records and imports the latest 50 events from each applicable event feed. This is in-app notification delivery, not browser push or guaranteed delivery of an unlimited historical backlog.
- **Fair Play is video-first:** choose the game and match, upload an MP4/WebM clip up to 100 MB, and optionally add a note. Evidence is stored privately in Cloud Storage and becomes immutable after case submission. Existing recording/screenshot links are also supported. Staff can watch the clip, step approximately 1/30 second, extract a filmstrip and save observations, decisions and review requests.
- **Visible model review:** from the playhead, capture up to 30 seconds at **2 sampled frames per second**, then send consecutive batches of at most six actual JPEG frames to the authenticated organizer-only `/api/fair-play/analyze` endpoint. The UI shows the captured frame, its timestamp, whether a model response has actually arrived, the visible observation, a possible legitimate explanation and missing context. Stop/error states preserve completed results. An unavailable provider never produces simulated assessments. This does not analyze every source frame, audio, game memory, input telemetry or a native game replay.
- **Model scope:** a vision-capable Gemini model receives game-specific evidence guidance for MLBB, Dota 2, CODM BR and CODM MP. This is prompt-based visual triage, not a trained or validated cheat classifier. There is no calibrated cheating probability, automatic verdict or publisher ban. Spectator vision, overlays, aim assist, sound and missing player perspective can change interpretation. Performance on labeled real gameplay has not been established.
- **Case accountability:** staff review events are append-only. Reporters may request one review of a closed case. Accepted requests preserve the original decision and evidence; any corrected tournament restriction is separately recorded at the Tournament desk. Shared community chat reports now remove actual published chat messages; account bans still require project-administrator privileges.

### Local verification and activation

Run `npm test`, `npm run test:api`, `npm run test:video-api`, and `npm run build`. With the disposable Auth, Firestore and Storage emulators running, run `npm run test:rules`, `npm run test:storage`, and `node --test tests/operations.integration.test.mjs`. The integration workflow exercises the actual services, duplicate reservations, public-profile scrubbing, private notifications, schedule announcements, shared configuration, corrected check-ins and case appeals. It creates clearly labeled QA records in **demo-arenahub only**. The seed script also supports local email/password sign-in for `organizer@wmsu.edu.ph` and `student@wmsu.edu.ph` using `ArenaHub-QA-Only-27!`; these are disposable emulator credentials.

Production activation has **not** been performed. Deploy the reviewed Firestore and Storage rules, configure the evidence bucket and its allowed web origins using `storage.cors.json` (adjust to the actual deployed hostname), and host the Node API behind the same-origin `/api` route. Firebase static hosting alone cannot run the video endpoint. Set `GEMINI_API_KEY` only on the server; `GEMINI_VIDEO_MODEL` optionally selects the vision model. Test mode deliberately disables the online provider. Real gameplay accuracy, real publisher integration and production uploads remain unverified.

Local verification on 8 November: 64 automated checks passed across application/API, database rules, storage, authentication, broadcasts and the real-service tournament workflow. TypeScript and production build passed. Browser checks covered phone/desktop layouts, read/unread and filtering with reload persistence, a private test clip upload and playback from saved storage, actual sampled-frame extraction, approximate frame stepping, organizer note persistence, and an explicit unavailable-model response with no fabricated assessments. The clip was the existing artwork loop, clearly labeled as a QA interface test rather than gameplay evidence. Preview images are in `output/module-completion/`.


## Authentication correction — 8 November 2026

Sign-in and sign-up use Firebase Authentication. Google is below the email form and uses the actual Google account flow, with an account chooser and a same-tab fallback. Demo account buttons, preset passwords and simulated QR admission have been removed. Account roles come from trusted Firebase claims; selecting Google does not grant organizer access. Profile failures show a retry screen instead of inventing an active account.

Google accepts only a verified, exact `@wmsu.edu.ph` address. Both popup results and restored/redirect sessions are checked before profile access; a rejected Google identity is signed out. The database and evidence-storage rules also reject external Google identities. Firebase Authentication itself may still create an identity record during the OAuth exchange; this is not ArenaHub membership or data access. The pre-existing student-invited spectator path remains available through verified email/password accounts. Personal Google accounts cannot use that path.

To reuse the access policy for another institution, edit **institution.config.json** (`name`, `shortName`, `emailDomain`) and run **npm run configure:institution**. The website, Google picker hint, exact domain checks and organizer video API use that shared configuration. The command regenerates the marked domain policy in both rules files; `npm run build` also runs it automatically. Rebuild/restart the website/API and deploy the regenerated rules when activating the institution. Verify synchronization with `node scripts/sync-institution.mjs --check`. This does not change Firebase project credentials or redesign campus-specific content.

For actual Google authentication locally, use **http://localhost:5176/** with normal `npm run dev -- --port 5176`; do not use `--mode test`. The existing Firebase project allows localhost, while 127.0.0.1 returns `auth/unauthorized-domain`. Test mode intentionally uses disposable emulator account choices and never represents the real Google chooser. In a deployed installation, enable Google in Firebase Authentication and authorize the deployed hostname.

QR admission now decodes an actual camera frame, QR image or pasted invitation and checks the private expiring student invitation. Scanning does not sign the visitor in. Sign-up preserves the name and optional college and requires real email verification. Expired invitations, mismatched passwords, canceled Google popups and profile failures have explicit messages.

Validation: application tests, authentication integration, database access rules, organizer API and the production build. Local integration covers rejected Google identities (personal email, deceptive domain and unverified school email), account creation, verification, QR redemption, returning login and trusted staff roles. The form order was visually checked in the normal preview. A production WMSU account sign-in and physical camera remain unverified. The live Google handoff reached the Firebase-hosted authentication origin but browser approval blocked inspection there. These changes and rules are local; no production deployment has been performed. Earlier notes allowing personal Google spectator admission are superseded by this policy.
