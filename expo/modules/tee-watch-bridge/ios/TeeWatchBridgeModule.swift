import ExpoModulesCore
import WatchConnectivity

/// The iPhone half of the Tee <-> Apple Watch link.
///
/// EVERY VALUE CROSSING THIS FILE'S JS BOUNDARY IS A `String`, and that is a
/// deliberate constraint rather than laziness.
///
/// The Expo Modules API can convert dictionaries, but doing so leans on `Any`
/// having a registered dynamic type, and WatchConnectivity separately requires
/// every value in a payload to be a property-list type — so a dictionary-shaped
/// payload has to survive two independent conversions, neither of which can be
/// exercised from the Windows machine this is written on (there is no iOS
/// simulator, and `expo prebuild` is hard-blocked on win32). A mistake in
/// either would surface only after a ~17 minute build.
///
/// There is a concrete example of the hazard right here: `Module.sendEvent` is
/// declared `(_ eventName: String, _ body: [String: Any?] = [:])`. Handing it a
/// prepared `[String: Any]` does not compile, because Swift will not implicitly
/// convert `[String: Any]` to `[String: Any?]`. A dictionary *literal* at the
/// call site does compile, because a literal simply adopts the expected type.
/// That distinction is invisible until the compiler sees it, which is why the
/// surface is kept as narrow as it is.
///
/// Encoding once in JS and decoding once on the watch costs nothing at this
/// size — a payload is well under 200 bytes, sent at most about once a second.
public class TeeWatchBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TeeWatchBridge")

    Events("onMessageFromWatch", "onWatchStateChange")

    OnCreate {
      TeeWatchLink.shared.onEvent = { [weak self] name, json in
        // Literal, not a prepared dictionary — see the note above.
        self?.sendEvent(name, ["json": json])
      }
    }

    OnDestroy {
      TeeWatchLink.shared.onEvent = nil
    }

    /// False on iPad and anywhere without WatchConnectivity. Callers use this
    /// to skip the rest of the work entirely rather than to show UI.
    Function("isAvailable") { () -> Bool in
      WCSession.isSupported()
    }

    /// Safe to call repeatedly — activation is idempotent, and re-activating an
    /// already-active session is a documented no-op.
    Function("activate") { () -> Void in
      TeeWatchLink.shared.activate()
    }

    /// Latest-state-wins. `updateApplicationContext` replaces any previously
    /// queued context instead of appending, so calling this on every GPS tick
    /// cannot build a backlog: the watch always receives the most recent state
    /// and never a queue of stale yardages.
    Function("updateContext") { (json: String) -> Void in
      TeeWatchLink.shared.updateContext(json: json)
    }

    /// JSON snapshot of the watch side as seen from here.
    Function("getState") { () -> String in
      TeeWatchLink.shared.stateJSON()
    }
  }
}

/// What `getState` reports, and what rides the `onWatchStateChange` event.
private struct WatchLinkState: Codable {
  let supported: Bool
  let paired: Bool
  let appInstalled: Bool
  let reachable: Bool
  let activated: Bool
}

/// Owns the single `WCSession` and its delegate.
///
/// A singleton because `WCSession.default` is one process-wide object with
/// exactly one delegate slot. A `Module` instance can be created and torn down
/// more than once over an app's life (development reloads, for one), and
/// letting each new instance reassign the delegate would silently orphan the
/// previous one. Keeping the delegate here and swapping only the event callback
/// means activation state and the pending payload survive that churn.
final class TeeWatchLink: NSObject {
  static let shared = TeeWatchLink()

  /// Set while a module instance exists. Takes an event name and a JSON string.
  var onEvent: ((String, String) -> Void)?

  /// The most recent context that could not be delivered because the session
  /// had not finished activating. Activation is asynchronous and the round
  /// screen starts pushing state the moment it mounts, so without this the
  /// first — and on a short hole possibly the only — update is dropped.
  private var pendingJSON: String?
  private var didStartActivating = false

  private override init() {
    super.init()
  }

  func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    // Re-assigning the delegate on every call is harmless and self-healing: if
    // anything else in the process ever takes the slot, the next round reclaims
    // it.
    session.delegate = self
    if session.activationState != .activated {
      didStartActivating = true
      session.activate()
    } else {
      flushPending()
    }
  }

  func updateContext(json: String) {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default

    guard session.activationState == .activated else {
      pendingJSON = json
      if !didStartActivating { activate() }
      return
    }

    send(json: json, on: session)
  }

  private func send(json: String, on session: WCSession) {
    do {
      try session.updateApplicationContext(["json": json])
      pendingJSON = nil
    } catch {
      // The documented failure is a session that isn't activated, which the
      // guard above already covers. Anything else is transient, and the next
      // GPS tick sends a fresher payload anyway — holding the stale one back
      // beats surfacing an error the golfer cannot act on.
      pendingJSON = json
    }
  }

  private func flushPending() {
    guard let json = pendingJSON else { return }
    send(json: json, on: WCSession.default)
  }

  func stateJSON() -> String {
    let state: WatchLinkState
    if WCSession.isSupported() {
      let session = WCSession.default
      state = WatchLinkState(
        supported: true,
        paired: session.isPaired,
        appInstalled: session.isWatchAppInstalled,
        reachable: session.isReachable,
        activated: session.activationState == .activated
      )
    } else {
      state = WatchLinkState(
        supported: false,
        paired: false,
        appInstalled: false,
        reachable: false,
        activated: false
      )
    }
    guard
      let data = try? JSONEncoder().encode(state),
      let json = String(data: data, encoding: .utf8)
    else {
      return "{}"
    }
    return json
  }

  private func emitStateChange() {
    let json = stateJSON()
    DispatchQueue.main.async { [weak self] in
      self?.onEvent?("onWatchStateChange", json)
    }
  }

  fileprivate func emitMessage(json: String) {
    DispatchQueue.main.async { [weak self] in
      self?.onEvent?("onMessageFromWatch", json)
    }
  }
}

extension TeeWatchLink: WCSessionDelegate {
  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    if activationState == .activated {
      // Anything the round screen pushed while activation was still in flight.
      DispatchQueue.main.async { [weak self] in
        self?.flushPending()
      }
    }
    emitStateChange()
  }

  // Both of these are REQUIRED for WCSessionDelegate conformance on iOS (they
  // do not exist on watchOS). Omitting them is a compile error, not a runtime
  // surprise — but the reactivation in the second is the part that matters:
  // when the golfer switches to a different Apple Watch the session
  // deactivates, and must be re-activated to bind to the new device. Leaving it
  // empty means the link works right up until the day they change watches, and
  // then silently never works again.
  func sessionDidBecomeInactive(_ session: WCSession) {
    emitStateChange()
  }

  func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
  }

  func sessionWatchStateDidChange(_ session: WCSession) {
    emitStateChange()
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    emitStateChange()
  }

  /// The guaranteed path for the watch's stroke edits.
  ///
  /// `transferUserInfo` is queued, persisted and delivered in the order it was
  /// sent, even if this app was not running when it was queued — iOS launches
  /// it in the background to hand the payload over.
  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
    guard let json = userInfo["json"] as? String else { return }
    emitMessage(json: json)
  }

  /// The live path, used when the phone app is in the foreground so a tap on
  /// the watch lands immediately instead of on the next queue flush. The watch
  /// sends via this AND via `transferUserInfo`, so the same edit can arrive
  /// twice; that is safe only because every message carries an absolute stroke
  /// count rather than a delta.
  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    guard let json = message["json"] as? String else { return }
    emitMessage(json: json)
  }
}
