import { describe, expect, it } from 'vitest';
import { estimateTempo } from '../src/analysis/tempo';
import { detectOnsets } from '../src/analysis/onset';
import { classifyMusicalEvents } from '../src/analysis/musical';
import type { FrameFeatures } from '../src/analysis/dsp';

describe('estimateTempo', () => {
  function pulseEnvelope(bpm: number, seconds: number, hopSec: number): Float32Array {
    const n = Math.floor(seconds / hopSec);
    const env = new Float32Array(n);
    const beatFrames = Math.round(60 / bpm / hopSec);
    for (let i = 0; i < n; i++) {
      env[i] = 0.02 + ((i * 17) % 11) * 0.0007;
      if (i % beatFrames === 0) env[i] = 1.0;
    }
    return env;
  }

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
    const lowFlux = new Float32Array(n);
    const midFlux = new Float32Array(n);
    const highFlux = new Float32Array(n);
    const rms = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      flux[i] = 0.01;
      rms[i] = 0.1;
    }
    for (const t of peaksAt) {
      const i = Math.round(t / hopSec);
      if (i > 0 && i < n - 1) {
        flux[i] = 1.0;
        lowFlux[i] = 0.4;
        midFlux[i] = 0.35;
        highFlux[i] = 0.25;
        rms[i] = 0.9;
      }
    }
    return {
      frameCount: n,
      hopSec,
      flux,
      lowFlux,
      midFlux,
      highFlux,
      rms,
      low: new Float32Array(n).fill(0.3),
      mid: new Float32Array(n).fill(0.3),
      high: new Float32Array(n).fill(0.3),
      centroid: new Float32Array(n).fill(0.5),
      flatness: new Float32Array(n).fill(0.25),
    };
  }

  it('detects clear peaks and exposes musical descriptors', () => {
    const hopSec = 512 / 44100;
    const times = [1, 2, 3, 4, 5];
    const f = makeFeatures(times, Math.floor(8 / hopSec), hopSec);
    const onsets = detectOnsets(f);
    expect(onsets.length).toBe(5);
    for (let i = 0; i < times.length; i++) {
      expect(Math.abs(onsets[i].time - times[i])).toBeLessThan(hopSec * 1.6);
      expect(onsets[i].attack).toBeGreaterThan(0);
      expect(onsets[i].flatness).toBeGreaterThanOrEqual(0);
      expect(onsets[i].sustain).toBeGreaterThanOrEqual(0);
    }
  });

  it('merges peaks that are too close', () => {
    const hopSec = 512 / 44100;
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

describe('classifyMusicalEvents', () => {
  it('separates kick-like and sustained harmonic gestures', () => {
    const { events } = classifyMusicalEvents([
      {
        time: 1,
        strength: 0.9,
        low: 0.72,
        mid: 0.18,
        high: 0.10,
        centroid: 0.20,
        attack: 0.9,
        sustain: 0.08,
        flatness: 0.20,
      },
      {
        time: 2,
        strength: 0.7,
        low: 0.20,
        mid: 0.58,
        high: 0.22,
        centroid: 0.42,
        attack: 0.35,
        sustain: 0.9,
        flatness: 0.12,
      },
    ], 120);
    expect(events[0].kind).toBe('KICK');
    expect(events[1].kind).toBe('HARMONIC');
    expect(events[1].duration).toBeGreaterThan(0.5);
  });
});
