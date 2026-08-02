/**
 * Tests the pure scorecard aggregation. The interesting cases are the ones a
 * screenshot would not catch: a 9-hole round must not render an IN row, and an
 * unscored hole must produce a blank cell rather than a 0 — a 0 in a scorecard
 * column reads as a score, and the exported image would be a lie.
 *
 *   node store/verify-scorecard.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "scorecard-"));

// Strip the @/ aliases and the type-only import so tsc can compile in isolation.
writeFileSync(
  join(dir, "scorecard.ts"),
  readFileSync("utils/scorecard.ts", "utf8")
    .replace(/import type \{ Hole \} from "@\/types\/models";/, "type Hole = { id: string; course_id: string; number: number; par: number; green_lat: number | null; green_lng: number | null; yardage: number | null };")
);
writeFileSync(
  join(dir, "stats.ts"),
  readFileSync("utils/stats.ts", "utf8")
    .replace(/import type \{ PlayedHole, PlayedRound \} from "@\/services\/db";/, "type PlayedHole = { number: number; par: number; strokes: number }; type PlayedRound = { round: { id: string; started_at: string; finished_at: string | null; is_multiplayer: boolean }; courseName: string; holes: PlayedHole[] };")
);
execFileSync(
  "npx",
  ["tsc", join(dir, "scorecard.ts"), join(dir, "stats.ts"), "--target", "es2020", "--module", "es2020", "--moduleResolution", "node", "--outDir", dir],
  { stdio: "pipe", shell: true }
);
writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
writeFileSync(
  join(dir, "scorecard.js"),
  readFileSync(join(dir, "scorecard.js"), "utf8").replace(/from "\.\/stats"/g, 'from "./stats.js"')
);

const { buildScorecard, countByClass } = await import(
  "file://" + join(dir, "scorecard.js").replace(/\\/g, "/")
);

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

/** Builds n holes, par 4 each unless overridden. */
function holes(n, pars) {
  return Array.from({ length: n }, (_, i) => ({
    id: `h${i + 1}`,
    course_id: "c",
    number: i + 1,
    par: pars?.[i] ?? 4,
    green_lat: null,
    green_lng: null,
    yardage: null,
  }));
}

console.log("Eighteen holes, fully scored:");
{
  const h = holes(18);
  const scores = Object.fromEntries(h.map((x) => [x.id, 5]));
  const card = buildScorecard(h, scores);
  check("splits into two nines", card.nines.length === 2, `${card.nines.length}`);
  check("labels them OUT and IN", card.nines[0].label === "OUT" && card.nines[1].label === "IN");
  check("course par is 72", card.coursePar === 72, `${card.coursePar}`);
  check("total strokes is 90", card.totalStrokes === 90, `${card.totalStrokes}`);
  check("to par is +18", card.toPar === 18, `${card.toPar}`);
  check("OUT strokes is 45", card.nines[0].strokes === 45, `${card.nines[0].strokes}`);
}

console.log("\nNine holes:");
{
  const h = holes(9);
  const card = buildScorecard(h, Object.fromEntries(h.map((x) => [x.id, 4])));
  check("produces a single nine", card.nines.length === 1, `${card.nines.length}`);
  check("labelled OUT, never IN", card.nines[0].label === "OUT", card.nines[0].label);
  check("to par is even", card.toPar === 0, `${card.toPar}`);
}

console.log("\nA partial round — the case that must not lie:");
{
  const h = holes(18);
  // Only the first five holes were scored; hole 3 was explicitly left at 0.
  const scores = { h1: 4, h2: 5, h3: 0, h4: 6, h5: 3 };
  const card = buildScorecard(h, scores);
  check("counts only scored holes", card.holesScored === 4, `${card.holesScored}`);
  check("a 0 becomes a blank, not a zero", card.nines[0].cells[2].strokes === null, String(card.nines[0].cells[2].strokes));
  check("an absent hole is blank", card.nines[0].cells[8].strokes === null, String(card.nines[0].cells[8].strokes));
  check("total counts only what was scored", card.totalStrokes === 18, `${card.totalStrokes}`);
  check("to par uses only scored holes' par", card.toPar === 2, `${card.toPar} (18 strokes vs 16 par)`);
  check("course par still reflects the whole course", card.coursePar === 72, `${card.coursePar}`);
}

console.log("\nOnly the back nine played — OUT must be blank, not a lying 0:");
{
  const h = holes(18);
  const scores = {};
  for (let i = 9; i < 18; i++) scores[`h${i + 1}`] = 4;
  const card = buildScorecard(h, scores);
  check("the unplayed nine (OUT) is null, not 0", card.nines[0].strokes === null, String(card.nines[0].strokes));
  check("the played nine (IN) is its real total", card.nines[1].strokes === 36, `${card.nines[1].strokes}`);
}

console.log("\nOnly the front nine played — IN must be blank, not a lying 0:");
{
  const h = holes(18);
  const scores = {};
  for (let i = 0; i < 9; i++) scores[`h${i + 1}`] = 5;
  const card = buildScorecard(h, scores);
  check("the played nine (OUT) is its real total", card.nines[0].strokes === 45, `${card.nines[0].strokes}`);
  check("the unplayed nine (IN) is null, not 0", card.nines[1].strokes === null, String(card.nines[1].strokes));
}

console.log("\nTwenty-seven holes — chunked by 9, not first-9/rest:");
{
  const h = holes(27);
  const scores = Object.fromEntries(h.map((x) => [x.id, 4]));
  const card = buildScorecard(h, scores);
  check("produces three nines", card.nines.length === 3, `${card.nines.length}`);
  check(
    "each nine holds exactly 9 cells",
    card.nines.every((n) => n.cells.length === 9),
    card.nines.map((n) => n.cells.length).join(",")
  );
  check(
    "labelled OUT, IN, NINE 3",
    card.nines.map((n) => n.label).join(",") === "OUT,IN,NINE 3",
    card.nines.map((n) => n.label).join(",")
  );
  check(
    "the third nine holds holes 19-27",
    card.nines[2].cells.map((c) => c.number).join(",") === "19,20,21,22,23,24,25,26,27",
    card.nines[2].cells.map((c) => c.number).join(",")
  );
}

console.log("\nOrdering and classification:");
{
  const h = holes(3, [3, 5, 4]).reverse();
  const card = buildScorecard(h, { h1: 2, h2: 7, h3: 4 });
  check("cells sort by hole number", card.nines[0].cells.map((c) => c.number).join(",") === "1,2,3");
  const counts = countByClass(card);
  check("a 2 on a par 3 is a birdie", counts.birdie === 1, JSON.stringify(counts));
  check("a 7 on a par 5 is a double", counts.double === 1, JSON.stringify(counts));
  check("a 4 on a par 4 is a par", counts.par === 1, JSON.stringify(counts));
}

console.log(`\n${failures === 0 ? "All checks passed." : failures + " check(s) failed."}`);
process.exit(failures > 0 ? 1 : 0);
