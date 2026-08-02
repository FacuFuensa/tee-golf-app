import SwiftUI
import WatchKit

// Tee design tokens, mirrored from expo/constants/theme.ts.
//
// This target shares no JS/TS with the main app, so these are kept in sync by
// hand. If theme.ts's Colors.background / Colors.primary / Colors.accent
// change, update here too.
private enum TeeColor {
  /// Colors.background — warm cream app background.
  static let background = Color(red: 0xF2 / 255, green: 0xED / 255, blue: 0xE3 / 255)
  /// Colors.primary / Colors.textPrimary — deep green.
  static let primary = Color(red: 0x1C / 255, green: 0x3A / 255, blue: 0x2B / 255)
  /// Colors.accent — mid green, reserved for the round button.
  static let accent = Color(red: 0x4E / 255, green: 0x8C / 255, blue: 0x6A / 255)
}

/// Sizes are tuned for the smallest watch this app supports rather than the
/// largest: a 40mm Series 5 is 162x197pt, and the owner's own watch is exactly
/// that. Anything laid out for a 45mm clips there, and clipping on watchOS is
/// silent. The ScrollView is the backstop — with Dynamic Type turned up, or on
/// a 38mm, the content scrolls instead of losing its last row.
struct ContentView: View {
  @ObservedObject private var link = WatchLink.shared

  var body: some View {
    ZStack {
      TeeColor.background.ignoresSafeArea()

      ScrollView {
        if let context = link.context, context.active {
          RoundView(context: context, link: link)
        } else {
          IdleView(isActivated: link.isActivated)
        }
      }
    }
  }
}

/// The playing screen.
private struct RoundView: View {
  let context: WatchContext
  @ObservedObject var link: WatchLink

  var body: some View {
    VStack(spacing: 3) {
      Text(header)
        .font(.system(size: 11, weight: .semibold))
        .tracking(0.4)
        .foregroundColor(TeeColor.primary)
        .lineLimit(1)
        .minimumScaleFactor(0.8)

      DistanceBlock(context: context)

      StrokeButton {
        // A stroke is a real edit to the golfer's card, so it gets the firmer
        // of the two obvious haptics. `.click` reads as navigation.
        WKInterfaceDevice.current().play(.success)
        link.addStroke()
      }
      .padding(.top, 6)

      Text(strokeCaption)
        .font(.system(size: 10, weight: .semibold))
        .tracking(0.8)
        .foregroundColor(TeeColor.primary.opacity(0.75))
        .lineLimit(1)
        .padding(.top, 2)
    }
    .padding(.horizontal, 4)
    .padding(.vertical, 2)
  }

  /// "HOLE 7 · PAR 4", or just "HOLE 7" on a hand-mapped course with no par.
  private var header: String {
    if let par = context.par {
      return "HOLE \(context.holeNumber)  ·  PAR \(par)"
    }
    return "HOLE \(context.holeNumber)"
  }

  private var strokeCaption: String {
    let strokes = link.displayedStrokes
    if strokes == 0 { return "NO STROKES YET" }
    return strokes == 1 ? "1 STROKE" : "\(strokes) STROKES"
  }
}

/// The hero number, in the three states the phone's own hero can be in. Keeping
/// these in step matters: a golfer glancing at the watch and then at the phone
/// should never see one showing a yardage and the other saying it has no fix.
private struct DistanceBlock: View {
  let context: WatchContext

  var body: some View {
    switch context.resolvedStatus {
    case .ok:
      if let distance = context.distance {
        VStack(spacing: 0) {
          Text("\(distance)")
            .font(.system(size: 40, weight: .semibold, design: .serif))
            .foregroundColor(TeeColor.primary)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
          Text(context.unitCaption)
            .font(.system(size: 9, weight: .semibold))
            .tracking(1.1)
            .foregroundColor(TeeColor.primary.opacity(0.65))
        }
      } else {
        CaptionState(text: "NO GREEN MAPPED")
      }
    case .searching:
      CaptionState(text: "SEARCHING FOR GPS")
    case .offcourse:
      CaptionState(text: "NOT AT THIS COURSE")
    }
  }
}

/// Takes roughly the height of the number it replaces so the `+` button does
/// not jump up and down as GPS comes and goes.
private struct CaptionState: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.system(size: 11, weight: .semibold))
      .tracking(0.6)
      .foregroundColor(TeeColor.primary.opacity(0.55))
      .multilineTextAlignment(.center)
      .lineLimit(2)
      .minimumScaleFactor(0.8)
      .frame(height: 52)
  }
}

/// The large circular `+`.
private struct StrokeButton: View {
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: "plus")
        .font(.system(size: 19, weight: .semibold))
        .foregroundColor(TeeColor.background)
        .frame(width: 42, height: 42)
        .background(Circle().fill(TeeColor.accent))
    }
    .buttonStyle(PressScaleButtonStyle())
  }
}

/// Scale + fade on press, matching hooks/usePressScale.ts on the phone.
private struct PressScaleButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.9 : 1.0)
      .opacity(configuration.isPressed ? 0.85 : 1.0)
      .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
  }
}

/// Shown whenever there is no round to display.
///
/// The two cases are deliberately worded differently. "Connecting" and "no
/// round" look identical to a user staring at a blank screen, and telling them
/// apart is the difference between "the app is broken" and "I haven't started a
/// round yet" — which is exactly the ambiguity that made the last watch build
/// impossible to diagnose from the outside.
private struct IdleView: View {
  let isActivated: Bool

  var body: some View {
    VStack(spacing: 6) {
      Text("TEE")
        .font(.system(size: 22, weight: .semibold, design: .serif))
        .tracking(3)
        .foregroundColor(TeeColor.primary)

      Text(isActivated ? "No round in progress" : "Connecting to iPhone…")
        .font(.system(size: 12, weight: .medium))
        .foregroundColor(TeeColor.primary.opacity(0.8))
        .multilineTextAlignment(.center)

      if isActivated {
        Text("Start one in Tee on your iPhone and it appears here.")
          .font(.system(size: 11))
          .foregroundColor(TeeColor.primary.opacity(0.55))
          .multilineTextAlignment(.center)
      }
    }
    .padding(.horizontal, 6)
    .padding(.top, 8)
  }
}

#Preview {
  ContentView()
}
