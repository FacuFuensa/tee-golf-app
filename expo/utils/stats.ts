import type { PlayedHole, PlayedRound } from "@/services/db";

/**
 * Pure scoring analytics derived from a player's recorded rounds.
 * All math is per-hole-relative-to-par so partial rounds (a few holes mapped)
 * still contribute fairly — then projected to a full 18 where it reads well.
 */

/** Buckets a golfer instantly recognizes on a scorecard. */
export type ScoreClass =
  | "eagle" // 2+ under (incl. albatross)
  | "birdie"
  | "par"
  | "bogey"
  | "double"
  | "triple"; // triple bogey or worse

export interface ScoreBucket {
  key: ScoreClass;
  label: string;
  count: number;
}

export interface ParTypeSplit {
  /** 3, 4 or 5. */
  par: number;
  holes: number;
  /** Average strokes relative to par on this hole type (e.g. +0.4). */
  avgToPar: number;
}

export interface RoundSummary {
  id: string;
  courseName: string;
  date: string;
  holesPlayed: number;
  strokes: number;
  par: number;
  toPar: number;
  /** Score relative to par projected to a full 18 holes. */
  toParPer18: number;
}

export interface PlayerStats {
  roundsPlayed: number;
  holesPlayed: number;
  /** Average score relative to par, projected to 18 holes (e.g. +11.4). */
  scoringAvgToPar18: number;
  /** Average raw strokes per hole. */
  avgStrokesPerHole: number;
  /** Share of holes played at par or better (0–1). */
  parOrBetterRate: number;
  /** Share of holes played as birdie or better (0–1). */
  birdieRate: number;
  best: RoundSummary | null;
  buckets: ScoreBucket[];
  parTypes: ParTypeSplit[];
  /** Newest-last recent rounds for the form trend (max 8). */
  recentTrend: RoundSummary[];
  /** Newest-first list of every round for the log. */
  rounds: RoundSummary[];
}

const BUCKET_META: { key: ScoreClass; label: string }[] = [
  { key: "eagle", label: "Eagles" },
  { key: "birdie", label: "Birdies" },
  { key: "par", label: "Pars" },
  { key: "bogey", label: "Bogeys" },
  { key: "double", label: "Doubles" },
  { key: "triple", label: "Triple+" },
];

export function classifyHole(hole: PlayedHole): ScoreClass {
  const diff = hole.strokes - hole.par;
  if (diff <= -2) return "eagle";
  if (diff === -1) return "birdie";
  if (diff === 0) return "par";
  if (diff === 1) return "bogey";
  if (diff === 2) return "double";
  return "triple";
}

function summarize(round: PlayedRound): RoundSummary {
  const strokes = round.holes.reduce((sum, h) => sum + h.strokes, 0);
  const par = round.holes.reduce((sum, h) => sum + h.par, 0);
  const holesPlayed = round.holes.length;
  const toPar = strokes - par;
  const toParPer18 = holesPlayed > 0 ? (toPar / holesPlayed) * 18 : 0;
  return {
    id: round.round.id,
    courseName: round.courseName,
    date: round.round.finished_at ?? round.round.started_at,
    holesPlayed,
    strokes,
    par,
    toPar,
    toParPer18,
  };
}

export function computePlayerStats(rounds: PlayedRound[]): PlayerStats {
  const allHoles: PlayedHole[] = rounds.flatMap((r) => r.holes);
  const summaries = rounds.map(summarize);

  const holesPlayed = allHoles.length;
  const totalStrokes = allHoles.reduce((sum, h) => sum + h.strokes, 0);
  const totalPar = allHoles.reduce((sum, h) => sum + h.par, 0);
  const perHoleToPar = holesPlayed > 0 ? (totalStrokes - totalPar) / holesPlayed : 0;

  const buckets: ScoreBucket[] = BUCKET_META.map((meta) => ({
    ...meta,
    count: allHoles.filter((h) => classifyHole(h) === meta.key).length,
  }));

  const parOrBetter = allHoles.filter((h) => h.strokes <= h.par).length;
  const birdieOrBetter = allHoles.filter((h) => h.strokes < h.par).length;

  const parTypes: ParTypeSplit[] = [3, 4, 5]
    .map((par) => {
      const holes = allHoles.filter((h) => h.par === par);
      const avgToPar =
        holes.length > 0
          ? holes.reduce((sum, h) => sum + (h.strokes - h.par), 0) / holes.length
          : 0;
      return { par, holes: holes.length, avgToPar };
    })
    .filter((split) => split.holes > 0);

  // Lowest score relative to par per 18 wins "best round".
  const best =
    summaries.length > 0
      ? summaries.reduce((b, s) => (s.toParPer18 < b.toParPer18 ? s : b))
      : null;

  // Trend reads left→right oldest→newest; summaries arrive newest-first.
  const recentTrend = [...summaries].slice(0, 8).reverse();

  return {
    roundsPlayed: rounds.length,
    holesPlayed,
    scoringAvgToPar18: perHoleToPar * 18,
    avgStrokesPerHole: holesPlayed > 0 ? totalStrokes / holesPlayed : 0,
    parOrBetterRate: holesPlayed > 0 ? parOrBetter / holesPlayed : 0,
    birdieRate: holesPlayed > 0 ? birdieOrBetter / holesPlayed : 0,
    best,
    buckets,
    parTypes,
    recentTrend,
    rounds: summaries,
  };
}

/** "+4", "Even", "-2" — the way golfers read a score relative to par. */
export function formatToPar(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return "Even";
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

/** One-decimal to-par for averages: "+0.4", "Even", "-1.2". */
export function formatToParDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "Even";
  return rounded > 0 ? `+${rounded.toFixed(1)}` : rounded.toFixed(1);
}

export function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
