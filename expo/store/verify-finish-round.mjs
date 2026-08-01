/**
 * Pins the real `finishRound()` against a stubbed Supabase client, so nothing
 * in its guard can regress unnoticed. `verify-backend.mjs` proves the RLS
 * policy refuses a joiner's raw update — it never calls `finishRound()`
 * itself, so deleting `{ count: "exact" }`, flipping the comparison, or
 * adding a `.select()` to the real function would leave every check in the
 * repo green. This compiles and runs the actual `services/db.ts` source
 * against a stub we fully control, so it can't be fooled that way.
 *
 * The case that matters most is `count: null`: supabase-js only sets `count`
 * when BOTH the `Prefer: count=…` header we send AND a parseable
 * `content-range` header come back — otherwise it stays `null`, and a
 * `Content-Range: * /*` response parses to `NaN`. A guard written as
 * `count === 0` never fires on either value, silently reporting success. See
 * the comment above `finishRound` in services/db.ts for the full story.
 *
 *   node store/verify-finish-round.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "finish-round-"));

// Strip the three imports tsc cannot resolve in isolation:
//  - expo-crypto: a native module, unused by finishRound but referenced by
//    other exports in the same file (createSoloRound, createMultiplayerRound),
//    which we still compile since we want the REAL finishRound source.
//  - the `@/types/models` type-only import: types are erased at runtime, so a
//    loose `any` alias for each name is enough to satisfy the compiler.
//  - `./supabase`: swapped for a stub this test fully controls.
// The stub's exported `supabase` is typed `any` on purpose — the file's other
// exports call `.select()`, `.upsert()`, `.rpc()`, etc. that this stub does
// not implement, and this test never calls those functions. Typing it `any`
// keeps the whole file type-checking without having to fake every method.
writeFileSync(
  join(dir, "db.ts"),
  readFileSync("services/db.ts", "utf8")
    .replace(
      'import * as Crypto from "expo-crypto";',
      'const Crypto = { randomUUID: () => "00000000-0000-0000-0000-000000000000" };'
    )
    .replace(
      'import type { Club, Course, Hole, Profile, Round, Score } from "@/types/models";',
      "type Club = any; type Course = any; type Hole = any; type Profile = any; type Round = any; type Score = any;"
    )
    .replace(
      'import { supabase } from "./supabase";',
      'import { supabase } from "./stub-supabase";'
    )
);

// The exact call shape `finishRound` makes is:
//   supabase.from("rounds").update(values, { count: "exact" }).eq("id", roundId)
// Real supabase-js query builders are PromiseLike at every step of the chain,
// and `finishRound` awaits right after `.eq()` — it never calls `.then()` or
// anything else further down the chain — so the stub must resolve AT `.eq()`,
// not at some later step, or it would stop matching the real await point.
writeFileSync(
  join(dir, "stub-supabase.ts"),
  `
export let lastUpdate: { table: string; values: unknown; options: unknown; eqColumn: string; eqValue: unknown } | null = null;
let nextResult: { error: unknown; count: number | null } = { error: null, count: 1 };

export function setNextResult(result: { error: unknown; count: number | null }): void {
  nextResult = result;
}
export function getLastUpdate() {
  return lastUpdate;
}

export const supabase: any = {
  from(table: string) {
    return {
      update(values: unknown, options: unknown) {
        return {
          eq(eqColumn: string, eqValue: unknown) {
            lastUpdate = { table, values, options, eqColumn, eqValue };
            return Promise.resolve(nextResult);
          },
        };
      },
    };
  },
};
`
);

execFileSync(
  "npx",
  [
    "tsc",
    join(dir, "db.ts"),
    join(dir, "stub-supabase.ts"),
    "--target", "es2020",
    "--module", "es2020",
    "--moduleResolution", "node",
    "--outDir", dir,
  ],
  { stdio: "pipe", shell: true }
);
writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
writeFileSync(
  join(dir, "db.js"),
  readFileSync(join(dir, "db.js"), "utf8").replace(
    /from "\.\/stub-supabase"/g,
    'from "./stub-supabase.js"'
  )
);

const { finishRound, NotRoundOwnerError } = await import(
  "file://" + join(dir, "db.js").replace(/\\/g, "/")
);
const { setNextResult, getLastUpdate } = await import(
  "file://" + join(dir, "stub-supabase.js").replace(/\\/g, "/")
);

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

/** Runs finishRound and reports what it did: resolved, or threw what. */
async function attempt(roundId) {
  try {
    await finishRound(roundId);
    return { threw: false, value: undefined };
  } catch (e) {
    return { threw: true, value: e };
  }
}

console.log("The success case:");
{
  setNextResult({ error: null, count: 1 });
  const { threw } = await attempt("round-1");
  check("count: 1 resolves without throwing", !threw);
}

console.log("\nFailure shapes the guard must catch:");
{
  setNextResult({ error: null, count: 0 });
  const { threw, value } = await attempt("round-2");
  check(
    "count: 0 throws NotRoundOwnerError",
    threw && value instanceof NotRoundOwnerError,
    threw ? value?.constructor?.name : "did not throw"
  );
}
{
  // The case F1 is about: supabase-js leaves `count` at `null` whenever the
  // response is missing a parseable `content-range` header, even though the
  // `Prefer: count=exact` request header was sent. A guard written as
  // `count === 0` does not fire here — this is what makes it fail open.
  setNextResult({ error: null, count: null });
  const { threw, value } = await attempt("round-3");
  check(
    "count: null throws NotRoundOwnerError (this is the F1 regression case)",
    threw && value instanceof NotRoundOwnerError,
    threw ? value?.constructor?.name : "did not throw"
  );
}
{
  // A `Content-Range: */*` response parses via `parseInt("*")`, which is NaN.
  setNextResult({ error: null, count: NaN });
  const { threw, value } = await attempt("round-4");
  check(
    "count: NaN throws NotRoundOwnerError",
    threw && value instanceof NotRoundOwnerError,
    threw ? value?.constructor?.name : "did not throw"
  );
}

console.log("\nA real Supabase error must not be masked as NotRoundOwnerError:");
{
  const sentinel = { message: "connection reset", code: "08006" };
  setNextResult({ error: sentinel, count: null });
  const { threw, value } = await attempt("round-5");
  check(
    "an error is thrown as-is, not wrapped or replaced",
    threw && value === sentinel,
    threw ? JSON.stringify(value) : "did not throw"
  );
}

console.log("\nThe request must actually ask for the count:");
{
  setNextResult({ error: null, count: 1 });
  await attempt("round-6");
  const call = getLastUpdate();
  check(
    'update() is called with { count: "exact" }',
    call?.options && call.options.count === "exact",
    `options=${JSON.stringify(call?.options)}`
  );
  check(
    "the filter targets the round by id",
    call?.eqColumn === "id" && call?.eqValue === "round-6",
    `eq(${call?.eqColumn}, ${call?.eqValue})`
  );
}

console.log(`\n${failures === 0 ? "All checks passed." : failures + " check(s) failed."}`);
process.exit(failures > 0 ? 1 : 0);
