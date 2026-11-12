# Match monitor: event setup (LAN mode)

This runbook is for tournament staff running ArenaHub's Match monitor from one Windows laptop at an on-campus event. It costs nothing to run: Firebase stays on the free Spark plan, and recordings stay on the laptop.

## What it does, and what it cannot do

ArenaHub cannot see inside Mobile Legends, CODM or Dota 2. iOS blocks it completely. On Android, reading another game's memory needs root, and the game's own anti-cheat would ban the player. On PC, touching Dota 2's memory risks a Valve Anti-Cheat (VAC) ban. So the monitor never does any of that.

It does three things instead:

1. It checks the device around the game:
   - Is the game app the official build?
   - Are known cheat tools installed?
   - Is the phone rooted?
   - Are screen-control or overlay apps on?
   - Is debugging enabled?
   - On PC, are blocklisted programs running?
2. It records evidence: screen recordings from phones, a screenshot every 20 seconds from PCs, and Dota 2's official live data.
3. It scores the risk from 0 to 100 and shows a referee why. The score only says how soon a referee should look. A referee decides, through the normal Fair play case flow.

| Device | Tool | Status |
|---|---|---|
| Android phone (MLBB, CODM) | ArenaHub Companion APK | Source in `companion/android`. Build it once in Android Studio (see below) |
| Windows PC (Dota 2) | `arenahub-agent.exe` | Run `npm run build:agent` |
| iPhone | Not supported yet | iPhone players play on an organizer Android device or under direct referee watch |

## One-time preparation

1. **Build the PC agent.** Run `npm run build:agent`. It writes `dist-agent/arenahub-agent.exe` (about 90 MB, with no install needed). Copy it to a USB drive for player PCs. Windows SmartScreen may warn that it is unsigned. Choose "More info", then "Run anyway".
2. **Build the Android app.** See `companion/android/README.md`. Copy `app-debug.apk` to a shared folder, a USB drive or a group chat. Players install it once.
3. **Allow phones to reach the laptop.** Open PowerShell as Administrator once and run:
   ```powershell
   New-NetFirewallRule -DisplayName "ArenaHub LAN 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
   ```
   Then, in Windows Settings > Network, mark the event network as **Private**. The rule never opens the port on public networks.
4. **Review the blocklists.** Open Admin > Match monitor > Blocklists and thresholds. The starter lists are a guide only, because cheat tools rename themselves often. A trailing `*` matches the start of a name.
5. **Trust the official game builds.** Do this before the first match, and again after each big game update:
   1. Install MLBB and CODM from the Play Store on a phone that staff control.
   2. Pair that phone like a player's phone.
   3. Open its session. The signal "Game signature not on the trusted list" shows a **Trust** button. Press it.

   From then on, any phone whose game is signed differently is flagged as critical. That is what a modified game app looks like.

## Event day

1. **Network.** Connect the laptop and every player device to the same network. Many campus Wi-Fi networks block devices from reaching each other ("client isolation"). If phones cannot connect, turn on Windows **Mobile hotspot** on the laptop, or use a cheap router with no internet needed. The games still need internet, so the hotspot must share the laptop's connection.
2. **Start ArenaHub in LAN mode** from the project folder:
   ```powershell
   npm run build
   $env:HOST = "0.0.0.0"; npm start
   ```
3. On the laptop itself, open `http://localhost:3000`. Sign in with a staff account and go to **Admin > Match monitor**. Use the laptop for the staff page, because Google sign-in only works on `localhost`, not on the Wi-Fi address.
4. **Pair each player.** For each player:
   1. Choose the match, the game and the player.
   2. Check the laptop address. It fills itself in, for example `http://192.168.137.1:3000`.
   3. Press **Create pairing code**.

   Each code works once and expires after 5 minutes.
   - **Android:** the player scans the QR code with the phone camera. That opens the Companion. The player reads the notice, ticks the box, presses Start, and allows "entire screen" recording. A "monitoring is ON" notification stays visible for the whole match.
   - **PC:** the player runs the command shown under the QR code, for example `arenahub-agent.exe --server http://192.168.137.1:3000 --code ABCD2345`, and types YES. For Dota 2, the player must **restart Dota 2** after pairing so it loads the live-data connection.
5. **During the match**, the session list refreshes every 5 seconds:
   - "Not reporting" means the device went quiet for more than 45 seconds.
   - Coloured edges show the level: watch (blue), review (amber), urgent (red).
6. **After the match:**
   - Press **End monitoring** on each session, or let the window close by itself. Devices stop on their next report.
   - For Dota 2, press **Check stats on OpenDota**. This only works once OpenDota has the match, and only if the player has "Expose Public Match Data" turned on in Dota 2 settings.
   - For a flagged session, review the recordings. If it needs a case, press **Copy case summary**, file it in **Fair play** with the clip, then tick **Keep this evidence past 30 days** and save the review.

## Storage and retention

- Data lives in `data/` in the project folder: `integrity.db` plus `recordings/<session>/`. It is git-ignored and never uploaded.
- A phone records at about 2.5 Mbit/s, which is roughly **1.1 GB per player per hour**. For example, ten phones over a three-hour event need about 33 GB. Check free disk space before the event.
- Ended sessions older than 30 days are deleted automatically, except sessions a referee marked to keep.

## Known limits

- Every check runs on the player's own device, so a skilled attacker with a modified companion app could send false reports. The monitor raises the cost of cheating and creates evidence. It does not replace referees watching in person.
- Accessibility and overlay apps include normal apps (password managers, chat heads, TalkBack). They are "medium" or "low" for that reason. Read the evidence before acting.
- Stat outliers mean a player had an unusually good game. They are context only.
- The Android app has not yet been built or tested on a real phone. Test it on two or three phones with different Android versions before the first event.
- Remote (off-campus) matches need a tunnel such as Cloudflare Tunnel, which is not set up yet.

## Troubleshooting

| Problem | Fix |
|---|---|
| The phone shows "Cannot reach ..." | Same network? Firewall rule added? Network set to Private? Try the laptop hotspot. |
| No laptop address is shown | The server was started without `HOST=0.0.0.0`, or the laptop is not on Wi-Fi. |
| "That pairing code is wrong, already used or expired" | Create a new code. |
| Dota 2 live data is empty | The player must restart Dota 2 after pairing. Steam must be installed normally. |
| Recording stopped | The player stopped screen sharing, or Android ended it. The session shows "Screen recording stopped". Ask the player to pair again. |
