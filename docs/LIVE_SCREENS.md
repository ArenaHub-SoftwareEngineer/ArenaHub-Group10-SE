# Live player screens

Facilitators watch every player's screen during a match on **Monitor → Live screens**: choose a game, choose the match, and the wall shows all screens at once with each player's in-game name and team. Click a screen to spotlight it (big view plus a strip of the others), or open it full screen. **Pause match** shows a pause notice on every player's sharing screen.

## How it works

```
Player phone / PC ──(1 WebRTC upload)──► LiveKit media server (SFU) ──► Facilitator 1
                                                                    └──► Facilitator 2 ...
ArenaHub API: signs short-lived access tokens only. Video never passes through ArenaHub.
```

- **One upload per player.** LiveKit forwards the stream to each watcher, so extra facilitators add no work on the player's device.
- **Simulcast + adaptive stream.** Each player sends a small 360p layer and a 720p/15 fps layer. Grid tiles receive the small one; only a spotlighted or full-screen player receives 720p. Tiles nobody can see are paused on the server.
- **Dynacast.** When nobody watches a layer, the player's device stops encoding it.
- **Hardware encoding.** H.264 is preferred (phones and most PC graphics cards encode it in hardware, leaving the CPU to the game). Browsers without H.264 fall back to VP8.
- **Privacy.** Players can publish only their screen (no camera, no microphone) and cannot watch anyone, including opponents. Staff join hidden and cannot publish. Tokens last 4 hours.

Open-source projects used:

