import type { Chart, Difficulty, NoteEvent, Onset } from '../types';
import { mulberry32 } from '../util/random';

export interface ChartOptions {
  difficulty: Difficulty;
  /** deterministic seed (hash of song+start+difficulty) */
  seed: number;
  bpm: number;
  beatPhaseSec: number;
  /** segment duration in seconds */
  duration: number;
}

interface DiffCfg {
  /** minimum seconds between consecutive note rows */
  minInterval: number;
  /** keep onsets at or above this strength percentile (0..1) */
  strengthPct: number;
  /** grid subdivision as a fraction of a beat (1/2 = eighth notes) */
  subdivision: number;
  /** snap window as a fraction of the subdivision length */
  snapWindow: number;
  /** onsets at/above this strength percentile may become chords */
  chordPct: number;
  /** minimum seconds between chords */
  chordGap: number;
}

function diffCfg(difficulty: Difficulty, beatSec: number): DiffCfg {
  switch (difficulty) {
    case 'EASY':
      return {
        minInterval: Math.max(0.22, beatSec * 0.5),
        strengthPct: 0.55,
        subdivision: 1 / 2,
        snapWindow: 0.4,
        chordPct: 2, // effectively disabled
        chordGap: Infinity,
      };
    case 'NORMAL':
      return {
        minInterval: Math.max(0.13, beatSec * 0.25),
        strengthPct: 0.35,
        subdivision: 1 / 2,
        snapWindow: 0.35,
        chordPct: 0.92,
        chordGap: 2.0,
      };
    case 'HARD':
      return {
        minInterval: Math.max(0.095, beatSec * 0.2),
        strengthPct: 0.18,
        subdivision: 1 / 4,
        snapWindow: 0.3,
        chordPct: 0.85,
        chordGap: 1.0,
      };
  }
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(p * (sortedAsc.length - 1))));
  return sortedAsc[idx];
}

/** Timbral lane preference: low->left, high->right, mid->inner. */
function laneScores(o: Onset): [number, number, number, number] {
  const { low, mid, high } = o;
  return [
    low * 1.2 + mid * 0.25,
    low * 0.55 + mid * 0.7 + high * 0.1,
    mid * 0.7 + high * 0.55 + low * 0.1,
    high * 1.2 + mid * 0.25,
  ];
}

function argmax(scores: readonly number[], exclude = -1): number {
  let best = -1;
  let bestV = -Infinity;
  for (let i = 0; i < scores.length; i++) {
    if (i === exclude) continue;
    if (scores[i] > bestV) {
      bestV = scores[i];
      best = i;
    }
  }
  return best < 0 ? 0 : best;
}

function handOf(lane: number): number {
  return lane < 2 ? 0 : 1;
}

interface Row {
  time: number;
  strength: number;
  onset: Onset;
}

/**
 * Generate a deterministic 4-key chart from detected onsets.
 * Same onsets + same options => identical chart.
 */
