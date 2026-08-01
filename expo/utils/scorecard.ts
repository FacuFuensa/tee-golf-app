import type { Hole } from "@/types/models";

import { classifyHole, type ScoreClass } from "./stats";

/**
 * Turns a round's holes and scores into the shape a printed scorecard has.
 * Kept pure and free of React so it can be tested directly and shared by the
 * detail screen and all three share cards.
 */

export interface ScorecardCell {
  number: number;
  par: number;
  /** null when the hole was never scored. Never 0 — a 0 reads as a score. */
  strokes: number | null;
}

export interface ScorecardNine {
  label: "OUT" | "IN";
  cells: ScorecardCell[];
  /** Par for every hole in this nine, scored or not — a fact about the course. */
  par: number;
  strokes: number;
}

export interface ScorecardData {
  nines: ScorecardNine[];
  /** Par of the whole course, as printed on the card. */
  coursePar: number;
  /** Par of only the holes actually scored. The basis for `toPar`. */
  scoredPar: number;
  totalStrokes: number;
  /** Strokes minus par over scored holes only, so a partial round reads honestly. */
  toPar: number;
  holesScored: number;
}

export function buildScorecard(
  holes: Hole[],
  scoresByHoleId: Record<string, number>
): ScorecardData {
  const cells: ScorecardCell[] = [...holes]
    .sort((a, b) => a.number - b.number)
    .map((h) => {
      const raw = scoresByHoleId[h.id] ?? 0;
      return { number: h.number, par: h.par, strokes: raw > 0 ? raw : null };
    });

  // Built from the holes that exist, never from an assumed 18: a nine-hole
  // round gets one nine labelled OUT and no IN row at all.
  const chunks = cells.length > 9 ? [cells.slice(0, 9), cells.slice(9)] : [cells];
  const nines: ScorecardNine[] = chunks.map((chunk, index) => ({
    label: index === 0 ? "OUT" : "IN",
    cells: chunk,
    par: chunk.reduce((sum, c) => sum + c.par, 0),
    strokes: chunk.reduce((sum, c) => sum + (c.strokes ?? 0), 0),
  }));

  const scored = cells.filter((c): c is ScorecardCell & { strokes: number } => c.strokes != null);
  const totalStrokes = scored.reduce((sum, c) => sum + c.strokes, 0);
  const scoredPar = scored.reduce((sum, c) => sum + c.par, 0);

  return {
    nines,
    coursePar: cells.reduce((sum, c) => sum + c.par, 0),
    scoredPar,
    totalStrokes,
    toPar: totalStrokes - scoredPar,
    holesScored: scored.length,
  };
}

/** Birdie/par/bogey counts for the summary card, reusing the app's own buckets. */
export function countByClass(data: ScorecardData): Record<ScoreClass, number> {
  const counts: Record<ScoreClass, number> = {
    eagle: 0,
    birdie: 0,
    par: 0,
    bogey: 0,
    double: 0,
    triple: 0,
  };
  for (const nine of data.nines) {
    for (const cell of nine.cells) {
      if (cell.strokes == null) continue;
      counts[classifyHole({ number: cell.number, par: cell.par, strokes: cell.strokes })] += 1;
    }
  }
  return counts;
}
