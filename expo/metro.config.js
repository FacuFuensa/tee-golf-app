const { getDefaultConfig } = require("expo/metro-config");

// NOTE: this was previously wrapped in `withRorkMetro` from @rork-ai/toolkit-sdk.
// That wrapper swapped in a custom babel transformer which rewrote app/_layout.tsx
// at build time to wrap the root layout in a PostHog analytics provider — in
// PRODUCTION builds too, not just development. Shipping undisclosed third-party
// telemetry is an App Store rejection (Guideline 5.1.2(i)) and would have made the
// privacy manifest in app.json untrue. Nothing in this app's source imports the
// toolkit, so dropping the wrapper changes no app behaviour.
const config = getDefaultConfig(__dirname);

module.exports = config;
