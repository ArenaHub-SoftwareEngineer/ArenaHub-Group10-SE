# Anti-cheat coverage and indicator research

Reviewed 17 November 2026. This document distinguishes publisher-confirmed cheat categories, defensive platform analysis, implemented checks and unverified device behavior. It is not a current cheat download catalogue or a universal detection database.

## What the publishers confirm

**MLBB:** MOONTON's April 2026 enforcement report describes cheat software providing map hacks and drone-style vision. This establishes those threat categories, not a stable package name, file path or fingerprint. A camera/skin/automation claim from an unverified seller is not automatically a verified working cheat. [MOONTON enforcement report](https://en.moonton.com/news/322.html).

**CODM BR and MP:** Activision's Mobile enforcement policy lists unauthorized software such as aim assistance cheats, wall information cheats, trainers, injectors and unauthorized modifications to game data. The policy applies to CODM; it does not publish separate, exhaustive BR/MP signature feeds or guarantee that every advertised feature works. [Activision policy](https://support.activision.com/content/atvi/support/web/en/cod-mobile/articles/call-of-duty-mobile-security-enforcement-policy.html).

**Dota 2:** Valve documented third-party software accessing client information unavailable during normal play and action against users of that software. It does not expose a public signature feed for ArenaHub or grant access to Valve's internal detection. [Valve's report](https://www.dota2.com/newsentry/3677788723152833273).

## How suspicious software can be packaged

The following are **defensive platform inferences**, not instructions for installing a cheat or claims that every named game currently has every variant:

- An Android modified game may be distributed as a replacement/re-signed APK. Android installs its package and signer metadata; this is where package visibility and signing-certificate comparisons help. Official regional builds and legitimate key rotations must be distinguished from tampering.
- A separate Android companion/tool APK can provide overlays, accessibility-driven input, privileged services or a virtualized environment. Its package, signer and permissions may be observable. Many apps with these capabilities are legitimate, and a package name is easy for an attacker to change.
- Scripts/macros may be data loaded by another application rather than a separate executable. Finding the interpreter or automation application does not establish the content or use of its scripts. The present collectors do not search private script folders.
- Modified assets/configuration or injected components may reside in app storage or memory without a distinctive installed-app entry. ArenaHub does not open another game's private Android data, inspect game memory or scan arbitrary personal files.
- On Windows, tools may be registered desktop applications, portable EXE loaders, DLL modules, scripts or drivers. Registered application detection covers only registry entries; running-file fingerprints cover accessible process executable files. The 3.1 collector also checks normal OS-reported Dota DLL modules. Inactive portable files and hidden drivers remain outside these observations.
- External input automation, another computer, hardware assistance or a tampered operating system may leave no reliable indicator in these user-mode reports.

Android limits package visibility, and broad visibility is a sensitive capability subject to distribution policy. An APK built successfully is not proof that every device grants complete visibility. [Android package visibility](https://developer.android.com/training/package-visibility), [app signing](https://developer.android.com/studio/publish/app-signing). Windows registered-software inspection uses documented Uninstall metadata; entries can be incomplete, stale or changed by an attacker. [Microsoft's registry reference](https://learn.microsoft.com/en-us/windows/win32/msi/uninstall-registry-key).

## Current known-indicator checks (3.1)

**Windows / Dota 2**

1. Read running processes using Windows CIM and match configured exact/prefix names.
2. Read machine/current-user registered software, including 32-bit Uninstall metadata, and report configured name matches even if that software is stopped.
3. Optionally compute SHA-256 of accessible running executable files and normal loaded Dota libraries and report configured fingerprint matches. Renaming preserves identical file bytes; repackaging changes them. Limits are 128 MiB per file, a scan time budget, local caching and bounded reported matches.
4. Report completed/partial/failed inspection status. Failures do not become a clean-device conclusion.
5. Collect optional screenshots and separate Dota GSI context. The telemetry token cannot control a session, and GSI/media traffic does not refresh scanner freshness.

**Android / MLBB and CODM**

1. Compare visible installed packages with the configured policy.
2. Report game signing certificates and installers; compare them with the correct staff-established regional trust list.
3. Optionally compare visible apps' signer hashes with staff-configured indicators, reporting matches only.
4. Report root/emulator heuristics, accessibility/overlay services and debugging settings, plus incomplete package/signature/overlay observations.
5. Capture the screen only when the session permits recording and the user grants OS capture consent. Standard builds require HTTPS and disable backup and debugging. Physical-device validation remains pending.

**iPhone / MLBB and CODM**

Check-in/decline and optional voluntary recording upload only. There is no installed-app detector. Apple's app sandbox restricts access to other apps; a website has still less access. Your available iPhone can verify Safari usability and uploads, not certify the absence of cheats. [Apple runtime security](https://support.apple.com/en-ie/guide/security-pdf/sec15bfe098e/1/web/1).

## Evidence quality and operator workflow

An installed-name entry, running-process name, exact file hash, signer certificate and observed gameplay are different evidence. The UI keeps those distinctions and shows scan coverage. A name can be copied; a signer can sign several apps; a known hash can identify a legitimate dual-use tool. Validate each indicator using trusted provenance, version/date, local harmless fixtures and a second reviewer. Do not automatically punish or mark someone clean from these reports.

The starter lists contain tools with legitimate uses and require organizer review. File and blocked-signer fingerprint lists are empty until staff provide verified indicators. This review did not obtain or execute live cheat samples. It therefore establishes that the configured detection mechanism works, not its recall against today's private cheats.

## Verification and next release work

Native Windows tests demonstrate a harmless live executable fingerprint flowing into the API's findings, and a selected real registered-software entry being filtered locally. Unit/API/browser tests exercise configured hashes, installed-vs-running evidence, server-side policy revalidation, unavailable/incomplete coverage, consent, token scope and upload authorization.

Before the first event: test the signed Windows release with Dota, test Safari on the available iPhone, and test Android when a consenting device is available. Include denied visibility/capture permissions, changed apps during a match, old/new publisher certificates, network loss, server expiry and stopping monitoring. Add independently verified indicators only after false-positive checks.

Publisher-integrated anti-cheat or managed tournament devices provide trust that a self-reported collector cannot. Attestation, kernel inspection and publisher partnerships are not implemented. No honest user-mode implementation can promise detection of every installed or hidden cheat on an attacker-controlled device.

## Mandatory pre-match admission

Both v3 companions submit current scan status with a session and policy stamp. ArenaHub admission requires a current passing scan for every published roster slot, including all squads in a CODM BR lobby. Changing the lineup invalidates earlier clearance, including replacements that reuse a slot ID. Official live transitions wait for the server admission check and a confirmed cloud save. The companion flags configured tool indicators and keeps other device-state observations visible for staff. Independent game launches and modified client software remain outside the enforcement boundary. INTEGRITY_SETUP.md describes the operator flow and provider assessment.


## Collector improvements in 3.1 (17 Nov 2026)

Windows now enumerates normal OS-reported modules for locally observed dota2.exe processes. It compares module names with staff policy and, when configured, fingerprints accessible module files. Full module inventories and module paths stay local. Only configured matches and inspection coverage are sent. The initial policy includes the Cheat Engine speed-modifier DLL names documented in the project's own source. Staff use matches to apply configured tournament restrictions. [Cheat Engine source](https://github.com/cheat-engine/cheat-engine/blob/master/Cheat%20Engine/speedhack2.pas), [Microsoft Process documentation](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process).

The scan reports failed/partial module inspection when access is denied, time/size limits are reached or a process disappears. A running Dota game needs complete configured module checks for admission. Before the game starts, module status is not-running and the companion continues inspecting on subsequent heartbeats. A named restricted library may remain loaded after its launcher closes, requiring the player to restart the game. Renamed libraries require configured fingerprints. Manually mapped/hidden modules, kernel tools and forged collectors remain beyond reliable coverage. Windows installed-software overflow and Android package-match overflow now retain incomplete coverage.

Android 3.1 fixes a JSON-stamp variable collision that could replace the session/policy object with cached inventory. Two JVM tests exercise real JSON serialization and policy changes independently of cached observations. The server now rejects empty game-certificate evidence even when coverage booleans claim success. This remains software-reported evidence. Physical Android testing is pending.


## Cheat families and coverage matrix (collector 3.2, 17 Nov 2026)

This table lists every cheat family we could identify for the tournament games, how each one reaches the device (at the level a defender needs), and what ArenaHub sees. It is a defensive map, not a how-to: there are no tool names to download, no offsets, no bypasses. "Sees" means a configured or structural indicator can appear in a report. It never means proof, and it never means the family is fully covered.

### Dota 2 on Windows

| Family | How it reaches the game | What 3.2 sees | What it cannot see |
| --- | --- | --- | --- |
| Internal cheat (map hack, auto-cast, auto-dodge, last-hit scripts) | A DLL loaded into `dota2.exe`, by an injector process, a proxy DLL beside the game, or a patched game file | Listed injector processes; extra binaries beside `dota2.exe` (Valve's list); unsigned libraries from user folders loaded into Dota; patched `client.dll`/`engine2.dll` (Valve SHA-1 list); configured module names and fingerprints | Manually mapped code with no module entry; kernel-mode loaders; libraries signed with a certificate the player trusted |
| External cheat (overlay ESP, radar) | A separate process reads game memory and draws its own window | Listed processes and fingerprints; installed-software names; optional folder check for portable copies | A renamed, unknown external tool; tools running on a second PC or DMA hardware |
| Camera zoom / vision hack | Memory edit (Cheat Engine tables) or a modified file | Running memory editors; Cheat Engine speed library in Dota; folder check for `.CT` tables targeting `dota2.exe`; modified `gameinfo.gi` | A private memory editor, or an edit made before the agent started and then closed |
| Content mod (removed weather or effects, brighter particles, custom models) | A content pack (VPK) mounted through `-language <name>`, an added `gameinfo.gi` search path or a replaced file | Non-Valve VPKs and folders, added search paths, `-language` launch option, modified files on Valve's list | Loose files dropped directly into `game/dota` subfolders (Valve also ships some loose files there, so they are not judged) |
| VAC disabled | `-insecure` launch option, sometimes required by loaders | Saved launch options of every Steam account on the PC and the running command line | A loader that patches the flag in memory |
| Macros / input automation | AutoHotkey or vendor mouse/keyboard software | Listed processes (AutoHotkey) and installed software; folder check for scripts that target `dota2.exe` | Macros stored in mouse or keyboard firmware; hardware input devices |
| Account sharing / boosting | Someone else plays on the account | Steam ID from Game State Integration vs. the registered ID; stats outliers | A legitimate account played by another person at the venue (needs ID checks) |
| Forged or modified agent | The player edits the agent or replays old reports | Session-bound challenge and policy stamp; staff-reference copy of Valve's list | A fully rewritten agent that fabricates every field. Only staff-controlled PCs close this |

### MLBB and CODM on Android

| Family | How it reaches the game | What 3.2 sees | What it cannot see |
| --- | --- | --- | --- |
| Modded game APK (map hack, drone view, aimbot, ESP built in) | A re-signed copy of the game installed from a file or third-party store | Game signing certificate vs. the staff trust list; installer package; game not installed from a store | A device that lies about package signatures (root plus a hook module) |
| Root plus hook modules (Magisk/KernelSU/APatch with Zygisk, LSPosed) | Code injected into the official game at runtime | Root files and mounts, root-manager packages, hook libraries visible in the companion, debuggable builds, permissive SELinux | Root hidden from the companion by deny-list or namespace tricks |
| Non-root patching (LSPatch) and app cloners or virtual phones (Parallel Space, VMOS, VPhoneGaga, VirtualXposed) | The game runs inside a container that injects modules | Listed packages; companion running from an unexpected data folder or loaded from a listed cloner | A container that hides itself, when the player does not also run the companion inside it |
| Frida-based scripts | A Frida server or gadget instruments the game | Frida libraries in the companion's memory map; a server answering on port 27042 | A renamed gadget embedded only in the game, or a server on another port |
| Memory editors (GameGuardian and similar) | A root or virtual-space app edits game memory | Listed packages, including GameGuardian's random-name pattern; root and container indicators | A renamed editor with a new package name and signer |
| Auto-tap, aim assist and recoil macros | Accessibility services or overlay apps that tap the screen | Enabled accessibility services, apps allowed to draw over others, listed auto-clicker packages | Hardware triggers and external controllers |
| Key mappers and emulators | Mouse and keyboard mapped to touch, or the game played on a PC emulator | Emulator build indicators; listed key-mapper packages (Octopus, Mantis); recording shows a pointer or PC resolution | A physical phone driven through a USB/Bluetooth mapping device |
| Debug-bridge control (Shizuku, wireless ADB) | A computer or privileged service drives the phone | USB/wireless debugging on, developer options, Shizuku package | Debugging turned on after the last report |
| Account sharing / piloting | Someone else plays on the account | Referee ID checks; recordings | Not detectable by the phone |

### MLBB and CODM on iPhone

| Family | How it reaches the game | What 3.2 sees | What it cannot see |
| --- | --- | --- | --- |
| Modified game build (IPA) | Installed through a sideload app, an enterprise or developer certificate, or TrollStore | Referee indicators: Developer Mode on, trusted enterprise or developer app, sideload apps present, the game's App Store page shows Get instead of Open, a duplicate or renamed game | Anything the referee did not check; a tweak hidden on a jailbroken phone |
| Jailbreak tweaks | Code injected into the official game on a jailbroken phone | Referee indicator: jailbreak apps (Sileo, Zebra, Cydia, Dopamine, palera1n) | A jailbreak with its apps hidden. No website or App Store app can inspect this |
| Network manipulation (lag switch, modified-content services) | A VPN, DNS or configuration profile | Referee indicator: VPN or profile the venue did not provide | A profile added after inspection (clearance lasts 15 minutes and supervision continues) |
| Screen-touch macros and controllers | Accessibility features or external devices | Supervision and recording | Not detectable by software on iPhone |

The iPhone column is deliberately manual. Apple's sandbox prevents any website, and any App Store app, from listing other apps or reading another app's memory, so a referee inspection plus continuous supervision is the strongest option without managed devices.

### What stays out of reach for any player-side collector

Kernel drivers, DMA cards and second-PC radar, hardware macros, a player who rewrites the collector, and private cheats with no public indicator. For finals and other high-stakes matches, use staff-owned devices, observer recording and publisher anti-cheat as well.


### Collector 3.3 update

The "What 3.3 sees" column now also applies to renamed files. Listed tools are recognised by their internal program identity; unknown cheats by being unsigned and targeting dota2.exe, by injector functions or by a commercial protector. Tables and macros are recognised under any extension, and ZIP archives are opened. Running programs get the same checks. Still out of reach: cheats stored in skipped system or cache folders and never run, password-protected, RAR or 7z archives, encrypted containers, and the kernel, hardware and forged-agent cases above.
