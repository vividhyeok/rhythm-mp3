import { describe, expect, it } from 'vitest';
import { generateChart } from '../src/chart/chartgen';
import type { Onset } from '../src/types';

function makeOnsets(count: number, interval: number, start = 0.5): Onset[] {
  const out: Onset[] = [];
  for (let i = 0; i < count; i++) {
    const strong = i % 4 === 0;
    out.push({
      time: start + i * interval,
      strength: strong ? 0.9 : 0.4 + (i % 3) * 0.1,
      low: strong ? 0.7 : 0.2,
      mid: 0.2,
      high: strong ? 0.1 : 0.6,
      centroid: strong ? 0.2 : 0.7,
    });
  }
  return out;
}

const baseOpts = {
  seed: 12345,
  bpm: 120,
  beatPhaseSec: 0,
  duration: 40,
} as const;

describe('generateChart', () => {
  it('is deterministic for the same input and seed', () => {
    const onsets = makeOnsets(80, 0.45);
    const a = generateChart(onsets, { ...baseOpts, difficulty: 'NORMAL' });
    const b = generateChart(onsets, { ...baseOpts, difficulty: 'NORMAL' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('produces sorted notes with valid lanes', () => {
    const chart = generateChart(makeOnsets(80, 0.45), { ...baseOpts, difficulty: 'NORMAL' });
    expect(chart.notes.length).toBeGreaterThan(0);
    for (let i = 0; i < chart.notes.length; i++) {
      const n = chart.notes[i];
      expect(n.lane).toBeGreaterThanOrEqual(0);
      expect(n.lane).toBeLessThanOrEqual(3);
      if (i > 0) {
        expect(n.time).toBeGreaterThanOrEqual(chart.notes[i - 1].time);
      }
    }
  });

  it('never places 3+ notes at the same timestamp', () => {
    const chart = generateChart(makeOnsets(120, 0.3), { ...baseOpts, difficulty: 'HARD' });
    const byTime = new Map<number, number>();
    for (const n of chart.notes) {
      byTime.set(n.time, (byTime.get(n.time) ?? 0) + 1);
    }
    for (const c of byTime.values()) {
      expect(c).toBeLessThanOrEqual(2);
    }
  });

  it('respects minimum interval between note rows', () => {
    const chart = generateChart(makeOnsets(200, 0.1), { ...baseOpts, difficulty: 'NORMAL' });
    const times = [...new Set(chart.notes.map((n) => n.time))].sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(0.12);
    }
  });

  it('EASY is sparser than HARD', () => {
    const onsets = makeOnsets(150, 0.25);
    const easy = generateChart(onsets, { ...baseOpts, difficulty: 'EASY' });
    const hard = generateChart(onsets, { ...baseOpts, difficulty: 'HARD' });
    expect(hard.notes.length).toBeGreaterThan(easy.notes.length);
  });

  it('EASY produces no chords', () => {
    const chart = generateChart(makeOnsets(100, 0.4), { ...baseOpts, difficulty: 'EASY' });
    const times = chart.notes.map((n) => n.time);
    expect(new Set(times).size).toBe(times.length);
  });

  it('falls back to a beat grid when onsets are empty', () => {
    const chart = generateChart([], { ...baseOpts, difficulty: 'NORMAL' });
    expect(chart.notes.length).toBeGreaterThan(8);
  });

  it('different seeds can produce different charts', () => {
    const onsets = makeOnsets(80, 0.45);
    const a = generateChart(onsets, { ...baseOpts, seed: 1, difficulty: 'NORMAL' });
    const b = generateChart(onsets, { ...baseOpts, seed: 999999, difficulty: 'NORMAL' });
    // lanes should differ somewhere (overwhelmingly likely with real variation)
    expect(JSON.stringify(a.notes)).not.toBe(JSON.stringify(b.notes));
  });
});
