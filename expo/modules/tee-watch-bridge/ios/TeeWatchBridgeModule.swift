import ExpoModulesCore
import WatchConnectivity

/// The iPhone half of the Tee <-> Apple Watch link.
///
/// EVERYTHING CROSSING THIS BRIDGE IS A SINGLE JSON STRING, in both
/// directions, and that is a deliberate constraint rather than laziness.
///
/// The Expo Modules API can convert dictionaries, but `[String: Any]` relies on
/// `Any` having a registered dynamic type, and WatchConnectivity separately
/// requires every value in a payload to be a property-list type — so a payload
/// built as a dictionary has to survive two independent, undocumented-at-the-
/// edges conversions. Neither can be exercised from the Windows machine this is
/// written on: there is no iOS simulator, and `expo prebuild` is hard-blocked
/// on win32. A mistake in either would surface only after a ~17 minute build.
///
/// `String` is unambiguous in both systems. Encoding once in JS and decoding
/// once on the watch costs nothing at this size (a payload is well under 200
/// bytes, sent at most about once a second) and removes the whole class of
/// error.
public class TeeWatchBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TeeWatchBridge")

    Events("onMessageFromWatch", "onWatchStateChange")

    OnCreate {
      TeeWatchLink.shared.onEvent = { [weak self] name, body in
        self?.sendEvent(name, body)
      }
    }

    OnDestroy {
      TeeWatchLink.shared.onEvent = nil
    }

    /// False on iPad and in any simulator without a paired watch. Callers use
    /// this to skip the rest of the work entirely rather than to show UI.
    Function("isAvailable") { () -> Bool in
      WCSession.isSupported()
    }

    /// Safe to call repeatedly — activation is idempotent and re-activating an
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

    /// Snapshot of what the watch side looks like from here. Reported to JS so
    /// a round can decide whether pushing state is worth doing at all.
    Function("getState") { () -> [String: Any] in
      TeeWatchLink.shared.stateDictionary()
    }
  }
}

/// Owns the single `WCSession` and its delegate.
///
/// This is a singleton because `WCSession.default` is one process-wide object
/// with exactly one delegate slot. A `Module` instance can be created and torn
/// down more than once over an app's life (reloads in development, for one), and
/// letting each new instance reassign the delegate would silently orphan the
/// previous one. Keeping the delegate here and swapping only the event callback
/// means activation state and the pending payload survive that churn.
final class TeeWatchLink: NSObject {
  static let shared = TeeWatchLink()

  /// Set while a JS listener exists. Weakly captured on the module side.
  var onEvent: ((String, [String: Any]) -> Void)?

  /// The most recent context that could not be delivered yet because the
  /// session had not finished activating. Activation is asynchronous, and the
  /// round screen starts pushing state the moment it mounts, so without this
  /// the first — and on a short hole possibly the only — update is dropped.
  private var pendingJSON: String?
  private var didStartActivating = false

  private override init() {
    super.init()
  }

  func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    // Re-assigning the delegate on every call is harmless and self-healing:
    // if anything else in the process ever takes the slot, the next round
    // reclaims it.
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
      // Wrapped in a dictionary because that is what the API takes; the
      // dictionary itself is never read for meaning on the other side beyond
      // pulling this one key out.
      try session.updateApplicationContext(["json": json])
      pendingJSON = nil
    } catch {
      // The documented failure here is a session that isn't activated, which
      // the guard above already covers. Anything else is transient, and the
      // next GPS tick sends a fresher payload anyway — holding the stale one
      // back is better than surfacing an error the golfer cannot act on.
      pendingJSON = json
    }
  }

  private func flushPending() {
    guard let json = pendingJSON else { return }
    send(json: json, on: WCSession.default)
  }

  func stateDictionary() -> [String: Any] {
    guard WCSession.isSupported() else {
      return ["supported": false, "paired": false, "appInstalled": false, "reachable": false]
    }
    let session = WCSession.default
    return [
      "supported": true,
      "paired": session.isPaired,
      "appInstalled": session.isWatchAppInstalled,
      "reachable": session.isReachable,
      "activated": session.activationState == .activated,
    ]
  }

  private func emitStateChange() {
    let body = stateDictionary()
    DispatchQueue.main.async { [weak self] in
      self?.onEvent?("onWatchStateChange", body)
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
  // surprise — but the reactivation in the second one is the part that matters:
  // when the user switches to a different Apple Watch, the session deactivates
  // and must be re-activated to bind to the new device. Leaving it empty means
  // the link works until the day they change watches and then silently never
  // works again.
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

  /// The watch's stroke edits arrive here.
  ///
  /// `transferUserInfo` (what the watch uses) is queued, persisted and
  /// delivered in the order it was sent, even if this app was not running when
  /// it was queued — iOS launches it in the background to hand the payload
  /// over. That ordering guarantee is why the watch can send absolute stroke
  /// counts and this side can simply apply the last one it sees.
  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    guard let json = userInfo["json"] as? String else { return }
    DispatchQueue.main.async { [weak self] in
      self?.onEvent?("onMessageFromWatch", ["json": json])
    }
  }

  /// Live path, used when the phone app is in the foreground so a tap on the
  /// watch lands immediately instead of on the next queue flush. The watch
  /// sends via this AND via `transferUserInfo`; duplicate delivery is safe
  /// because every message carries an absolute stroke count, never a delta.
  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    guard let json = message["json"] as? String else { return }
    DispatchQueue.main.async { [weak self] in
      self?.onEvent?("onMessageFromWatch", ["json": json])
    }
  }
}
