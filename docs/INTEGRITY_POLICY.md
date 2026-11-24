# Match monitoring: player notice

Updated 17 November 2026. The tournament organizer must identify the hosting provider, responsible staff and contact details before using this notice with players. This is a technical description, not a certification of legal compliance.

## Your choice and the match window

Every roster player must pass a supported companion scan before match time. The organizer checks this; the website's Go live control does not. Monitoring starts after you agree on your device and lasts only for the assigned match window. You can decline, stop the app/agent, or refuse screen capture. Staff are told so they can arrange a supported organizer device. A declined or unsupported personal device does not pass required scan admission. Software does not decide a cheating penalty.

Android displays a foreground notification; Windows keeps the agent window open. Ending a session at the server revokes its credentials. Devices stop when they next contact the server; closing the local app/agent stops local collection immediately.

## Live game previews

After check-in, you can start live screen sharing through your private match link. Your game preview is visible to tournament administrators, organizers and the facilitator assigned to your match. The live wall sends silent screen previews and holds the latest frame briefly in the tournament server's memory. Opening the link or starting the scan leaves sharing off until you approve the screen capture on your device. Use the game's window or single-app option where available. When using the whole display, turn on Do Not Disturb or Focus to hide notifications. You can stop sharing through the sharing page, the Android companion or your device's system broadcast controls.

## Reports and recordings

**Windows:** the agent checks running program names and registered installed-software names against the tournament policy. It also checks configured restricted DLL names loaded into Dota 2 through normal OS module inspection. When staff enable file fingerprints, it reads accessible executable and Dota library files to compute SHA-256 hashes. Only matching entries, their paths/versions/hashes when available, Dota-running status and check-completion status are reported. The full process/software/module inventory and module paths stay on the PC. Matched module names and configured hashes are reported. Dota GSI reports hero, match ID, game state and Steam ID. Optional screenshots are captured every 20 seconds only when recording is enabled for the session.

**Android:** the companion reports game package/version, signing-certificate hashes and install source; listed installed apps and configured signer matches; root/emulator indicators; enabled accessibility services, permitted overlay apps and debugging settings. Optional usage access can report the foreground app. Device model, OS, collector version and session/policy scan metadata identify the session. The full installed-app inventory stays on the phone. Screen recording requires both the match recording setting and the Android capture prompt. No microphone or camera is used.

**iPhone:** the browser reports your check-in/decline and optional device details. No installed-app or cheat scan runs. If recording is enabled and you choose to provide it, you can upload your own screen recording.

The collectors do not inspect private documents, messages, contacts, photos, passwords, location, browser history or game memory. **Screen recordings and screenshots can still capture notifications or personal content that is visible on screen.** Close personal apps and enable Do Not Disturb before capture.

## Destination, access and retention

Reports and recordings go to the tournament API server shown in the join-page/agent address. For public hosting, this is a hosted server, not necessarily a laptop at the venue. Monitoring reports and recordings use its private disk storage, separate from Firestore. Fair Play cases submitted through the main website may use Firebase database/file storage under their own access rules.

Signed-in, active tournament staff can inspect sessions and recordings. Playback uses short-lived links: do not share them. Ended monitor sessions older than 30 days are removed unless staff set an explicit evidence hold. A hold remains until staff release it; it is not automatically tied to a case closing. Backups and host access also need the organizer's retention/access controls.

## Human review and requests

Installed software, process names, signing certificates, root indicators and unusual gameplay are review signals. They do not establish intent or prove cheating. A missing signal does not prove a clean device, especially if checks were incomplete or unavailable.

Contact tournament staff through ArenaHub Support for your monitoring record, corrections, retention questions or a decision review. Staff must verify the request and preserve evidence needed for any active case.
