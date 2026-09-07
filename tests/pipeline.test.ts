import { describe, expect, it } from 'vitest';
import { analyzeFrames } from '../src/analysis/dsp';
import { detectOnsets } from '../src/analysis/onset';
import { estimateTempo } from '../src/analysis/tempo';
import { generateChart } from '../src/chart/chartgen';
import { mulberry32 } from '../src/util/random';

/**
 * End-to-end DSP pipeline test on a synthetic 40s click track:
 * kick drums on beats + hi-hat noise on offbeats at 128 BPM.
 */
function synthTrack(bpm: number, seconds: number, sr: number): Float32Array {
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  const rng = mulberry32(42);
  const beatSec = 60 / bpm;

  // kicks on every beat
  for (let t = 0.1; t < seconds - 0.1; t += beatSec) {
    const s0 = Math.floor(t * sr);
    const len = Math.floor(0.12 * sr);
    for (let i = 0; i < len && s0 + i < n; i++) {
      const env = Math.exp(-i / (0.02 * sr));
      out[s0 + i] += env * Math.sin((2 * Math.PI * 55 * i) / sr) * 0.9;
    }
  }
  // hats on offbeats (eighth notes)
  for (let t = 0.1 + beatSec / 2; t < seconds - 0.1; t += beatSec / 2) {
    const s0 = Math.floor(t * sr);
    const len = Math.floor(0.03 * sr);
    for (let i = 0; i < len && s0 + i < n; i++) {
      const env = Math.exp(-i / (0.006 * sr));
      out[s0 + i] += env * (rng() * 2 - 1) * 0.35;
    }
  }
  return out;
}

describe('full analysis pipeline (synthetic 128 BPM track)', () => {
  it('detects onsets, tempo and builds a playable chart', async () => {
    const sr = 44100;
    const seconds = 40;
    const samples = synthTrack(128, seconds, sr);

    const features = await analyzeFrames(samples, sr);
    expect(features.frameCount).toBeGreaterThan(3000);

    const onsets = detectOnsets(features);
    // 128 BPM over 40s = ~85 beats + ~170 hats = ~255 transients; allow wide margin
    expect(onsets.length).toBeGreaterThan(100);
    expect(onsets.length).toBeLessThan(500);

    // first kick at 0.1s should be detected nearby
    expect(Math.abs(onsets[0].time - 0.1)).toBeLessThan(0.05);

    const tempo = estimateTempo(features.flux, features.hopSec);
    // 128 or its half (64) are both plausible autocorrelation results
    const ok = Math.abs(tempo.bpm - 128) < 4 || Math.abs(tempo.bpm - 64) < 2;
    expect(ok).toBe(true);

    const chart = generateChart(onsets, {
      difficulty: 'NORMAL',
      seed: 7,
      bpm: tempo.bpm,
      beatPhaseSec: tempo.beatPhaseSec,
      duration: seconds,
    });
    expect(chart.notes.length).toBeGreaterThan(50);

    // chart notes should align with actual transient times (within 60ms)
    let aligned = 0;
    for (const n of chart.notes) {
      for (const o of onsets) {
        if (Math.abs(o.time - n.time) < 0.06) {
          aligned++;
          break;
        }
      }
    }
    expect(aligned / chart.notes.length).toBeGreaterThan(0.7);
  }, 30000);
});
