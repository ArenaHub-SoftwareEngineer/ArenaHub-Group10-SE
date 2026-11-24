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
| iPhone | The ArenaHub POV app (`companion/ios`), once a signed build exists | iOS lets only a native app with a Broadcast Upload Extension share the screen; a web page cannot. The app is ported to LiveKit but has never been built: that needs a Mac and an Apple developer account. Until then, facilitators watch iPhone players from the in-game observer slot, or a capture computer shares a mirrored iPhone (steps on the sharing page). |

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

## Testing

- API and token rules: `npm run test:integrity-api` (`tests/room-codes.test.ts` decodes real LiveKit tokens to check their permissions).
- Browser, end to end with real video: start a LiveKit server (Option B config), then run the Playwright test `tests/e2e/screen-wall.spec.ts` with `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` set. The test publishes a generated test pattern, never the real desktop. Without `LIVEKIT_URL` it is skipped.
- Android: `npm run test:companion` builds, unit-tests and lints the app. Screen sharing on a real phone has not been tested yet.
