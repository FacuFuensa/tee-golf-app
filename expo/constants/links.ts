/**
 * Public URLs Apple requires to be reachable from inside the app, and the
 * contact address published for support and content reports.
 *
 * These are served as static pages from the repository's `docs/` folder via
 * GitHub Pages. They must stay live and publicly reachable (no login wall) —
 * Guideline 5.1.1(i) for the privacy policy, 1.5 and 1.2 for the contact route.
 */
const SITE = "https://facufuensa.github.io/tee-golf-app";

export const Links = {
  privacyPolicy: `${SITE}/privacy.html`,
  support: `${SITE}/support.html`,
  deleteAccount: `${SITE}/delete-account.html`,
  /** Published contact address — also the destination for content reports. */
  supportEmail: "ffuensalida@icloud.com",
} as const;

/** Pre-filled mailto for reporting a player, so the report reaches us with context. */
export function reportMailto(params: {
  reportedName: string;
  roundId: string;
}): string {
  const subject = encodeURIComponent(`Tee — report a player`);
  const body = encodeURIComponent(
    `I want to report a player in a Tee group round.\n\n` +
      `Player name shown: ${params.reportedName}\n` +
      `Round reference: ${params.roundId}\n\n` +
      `What happened:\n`
  );
  return `mailto:${Links.supportEmail}?subject=${subject}&body=${body}`;
}
