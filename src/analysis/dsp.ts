import FFT from 'fft.js';

export const FRAME_SIZE = 1024;
export const HOP_SIZE = 512;

export function hannWindow(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  return w;
}

export interface FrameFeatures {
  frameCount: number;
  hopSec: number;
  /** positive spectral flux per frame */
  flux: Float32Array;
  /** positive low/mid/high-band spectral flux */
  lowFlux: Float32Array;
  midFlux: Float32Array;
  highFlux: Float32Array;
  /** RMS energy per frame */
  rms: Float32Array;
  /** low band energy (<=250Hz) per frame */
  low: Float32Array;
  /** mid band energy (250-2000Hz) per frame */
  mid: Float32Array;
  /** high band energy (2000-8000Hz) per frame */
  high: Float32Array;
  /** normalized spectral centroid 0..1 per frame */
  centroid: Float32Array;
  /** spectral flatness 0..1; noisy/transient spectra are flatter */
  flatness: Float32Array;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Compute per-frame spectral features from mono samples.
 * Async with periodic yields so the UI stays responsive.
 */
export async function analyzeFrames(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (p: number) => void,
): Promise<FrameFeatures> {
  const fft = new FFT(FRAME_SIZE);
  const win = hannWindow(FRAME_SIZE);
  const frame = new Float32Array(FRAME_SIZE);
  const spectrum = fft.createComplexArray();
  const bins = FRAME_SIZE / 2;

  const frameCount = Math.max(0, Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE) + 1);
  const flux = new Float32Array(frameCount);
  const lowFlux = new Float32Array(frameCount);
  const midFlux = new Float32Array(frameCount);
  const highFlux = new Float32Array(frameCount);
  const rms = new Float32Array(frameCount);
  const low = new Float32Array(frameCount);
  const mid = new Float32Array(frameCount);
  const high = new Float32Array(frameCount);
  const centroid = new Float32Array(frameCount);
  const flatness = new Float32Array(frameCount);

  const binHz = sampleRate / FRAME_SIZE;
  const lowEnd = Math.max(1, Math.floor(250 / binHz));
  const midEnd = Math.max(lowEnd + 1, Math.floor(2000 / binHz));
  const highEnd = Math.min(bins, Math.ceil(8000 / binHz));

  const prevMag = new Float32Array(bins + 1);

  for (let i = 0; i < frameCount; i++) {
    const off = i * HOP_SIZE;
    let sumSq = 0;
    for (let j = 0; j < FRAME_SIZE; j++) {
      const v = samples[off + j];
      frame[j] = v * win[j];
      sumSq += v * v;
    }
    rms[i] = Math.sqrt(sumSq / FRAME_SIZE);

    fft.realTransform(spectrum, frame);

    let f = 0;
    let lf = 0;
    let mf = 0;
    let hf = 0;
    let le = 0;
    let me = 0;
    let he = 0;
    let cnum = 0;
    let cden = 0;
    let logMag = 0;
    let magMean = 0;
    let flatCount = 0;

    for (let b = 0; b <= bins; b++) {
      const re = spectrum[2 * b];
      const im = spectrum[2 * b + 1];
      const mag = Math.sqrt(re * re + im * im) / FRAME_SIZE;
      const d = mag - prevMag[b];
      if (d > 0) {
        f += d;
        if (b <= lowEnd) lf += d;
        else if (b <= midEnd) mf += d;
        else if (b <= highEnd) hf += d;
      }
      prevMag[b] = mag;

      const e = mag * mag;
      if (b <= lowEnd) le += e;
      else if (b <= midEnd) me += e;
      else if (b <= highEnd) he += e;

      cnum += b * mag;
      cden += mag;

      if (b > 0 && b <= highEnd) {
        logMag += Math.log(mag + 1e-12);
        magMean += mag;
        flatCount++;
      }
    }

    flux[i] = f;
    lowFlux[i] = lf;
    midFlux[i] = mf;
    highFlux[i] = hf;
    low[i] = le;
    mid[i] = me;
    high[i] = he;
    centroid[i] = cden > 1e-12 ? cnum / cden / bins : 0;
    if (flatCount > 0 && magMean > 1e-12) {
      const geo = Math.exp(logMag / flatCount);
      const arith = magMean / flatCount;
      flatness[i] = Math.min(1, Math.max(0, geo / arith));
    }

    if ((i & 255) === 0) {
      onProgress?.(i / Math.max(1, frameCount));
      await tick();
    }
  }
  onProgress?.(1);

  return {
    frameCount,
    hopSec: HOP_SIZE / sampleRate,
    flux,
    lowFlux,
    midFlux,
    highFlux,
    rms,
    low,
    mid,
    high,
    centroid,
    flatness,
  };
}
