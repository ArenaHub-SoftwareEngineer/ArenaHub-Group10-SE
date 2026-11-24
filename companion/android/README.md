# ArenaHub Companion (Android)

A small Android app that pairs a player's phone with an ArenaHub match and reports to the tournament API server. The staff runbook is in [docs/INTEGRITY_SETUP.md](../../docs/INTEGRITY_SETUP.md). The player notice is in [docs/INTEGRITY_POLICY.md](../../docs/INTEGRITY_POLICY.md).

- **Minimum Android version:** Android 10 (API 29). The target is Android 15 (API 35).
- **Dependencies:** none. It uses the platform SDK, `org.json` and `HttpURLConnection`.
- **Distribution:** sideloaded APK, not Google Play. It declares `QUERY_ALL_PACKAGES` for local policy matching. Actual visibility must be verified on target devices; Google Play distribution would require a separate policy review.

## Build (free)

**On the event laptop:** run `npm run build:companion` from the project folder. It writes `dist-agent/arenahub-companion.apk`. While the ArenaHub server is running, phones can download it from `https://<api-host>/api/integrity/downloads/arenahub-companion.apk`, and the pairing panel shows that link.

The command uses build tools that were set up once in `%LOCALAPPDATA%`: `ArenaHubBuild\jdk17` (Temurin JDK 17), `ArenaHubBuild\gradle-8.10.2`, and `Android\Sdk` (command-line tools, `platforms;android-35`, `build-tools;34.0.0`). It copies the project to `ArenaHubBuild\companion` first, because Android's build tools fail when the project path has non-ASCII characters and this repo's folder name has a long dash.

**On another computer, with Android Studio:**

