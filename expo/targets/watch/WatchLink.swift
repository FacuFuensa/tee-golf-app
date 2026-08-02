import Foundation
import WatchConnectivity

/// The watch half of the link. Receives round state from the iPhone and sends
/// stroke edits back.
///
/// Not marked `@MainActor`: `WCSessionDelegate` callbacks arrive on a private
/// background queue, so an actor-isolated delegate would either fail to conform
/// or force every callback through an `await` hop. Publishing is hopped to main
/// explicitly instead, which is the same result with none of the ceremony.
final class WatchLink: NSObject, ObservableObject {
  static let shared = WatchLink()

  /// The last state the phone sent. Nil until the first context arrives, which
  /// is what the idle screen keys off — see `ContentView`.
  @Published private(set) var context: WatchContext?

  /// True once activation has completed, whatever the phone has or hasn't sent.
  /// Distinguishes "connecting" from "connected, no round" on the idle screen,
  /// which is the difference between a broken app and an idle one.
  @Published private(set) var isActivated = false

  /// Optimistic stroke count, shown instead of the phone's until it catches up.
  ///
  /// Without this the `+` button feels broken: a tap would send a message and
  /// then show nothing until the phone answered, which over a queued transfer
  /// can be seconds.
  @Published private(set) var pendingStrokes: Int?
  private var pendingHoleId: String?
  private var pendingAt: Date?

  /// How long the optimistic value outranks the phone.
  ///
  /// This exists to resolve one specific conflict: the golfer taps `+` on the
  /// watch and then edits the same hole on the phone. Both are legitimate, and
  /// the phone has to win — it is the source of truth and the golfer is looking
  /// straight at it. Expiring the override is what lets it. Eight seconds is
  /// comfortably longer than a round trip when the phone is reachable, so in
  /// the ordinary case the phone's confirmation clears the override before this
  /// ever fires.
  private let pendingTTL: TimeInterval = 8

  /// Edits made before activation finished. Small, but dropping one loses a
  /// stroke the golfer actually took, silently — the exact failure this app has
  /// already shipped three times in other forms.
  private var outbox: [WatchMessage] = []

  private override init() {
    super.init()
  }

  func start() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    if session.activationState != .activated {
      session.activate()
    }
  }

  /// What the UI shows: the optimistic value while it is in force, otherwise
  /// whatever the phone last said.
  var displayedStrokes: Int {
    guard let context else { return 0 }
    if let pendingStrokes, pendingHoleId == context.holeId {
      return pendingStrokes
    }
    return context.strokes
  }

  var canRecordStroke: Bool {
    guard let context else { return false }
    return context.active
  }

  func addStroke() {
    guard let context, context.active else { return }
    let next = displayedStrokes + 1

    let message = WatchMessage(
      v: watchPayloadVersion,
      type: "setStrokes",
      roundId: context.roundId,
      holeId: context.holeId,
      strokes: next
    )

    pendingStrokes = next
    pendingHoleId = context.holeId
    pendingAt = Date()

    deliver(message)
  }

  private func deliver(_ message: WatchMessage) {
    let session = WCSession.default
    guard session.activationState == .activated else {
      outbox.append(message)
      return
    }
    guard
      let data = try? JSONEncoder().encode(message),
      let json = String(data: data, encoding: .utf8)
    else {
      return
    }

    // Two paths, on purpose.
    //
    // transferUserInfo is queued, persisted and delivered in order even if the
    // phone app is not running — iOS launches it in the background to hand the
    // payload over. It is the guarantee that a stroke is never lost.
    //
    // sendMessage only works while the phone is reachable, but it lands
    // immediately. Without it, a tap taken with the phone in your pocket and
    // the app open would still wait for the transfer queue to drain.
    //
    // The phone therefore sees some edits twice. That is safe only because
    // `strokes` is absolute — see the comment on WatchMessage.
    session.transferUserInfo(["json": json])
    if session.isReachable {
      session.sendMessage(["json": json], replyHandler: nil, errorHandler: { _ in
        // The queued copy above is the one that guarantees delivery; a failure
        // on the live path costs nothing.
      })
    }
  }

  private func flushOutbox() {
    guard !outbox.isEmpty else { return }
    let queued = outbox
    outbox.removeAll()
    for message in queued {
      deliver(message)
    }
  }

  fileprivate func apply(rawContext: [String: Any]) {
    guard
      let json = rawContext["json"] as? String,
      let data = json.data(using: .utf8),
      let decoded = try? JSONDecoder().decode(WatchContext.self, from: data)
    else {
      return
    }

    // A phone newer than this watch build may be sending a shape this cannot
    // read. Showing the idle screen is the honest outcome; rendering fields
    // half-understood is not.
    guard decoded.v == watchPayloadVersion else { return }

    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.resolvePending(against: decoded)
      self.context = decoded
    }
  }

  /// Decide whether the optimistic stroke count still stands.
  private func resolvePending(against incoming: WatchContext) {
    guard pendingStrokes != nil else { return }

    // A different hole (or a different round) makes the override meaningless.
    if pendingHoleId != incoming.holeId {
      clearPending()
      return
    }
    // The phone has caught up — its value and ours agree.
    if incoming.strokes == pendingStrokes {
      clearPending()
      return
    }
    // The phone disagrees and the grace period has run out. It wins.
    if let pendingAt, Date().timeIntervalSince(pendingAt) > pendingTTL {
      clearPending()
    }
  }

  private func clearPending() {
    pendingStrokes = nil
    pendingHoleId = nil
    pendingAt = nil
  }
}

extension WatchLink: WCSessionDelegate {
  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    let activated = activationState == .activated

    // `receivedApplicationContext` holds the last context the phone sent, kept
    // by the system across launches. Reading it here is what makes the watch
    // app show the current hole the instant it opens instead of sitting on the
    // idle screen waiting for the phone to push again — which, since the
    // context only changes when the state does, might not happen for minutes.
    let stored = activated ? session.receivedApplicationContext : [:]

    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.isActivated = activated
      if activated {
        self.flushOutbox()
      }
    }

    if activated && !stored.isEmpty {
      apply(rawContext: stored)
    }
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    apply(rawContext: applicationContext)
  }
}
