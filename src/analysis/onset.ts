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

/**
 * Peak-picking on the positive spectral flux envelope with an adaptive
 * (local mean + k*std) threshold, blended with the RMS envelope so that
 * both percussive transients and strong energy accents register.
 */
export function detectOnsets(f: FrameFeatures, opts: OnsetOptions = {}): Onset[] {
  const windowSec = opts.windowSec ?? 0.5;
  const k = opts.k ?? 1.5;
  const minGapSec = opts.minGapSec ?? 0.09;

  const n = f.frameCount;
  if (n < 3) return [];
  const hop = f.hopSec;
  const halfW = Math.max(1, Math.round(windowSec / hop));
  const minGapFrames = Math.max(1, Math.round(minGapSec / hop));

  // Adaptive threshold from local statistics of the flux envelope.
  const thr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - halfW);
    const b = Math.min(n - 1, i + halfW);
    let sum = 0;
    for (let j = a; j <= b; j++) sum += f.flux[j];
    const mean = sum / (b - a + 1);
    let sq = 0;
    for (let j = a; j <= b; j++) {
      const d = f.flux[j] - mean;
      sq += d * d;
    }
    const std = Math.sqrt(sq / (b - a + 1));
    thr[i] = mean + k * std;
  }

  // Peak picking: local maximum above the adaptive threshold.
  const peaks: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    const v = f.flux[i];
    if (v <= thr[i]) continue;
    if (v >= f.flux[i - 1] && v > f.flux[i + 1]) {
      peaks.push(i);
    }
  }

  // Merge peaks that are too close: keep the stronger one.
  const kept: number[] = [];
  for (const p of peaks) {
    const last = kept[kept.length - 1];
    if (last !== undefined && p - last < minGapFrames) {
      if (f.flux[p] > f.flux[last]) kept[kept.length - 1] = p;
    } else {
      kept.push(p);
    }
  }

  // Normalize strengths: exceedance over threshold, blended with RMS.
  let maxExceed = 1e-9;
  let maxRms = 1e-9;
  for (const p of kept) {
    maxExceed = Math.max(maxExceed, f.flux[p] - thr[p]);
    maxRms = Math.max(maxRms, f.rms[p]);
  }

  const onsets: Onset[] = kept.map((p) => {
    const fluxN = (f.flux[p] - thr[p]) / maxExceed;
    const rmsN = f.rms[p] / maxRms;
    const strength = Math.min(1, Math.max(0, 0.75 * fluxN + 0.25 * rmsN));
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

  return onsets;
}
