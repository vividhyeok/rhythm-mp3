import type {
  Chart,
  Difficulty,
  MusicalEvent,
  MusicalEventKind,
  MusicalVoice,
  NoteEvent,
  Onset,
} from '../types';
import { hashString, mulberry32 } from '../util/random';

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
  /** classified perceptual events from the v3 analysis pipeline */
  events?: MusicalEvent[];
  /** nominal four-beat phrase length from analysis */
  phraseSec?: number;
}

interface DiffCfg {
  minInterval: number;
  targetNps: number;
  subdivision: number;
  snapWindow: number;
  chordStrength: number;
  chordGap: number;
  holdMin: number;
  holdMax: number;
  secondaryWeight: number;
}

interface Row {
  time: number;
  strength: number;
  event: MusicalEvent;
}

const VOICES: MusicalVoice[] = ['DRUMS', 'BASS', 'MELODY', 'ACCENT'];

function diffCfg(difficulty: Difficulty, beatSec: number): DiffCfg {
  switch (difficulty) {
    case 'EASY':
      return {
        minInterval: Math.max(0.22, beatSec * 0.45),
        targetNps: 1.55,
        subdivision: 1 / 2,
        snapWindow: 0.34,
        chordStrength: 2,
        chordGap: Infinity,
        holdMin: Math.max(0.58, beatSec * 0.8),
        holdMax: 1.8,
        secondaryWeight: 0.34,
      };
    case 'NORMAL':
      return {
        minInterval: Math.max(0.13, beatSec * 0.22),
        targetNps: 2.65,
        subdivision: 1 / 2,
        snapWindow: 0.30,
        chordStrength: 0.86,
        chordGap: 1.75,
        holdMin: Math.max(0.44, beatSec * 0.62),
        holdMax: 1.65,
        secondaryWeight: 0.52,
      };
    case 'HARD':
      return {
        minInterval: Math.max(0.095, beatSec * 0.16),
        targetNps: 4.0,
        subdivision: 1 / 4,
        snapWindow: 0.26,
        chordStrength: 0.78,
        chordGap: 0.78,
        holdMin: Math.max(0.36, beatSec * 0.50),
        holdMax: 1.45,
        secondaryWeight: 0.68,
      };
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function handOf(lane: number): number {
  return lane < 2 ? 0 : 1;
}

function eventFromOnset(o: Onset): MusicalEvent {
  let kind: MusicalEventKind = 'SNARE';
  if (o.low > 0.50 && o.centroid < 0.42) kind = 'KICK';
  else if (o.high > 0.50 && o.centroid > 0.52) kind = 'HAT';
  else if ((o.sustain ?? 0) > 0.28 && (o.flatness ?? 0.25) < 0.48) kind = 'HARMONIC';
  else if (o.low > 0.40 && (o.sustain ?? 0) > 0.14) kind = 'BASS';
  else if (o.strength > 0.78) kind = 'ACCENT';

  const voice: MusicalVoice =
    kind === 'KICK' || kind === 'SNARE' || kind === 'HAT' || kind === 'FILL'
      ? 'DRUMS'
      : kind === 'BASS'
        ? 'BASS'
        : kind === 'HARMONIC'
          ? 'MELODY'
          : 'ACCENT';

  return {
    time: o.time,
    strength: o.strength,
    duration: o.sustain ?? 0,
    kind,
    voice,
    low: o.low,
    mid: o.mid,
    high: o.high,
    centroid: o.centroid,
    attack: o.attack ?? o.strength,
    flatness: o.flatness ?? 0.25,
    isFill: false,
  };
}

function kindImportance(kind: MusicalEventKind): number {
  switch (kind) {
    case 'FILL': return 1.20;
    case 'ACCENT': return 1.16;
    case 'KICK': return 1.09;
    case 'SNARE': return 1.06;
    case 'HARMONIC': return 1.04;
    case 'BASS': return 1.02;
    case 'HAT': return 0.82;
  }
}

function dedupeRows(rows: Row[]): Row[] {
  if (rows.length <= 1) return rows;
  const sorted = [...rows].sort((a, b) => a.time - b.time || b.strength - a.strength);
  const out: Row[] = [];
  for (const row of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(row.time - last.time) < 0.018) {
      const lastScore = last.strength * kindImportance(last.event.kind);
      const score = row.strength * kindImportance(row.event.kind);
      if (score > lastScore) out[out.length - 1] = row;
    } else {
      out.push(row);
    }
  }
  return out;
}

function dominantVoice(bucket: Row[], previous: MusicalVoice | null): MusicalVoice {
  const scores: Record<MusicalVoice, number> = {
    DRUMS: 0,
    BASS: 0,
    MELODY: 0,
    ACCENT: 0,
  };
  for (const row of bucket) {
    const sustainBonus = row.event.duration >= 0.35 ? 1.10 : 1;
    scores[row.event.voice] += row.strength * kindImportance(row.event.kind) * sustainBonus;
  }

  let best: MusicalVoice = 'DRUMS';
  for (const voice of VOICES) {
    if (scores[voice] > scores[best]) best = voice;
  }

  // Human-authored charts usually stay on an instrument/part for a phrase rather
  // than switching voice because of one slightly stronger transient.
  if (previous && scores[previous] >= scores[best] * 0.72) return previous;
  return best;
}

function selectionScore(row: Row, primary: MusicalVoice, cfg: DiffCfg): number {
  let voiceWeight = row.event.voice === primary ? 1.20 : cfg.secondaryWeight;
  if (row.event.voice === 'ACCENT' && row.strength > 0.72) voiceWeight = Math.max(voiceWeight, 0.94);
  if ((row.event.kind === 'KICK' || row.event.kind === 'SNARE') && row.strength > 0.62) {
    voiceWeight = Math.max(voiceWeight, 0.82);
  }
  if (row.event.isFill) voiceWeight = Math.max(voiceWeight, 1.08);
  const sustainBonus = row.event.duration > cfg.holdMin ? 1.08 : 1;
  return row.strength * kindImportance(row.event.kind) * voiceWeight * sustainBonus;
}

function selectPhraseRows(
  rows: Row[],
  cfg: DiffCfg,
  duration: number,
  phraseSec: number,
): Row[] {
  if (rows.length === 0) return [];
  const accepted: Row[] = [];
  const globalAvg = rows.reduce((sum, r) => sum + r.strength, 0) / rows.length;
  let previousVoice: MusicalVoice | null = null;

  for (let start = 0; start < duration; start += phraseSec) {
    const end = Math.min(duration, start + phraseSec);
    const bucket = rows.filter((r) => r.time >= start && r.time < end);
    if (bucket.length === 0) continue;

    const primary = dominantVoice(bucket, previousVoice);
    previousVoice = primary;
    const localAvg = bucket.reduce((sum, r) => sum + r.strength, 0) / bucket.length;
    const activity = globalAvg > 1e-6 ? localAvg / globalAvg : 1;
    const activityFactor = Math.min(1.28, Math.max(0.62, 0.78 + 0.26 * activity));
    const quota = Math.max(1, Math.round(cfg.targetNps * (end - start) * activityFactor));

    const ranked = [...bucket].sort((a, b) => {
      const d = selectionScore(b, primary, cfg) - selectionScore(a, primary, cfg);
      return Math.abs(d) > 1e-9 ? d : a.time - b.time;
    });

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

const DRUM_PATTERNS = [
  [0, 2, 1, 2, 0, 3, 1, 2],
  [0, 3, 1, 2, 0, 2, 1, 3],
  [1, 2, 0, 3, 1, 2, 0, 3],
  [0, 2, 0, 3, 1, 2, 1, 3],
];
const BASS_PATTERNS = [
  [0, 1, 0, 2, 1, 0, 2, 1],
  [3, 2, 3, 1, 2, 3, 1, 2],
  [0, 2, 1, 3, 2, 1, 0, 2],
  [3, 1, 2, 0, 1, 2, 3, 1],
];
const MELODY_PATTERNS = [
  [0, 1, 2, 3, 2, 1, 0, 1],
  [3, 2, 1, 0, 1, 2, 3, 2],
  [1, 2, 3, 2, 1, 0, 1, 2],
  [2, 1, 0, 1, 2, 3, 2, 1],
];
const ACCENT_PATTERNS = [
  [0, 3, 1, 2, 0, 3, 2, 1],
  [3, 0, 2, 1, 3, 0, 1, 2],
  [0, 2, 3, 1, 0, 3, 1, 2],
  [1, 3, 0, 2, 1, 2, 0, 3],
];
const FILL_PATTERNS = [
  [0, 1, 2, 3, 2, 1],
  [3, 2, 1, 0, 1, 2],
  [0, 2, 1, 3, 0, 2],
  [1, 2, 1, 3, 1, 2],
];

function patternsFor(voice: MusicalVoice): number[][] {
  if (voice === 'DRUMS') return DRUM_PATTERNS;
  if (voice === 'BASS') return BASS_PATTERNS;
  if (voice === 'MELODY') return MELODY_PATTERNS;
  return ACCENT_PATTERNS;
}

function motifSignature(rows: Row[], start: number, beatSec: number, primary: MusicalVoice): string {
  const slotSec = Math.max(0.06, beatSec / 2);
  const body = rows.slice(0, 14).map((row) => {
    const slot = Math.round((row.time - start) / slotSec);
    const voice = row.event.voice === 'DRUMS'
      ? 'D'
      : row.event.voice === 'BASS'
        ? 'B'
        : row.event.voice === 'MELODY'
          ? 'M'
          : 'A';
    return `${slot}${voice}`;
  });
  return `${primary}:${body.join('.')}`;
}

function timbreLaneScore(event: MusicalEvent, lane: number): number {
  const scores = [
    event.low * 1.10 + event.mid * 0.20,
    event.low * 0.42 + event.mid * 0.78 + event.high * 0.08,
    event.mid * 0.78 + event.high * 0.42 + event.low * 0.08,
    event.high * 1.10 + event.mid * 0.20,
  ];
  const max = Math.max(...scores, 1e-9);
  return scores[lane] / max;
}

function roleLaneScore(event: MusicalEvent, lane: number): number {
  if (event.kind === 'KICK') return [1, 0.86, 0.20, 0.10][lane];
  if (event.kind === 'SNARE') return [0.12, 0.34, 0.88, 1][lane];
  if (event.kind === 'HAT') return [0.25, 1, 1, 0.25][lane];
  if (event.kind === 'ACCENT') return [0.92, 0.58, 0.58, 0.92][lane];
  if (event.kind === 'FILL') return 0.65;

  const target = Math.min(3, Math.max(0, Math.round(event.centroid * 3)));
  return Math.max(0.18, 1 - Math.abs(lane - target) * 0.28);
}

function chooseLane(
  row: Row,
  desired: number,
  lastLane: number,
  runLen: number,
  dt: number,
  blockedUntil: number[],
  rng: () => number,
): number {
  let bestLane = 0;
  let bestScore = -Infinity;

  for (let lane = 0; lane < 4; lane++) {
    let score = lane === desired ? 1.05 : 0;
    score += timbreLaneScore(row.event, lane) * 0.22;
    score += roleLaneScore(row.event, lane) * 0.48;

    if (blockedUntil[lane] > row.time + 0.02) score -= 5;
    if (lastLane >= 0 && dt < 0.24 && handOf(lane) !== handOf(lastLane)) score += 0.18;
    if (lane === lastLane && (runLen >= 2 || dt < 0.16)) score -= 1.20;
    if (lane === lastLane && dt > 0.30 && row.event.kind === 'KICK') score += 0.08;
    score += rng() * 0.035;

    if (score > bestScore) {
      bestScore = score;
      bestLane = lane;
    }
  }
  return bestLane;
}

function holdDuration(
  row: Row,
  cfg: DiffCfg,
  beatSec: number,
  confidence: number,
  chartDuration: number,
): number {
  if (row.event.kind !== 'HARMONIC' && row.event.kind !== 'BASS') return 0;
  if (row.event.duration < cfg.holdMin || row.event.strength < 0.34) return 0;

  let d = Math.min(cfg.holdMax, row.event.duration * 0.92);
  if (confidence >= 0.45) {
    const unit = Math.max(0.12, beatSec / 2);
    const snapped = Math.round(d / unit) * unit;
    if (Math.abs(snapped - d) <= unit * 0.30) d = snapped;
  }
  d = Math.min(d, chartDuration - row.time - 0.05);
  return d >= cfg.holdMin ? d : 0;
}

function findChordPartner(lane: number, blockedUntil: number[], time: number, rng: () => number): number | null {
  const pool = handOf(lane) === 0 ? [2, 3] : [0, 1];
  const available = pool.filter((p) => blockedUntil[p] <= time + 0.02);
  if (available.length === 0) return null;
  return available[Math.floor(rng() * available.length)];
}

/**
 * Human-like v3 chart generator.
 *
 * Instead of translating isolated onsets directly into notes, this generator
 * first keeps a coherent musical voice for each phrase, preserves repeated
 * rhythmic motifs as repeated hand shapes, maps short fills to deliberate
 * runs, turns sustained bass/harmonic events into holds, and reserves chords
 * for meaningful accents. Timbre remains a hint rather than the chart itself.
 */
export function generateChart(onsets: Onset[], opts: ChartOptions): Chart {
  const rng = mulberry32(opts.seed);
  const beatSec = 60 / Math.min(240, Math.max(40, opts.bpm));
  const cfg = diffCfg(opts.difficulty, beatSec);
  const phraseSec = Math.max(beatSec * 2, opts.phraseSec ?? beatSec * 4);
  const subSec = beatSec * cfg.subdivision;
  const confidence = clamp01(opts.tempoConfidence ?? 0.75);
  const snapTrust = confidence < 0.2 ? 0 : 0.35 + 0.65 * confidence;
  const snapWin = subSec * cfg.snapWindow * snapTrust;

  const sourceEvents = opts.events && opts.events.length > 0
    ? opts.events
    : onsets.map(eventFromOnset);

  const snapped = dedupeRows(
    sourceEvents
      .filter((event) => event.time >= 0 && event.time <= opts.duration)
      .map((event) => {
        let t = event.time;
        if (subSec > 0.05 && snapWin > 0) {
          const k = Math.round((t - opts.beatPhaseSec) / subSec);
          const gridT = opts.beatPhaseSec + k * subSec;
          if (Math.abs(gridT - t) <= snapWin && gridT >= 0 && gridT <= opts.duration) t = gridT;
        }
        return { time: t, strength: event.strength, event };
      }),
  );

  let rows = selectPhraseRows(snapped, cfg, opts.duration, phraseSec);

  // Sparse-content fallback: retain a playable pulse while keeping difficulty meaningful.
  if (rows.length < 8 && beatSec > 0.2) {
    rows = [];
    const step = opts.difficulty === 'EASY' ? beatSec : beatSec * 0.5;
    const start = Math.max(0, opts.beatPhaseSec);
    for (let t = start; t < opts.duration - 0.2; t += step) {
      rows.push({
        time: t,
        strength: 0.5,
        event: {
          time: t,
          strength: 0.5,
          duration: 0,
          kind: 'KICK',
          voice: 'DRUMS',
          low: 0.55,
          mid: 0.30,
          high: 0.15,
          centroid: 0.25,
          attack: 0.5,
          flatness: 0.2,
          isFill: false,
        },
      });
    }
  }

  const notes: NoteEvent[] = [];
  const blockedUntil = [0, 0, 0, 0];
  let lastLane = -1;
  let lastTime = -Infinity;
  let runLen = 0;
  let lastChordTime = -Infinity;

  for (let phraseStart = 0; phraseStart < opts.duration; phraseStart += phraseSec) {
    const phraseEnd = Math.min(opts.duration, phraseStart + phraseSec);
    const phraseRows = rows.filter((r) => r.time >= phraseStart && r.time < phraseEnd);
    if (phraseRows.length === 0) continue;

    const primary = dominantVoice(phraseRows, null);
    const signature = motifSignature(phraseRows, phraseStart, beatSec, primary);
    const patterns = patternsFor(primary);
    const pattern = patterns[hashString(`${opts.seed}|${signature}`) % patterns.length];
    const fillPattern = FILL_PATTERNS[hashString(`${opts.seed}|fill|${signature}`) % FILL_PATTERNS.length];
    let fillIndex = 0;

    for (let i = 0; i < phraseRows.length; i++) {
      const row = phraseRows[i];
      const dt = row.time - lastTime;
      let desired = pattern[i % pattern.length];
      if (row.event.isFill || row.event.kind === 'FILL') {
        desired = fillPattern[fillIndex % fillPattern.length];
        fillIndex++;
      } else {
        fillIndex = 0;
      }

      const lane = chooseLane(row, desired, lastLane, runLen, dt, blockedUntil, rng);
      const duration = holdDuration(row, cfg, beatSec, confidence, opts.duration);

      if (lane === lastLane) runLen++;
      else runLen = 1;
      lastLane = lane;
      lastTime = row.time;

      notes.push({
        time: row.time,
        lane,
        strength: row.strength,
        duration: duration > 0 ? Math.round(duration * 1000) / 1000 : undefined,
        sourceKind: row.event.kind,
      });

      if (duration > 0) blockedUntil[lane] = Math.max(blockedUntil[lane], row.time + duration);

      // Chords are punctuation, not random density: strong percussive/accent events only.
      const chordWorthy =
        duration === 0 &&
        row.strength >= cfg.chordStrength &&
        (row.event.kind === 'ACCENT' || row.event.kind === 'KICK' || row.event.kind === 'SNARE') &&
        row.time - lastChordTime >= cfg.chordGap;
      if (chordWorthy) {
        const partner = findChordPartner(lane, blockedUntil, row.time, rng);
        if (partner !== null) {
          notes.push({
            time: row.time,
            lane: partner,
            strength: row.strength,
            sourceKind: row.event.kind,
          });
          lastChordTime = row.time;
        }
      }
    }
  }

  notes.sort((a, b) => (a.time - b.time) || (a.lane - b.lane));
  for (const note of notes) note.time = Math.round(note.time * 1000) / 1000;

  return {
    notes,
    bpm: Math.round(opts.bpm),
    duration: opts.duration,
    difficulty: opts.difficulty,
  };
}
