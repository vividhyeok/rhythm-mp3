import type { Onset } from '../types';
import type { FrameFeatures } from './dsp';

export interface OnsetOptions {
  /** half-window (seconds) for the adaptive threshold neighbourhood */
  windowSec?: number;
  /** threshold = localMean + k * localStd */
  k?: number;
  /** minimum seconds between two onsets */
  minGapSec?: number;
}

function buildNovelty(f: FrameFeatures): Float32Array {
  const n = f.frameCount;
  const novelty = new Float32Array(n);
  const bandRise = new Float32Array(n);
  const rmsRise = new Float32Array(n);

  let maxFlux = 1e-9;
  let maxBandRise = 1e-9;
  let maxRmsRise = 1e-9;

  for (let i = 1; i < n; i++) {
    maxFlux = Math.max(maxFlux, f.flux[i]);
    const lowRise = Math.max(0, f.low[i] - f.low[i - 1]);
    const midRise = Math.max(0, f.mid[i] - f.mid[i - 1]);
    const highRise = Math.max(0, f.high[i] - f.high[i - 1]);
    bandRise[i] = lowRise + midRise + highRise;
    rmsRise[i] = Math.max(0, f.rms[i] - f.rms[i - 1]);
    maxBandRise = Math.max(maxBandRise, bandRise[i]);
    maxRmsRise = Math.max(maxRmsRise, rmsRise[i]);
  }

  for (let i = 0; i < n; i++) {
    const fluxN = f.flux[i] / maxFlux;
    const bandN = bandRise[i] / maxBandRise;
    const rmsN = rmsRise[i] / maxRmsRise;
    novelty[i] = 0.72 * fluxN + 0.18 * bandN + 0.10 * rmsN;
  }
  return novelty;
}

/**
 * Peak-picking on a blended novelty envelope.
 *
 * Spectral flux remains the main signal, but positive low/mid/high-band energy
 * rises and RMS rises are mixed in so softer attacks and strong accents are not
 * missed simply because their broadband spectral flux is modest.
 */
export function detectOnsets(f: FrameFeatures, opts: OnsetOptions = {}): Onset[] {
  const windowSec = opts.windowSec ?? 0.5;
  const k = opts.k ?? 1.35;
  const minGapSec = opts.minGapSec ?? 0.09;

  const n = f.frameCount;
  if (n < 3) return [];
  const hop = f.hopSec;
  const halfW = Math.max(1, Math.round(windowSec / hop));
  const minGapFrames = Math.max(1, Math.round(minGapSec / hop));
  const novelty = buildNovelty(f);

  const thr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - halfW);
    const b = Math.min(n - 1, i + halfW);
    let sum = 0;
    for (let j = a; j <= b; j++) sum += novelty[j];
    const mean = sum / (b - a + 1);
    let sq = 0;
    for (let j = a; j <= b; j++) {
      const d = novelty[j] - mean;
      sq += d * d;
    }
    const std = Math.sqrt(sq / (b - a + 1));
    thr[i] = mean + k * std;
  }

  const peaks: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    const v = novelty[i];
    if (v <= thr[i]) continue;
    if (v >= novelty[i - 1] && v > novelty[i + 1]) peaks.push(i);
  }

  const kept: number[] = [];
  for (const p of peaks) {
    const last = kept[kept.length - 1];
    if (last !== undefined && p - last < minGapFrames) {
      if (novelty[p] > novelty[last]) kept[kept.length - 1] = p;
    } else {
      kept.push(p);
    }
  }

  let maxExceed = 1e-9;
  let maxRms = 1e-9;
  for (const p of kept) {
    maxExceed = Math.max(maxExceed, novelty[p] - thr[p]);
    maxRms = Math.max(maxRms, f.rms[p]);
  }

  return kept.map((p) => {
    const noveltyN = (novelty[p] - thr[p]) / maxExceed;
    const rmsN = f.rms[p] / maxRms;
    const strength = Math.min(1, Math.max(0, 0.82 * noveltyN + 0.18 * rmsN));
    const tot = f.low[p] + f.mid[p] + f.high[p] + 1e-12;
    return {
      time: p * hop,
      strength,
      low: f.low[p] / tot,
      mid: f.mid[p] / tot,
      high: f.high[p] / tot,
      centroid: f.centroid[p],
    };
  });
}
