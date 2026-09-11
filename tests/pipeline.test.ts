import { describe, expect, it } from 'vitest';
import { analyzeFrames } from '../src/analysis/dsp';
import { detectOnsets } from '../src/analysis/onset';
import { estimateTempo } from '../src/analysis/tempo';
import { classifyMusicalEvents } from '../src/analysis/musical';
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

  for (let t = 0.1; t < seconds - 0.1; t += beatSec) {
    const s0 = Math.floor(t * sr);
    const len = Math.floor(0.12 * sr);
    for (let i = 0; i < len && s0 + i < n; i++) {
      const env = Math.exp(-i / (0.02 * sr));
      out[s0 + i] += env * Math.sin((2 * Math.PI * 55 * i) / sr) * 0.9;
    }
  }
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
  it('detects events, tempo and builds a playable v3 chart', async () => {
    const sr = 44100;
    const seconds = 40;
    const samples = synthTrack(128, seconds, sr);

    const features = await analyzeFrames(samples, sr);
    expect(features.frameCount).toBeGreaterThan(3000);

    const onsets = detectOnsets(features);
    expect(onsets.length).toBeGreaterThan(100);
    expect(onsets.length).toBeLessThan(500);
    expect(Math.abs(onsets[0].time - 0.1)).toBeLessThan(0.05);

    const tempo = estimateTempo(features.flux, features.hopSec);
    const ok = Math.abs(tempo.bpm - 128) < 4 || Math.abs(tempo.bpm - 64) < 2;
    expect(ok).toBe(true);

    const musical = classifyMusicalEvents(onsets, tempo.bpm);
    expect(musical.events.length).toBe(onsets.length);

    const chart = generateChart(onsets, {
      difficulty: 'NORMAL',
      seed: 7,
      bpm: tempo.bpm,
      beatPhaseSec: tempo.beatPhaseSec,
      tempoConfidence: tempo.confidence,
      duration: seconds,
      events: musical.events,
      phraseSec: musical.phraseSec,
    });
    expect(chart.notes.length).toBeGreaterThan(50);

    // Human-like charts may snap source transients onto the musical beat grid,
    // so validate perceptual proximity rather than exact raw-onset copying.
    let aligned80 = 0;
    let aligned140 = 0;
    for (const n of chart.notes) {
      let best = Infinity;
      for (const o of onsets) best = Math.min(best, Math.abs(o.time - n.time));
      if (best < 0.08) aligned80++;
      if (best < 0.14) aligned140++;
    }
    expect(aligned80 / chart.notes.length).toBeGreaterThan(0.7);
    expect(aligned140 / chart.notes.length).toBeGreaterThan(0.9);
  }, 30000);
});
