export interface TempoResult {
  bpm: number;
  /** 0..1 rough confidence of the estimate */
  confidence: number;
  /** beat phase in seconds, relative to segment start, within [0, beatSec) */
  beatPhaseSec: number;
}

const MIN_BPM = 60;
const MAX_BPM = 200;

function corrAt(env: Float32Array, lag: number): number {
  let xy = 0;
  let xx = 0;
  let yy = 0;
  for (let i = 0; i + lag < env.length; i++) {
    const a = env[i];
    const b = env[i + lag];
    xy += a * b;
    xx += a * a;
    yy += b * b;
  }
  const den = Math.sqrt(xx * yy);
  return den > 1e-12 ? xy / den : 0;
}

/**
 * Estimate tempo from the onset-flux envelope.
 *
 * Uses normalized autocorrelation, harmonic support and a conservative octave
 * correction. When a slow half-time candidate has a strongly supported
 * double-time pulse, prefer the double-time interpretation because it gives
 * chart snapping a more useful musical grid without forcing every song to 120.
 */
export function estimateTempo(flux: Float32Array, hopSec: number): TempoResult {
  const n = flux.length;
  if (n < 16) {
    return { bpm: 120, confidence: 0, beatPhaseSec: 0 };
  }

  let mean = 0;
  for (let i = 0; i < n; i++) mean += flux[i];
  mean /= n;

  const env = new Float32Array(n);
  let envEnergy = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, flux[i] - mean);
    env[i] = v;
    envEnergy += v * v;
  }
  if (envEnergy < 1e-12) {
    return { bpm: 120, confidence: 0, beatPhaseSec: 0 };
  }

  const minLag = Math.max(1, Math.round(60 / MAX_BPM / hopSec));
  const maxLag = Math.min(n - 2, Math.round(60 / MIN_BPM / hopSec));
  const corr = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) corr[lag] = corrAt(env, lag);

  let bestLag = minLag;
  let bestScore = -Infinity;
  let secondScore = -Infinity;

  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 / (lag * hopSec);
    let score = corr[lag];

    if (lag * 2 <= maxLag) score += 0.34 * corr[lag * 2];
    const halfLag = Math.round(lag / 2);
    if (halfLag >= minLag) score += 0.12 * corr[halfLag];

    const z = Math.log2(bpm / 120) / 1.15;
    const prior = Math.exp(-0.5 * z * z);
    score *= 0.86 + 0.14 * prior;

    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestLag = lag;
    } else if (Math.abs(lag - bestLag) > 2 && score > secondScore) {
      secondScore = score;
    }
  }

  // Half-time is a common autocorrelation failure mode. If the chosen tempo is
  // slow but its double-time lag still has substantial periodic support, use
  // the denser grid. This is deliberately asymmetric: a 128 BPM pulse is more
  // useful for 4-key phrasing than an accidental 64 BPM interpretation.
  const rawBpm = 60 / (bestLag * hopSec);
  if (rawBpm < 90) {
    const doubleLag = Math.round(bestLag / 2);
    if (doubleLag >= minLag && corr[doubleLag] >= corr[bestLag] * 0.58) {
      bestLag = doubleLag;
    }
  }

  const bpm = 60 / (bestLag * hopSec);

  let bestPhase = 0;
  let bestPhaseSum = -Infinity;
  let phaseTotal = 0;
  for (let p = 0; p < bestLag; p++) {
    let s = 0;
    for (let i = p; i < n; i += bestLag) s += env[i];
    phaseTotal += Math.max(0, s);
    if (s > bestPhaseSum) {
      bestPhaseSum = s;
      bestPhase = p;
    }
  }

  const margin = bestScore > 1e-9
    ? Math.max(0, (bestScore - Math.max(0, secondScore)) / bestScore)
    : 0;
  const phaseConcentration = phaseTotal > 1e-9
    ? Math.min(1, (bestPhaseSum * bestLag) / phaseTotal)
    : 0;
  const periodicity = Math.min(1, Math.max(0, corr[bestLag]));
  const confidence = Math.min(
    1,
    Math.max(0, 0.45 * periodicity + 0.35 * margin + 0.2 * Math.min(1, phaseConcentration / 3)),
  );

  return { bpm, confidence, beatPhaseSec: bestPhase * hopSec };
}
