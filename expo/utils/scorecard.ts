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
  /**
   * "OUT" and "IN" for the first two nines. A course beyond 18 holes (27, 36…)
   * gets "NINE 3", "NINE 4"... — real courses that deep usually name their
   * extra nines after something local, but the app has no such data, and a
   * plain ordinal is honest without inventing golf terminology.
   */
  label: string;
  cells: ScorecardCell[];
  /** Par for every hole in this nine, scored or not — a fact about the course. */
  par: number;
  /** null when nothing in this nine was scored — never 0, which would print as an even-par nine that was never played. */
  strokes: number | null;
}

export interface ScorecardData {
  nines: ScorecardNine[];
  /** Par of the whole course, as printed on the card. */
  coursePar: number;
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
  // round gets one nine labelled OUT and no IN row at all. Chunked by 9
  // rather than "first 9 / rest" so a 27+ hole course gets several legible
  // nines instead of one bloated row sharing its width among 18+ cells.
  const chunks: ScorecardCell[][] = [];
  for (let i = 0; i < cells.length; i += 9) chunks.push(cells.slice(i, i + 9));
  if (chunks.length === 0) chunks.push([]);

  const nines: ScorecardNine[] = chunks.map((chunk, index) => {
    const wasPlayed = chunk.some((c) => c.strokes != null);
    return {
      label: index === 0 ? "OUT" : index === 1 ? "IN" : `NINE ${index + 1}`,
      cells: chunk,
      par: chunk.reduce((sum, c) => sum + c.par, 0),
      // null, not 0, when nothing in this nine was scored — playing only the
      // back nine of a course must not print a false "0" OUT subtotal.
      strokes: wasPlayed ? chunk.reduce((sum, c) => sum + (c.strokes ?? 0), 0) : null,
    };
  });

  const scored = cells.filter((c): c is ScorecardCell & { strokes: number } => c.strokes != null);
  const totalStrokes = scored.reduce((sum, c) => sum + c.strokes, 0);
  // Par of only the scored holes — kept internal; only `toPar` needs it.
  const scoredPar = scored.reduce((sum, c) => sum + c.par, 0);

  return {
    nines,
    coursePar: cells.reduce((sum, c) => sum + c.par, 0),
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
