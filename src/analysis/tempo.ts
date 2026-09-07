export interface TempoResult {
  bpm: number;
  /** 0..1 rough confidence of the estimate */
  confidence: number;
  /** beat phase in seconds, relative to segment start, within [0, beatSec) */
  beatPhaseSec: number;
}

const MIN_BPM = 60;
const MAX_BPM = 200;

/**
 * Estimate tempo via autocorrelation of the onset (flux) envelope,
 * with a mild prior favouring common dance/pop tempi around 120 BPM
 * to reduce octave errors. Also estimates beat phase.
 */
export function estimateTempo(flux: Float32Array, hopSec: number): TempoResult {
  const n = flux.length;
  if (n < 16) {
    return { bpm: 120, confidence: 0, beatPhaseSec: 0 };
  }

  // Envelope: mean-subtracted, positive part.
  let mean = 0;
  for (let i = 0; i < n; i++) mean += flux[i];
  mean /= n;
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) env[i] = Math.max(0, flux[i] - mean);

  const minLag = Math.max(1, Math.round(60 / MAX_BPM / hopSec));
  const maxLag = Math.min(n - 1, Math.round(60 / MIN_BPM / hopSec));

  let bestLag = minLag;
  let bestScore = -Infinity;
  let sumScore = 0;
  let cntScore = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0;
    for (let i = 0; i + lag < n; i++) c += env[i] * env[i + lag];
    c /= n - lag;
    const bpm = 60 / (lag * hopSec);
    // Log-gaussian tempo prior centred at 120 BPM.
    const z = Math.log2(bpm / 120) / 0.8;
    const prior = Math.exp(-0.5 * z * z);
    const score = c * (0.35 + 0.65 * prior);
    sumScore += score;
    cntScore++;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  const avgScore = cntScore > 0 ? sumScore / cntScore : 0;
  const confidence =
    avgScore > 0 ? Math.min(1, Math.max(0, (bestScore - avgScore) / (bestScore + 1e-12))) : 0;

  const bpm = 60 / (bestLag * hopSec);

  // Beat phase: pick the grid offset that maximizes envelope energy on beats.
  let bestPhase = 0;
  let bestPhaseSum = -Infinity;
  for (let p = 0; p < bestLag; p++) {
    let s = 0;
    for (let i = p; i < n; i += bestLag) s += env[i];
    if (s > bestPhaseSum) {
      bestPhaseSum = s;
      bestPhase = p;
    }
  }

  return { bpm, confidence, beatPhaseSec: bestPhase * hopSec };
}
