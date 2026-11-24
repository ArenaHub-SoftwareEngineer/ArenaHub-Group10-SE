# ArenaHub POV for iPhone

ArenaHub POV shares an iPhone's screen live with the match facilitators through LiveKit, using Apple's ReplayKit broadcast extension. The extension keeps capturing while the player switches to MLBB or CODM. The phone sends one stream to the match's LiveKit room; only match staff can watch it.

Setup follows LiveKit's guide: https://github.com/livekit/client-sdk-swift/blob/main/Docs/ios-screen-sharing.md

**Status: not built or tested.** Building needs a Mac with Xcode 26 or later and a paid Apple developer account. Until a signed build exists, facilitators watch iPhone players from the in-game observer slot, or a capture computer shares a mirrored iPhone (see the sharing page).

## Build

1. On a Mac with Xcode and XcodeGen, run `xcodegen generate` in this folder and open `ArenaHubPOV.xcodeproj`. Xcode fetches the LiveKit Swift package (`client-sdk-swift`, 2.20.0 or later) for both targets.
2. Select your Apple development team for both targets. Set `POV_BUNDLE_ID` to the app identifier registered by your team. The broadcast extension uses that identifier plus `.broadcast`, and both targets share the App Group `group.<POV_BUNDLE_ID>`. These are the names the LiveKit SDK looks for by default.
3. Install a signed build on the tournament iPhone, or distribute it through your team's TestFlight.

## Share a match

1. Check in for your match, open **Open screen sharing**, then **Copy private sharing link**.
2. Open ArenaHub POV, paste the link, and choose **Check match**. Confirm your name, match and server. Turn on Focus so personal notifications stay off the stream.
3. Choose **Start sharing**, then **Start Broadcast** on the system sheet, and return to your game.
4. If the referee pauses the match, the app shows the pause. To stop, choose **Stop sharing** or tap the red recording indicator.

Open questions to check on the first real build (the LiveKit guide does not say): whether the app needs a background mode to stay connected while the game is in front, and whether **Stop sharing** ends the system broadcast or only unpublishes it.