| Project | Used for |
|---|---|
| [livekit/livekit](https://github.com/livekit/livekit) | The media server (Apache-2.0), cloud or self-hosted |
| [livekit/client-sdk-js](https://github.com/livekit/client-sdk-js) | PC sharing page (`public/pov.js`) and the staff wall |
| [livekit/components-js](https://github.com/livekit/components-js) | React hooks for the wall (`LiveKitRoom`, `useTracks`, `VideoTrack`, `useRoomInfo`) |
| [livekit/client-sdk-android](https://github.com/livekit/client-sdk-android) | Android companion screen sharing (MediaProjection) |
| [livekit/server-sdk-js](https://github.com/livekit/node-sdks) | Token signing and the pause (room metadata) on the ArenaHub API |

## Who shares how

| Device | How | Notes |
|---|---|---|
| Windows PC (Dota 2) | Check in, then **Open screen sharing** → **Share my screen** in Chrome or Edge | Choose **Entire screen**. A window share can turn black when the game goes full screen. Needs an HTTPS page (any hosted ArenaHub address, or `npm run online`). |
| Android (MLBB, CODM) | The companion app: **Share with the Android Companion** on the sharing page | Choose **Entire screen** when Android asks. A single-app share hides other apps' floating windows (where overlay cheat menus live). Stop from the notification. |
| iPhone | A free streaming app (PRISM Live Studio, or any app with a Custom RTMP screen broadcast) sending to the ArenaHub iPhone relay | Safari cannot capture the screen, and a native broadcast app needs a paid Apple developer account and a Mac. PRISM is free on the App Store and broadcasts the whole iPhone screen over RTMP. The relay passes it to the wall without re-encoding. See [iPhone relay](#iphone-relay-free). The native POV app (`companion/ios`) stays an option if a paid Apple account ever becomes available. |

## Facilitators

Organizers and admins can watch every match. On the match list, **Facilitators** assigns up to four staff emails to a match. Those staff see only their assigned matches.

## Pause

**Pause match** writes the pause into the LiveKit room. Every player in that match sees it at once: a red notice on the PC sharing page, and a heads-up notification on Android. If the match is broadcasting live, the dialog can also pause the spectator broadcast.

ArenaHub cannot pause Mobile Legends, CODM or Dota 2 itself. Those games have no outside control. The lobby host pauses in game.

## Setup

ArenaHub needs three server settings (never `VITE_` prefixed):

```
LIVEKIT_URL=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

Restart the dev server or redeploy after changing them. Vite does not reload server files.

### Option A: LiveKit Cloud (recommended)

1. Create a free project at https://cloud.livekit.io (no credit card on the Build plan).
2. Settings → Keys: create a key, then copy the URL, key and secret into `.env` (and the API host's settings).

Free Build plan (livekit.com/pricing, checked 24 Nov 2026): 5,000 participant-minutes and 50 GB downstream a month, 100 people connected at once. A 5v5 MLBB match of 20 minutes with one facilitator uses about 11 × 20 = 220 minutes, so roughly 20 matches a month. For a larger event, self-host (Option B) or upgrade.

It works on any network (players on their own mobile data included), and the address is `wss://`, which HTTPS pages need.

### Option B: self-hosted on the event laptop (unlimited, same Wi-Fi only)

1. Download `livekit_<version>_windows_amd64.zip` from https://github.com/livekit/livekit/releases and check it against `checksums.txt`.
2. Save this as `livekit.yaml` (use the laptop's Wi-Fi address):

   ```yaml
   port: 7880
   rtc:
     tcp_port: 7881
     port_range_start: 50000
     port_range_end: 50200
     use_external_ip: false
     node_ip: 192.168.x.x
   keys:
     devkey: <a long random secret>
   ```

   Use a port range. On Windows, `livekit-server --dev` (one shared UDP port) did not connect browsers in our test on 24 Nov 2026; the port range above did.
3. Run `livekit-server.exe --config livekit.yaml` and allow it through Windows Firewall when asked.
4. Set `LIVEKIT_URL=ws://192.168.x.x:7880`, `LIVEKIT_API_KEY=devkey`, `LIVEKIT_API_SECRET=<the secret>`.

Limit: a `ws://` server works for the Android companion (LAN test build, `ARENAHUB_ALLOW_HTTP_LAN=1 npm run build:companion`) and for staff on the laptop, but not for PC players on an HTTPS page (browsers block `ws://` from HTTPS). PC sharing over the LAN needs LiveKit with TLS (a domain and certificate), so use Option A for Dota 2.

## iPhone relay (free)

iPhones share through a small relay server ([MediaMTX](https://github.com/bluenviron/mediamtx), open source) instead of LiveKit:

```
iPhone: PRISM "Screen" broadcast --RTMP--> relay (MediaMTX on a free cloud VM) --WebRTC (WHEP)--> staff wall
                                              |  asks before every publish, view and API call
                                              v
                                   ArenaHub API  POST /api/integrity/relay/auth
```

- **Player:** after check-in, the sharing page on the iPhone shows an RTMP server and a private stream key with Copy buttons and four steps: install PRISM, add a Custom RTMP channel, choose Screen mode, and go live. The key is signed for that player and that match, and stops working when the check-in ends.
- **Staff:** iPhone tiles appear on the same wall as Android and PC players. They fill the player's roster seat and are labelled "iPhone". Facilitators get a 30-minute pass for their own match only. The match list counts iPhones as sharing.
- **Cost:** nothing. The relay does not re-encode, so an Oracle Cloud Always Free VM (Ampere A1, 10 TB/month traffic) is enough for a tournament. Oracle asks for a card to verify the account but does not charge for Always Free resources. No LiveKit minutes are used.
- **Latency:** about 1 to 2 seconds (RTMP from the phone, then WebRTC to the wall).
- **Limits:** PRISM's free plan may add a small PRISM watermark, which is fine for referees. The iOS broadcast stops if the player stops it, restarts the phone, or iOS ends it under memory pressure. The wall shows "Reconnecting to iPhone…", and the player starts the broadcast again. Players do not see the referee pause notice while they are in the game, so the facilitator tells the lobby host.

### Set up the relay (once)

1. Create a free Oracle Cloud account and an **Always Free** VM: Ubuntu 22.04 or 24.04, shape VM.Standard.A1.Flex (1 OCPU and 6 GB is plenty). Keep the SSH key.
2. In the VM's subnet **Security List**, add ingress rules from `0.0.0.0/0`: TCP 80, 443, 1935 and 8189, and UDP 8189.
3. Copy `deploy/iphone-relay/` to the VM and run:
   `sudo bash setup.sh https://arenahub-live.vercel.app https://arenahub-esports.web.app`
   It installs MediaMTX and Caddy (free HTTPS through `<ip>.sslip.io`), opens the VM firewall, and prints the settings below.
4. On the ArenaHub API (Vercel environment variables), set the following, then redeploy with `npm run deploy:api`:
   - `IPHONE_RELAY_RTMP=rtmp://<vm-ip>:1935`
   - `IPHONE_RELAY_WEB=https://<vm-ip-with-dashes>.sslip.io`
   - `IPHONE_RELAY_SECRET=<openssl rand -base64 36>`
5. Check: `https://<host>/v3/paths/list` answers 401 (running and protected). Then do a real test with one iPhone.

Local test (no cloud): run `mediamtx.exe` with `deploy/iphone-relay/mediamtx.yml`, with the auth URL pointing at the dev server. Set `IPHONE_RELAY_RTMP=rtmp://127.0.0.1:1935`, `IPHONE_RELAY_WEB=http://127.0.0.1:8889` and `IPHONE_RELAY_API=http://127.0.0.1:9997`. ffmpeg can stand in for PRISM:
`ffmpeg -re -f lavfi -i testsrc2=size=1280x720:rate=30 -c:v libx264 -tune zerolatency -g 30 -f flv "<server>/<stream key>"`.

## Testing

- API and token rules: `npm run test:integrity-api` (`tests/room-codes.test.ts` decodes real LiveKit tokens to check their permissions).
- Browser, end to end with real video: start a LiveKit server (Option B config), then run the Playwright test `tests/e2e/screen-wall.spec.ts` with `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` set. The test publishes a generated test pattern, never the real desktop. Without `LIVEKIT_URL` it is skipped.
- iPhone relay: `tests/room-codes.test.ts` covers stream keys and the relay checks for publish, view and API. A real run (MediaMTX, ffmpeg over RTMP, and Chromium playing over WHEP) passed on 2026-11-25. PRISM on a real iPhone has not been tested yet.
- Android: `npm run test:companion` builds, unit-tests and lints the app. Screen sharing on a real phone has not been tested yet.
