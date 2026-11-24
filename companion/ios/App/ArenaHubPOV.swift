import SwiftUI
import LiveKit

@main struct ArenaHubPOV: App {
    var body: some Scene { WindowGroup { ShareView() } }
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Connects to the match's LiveKit room and shares the screen through the broadcast extension.
/// The phone uploads one stream; LiveKit forwards it to the match facilitators. Players cannot watch anyone.
@MainActor final class LiveShare: ObservableObject, RoomDelegate {
    @Published var sharing = false
    @Published var paused = ""
    private lazy var room = Room(delegate: self)

    func start(url: String, token: String) async throws {
        try await room.connect(url: url, token: token)
        showPause(room.metadata)
        // With the broadcast extension set up, LiveKit asks iOS to show the "Screen Broadcast" sheet here.
        try await room.localParticipant.setScreenShare(enabled: true)
        sharing = true
    }
    func stop() async {
        try? await room.localParticipant.setScreenShare(enabled: false)
        await room.disconnect()
        sharing = false; paused = ""
    }
    nonisolated func room(_ room: Room, didUpdateMetadata metadata: String?) {
        Task { @MainActor in self.showPause(metadata) }
    }
    private func showPause(_ metadata: String?) {
        let state = (metadata?.data(using: .utf8)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        guard state?["paused"] as? Bool == true else { paused = ""; return }
        let note = (state?["note"] as? String).map { "Reason: \($0). " } ?? ""
        paused = note + "Stop playing and pause the game now. Keep sharing until the referee resumes."
    }
}

struct ShareView: View {
    @StateObject private var live = LiveShare()
    @State private var link = ""
    @State private var identity = ""
    @State private var message = ""
    @State private var busy = false
    var body: some View {
        NavigationStack {
            Form {
                Section("Your match") {
                    SecureField("Paste your private sharing link", text: $link)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .onChange(of: link) { _ in identity = "" }
                    Button("Check match") { Task { await checkMatch() } }.disabled(busy || link.isEmpty || live.sharing)
                    if !message.isEmpty { Text(message) }
                }
                if !live.paused.isEmpty {
                    Section("The referee paused this match") { Text(live.paused).foregroundStyle(.red) }
                }
                if !identity.isEmpty {
                    Section(identity) {
                        Text("Your match facilitators watch your screen live. Other players cannot see it. Turn on Focus first: notifications are visible. Audio is off.")
                        if live.sharing {
                            Button("Stop sharing", role: .destructive) { Task { await live.stop() } }
                            Text("Return to your game. You can also stop from the red recording indicator.")
                        } else {
                            Button("Start sharing") { Task { await startSharing() } }.disabled(busy)
                            Text("Tap Start Broadcast on the next screen, then return to your game.")
                        }
                    }
                }
            }.navigationTitle("Share game screen")
        }
    }

    private func endpoint(_ action: String) -> (URLRequest, String)? {
        let entered = link.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var parts = URLComponents(string: entered), parts.scheme == "https", parts.host != nil,
              parts.path == "/pov.html", parts.user == nil, parts.password == nil, parts.query == nil,
              let key = parts.fragment, key.range(of: #"^[A-Za-z0-9_.-]{40,300}$"#, options: .regularExpression) != nil
        else { return nil }
        parts.fragment = nil; parts.path = "/api/integrity/device/pov/" + action
        guard let url = parts.url else { return nil }
        var request = URLRequest(url: url); request.httpMethod = "POST"
        request.setValue("Bearer " + key, forHTTPHeaderField: "Authorization")
        return (request, url.host ?? "")
    }
    private func call(_ action: String) async -> [String: Any]? {
        guard let (request, _) = endpoint(action),
              let (data, response) = try? await URLSession.shared.data(for: request, delegate: NoRedirects()),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
    @MainActor private func checkMatch() async {
        busy = true; message = ""; identity = ""
        defer { busy = false }
        guard let (_, host) = endpoint("info") else { message = "Copy the private HTTPS link from ArenaHub match check-in."; return }
        guard let info = await call("info"), let name = info["name"] as? String, let match = info["match"] as? String
        else { message = "Check-in unavailable. Open the link from your current match."; return }
        guard info["ready"] as? Bool == true else { message = "Live screens are not switched on for this event yet. Tell your organizer."; return }
        identity = name + " · " + match
        message = host
    }
    @MainActor private func startSharing() async {
        busy = true; defer { busy = false }
        guard let access = await call("token"), let url = access["url"] as? String, let token = access["token"] as? String
        else { message = "Sharing could not start. Check the match again."; return }
        do { try await live.start(url: url, token: token) }
        catch { message = "Sharing could not start: \(error.localizedDescription)"; await live.stop() }
    }
}
