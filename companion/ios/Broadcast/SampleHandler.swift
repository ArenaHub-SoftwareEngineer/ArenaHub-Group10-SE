// The broadcast upload extension. iOS runs it while the player is in the game; LiveKit's handler passes the
// frames to the ArenaHub POV app through the shared App Group, and the app publishes them to the match.
// Setup follows https://github.com/livekit/client-sdk-swift/blob/main/Docs/ios-screen-sharing.md
import LiveKit

#if os(iOS)
@available(macCatalyst 13.1, *)
class SampleHandler: LKSampleHandler {
    override var enableLogging: Bool { true }
}
#endif
