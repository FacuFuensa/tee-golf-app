import SwiftUI

/// Milestone 2/3 entry point.
///
/// `WatchLink.start()` runs here rather than in `ContentView.onAppear` because
/// activation has to survive the view being torn down and rebuilt — SwiftUI is
/// free to do that at any time, and re-activating a live WCSession on every
/// redraw would churn the delegate. The scene outlives every view in it, so
/// this is the one place it happens exactly once.
@main
struct TeeWatchApp: App {
  init() {
    WatchLink.shared.start()
  }

  var body: some Scene {
    WindowGroup {
      ContentView()
    }
  }
}
