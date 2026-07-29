/**
 * Pre-publication filtering for the two pieces of free text a golfer can type
 * that another golfer will see: their display name, and the name of a course
 * they map by hand.
 *
 * Apple's Guideline 1.2 requires "a method for filtering objectionable material
 * before it is posted" in any app with user-generated content. This is that
 * filter. It is deliberately conservative — it blocks slurs and unambiguous
 * obscenity rather than trying to police taste, because false positives on a
 * golfer's own name are their own kind of failure.
 *
 * The same list is enforced again server-side (supabase/migrations/0010) so the
 * check cannot be bypassed by talking to the API directly.
 *
 * Every pattern here is built from escape sequences rather than literal
 * characters, so this file stays pure ASCII and no invisible codepoint can be
 * silently corrupted by an editor or a diff.
 */

/**
 * Terms long and distinctive enough to match ANYWHERE in the collapsed string
 * without hitting a legitimate word. Matching these as substrings is what
 * catches "f.u.c.k", "f u c k" and "MyNameIsFuck" in one pass.
 *
 * Adding a short term here is a bug: it produces the Scunthorpe problem, where
 * a real place name or surname gets rejected because a slur happens to sit
 * inside it. Short terms belong in WHOLE_WORD_TERMS.
 */
const SUBSTRING_TERMS: readonly string[] = [
  // Sexual obscenity
  "fuck",
  "asshole",
  "arsehole",
  "blowjob",
  "handjob",
  "cumshot",
  "creampie",
  "buttplug",
  "hentai",
  "dildo",
  "pedophile",
  "paedophile",
  // Racial, ethnic and religious slurs
  "nigger",
  "nigga",
  "sandnigger",
  "wetback",
  "beaner",
  "raghead",
  "towelhead",
  "jigaboo",
  // Homophobic and transphobic slurs
  "faggot",
  "shemale",
  // Ableist slurs
  "mongoloid",
  // Hate movements and violence
  "heilhitler",
  "killyourself",
  // Spanish-language slurs and obscenity
  "gilipollas",
  "pelotudo",
  "maricon",
  "pendejo",
  "sudaca",
];

/**
 * Terms that are only objectionable as a word on their own. Each is a substring
 * of at least one innocent word, so matching them loosely would reject real
 * names: "cunt" is inside Scunthorpe, "rape" inside grape, "rapist" inside
 * therapist, "anal" inside analysis, "coon" inside raccoon, "spic" inside
 * conspicuous, "shit" inside Mishit.
 *
 * These are checked two ways: against each separated token, and against the
 * fully collapsed string, so "c u n t" is still caught while Scunthorpe is not.
 */
const WHOLE_WORD_TERMS: readonly string[] = [
  // Sexual obscenity
  "shit",
  "cunt",
  "pussy",
  "whore",
  "slut",
  "bitch",
  "wank",
  "bastard",
  "porn",
  "penis",
  "vagina",
  "anal",
  "rape",
  "rapist",
  "incest",
  "pedo",
  // Racial, ethnic and religious slurs
  "chink",
  "gook",
  "spic",
  "kike",
  "coon",
  "wop",
  "dago",
  // Homophobic and transphobic slurs
  "fag",
  "fagot",
  "dyke",
  "tranny",
  // Ableist slurs
  "retard",
  "retarded",
  "spastic",
  // Hate movements and violence
  "hitler",
  "nazi",
  "kkk",
  "jihadist",
  "terrorist",
  "genocide",
  // Spanish-language slurs and obscenity
  "puta",
  "puto",
  "mierda",
  "cabron",
  "verga",
];

/** Combining diacritical marks, stripped so "n-tilde" and "n" compare equal. */
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036F]", "g");

/**
 * Characters that can be used to spoof or corrupt how a name renders in someone
 * else's list: C0/C1 controls, zero-width spaces and joiners, the bidirectional
 * override marks, and the byte-order mark.
 */
const DECEPTIVE_CHARS = new RegExp(
  "[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF]"
);

/** At least one real letter or digit must survive normalization. */
const HAS_ALPHANUMERIC = /[a-z0-9]/i;

/**
 * Normalizes text for matching: lowercases, strips accents, folds common
 * leetspeak substitutions, and removes everything that is not a letter or
 * digit — so spacing and punctuation cannot be used to slip a term through.
 */
function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/[4@]/g, "a")
    .replace(/3/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/0/g, "o")
    .replace(/[5$]/g, "s")
    .replace(/7/g, "t")
    .replace(/[^a-z0-9]/g, "");
}

export interface ModerationResult {
  ok: boolean;
  /** User-facing reason, ready to show inline. Null when ok. */
  reason: string | null;
}

const OK: ModerationResult = { ok: true, reason: null };

/**
 * Checks a piece of user-authored text that will be visible to other golfers.
 * `label` names the field so the error reads naturally ("That display name...").
 */
export function checkUserText(value: string, label: string): ModerationResult {
  const trimmed = value.trim();

  if (trimmed.length < 2) {
    return { ok: false, reason: `${label} needs at least 2 characters.` };
  }
  if (trimmed.length > 40) {
    return { ok: false, reason: `${label} can be at most 40 characters.` };
  }

  if (DECEPTIVE_CHARS.test(trimmed)) {
    return { ok: false, reason: `${label} contains characters that aren't allowed.` };
  }

  // A name made only of punctuation or symbols renders as a blank row to
  // everyone else, which is its own kind of abuse.
  const letters = trimmed.normalize("NFD").replace(COMBINING_MARKS, "");
  if (!HAS_ALPHANUMERIC.test(letters)) {
    return { ok: false, reason: `${label} needs at least one letter or number.` };
  }

  const rejected: ModerationResult = {
    ok: false,
    reason: `${label} contains language we don't allow. Please choose another.`,
  };

  // The whole string with separators removed. Catches spacing and punctuation
  // used to break a term up.
  const collapsed = normalize(trimmed);

  for (const term of SUBSTRING_TERMS) {
    if (collapsed.includes(term)) return rejected;
  }

  // "c u n t" collapses to exactly "cunt" — block that, while leaving
  // Scunthorpe (which merely contains it) alone.
  if (WHOLE_WORD_TERMS.includes(collapsed)) return rejected;

  // Each separated word, checked on its own.
  for (const token of trimmed.split(/[^\p{L}\p{N}]+/u)) {
    if (token.length === 0) continue;
    if (WHOLE_WORD_TERMS.includes(normalize(token))) return rejected;
  }

  return OK;
}

/** Convenience wrapper for the onboarding display-name field. */
export function checkDisplayName(value: string): ModerationResult {
  return checkUserText(value, "That display name");
}

/** Convenience wrapper for a hand-mapped course name. */
export function checkCourseName(value: string): ModerationResult {
  return checkUserText(value, "That course name");
}
