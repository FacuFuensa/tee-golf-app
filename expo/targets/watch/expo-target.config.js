// Apple Watch target for Tee — milestone 1 (see .superpowers/sdd/watch-m1-report.md).
//
// This must stay a *function* export, not a plain object, so it can read and
// mutate the incoming Expo config before @bacons/apple-targets reads it back
// out a few lines later in the same prebuild pass. See the CFBundleVersion
// comment below — that's the only reason this isn't a plain object.
//
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => {
  // --- CFBundleVersion / error 90379 -------------------------------------
  //
  // eas.json has appVersionSource: "remote" + autoIncrement: true. During an
  // EAS Build, EAS resolves the real build number remotely and makes it
  // available as the EAS_BUILD_IOS_BUILD_NUMBER env var, then — after
  // `expo prebuild` has already generated the Xcode project — patches the
  // MAIN app target's CURRENT_PROJECT_VERSION directly in the generated
  // project. That patch step doesn't know this watch target exists, so it
  // never touches it.
  //
  // Meanwhile @bacons/apple-targets computes every *other* target's
  // CURRENT_PROJECT_VERSION from config.ios.buildNumber — see
  // node_modules/@bacons/apple-targets/build/with-widget.js:
  //   currentProjectVersion: (config.ios?.buildNumber) || 1
  // — which is app.json's static "1". It only special-cases
  // EAS_BUILD_IOS_BUILD_NUMBER for the App Clip target (see
  // node_modules/@bacons/apple-targets/build/configuration-list.js,
  // createAppClipConfigurationList: "Attempt to automatically set the build
  // number to match the main app. This only works with EAS Build, other
  // processes can simply set the number manually."). There's no such
  // handling for `type: "watch"`.
  //
  // Net effect without this: the watch app ships CURRENT_PROJECT_VERSION "1"
  // while EAS bumps the main app to whatever the next remote build number is
  // (2, 3, ...). The two don't match, and App Store Connect rejects the
  // upload with error 90379.
  //
  // Fix: mirror the App Clip's own workaround here instead of waiting for
  // the plugin to grow one for watch targets. This function runs
  // synchronously inside @bacons/apple-targets' withTargetsDir, which calls
  // it and reads the *returned* target config into withWidget() — which is
  // what computes currentProjectVersion from config.ios.buildNumber — before
  // this same prebuild pass reaches the pbxproj-writing mod. So mutating
  // config.ios.buildNumber here, before returning, is enough: by the time
  // withWidget reads it, it already has the corrected value.
  //
  // This is a no-op on every machine that isn't an EAS Build worker (the env
  // var is only set there), so it changes nothing about local prebuilds or
  // the developer's day-to-day workflow, and appVersionSource stays "remote".
  if (process.env.EAS_BUILD_IOS_BUILD_NUMBER) {
    config.ios = config.ios || {};
    config.ios.buildNumber = process.env.EAS_BUILD_IOS_BUILD_NUMBER;
  }

  return {
    type: "watch",

    // The Xcode target/product name. NOT user-facing — `displayName` below is
    // what a golfer sees.
    //
    // It must contain NO SPACES, and that is not cosmetic. The plugin writes
    // this name into `extra.eas.build.experimental.ios.appExtensions` with
    // spaces stripped, while the Xcode target keeps them — so "Tee Watch"
    // becomes `targetName: "TeeWatch"` in the manifest EAS reads, EAS then
    // looks that up in project.pbxproj, finds "Tee Watch" instead, and the
    // build dies at credential assignment with
    // `Could not find target 'TeeWatch' in project.pbxproj`.
    // Keeping the two identical is the whole fix.
    name: "TeeWatch",
    // CFBundleDisplayName — what shows under the icon on the watch face. This
    // is the one that is allowed to be pretty.
    displayName: "Tee",

    // A watch app needs its OWN icon. Without one the build succeeds, the .ipa
    // is valid, every local check passes — and App Store Connect rejects the
    // UPLOAD with "No icons found for watch application" plus a missing
    // CFBundleIconName. It is a server-side validation, so nothing on this
    // machine or on the build runner can catch it.
    //
    // A copy of the app icon lives in THIS directory rather than being
    // referenced across the tree. with-widget.js resolves this with
    // `path.join(props.directory, props.icon)`, and pointing at
    // ../../assets/images/icon.png produced no icon at all — the build
    // succeeded and App Store Connect refused the upload. A bare filename in
    // the target's own folder cannot resolve wrong.
    //
    // It is the app's 1024x1024 icon, PNG colour type 2 — no alpha channel,
    // which Apple requires for app icons and which the splash mark,
    // deliberately transparent, is not.
    icon: "icon.png",

    // Leading-dot form is appended to the main app's bundle identifier by
    // @bacons/apple-targets (see with-widget.js: `bundleId.startsWith(".")`),
    // producing com.teegolf.app.watchkitapp — the conventional WatchKit app
    // suffix.
    bundleIdentifier: ".watchkitapp",

    // 10.0, NOT the plugin's default of 11.0, and this is the single most
    // load-bearing number in this file: it decides which watches are even
    // OFFERED the app.
    //
    // The developer's own watch is an Apple Watch Series 5 (MWRX2LL/A, 40mm,
    // 2019), and watchOS 10.6.1 is the last version it will ever run —
    // watchOS 11 dropped the Series 4, the Series 5 and the 1st-gen SE. With
    // an 11.0 floor the build succeeds, the .ipa is valid, App Store Connect
    // accepts it, TestFlight even reports "Apple Watch: Yes" — and the app
    // simply never appears under Available Apps in the iPhone's Watch app.
    // There is no error anywhere; watchOS filters it out silently. That cost
    // a full build-and-upload round trip to discover.
    //
    // 10.0 is the lowest floor the source actually permits: the `#Preview`
    // macro in ContentView.swift is annotated @available(watchOS 10.0, *),
    // so going lower breaks the build unless that preview is guarded. It
    // still reaches back to the Series 4 (2018), and nothing in this target
    // uses API newer than watchOS 7 anyway.
    deploymentTarget: "10.0",
  };
};