export function generateChart(onsets: Onset[], opts: ChartOptions): Chart {
  const rng = mulberry32(opts.seed);
  const beatSec = 60 / Math.min(240, Math.max(40, opts.bpm));
  const cfg = diffCfg(opts.difficulty, beatSec);
  const subSec = beatSec * cfg.subdivision;
  const snapWin = subSec * cfg.snapWindow;

  // 1) Snap onsets close to the beat grid onto it.
  const snapped: Row[] = onsets
    .filter((o) => o.time >= 0 && o.time <= opts.duration)
    .map((o) => {
      let t = o.time;
      if (subSec > 0.05) {
        const k = Math.round((t - opts.beatPhaseSec) / subSec);
        const gridT = opts.beatPhaseSec + k * subSec;
        if (Math.abs(gridT - t) <= snapWin && gridT >= 0 && gridT <= opts.duration) {
          t = gridT;
        }
      }
      return { time: t, strength: o.strength, onset: o };
    });

  // 2) Density control by difficulty: strength percentile + min interval
  //    (strong-priority greedy acceptance).
  const strengths = snapped.map((r) => r.strength).sort((a, b) => a - b);
  const thr = percentile(strengths, cfg.strengthPct);
  const candidates = snapped
    .filter((r) => r.strength >= thr)
    .sort((a, b) => b.strength - a.strength);

  const accepted: Row[] = [];
  for (const c of candidates) {
    let ok = true;
    for (const a of accepted) {
      if (Math.abs(a.time - c.time) < cfg.minInterval) {
        ok = false;
        break;
      }
    }
    if (ok) accepted.push(c);
  }
  accepted.sort((a, b) => a.time - b.time);

  // 3) Fallback for very sparse audio: quarter-note grid from the tempo.
  let rows = accepted;
  if (rows.length < 8 && beatSec > 0.2) {
    rows = [];
    const start = Math.max(0, opts.beatPhaseSec);
    for (let t = start; t < opts.duration - 0.2; t += beatSec) {
      rows.push({
        time: t,
        strength: 0.5,
        onset: { time: t, strength: 0.5, low: 0.33, mid: 0.34, high: 0.33, centroid: 0.5 },
      });
    }
  }

  // 4) Lane assignment: timbre-based preference + deterministic variation
  //    + playability constraints (limited repeats, hand alternation).
  const notes: NoteEvent[] = [];
  let lastLane = -1;
  let lastTime = -Infinity;
  let runLen = 0;

  for (const row of rows) {
    const scores = laneScores(row.onset);
    let lane = argmax(scores);

    // Deterministic variation: sometimes take the 2nd-best lane.
    if (rng() < 0.3) {
      const alt = argmax(scores, lane);
      if (alt !== lane) lane = alt;
    }

    const dt = row.time - lastTime;

    // Avoid excessive same-lane runs / machine-gun repeats.
    if (lane === lastLane && (runLen >= 2 || dt < 0.18)) {
      lane = argmax(scores, lastLane);
    }

    // Encourage hand alternation on fast passages.
    if (lastLane >= 0 && dt < 0.22 && handOf(lane) === handOf(lastLane) && lane !== lastLane) {
      const otherHandLanes = handOf(lastLane) === 0 ? [2, 3] : [0, 1];
      const bestOther = otherHandLanes.reduce((a, b) => (scores[a] >= scores[b] ? a : b));
      if (scores[bestOther] > scores[lane] * 0.55) lane = bestOther;
    }

    if (lane === lastLane) runLen++;
    else runLen = 1;
    lastLane = lane;
    lastTime = row.time;

    notes.push({ time: row.time, lane, strength: row.strength });
  }

  // 5) Chords: rare, only on very strong accents, cross-hand pairs only.
  const chords: NoteEvent[] = [];
  if (isFinite(cfg.chordGap)) {
    const chordThr = percentile(
      rows.map((r) => r.strength).sort((a, b) => a - b),
      cfg.chordPct,
    );
    let lastChordTime = -Infinity;
    const noteAtTime = new Map<number, number[]>();
    for (const nt of notes) {
      const key = Math.round(nt.time * 1000);
      const arr = noteAtTime.get(key);
      if (arr) arr.push(nt.lane);
      else noteAtTime.set(key, [nt.lane]);
    }

    for (const nt of notes) {
      if (nt.strength < chordThr) continue;
      if (nt.time - lastChordTime < cfg.chordGap) continue;
      const key = Math.round(nt.time * 1000);
      if ((noteAtTime.get(key)?.length ?? 0) > 1) continue;
      const partners = handOf(nt.lane) === 0 ? [2, 3] : [0, 1];
      const partner = partners[Math.floor(rng() * partners.length)];
      chords.push({ time: nt.time, lane: partner, strength: nt.strength });
      noteAtTime.get(key)!.push(partner);
      lastChordTime = nt.time;
    }
  }

  const all = notes.concat(chords);
  all.sort((a, b) => (a.time - b.time) || (a.lane - b.lane));
  for (const nt of all) {
    nt.time = Math.round(nt.time * 1000) / 1000;
  }

  return {
    notes: all,
    bpm: Math.round(opts.bpm),
    duration: opts.duration,
    difficulty: opts.difficulty,
  };
}