1. Install [Android Studio](https://developer.android.com/studio). It includes the SDK and a JDK.
2. Open this folder (`companion/android`) in Android Studio. Let it sync Gradle. If it offers to create the Gradle wrapper, accept.
3. Choose **Build > Build App Bundle(s) / APK(s) > Build APK(s)**. The file is `app/build/outputs/apk/debug/app-debug.apk`.
4. To install it on a phone, turn on "Install unknown apps" for the app you open the APK with (Files, Chrome or Drive), then open the APK.

The generated APK is a test artifact signed with a development key, with debugging disabled. Use it on consenting test devices. Create an organization-controlled signing key for a public release and keep it outside git; `.gitignore` excludes common keystore/signing-secret files. The standard build requires HTTPS. An explicit `ARENAHUB_ALLOW_HTTP_LAN=1` build flag enables private/loopback HTTP for isolated LAN tests; do not distribute that build as the public release.

## Share your screen live

1. On the match check-in page, choose **Open screen sharing**, then **Share with Android Companion**. If the browser cannot open the companion, copy the private link and paste it into **Share game screen** in the app.
2. Verify your name and match, then choose **Choose game**. When Android asks, choose **Entire screen** (a single-app share hides other apps' floating windows from the referee). Keep the companion on screen until it says your screen is live; Android allows starting screen capture only from a visible app.
3. The phone sends one silent stream to the match's LiveKit room (H.264 hardware encoding, 720p/15 fps plus a 360p layer for the facilitators' grid). Only match staff can watch it.
4. If the referee pauses the match, a heads-up notification appears over the game.
5. To stop, tap the sharing notification, or return to **Share game screen → Stop sharing**. The device scan can continue while sharing is off.

Uses [LiveKit's Android SDK](https://github.com/livekit/client-sdk-android). The SDK's camera and microphone permissions are removed in the manifest. Not yet tested on a real phone.

## How it works

| File | Purpose |
|---|---|
| `MainActivity.kt` | Pairing (QR deep link `arenahub://pair?s=...&c=...` or typed code), consent, screen-capture permission, status |
| `MonitorService.kt` | Foreground service: a report every 15 s, a segment upload queue (holds up to about 20 minutes offline), and stop at the local consent deadline even without connectivity, or when the server answers 410 |
| `DeviceChecks.kt` | The facts sent each report. The format must match `androidFactsSchema` in `src/lib/integrityRisk.ts` |
| `ScreenRecorder.kt` | 30-second, 720p H.264 MP4 segments through MediaProjection, with no audio |
| `Api.kt` | POST JSON and files to `/api/integrity` |

If you change the report format, change `src/lib/integrityRisk.ts` and its tests in the same commit.

## Test checklist before the first event

The v3 app builds and Android lint reports zero errors and no security-category warnings (17 Nov 2026). Nine localization/resource warnings remain. Physical Android testing is pending a consenting device. On 20 Nov 2026 the 3.3 app was run end to end on an Android 15 emulator (see below).

- [x] It builds without errors.
- [ ] Scanning the referee QR code with the phone camera opens the app with the address and code filled in.
- [x] Pairing works (Android 15 emulator, 20 Nov 2026: link, code lookup, consent, claim, live verdict).
- [ ] The screen-capture prompt appears. The staff page receives 30-second MP4 files, and they play.
- [ ] A harmless test package added to a test-only blocklist is detected, with unrelated apps excluded from reports.
- [ ] Configured signer matches are included from the first report, and denied/incomplete visibility is shown honestly.
- [x] Turning on USB debugging shows a signal (emulator: shown under Worth knowing).
- [ ] With the API unreachable, the local match deadline stops capture and reporting.
- [ ] Backup/device-transfer exclusions and HTTPS-only transport work on the test device.
- [x] Stopping in the app ends the session (emulator). Still to check: stopping from the notification ends the session ("player stopped" in the activity log).
- [ ] Ending the session on the staff page stops the phone within about 15 seconds.
- [ ] Repeat on Android 10, 13 and 14 or newer if possible. Android 14 changed the screen-capture rules.

## Required scan admission in v3

The first scan carries its session challenge and current policy version. The app displays Scan passed, Action required or Scan incomplete from the API. A required scan is linked to a published roster slot. The player keeps the companion running throughout the match. Closing a restricted tool allows the next valid scan to clear it. Staff create a new code when the published roster changes.


## Companion 3.1

The scan-stamp serializer now has JVM tests using real org.json serialization. Run `npm run test:companion` from the repository root to execute those tests, Android lint and the HTTPS-only APK build. Test dependencies are excluded from the production app.

The app identifies itself as ArenaHub Anti-cheat, shows the required-scan workflow and updates its ongoing notification with the latest scan result. Installed-package match overflow remains incomplete. The API requires actual game-certificate evidence for admission even if a coverage flag claims the check succeeded. Hardware validation is still pending an available Android device.

## Companion 3.3 (20 Nov 2026)

The app was redesigned into separate screens that use the website's colours, in light and dark mode: Home (code and server, or a practice scan), a code check, Consent (the real player, match and game from `GET /device/pairing/:code`, what is checked, what is never touched, and the server address), Starting, a live status screen (Scan passed / Action required / incomplete, "Live · checked N s ago", findings with the file or app name first, recording state and the optional usage-access step), the practice result with Scan again, and a message screen for declines, errors and stops. It has an ArenaHub adaptive launcher icon and a status-bar icon. `MonitorState` now carries the structured verdict (`ScanView` in `ScanReport.kt`), and `Ui.kt` holds the shared view builders.

Tested on an Android 15 emulator (`system-images;android-35;google_apis;x86_64`, AVD `arenahub35`; WHPX works on the event laptop) with a LAN-test build against a local server at `http://10.0.2.2`: the pair link, code lookup, consent, claim, live verdict, Stop scan and the practice scan all worked, in light and dark mode. A real phone is still needed for the camera QR scan, screen recording upload and Android 10 to 14 behaviour. Start the emulator with `emulator -avd arenahub35` from `%LOCALAPPDATA%\Android\Sdk\emulator`.
