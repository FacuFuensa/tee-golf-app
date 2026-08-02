import SwiftUI

// Milestone 1 entry point. No WatchConnectivity, no shared state with the
// iOS app — just enough to prove the target embeds, signs, and installs.
// See .superpowers/sdd/watch-m1-report.md.
@main
struct TeeWatchApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
