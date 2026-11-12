# ArenaHub Companion (Android)

A small Android app that pairs a player's phone with an ArenaHub match and reports to the referee laptop. The staff runbook is in [docs/INTEGRITY_SETUP.md](../../docs/INTEGRITY_SETUP.md). The player notice is in [docs/INTEGRITY_POLICY.md](../../docs/INTEGRITY_POLICY.md).

- **Minimum Android version:** Android 10 (API 29). The target is Android 15 (API 35).
- **Dependencies:** none. It uses the platform SDK, `org.json` and `HttpURLConnection`.
- **Distribution:** sideloaded APK, not Google Play. That allows `QUERY_ALL_PACKAGES`, which is needed to compare installed apps with the blocklist on the phone.

## Build (free)

1. Install [Android Studio](https://developer.android.com/studio). It includes the SDK and a JDK.
2. Open this folder (`companion/android`) in Android Studio. Let it sync Gradle. If it offers to create the Gradle wrapper, accept.
3. Choose **Build > Build App Bundle(s) / APK(s) > Build APK(s)**. The file is `app/build/outputs/apk/debug/app-debug.apk`.
4. To install it on a phone, turn on "Install unknown apps" for the app you open the APK with (Files, Chrome or Drive), then open the APK.

A debug APK is fine for school events. For a longer-term release, create a signing key (Build > Generate Signed App Bundle / APK). Keep the keystore out of git; `.gitignore` already excludes it.

## How it works

| File | Purpose |
|---|---|
| `MainActivity.kt` | Pairing (QR deep link `arenahub://pair?s=...&c=...` or typed code), consent, screen-capture permission, status |
| `MonitorService.kt` | Foreground service: a report every 15 s, a segment upload queue (holds up to about 20 minutes offline), and stop when the server answers 410 |
| `DeviceChecks.kt` | The facts sent each report. The format must match `androidFactsSchema` in `src/lib/integrityRisk.ts` |
| `ScreenRecorder.kt` | 30-second, 720p H.264 MP4 segments through MediaProjection, with no audio |
| `Api.kt` | POST JSON and files to `/api/integrity` |

If you change the report format, change `src/lib/integrityRisk.ts` and its tests in the same commit.

## Test checklist before the first event

These have not been run yet, because no Android SDK or test phone was available when the app was written.

- [ ] It builds without errors in Android Studio.
- [ ] Scanning the referee QR code with the phone camera opens the app with the address and code filled in.
- [ ] Pairing works, and the staff page shows "Online".
- [ ] The screen-capture prompt appears. The staff page receives 30-second MP4 files, and they play.
- [ ] Installing a blocklisted package (for example a cloner app) shows a signal within about 15 seconds.
- [ ] Turning on USB debugging shows a signal.
- [ ] Stopping from the notification ends the session ("player stopped" in the activity log).
- [ ] Ending the session on the staff page stops the phone within about 15 seconds.
- [ ] Repeat on Android 10, 13 and 14 or newer if possible. Android 14 changed the screen-capture rules.
