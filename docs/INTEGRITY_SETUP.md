# Match monitor: hosting and verification

Updated 17 November 2026 for the confirmed public website/API deployment. This runbook describes implemented behavior, not proof that production is configured or that every cheat can be detected.

## Live player screens

Live screens run through LiveKit (WebRTC). Video goes from each player's device to LiveKit and on to the facilitators, never through the ArenaHub server, so it works on the event laptop and the hosted API alike. Setup, limits and the free-plan numbers are in [LIVE_SCREENS.md](LIVE_SCREENS.md).

Staff open **Anti-cheat → Live screens**, choose the game and then the match. Organizers assign up to four facilitators per match; facilitators see only their matches. Players pick their match during check-in, then choose **Open screen sharing**: PCs share from Chrome or Edge, Android phones through the companion, and iPhones through the ArenaHub POV app (needs a signed build). [Android setup](../companion/android/README.md) · [iPhone setup](../companion/ios/README.md)

## Required pre-match scans (3.1)

The primary flow is now **Anti-cheat**, not filing a manual cheating report. In the player workspace, Anti-cheat opens the required companion scan; disputes and appeals are secondary. In the staff workspace, Anti-cheat lists every player in a published match and whether admission is locked.

1. Publish complete rosters first. For CODM BR, captains can now register their squads through My team; staff approve/lock them, and all squad rosters are hydrated for each lobby game. A lobby scan covers every squad, not just two teams.
2. Use **Anti-cheat → Check-in**: choose game, bracket and match, then open check-in. Players scan the QR, sign in with their school account and type the 8-digit code (it changes every 3 minutes). Their school email finds their seat on the published roster, and each seat can be held by one device until staff reset it.
3. Each player downloads the verified 3.1 Windows agent or Android companion and consents locally. It scans automatically. Restricted tools show **Action required**; close/remove them and let the app scan again. Old findings remain in history but do not permanently block a corrected current scan.
4. Open the published match under **Broadcast → Match scan readiness** for roster-linked scan results. Android readiness requires a current report with the configured trusted publisher certificate. iPhone readiness requires a current referee inspection and supervised clearance.
5. **Go live does not check scans** (changed 23 November 2026, Kerr's decision). The organizer confirms all players passed before match time, about 30 minutes ahead, using the panel above. Go live, resume and the live-stream controls only change the match state. The panel still shows who passed and still drops a player if their companion reports a restricted tool during the match.
6. Keep every companion open during the match. Disconnects lose readiness. Use a supported organizer device if a player declines on their own device or only has an iPhone. This is an admission requirement, not an automatic cheating ban.

The basic Android gate requires visible installed packages and trusted regional game certificates. Overlay inspection is best effort and its failure is shown as a warning; it is not mislabeled as a complete overlay scan. Windows requires completed process/registered-software checks and completed executable hash checks when staff configured hashes. Low-severity installed dual-use tools are not automatically treated as cheating.

This gate governs ArenaHub's official match controls. ArenaHub cannot stop someone launching MLBB, CODM or Dota independently, and privileged staff with direct database administration can bypass application workflows. Companion scan metadata binds the current session/policy but is not hardware attestation; a modified client can still lie.

### API/service choice

The implemented scanner uses local Windows/Android observations and ArenaHub's authenticated admission API. [Epic's anti-cheat SDK](https://dev.epicgames.com/docs/epic-online-services/trust-and-safety/anti-cheat-interfaces/anti-cheat-interfaces) expects integration with the protected game and does not support Android/iOS anti-cheat clients. It cannot simply be wrapped around these publishers' games. [Google Play Integrity](https://developer.android.com/google/play/integrity/verdicts) can add genuine-app/device and Play Protect risk checks after project/app provisioning, but those verdicts do not specifically identify every MLBB/CODM cheat. [VirusTotal](https://docs.virustotal.com/reference/intro/getting-started) provides file reputation, with API-use restrictions; it is not a universal cheat detector. No external service is falsely shown as connected, and player binaries/inventories are not uploaded to a new provider.

## Choose the runtime

Use a persistent Node 24 process with a private persistent volume. `npm start` runs the full Express application, including `/api/integrity`, the built website and `join.html`. Keep `data/` outside the public document root. Back it up securely, restrict its filesystem permissions to the service account, and monitor free space. SQLite, pending uploads and playback tickets currently assume **one active API process**. Ephemeral functions and multiple replicas are not supported for this monitor.

The website can use the same HTTPS origin as the API, or Firebase Hosting with `VITE_API_BASE_URL=https://api.example.org` in its build and `CORS_ORIGINS=https://site.example.org` on the API host. Both layouts now support the staff monitor, including settings and playback. Serve the complete `dist/` on the persistent API host too, so pairing links open its own join page.

Configure the public API host:

```text
HOST=0.0.0.0
PORT=<host-assigned port>
INTEGRITY_HOSTED_URL=https://api.example.org
INTEGRITY_DATA_DIR=<private persistent volume>/integrity
INTEGRITY_DOWNLOAD_DIR=<release directory>/dist-agent
CORS_ORIGINS=https://site.example.org
```

Set Firebase project configuration and the server service account through the host's secret manager; see ENV_CHECKLIST.md. Terminate TLS at a trusted reverse proxy, preserve the original Host header, and sanitize forwarded-client headers. The app trusts loopback proxies only; verify rate limiting on the actual ingress. Apply edge connection/body/concurrency limits and a global storage quota. Per-session recording limits alone are not a disk-capacity guarantee. Configure Firebase authorized sign-in domains and deploy the tested Firestore/Storage rules separately.

Do not set `INTEGRITY_PUBLIC_URL` in hosted mode. That variable belongs to the alternative **player-only event-laptop tunnel**, where staff APIs are deliberately hidden from tunnel visitors. Conflicting hosted/tunnel settings fail at startup.

`api/index.ts` remains an AI/video-only serverless entry: it intentionally disables the disk-backed monitor. Hosting only that entry will not provide anti-cheat sessions.

## Build and verify downloads

```powershell
npm.cmd run build
npm.cmd run build:agent
npm.cmd run build:companion
npm.cmd run test:collector
```

The Windows executable and Android APK appear in `dist-agent/`. Publish reviewed SHA-256 download fingerprints through a trusted staff channel. These are test artifacts: the executable is unsigned and the APK uses a development signing key, although debugging is disabled. Sign release artifacts with organization-controlled keys before broad distribution. Never teach players to ignore security warnings for an unverified download.

The standard Android build requires HTTPS. For an isolated, staff-controlled LAN test only, set `ARENAHUB_ALLOW_HTTP_LAN=1` before building the companion. That separate build permits HTTP only to localhost/private IPv4 addresses. Remove the variable and rebuild for public distribution. Cleartext LAN traffic can expose pairing credentials and recordings; prefer HTTPS even at the venue.

## Configure detection policy

Staff can review and update the scan rules through `GET /api/integrity/config` and `PUT /api/integrity/config`. Review every starter entry against tournament rules. Editors, debuggers, virtual devices, accessibility services and macro tools have legitimate uses. Their presence alone does not establish cheating.

- Package/process/registered-software entries use `pattern | label | severity`. Only a trailing `*` is supported; otherwise names match exactly, ignoring case.
- **PC installed software** checks registered display names in the current-user and machine Uninstall registry locations, including the 32-bit view. It can find listed registered software even when stopped. It does not discover every portable program or every Windows Store app.
- **PC executable fingerprints** use `SHA-256 | label | severity`. The agent hashes accessible running executables and loaded Dota libraries when this list is configured. Renaming identical bytes does not evade a fingerprint; changing the bytes does. Unreadable files, time/size limits and failed observations are reported as incomplete.
- **Android certificate fingerprints** match configured signer hashes across visible installed apps. Repackaging under a different key can evade a signer list. A shared certificate may also identify legitimate apps, so verify the provenance of each entry.
- Game trust lists are initially empty. Establish the correct regional publisher certificate using an independently verified, staff-controlled Android device and official distribution. Do not trust an unknown player's self-report as the reference. Legitimate publisher key rotation requires review.

No current cheat binary hashes are invented or bundled. Research does not supply a reliable universal signature database. Record each real indicator's source, sample version, date, false-positive assessment and reviewer before using it in a tournament policy. Do not install live cheats on a gaming account or staff workstation to obtain samples.

## Pair and monitor

1. In **Player check-in**, select **Generate check-in QR** and share it or copy its link. Phones need a reachable HTTPS ArenaHub address. Windows players open the same link on their game PC.
2. Players sign in and provide their game details. The server creates one active scan session per verified school account. Use **Reset** on a player who needs to start again.
3. Windows players download the verified agent (or press Start my scan once it is installed). The agent opens its own window in the player's browser, served only to this PC on 127.0.0.1 behind a random secret address. The window shows whose scan it is, what is checked and the server address, and the player chooses Agree and start scan or Decline. It then shows each check as it runs and the live result (Scan passed, or Action required with the file or program names). Typing YES or NO in the console still works. Keep the agent open. Restart Dota after pairing to load the GSI configuration. The agent does not read game memory or inject code; publisher compatibility still needs event validation.
4. Android players install the verified companion, review consent and agree or decline. Screen capture requires a separate OS prompt. The foreground notification stays visible. Package inventories refresh at most once a minute and on package changes.
5. iPhone players use Safari to check in or decline. Nothing is installed or inspected. When recording is enabled for the session, they can upload their own recording if requested. A real iPhone test remains necessary.
6. Staff see findings, their evidence, and **Detection coverage** in each session. GSI and media do not refresh scanner liveness. A scanner silent for more than 45 seconds becomes **Not reporting**. A zero score means no listed indicators were reported; it is not a clean-device certificate.
7. Review recordings/replays from player perspective. Observer vision, normal game mechanics, latency and skill can explain apparent anomalies. Neither an AI frame review nor an unusual statistic detects installed cheats.
8. End the session after the match. Tokens are revoked when it ends/expires. If a case needs evidence, record the review note and enable the explicit evidence hold. Otherwise ended sessions older than 30 days are removed by cleanup. Held evidence needs a staff-managed release/deletion process.

## Test devices and release limits

Use the **Player check-in** QR to exercise Android, Windows and iPhone handoff. The localhost demo QR opens on the computer running the demo. For a physical phone, use the ArenaHub HTTPS site or a production build served through the player-only tunnel with working campus sign-in.

Windows process hashing and installed-software collection have native local tests using harmless matches. Automated tests also cover API decisions, Android fact validation, consent/decline flows, iPhone upload simulation and desktop/mobile layouts. The Windows registry test reads entries locally, writes no registry keys and uploads no full inventory.

Android compiles and has static lint coverage; physical Android validation is pending device availability. Test visibility permissions, denial paths, app install/uninstall invalidation, certificate matching, background operation and screen capture on several supported Android versions before using it in an event. iPhone Safari behavior must be verified on your available device. No live MLBB, CODM or Dota cheat was downloaded or executed, and real-game publisher compatibility was not certified.

A player controlling their OS can modify the collector or forge its reports. Private/kernel cheats, inactive portable files, hidden or manually mapped modules, external hardware and unknown signatures remain outside reliable detection coverage. For high-stakes matches use staff-controlled devices and independent observers alongside publisher anti-cheat.

See [ANTI_CHEAT_COVERAGE.md](ANTI_CHEAT_COVERAGE.md) for the source-backed threat categories and [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for changes and remaining release conditions.


## Using companion 3.1

Update the Windows agent and Android companion together with the API. Windows players can double-click the app and enter the tournament server address and their match scan code, then explicitly consent. Command-line arguments remain supported.

Staff can edit Dota 2 restricted-library names in Anti-cheat settings. Name patterns use the same exact/prefix rules and severity levels as process indicators. Optional PC SHA-256 fingerprints now apply to accessible executables and normally loaded Dota libraries. Keep the companion open after launching Dota. A restricted DLL blocks current readiness, and a library-access failure keeps the scan incomplete while the game runs. Remove the restricted tool and restart the game if its library remains loaded.

Android 3.1 sends the current session/policy stamp independently of cached observations and updates its ongoing notification with scan status. Official regional game certificates remain required for admission. Run `npm run test:companion` for JVM JSON regression tests, Android lint and an APK build. The production APK includes no added runtime libraries from these tests.


## Using collector 3.2 (17 November 2026)

Update the Windows agent (3.2.0) and Android companion (3.2.0) together with the API. A 3.1 Windows agent can no longer clear a Dota 2 player: admission now requires the Dota 2 install audit.

**Dota 2 install audit (always on for Dota sessions).** Valve ships `game/bin/win64/dota.signatures` with every Dota 2 build: the SHA-1 of every program file plus `gameinfo.gi`. The agent finds Dota 2 in every Steam library and, read-only:

1. hashes every listed file and reports any that differ or are missing (`client.dll`, `engine2.dll`, `dota2.exe`, `gameinfo.gi` and the rest);
2. reports DLL, ASI, EXE or SYS files in `game/bin/win64` or `game/dota/bin/win64` that Valve's list does not name. This is the proxy-DLL loader route (a fake `version.dll`, `dxgi.dll` or `winmm.dll` that Dota loads at start);
3. reports content packs (VPK) Valve does not ship: extra packs in `game/dota` or `game/core`, any pack in a language folder (Valve ships only `gameinfo.gi` there), packs in `dota_lv` outside Valve's dashboard scenes, unknown folders, and search paths added to any `gameinfo.gi`. `dota_addons` (custom games) is not flagged;
4. reports `-insecure`, `+sv_cheats 1` and `-language <non-Valve name>` in each Steam account's saved launch options and in the running `dota2.exe` command line;
5. reads Steam's `appmanifest_570.acf` for the build ID and whether an update is pending.

Only relative game paths, flags, the build ID and the SHA-256 of Valve's list leave the PC. The first pass hashes about 600 MB and took 2 to 3 seconds on the test PC; later passes reuse a size/time cache and rehash at least every 10 minutes. On a Steam-verified install of build 26632873 the audit reported no findings.

When a player is blocked for a file finding, ask them to close Dota 2, run **Steam > Dota 2 > Properties > Installed Files > Verify integrity**, remove any listed extra file, folder or launch option, and rescan.

**Optional reference copy of Valve's list.** A cheater could edit both a game file and `dota.signatures` so that they agree. To close that gap, verify Dota 2 on an organizer PC, start the agent once and copy the line it prints (`Dota 2 build ...; Valve file list SHA-256 ...`). The session dialog shows the same value. Paste it into **Fingerprint checks > Dota 2 reference file lists** as `sha256 | Build 26632873 | high`. Add a line for each build in use and update it when Valve patches mid-event, or every player will be blocked until you do.

**Unsigned libraries from user folders.** While Dota 2 runs, the agent checks the Authenticode signature of every library Dota loaded from outside Windows, Program Files and the audited game folder. A library that is not validly signed (typical of injected cheats in Downloads, Temp or AppData) blocks admission with its name, status and SHA-256. Signed overlays such as Steam, Discord and NVIDIA pass. Some small unsigned overlay or hotkey tools will also be flagged; the player closes that program and restarts Dota 2. A cheat installed into Program Files, or one signed with a certificate the player trusted locally, is not covered.

**Cheat-file folder check (off by default).** **Cheat-file folder check on player PCs** in Anti-cheat settings makes the agent ask the player for a second permission. It then looks in Desktop, Downloads, Documents and Temp, including OneDrive-redirected Desktop and Documents, up to four levels deep, with limits of 40,000 entries and 25 seconds. It reports:

- Cheat Engine tables (`.CT`) that target `dota2.exe`, and Cheat Engine trainers named for Dota;
- AutoHotkey scripts that target `dota2.exe`;
- executables named like a listed program (portable copies that are not running);
- files that match a staff SHA-256 fingerprint;
- folders named like listed installed software.

Only the file name, a folder label and the reason are sent. A player who declines cannot pass the scan, so publish the rule before the event. Turn it on only if your tournament rules and the school's data-privacy guidance allow it.

**Android 3.2.** Adds hooking-framework indicators (Frida, Xposed/LSPosed, Zygisk, Riru, Substrate libraries in the companion's memory map, root-framework mounts, a Frida server on port 27042), cloned or virtual-space detection (an unexpected app data folder, or code loaded from a listed cloner), debuggable system builds and permissive SELinux. Hook and container findings block admission. The starter list adds LSPatch, KernelSU, APatch, Magisk Alpha, Octopus, Mantis, VPhoneGaga and Termux (low severity, shown as a warning). Verify each package name on a test phone before the event. Physical-device testing is still pending.

**iPhone inspection.** The referee form now lists six sideload and jailbreak indicators, each with where to look on the phone: Developer Mode, trusted enterprise or developer apps, sideload or jailbreak apps, the game's App Store page showing Get instead of Open, a duplicate or renamed game, and a VPN or profile the venue did not provide. Each indicator must be marked Not present or Found. Any Found blocks approval, and a revoke records what was found.


## Collector 3.3: content-based detection (17 November 2026)

**Tournament rule:** the cheat-file folder check is **on by default** (Kerr's decision, 17 November 2026). Players are still asked for permission, and a player who declines cannot pass the pre-match scan. Staff can switch it off in Anti-cheat settings.

**Why 3.3 exists.** Name lists are easy to evade: renaming `cheatengine-x86_64.exe` to `chrome_updater.exe`, or a `.CT` table to `notes.txt`, hid it from 3.2. Version 3.3 judges files by what they contain:

| Trick | What 3.3 looks at |
| --- | --- |
| Renamed listed tool | The internal identity stamped into Windows programs (OriginalFilename, InternalName, ProductName, FileDescription), matched against the process and installed-software lists |
| Unknown or private cheat | An unsigned program that names `dota2.exe` or the Dota install folder |
| Injector under any name | An unsigned program with the four DLL-injection functions (OpenProcess, VirtualAllocEx, WriteProcessMemory, CreateRemoteThread or equivalents) |
| Protected cheat loader | An unsigned program wrapped in VMProtect, Themida or Enigma |
| Fake extension | Files are recognised by their header bytes, so an `.exe` named `.txt`, `.log`, `.bin` or `.mp4` is still a program |
| Renamed tables and macros | A Cheat Engine table is an XML document whose root is `CheatTable`; an AutoHotkey or Python macro has line-start directives or imports that name `dota2.exe` |
| Zipped | ZIP archives are opened in memory (one level, entries up to 32 MB) and each entry is judged the same way |
| Running under a fake name | The same content rules run on every running program outside Windows, Program Files and the game folder, whether or not the folder check is on |

**Blocking vs. warning.** These block admission: anything that targets Dota 2, a listed tool (renamed or not), a Cheat Engine table, a Dota macro script, a staff fingerprint match, and any unsigned injector or protected program that is running during the match. An unsigned injector or protected program that only sits on disk is a staff warning, because ordinary software has the same traits. The real-PC run found Java's `attach.dll` in a Minecraft runtime this way. A valid Authenticode signature clears the behaviour rules but never clears a listed tool.

**Coverage and limits.** Order: Desktop, Documents (including OneDrive), Downloads, Temp, AppData, the rest of the user profile, then every other fixed drive. Skipped: Windows, Program Files, ProgramData, `steamapps`, `node_modules`, `.git` and package caches. Photos, video and office files are checked last. Limits: 150 seconds, 400,000 entries, 3 GB read, 8 folder levels, 5 seconds per file, 60 seconds for signature checks. The check runs in the background, and admission shows "Folder check running" until the first pass ends; it repeats every 10 minutes. Reaching any limit reports "partial", which is a staff warning and never "clean". A cheat stored in a skipped folder, a password-protected or RAR/7z archive, or an encrypted container is not opened. If it runs, the running-program check still sees it.

**Measured on the development PC** (a heavy developer profile with 388,000 entries): the check finished in 84 seconds and reached the 3 GB read budget. Apart from the harmless test simulators, its only finding was Java's `attach.dll`, reported as a warning. Two false positives found during testing were fixed: sample text inside source code, and installer archives whose entries cannot be signature-checked. A regex that backtracked for minutes on comment-heavy XML was also fixed.

**How it was tested without real cheats.** `tests/fixtures/cheat-sim` holds harmless C programs, built with MinGW gcc during `npm run test:collector`, that copy the traits of cheat software without doing anything: injector imports that are never called, a `dota2.exe` target string, a listed tool's internal identity, a VMProtect section name, and an unsigned Dota-targeting DLL. The test hides them the way cheaters do: renamed, with fake extensions, buried in folders, zipped, disguised as a video, run under system-looking names, and loaded into a process called `dota2.exe`. It also checks that an ordinary unsigned program, a zipped ordinary program, a signed Windows program and an essay that mentions dota2.exe are not flagged. Real cheat downloads were deliberately not used: they are a common malware route, and the test PC has Steam accounts and Dota 2 installed.
