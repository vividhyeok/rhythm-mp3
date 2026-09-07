import { describe, expect, it } from 'vitest';
import { estimateTempo } from '../src/analysis/tempo';
import { detectOnsets } from '../src/analysis/onset';
import type { FrameFeatures } from '../src/analysis/dsp';

function pulseEnvelope(bpm: number, seconds: number, hopSec: number): Float32Array {
  const n = Math.floor(seconds / hopSec);
  const env = new Float32Array(n);
  const beatFrames = Math.round(60 / bpm / hopSec);
  for (let i = 0; i < n; i++) {
    env[i] = 0.02 + Math.random() * 0.01; // noise floor
    if (i % beatFrames === 0) env[i] = 1.0;
  }
  return env;
}

describe('estimateTempo', () => {
  it('detects ~120 BPM from a pulse train', () => {
    const hopSec = 512 / 44100;
    const env = pulseEnvelope(120, 40, hopSec);
    const r = estimateTempo(env, hopSec);
    expect(r.bpm).toBeGreaterThan(115);
    expect(r.bpm).toBeLessThan(125);
  });

  it('detects ~90 BPM from a pulse train', () => {
    const hopSec = 512 / 44100;
    const env = pulseEnvelope(90, 40, hopSec);
    const r = estimateTempo(env, hopSec);
    // allow octave errors: 90 or 180 both acceptable
    const ok = (r.bpm > 86 && r.bpm < 94) || (r.bpm > 172 && r.bpm < 188);
    expect(ok).toBe(true);
  });

  it('returns a fallback for degenerate input', () => {
    const r = estimateTempo(new Float32Array(4), 0.01);
    expect(r.bpm).toBe(120);
  });
});

describe('detectOnsets', () => {
  function makeFeatures(peaksAt: number[], n: number, hopSec: number): FrameFeatures {
    const flux = new Float32Array(n);
    const rms = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      flux[i] = 0.01;
      rms[i] = 0.1;
    }
    for (const t of peaksAt) {
      const i = Math.round(t / hopSec);
      if (i > 0 && i < n - 1) {
        flux[i] = 1.0;
        rms[i] = 0.9;
      }
    }
    return {
      frameCount: n,
      hopSec,
      flux,
      rms,
      low: new Float32Array(n).fill(0.3),
      mid: new Float32Array(n).fill(0.3),
      high: new Float32Array(n).fill(0.3),
      centroid: new Float32Array(n).fill(0.5),
    };
  }

  it('detects clear peaks', () => {
    const hopSec = 512 / 44100;
    const times = [1, 2, 3, 4, 5];
    const f = makeFeatures(times, Math.floor(8 / hopSec), hopSec);
    const onsets = detectOnsets(f);
    expect(onsets.length).toBe(5);
    for (let i = 0; i < times.length; i++) {
      expect(Math.abs(onsets[i].time - times[i])).toBeLessThan(hopSec * 1.6);
    }
  });

  it('merges peaks that are too close', () => {
    const hopSec = 512 / 44100;
    // two peaks 2 frames apart (~23ms) should merge into one
    const f = makeFeatures([2.0, 2.0 + 2 * hopSec, 4.0], Math.floor(8 / hopSec), hopSec);
    const onsets = detectOnsets(f);
    expect(onsets.length).toBe(2);
  });

  it('ignores a flat envelope', () => {
    const hopSec = 512 / 44100;
    const f = makeFeatures([], Math.floor(8 / hopSec), hopSec);
    expect(detectOnsets(f).length).toBe(0);
  });
});
