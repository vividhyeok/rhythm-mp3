import type { Chart, Difficulty, NoteEvent, Onset } from '../types';
import { mulberry32 } from '../util/random';

export interface ChartOptions {
  difficulty: Difficulty;
  /** deterministic seed (hash of song+start+difficulty+variant) */
  seed: number;
  bpm: number;
  beatPhaseSec: number;
  /** confidence of the tempo estimate; low confidence reduces grid snapping */
  tempoConfidence?: number;
  /** segment duration in seconds */
  duration: number;
}

interface DiffCfg {
  minInterval: number;
  targetNps: number;
  subdivision: number;
  snapWindow: number;
  chordPct: number;
  chordGap: number;
  densityWindow: number;
}

function diffCfg(difficulty: Difficulty, beatSec: number): DiffCfg {
  switch (difficulty) {
    case 'EASY':
      return {
        minInterval: Math.max(0.22, beatSec * 0.45),
        targetNps: 1.7,
        subdivision: 1 / 2,
        snapWindow: 0.34,
        chordPct: 2,
        chordGap: Infinity,
        densityWindow: 2,
      };
    case 'NORMAL':
      return {
        minInterval: Math.max(0.13, beatSec * 0.22),
        targetNps: 2.8,
        subdivision: 1 / 2,
        snapWindow: 0.30,
        chordPct: 0.93,
        chordGap: 2.0,
        densityWindow: 2,
      };
    case 'HARD':
      return {
        minInterval: Math.max(0.095, beatSec * 0.16),
        targetNps: 4.2,
        subdivision: 1 / 4,
        snapWindow: 0.26,
        chordPct: 0.86,
        chordGap: 0.9,
        densityWindow: 2,
      };
  }
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(p * (sortedAsc.length - 1))));
  return sortedAsc[idx];
}

function laneScores(o: Onset): [number, number, number, number] {
  const { low, mid, high } = o;
  return [
    low * 1.15 + mid * 0.25,
    low * 0.45 + mid * 0.75 + high * 0.10,
    mid * 0.75 + high * 0.45 + low * 0.10,
    high * 1.15 + mid * 0.25,
  ];
}

function handOf(lane: number): number {
  return lane < 2 ? 0 : 1;
}

interface Row {
  time: number;
  strength: number;
  onset: Onset;
}

function dedupeRows(rows: Row[]): Row[] {
  if (rows.length <= 1) return rows;
  const sorted = [...rows].sort((a, b) => a.time - b.time);
  const out: Row[] = [];
  for (const row of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(row.time - last.time) < 0.018) {
      if (row.strength > last.strength) out[out.length - 1] = row;
    } else {
      out.push(row);
    }
  }
  return out;
}

function selectRowsByLocalDensity(rows: Row[], cfg: DiffCfg, duration: number): Row[] {
  const accepted: Row[] = [];
  const strengths = rows.map((r) => r.strength);
  const globalAvg = strengths.length > 0
    ? strengths.reduce((a, b) => a + b, 0) / strengths.length
    : 0.5;

  for (let start = 0; start < duration; start += cfg.densityWindow) {
    const end = Math.min(duration, start + cfg.densityWindow);
    const bucket = rows.filter((r) => r.time >= start && r.time < end);
    if (bucket.length === 0) continue;

    const localAvg = bucket.reduce((s, r) => s + r.strength, 0) / bucket.length;
    const relativeActivity = globalAvg > 1e-6 ? localAvg / globalAvg : 1;
    const activityFactor = Math.min(1.35, Math.max(0.60, 0.72 + 0.32 * relativeActivity));
    const quota = Math.max(1, Math.round(cfg.targetNps * (end - start) * activityFactor));

    const ranked = [...bucket].sort((a, b) => b.strength - a.strength || a.time - b.time);
    let added = 0;
    for (const candidate of ranked) {
      if (added >= quota) break;
      let ok = true;
      for (const existing of accepted) {
        if (Math.abs(existing.time - candidate.time) < cfg.minInterval) {
          ok = false;
          break;
        }
      }
      if (ok) {
        accepted.push(candidate);
        added++;
      }
    }
  }

  accepted.sort((a, b) => a.time - b.time);
  return accepted;
}

const EASY_PATTERNS = [
  [0, 2, 1, 3],
  [3, 1, 2, 0],
  [0, 1, 2, 3],
  [3, 2, 1, 0],
];

const NORMAL_PATTERNS = [
  ...EASY_PATTERNS,
  [0, 2, 3, 1],
  [3, 1, 0, 2],
  [1, 3, 0, 2],
  [2, 0, 3, 1],
];

const HARD_PATTERNS = [
  ...NORMAL_PATTERNS,
  [0, 2, 0, 3],
  [3, 1, 3, 0],
  [1, 2, 0, 3],
  [2, 1, 3, 0],
];

function patternsFor(difficulty: Difficulty): number[][] {
  if (difficulty === 'EASY') return EASY_PATTERNS;
  if (difficulty === 'NORMAL') return NORMAL_PATTERNS;
  return HARD_PATTERNS;
}

