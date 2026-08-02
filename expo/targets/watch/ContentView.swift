import SwiftUI

// Tee design tokens, mirrored from expo/constants/theme.ts.
//
// This target intentionally does not share JS/TS with the main app (that's
// what makes it a clean pipeline test — see the milestone note in
// TeeWatchApp.swift), so these values are kept in sync by hand. If
// theme.ts's Colors.background / Colors.primary / Colors.accent change,
// update here too.
private enum TeeColor {
    /// Colors.background — warm cream app background.
    static let background = Color(red: 0xF2 / 255, green: 0xED / 255, blue: 0xE3 / 255)
    /// Colors.primary / Colors.textPrimary — deep green, used for the big
    /// number and primary text.
    static let primary = Color(red: 0x1C / 255, green: 0x3A / 255, blue: 0x2B / 255)
    /// Colors.accent — mid green, reserved for the round button.
    static let accent = Color(red: 0x4E / 255, green: 0x8C / 255, blue: 0x6A / 255)
}

/// Milestone 1: a hardcoded screen. No connectivity, no live data, no
/// button action — see .superpowers/sdd/watch-m1-report.md for why that's
/// deliberate. The only interactive part is the pressed state on the `+`
/// button, purely so it doesn't feel broken to tap.
struct ContentView: View {
    var body: some View {
        ZStack {
            TeeColor.background.ignoresSafeArea()

            VStack(spacing: 4) {
                Text("HOLE 7  ·  PAR 4")
                    .font(.system(size: 12, weight: .semibold))
                    .tracking(0.5)
                    .foregroundColor(TeeColor.primary)

                // Newsreader (the app's serif) isn't bundled for this
                // milestone — see the M2 follow-up note in the report.
                // SwiftUI's built-in serif design is the closest
                // zero-dependency substitute.
                Text("152")
                    .font(.system(size: 44, weight: .semibold, design: .serif))
                    .foregroundColor(TeeColor.primary)
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
                    .padding(.top, 2)

                Text("YARDS")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(1.2)
                    .foregroundColor(TeeColor.primary.opacity(0.65))

                InertPlusButton()
                    .padding(.top, 8)
                    .padding(.bottom, 2)

                Text("SHOT 3  ·  142 YD")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(TeeColor.primary.opacity(0.75))
            }
            .padding(.horizontal, 6)
        }
    }
}

/// The large circular `+` from the mockup. It is inert by design — milestone
/// 1 proves the build/sign/submit/install pipeline, not app behavior. It
/// gets a pressed state purely so tapping it doesn't feel broken; nothing
/// happens on release.
private struct InertPlusButton: View {
    var body: some View {
        Button {
            // Intentionally empty. Stroke logging and WatchConnectivity are
            // milestones 2 and 3.
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 20, weight: .semibold))
                .foregroundColor(TeeColor.background)
                .frame(width: 44, height: 44)
                .background(Circle().fill(TeeColor.accent))
        }
        .buttonStyle(PressScaleButtonStyle())
    }
}

/// Scale + fade on press. The only bit of "interactivity" milestone 1 has.
private struct PressScaleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.9 : 1.0)
            .opacity(configuration.isPressed ? 0.85 : 1.0)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

#Preview {
    ContentView()
}
