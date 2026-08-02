import Foundation

/// The wire contract with the iPhone app.
///
/// These mirror `WatchContext` and `WatchMessage` in
/// modules/tee-watch-bridge/index.ts. The field names are the contract — they
/// are what JSON.stringify writes and what JSONDecoder reads — so renaming one
/// on either side without the other breaks the link silently, with the watch
/// simply falling back to its idle screen and nothing logging a reason.
///
/// Everything optional is optional because the phone genuinely may not know it:
/// a hand-mapped course can have no par, and the yardage is absent until GPS
/// has a fix. Decoding must not fail over a missing one, which is why they are
/// `?` rather than defaulted.

/// Phone -> watch.
struct WatchContext: Codable, Equatable {
  let v: Int
  let active: Bool
  let roundId: String
  let holeId: String
  let holeNumber: Int
  let par: Int?
  let strokes: Int
  let distance: Int?
  let unit: String
  let status: String
  let courseName: String
  let holeCount: Int

  /// Mirrors the three states the phone's own hero number can be in, so the two
  /// screens never disagree about whether there is a distance to show.
  enum Status: String {
    case ok
    case searching
    case offcourse
  }

  var resolvedStatus: Status {
    Status(rawValue: status) ?? .searching
  }

  /// "YARDS" / "METERS" under the big number, matching the phone's own label.
  var unitCaption: String {
    unit == "m" ? "METERS" : "YARDS"
  }
}

/// Watch -> phone.
///
/// `strokes` is the absolute count for the hole, never a delta — see the long
/// note on the TypeScript side. The same edit is deliberately sent twice (once
/// live, once queued), so the phone must be able to apply the same message
/// repeatedly without changing the answer.
struct WatchMessage: Codable {
  let v: Int
  let type: String
  let roundId: String
  let holeId: String
  let strokes: Int
}

/// Bumped only on a breaking shape change. A watch running an older build than
/// the phone stops rather than rendering fields it is misreading.
let watchPayloadVersion = 1