function chooseLane(
  row: Row,
  desired: number,
  lastLane: number,
  runLen: number,
  dt: number,
  rng: () => number,
): number {
  const timbre = laneScores(row.onset);
  const maxTimbre = Math.max(...timbre, 1e-9);
  let bestLane = 0;
  let bestScore = -Infinity;

  for (let lane = 0; lane < 4; lane++) {
    let score = (timbre[lane] / maxTimbre) * 0.42;
    if (lane === desired) score += 1.0;
    if (lastLane >= 0 && dt < 0.22 && handOf(lane) !== handOf(lastLane)) score += 0.22;
    if (lane === lastLane && (runLen >= 2 || dt < 0.16)) score -= 1.1;
    score += rng() * 0.035;
    if (score > bestScore) {
      bestScore = score;
      bestLane = lane;
    }
  }
  return bestLane;
}

/**
 * Generate a deterministic 4-key chart from detected onsets.
 *
 * Density is budgeted locally in two-second windows so quiet/strong sections
 * breathe differently. Lane assignment follows short playable pattern phrases
 * first, with timbre used as a secondary hint instead of a hard low-left /
 * high-right mapping.
 */
export function generateChart(onsets: Onset[], opts: ChartOptions): Chart {
  const rng = mulberry32(opts.seed);
  const beatSec = 60 / Math.min(240, Math.max(40, opts.bpm));
  const cfg = diffCfg(opts.difficulty, beatSec);
  const subSec = beatSec * cfg.subdivision;
  const confidence = Math.min(1, Math.max(0, opts.tempoConfidence ?? 0.75));
  const snapTrust = confidence < 0.2 ? 0 : 0.35 + 0.65 * confidence;
  const snapWin = subSec * cfg.snapWindow * snapTrust;

  const snapped = dedupeRows(
    onsets
      .filter((o) => o.time >= 0 && o.time <= opts.duration)
      .map((o) => {
        let t = o.time;
        if (subSec > 0.05 && snapWin > 0) {
          const k = Math.round((t - opts.beatPhaseSec) / subSec);
          const gridT = opts.beatPhaseSec + k * subSec;
          if (Math.abs(gridT - t) <= snapWin && gridT >= 0 && gridT <= opts.duration) t = gridT;
        }
        return { time: t, strength: o.strength, onset: o };
      }),
  );

  let rows = selectRowsByLocalDensity(snapped, cfg, opts.duration);

  // Sparse-content fallback. Keep difficulty meaningful by changing the grid
  // subdivision rather than filling every mode with the same quarter notes.
  if (rows.length < 8 && beatSec > 0.2) {
    rows = [];
    const step = opts.difficulty === 'EASY' ? beatSec : beatSec * 0.5;
    const start = Math.max(0, opts.beatPhaseSec);
    for (let t = start; t < opts.duration - 0.2; t += step) {
      rows.push({
        time: t,
        strength: 0.5,
        onset: { time: t, strength: 0.5, low: 0.33, mid: 0.34, high: 0.33, centroid: 0.5 },
      });
    }
  }

  const notes: NoteEvent[] = [];
  const patterns = patternsFor(opts.difficulty);
  let pattern = patterns[Math.floor(rng() * patterns.length)];
  let lastLane = -1;
  let lastTime = -Infinity;
  let runLen = 0;

  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && i % 4 === 0) pattern = patterns[Math.floor(rng() * patterns.length)];
    const row = rows[i];
    const desired = pattern[i % 4];
    const dt = row.time - lastTime;
    const lane = chooseLane(row, desired, lastLane, runLen, dt, rng);

    if (lane === lastLane) runLen++;
    else runLen = 1;
    lastLane = lane;
    lastTime = row.time;
    notes.push({ time: row.time, lane, strength: row.strength });
  }

  // Rare cross-hand chords on strong accents only.
  const chords: NoteEvent[] = [];
  if (isFinite(cfg.chordGap) && rows.length > 0) {
    const chordThr = percentile(
      rows.map((r) => r.strength).sort((a, b) => a - b),
      cfg.chordPct,
    );
    let lastChordTime = -Infinity;
    for (const nt of notes) {
      if (nt.strength < chordThr || nt.time - lastChordTime < cfg.chordGap) continue;
      const partners = handOf(nt.lane) === 0 ? [2, 3] : [0, 1];
      const partner = partners[Math.floor(rng() * partners.length)];
      chords.push({ time: nt.time, lane: partner, strength: nt.strength });
      lastChordTime = nt.time;
    }
  }

  const all = notes.concat(chords);
  all.sort((a, b) => (a.time - b.time) || (a.lane - b.lane));
  for (const nt of all) nt.time = Math.round(nt.time * 1000) / 1000;

  return {
    notes: all,
    bpm: Math.round(opts.bpm),
    duration: opts.duration,
    difficulty: opts.difficulty,
  };
}
