import { describe, expect, it } from 'vitest';
import { clampStart, computeSegment, SEGMENT_SECONDS, MIN_SEGMENT_SECONDS } from '../src/util/segment';

describe('computeSegment', () => {
  it('uses 40s when plenty of song remains', () => {
    const s = computeSegment(180, 30);
    expect(s.start).toBe(30);
    expect(s.duration).toBe(SEGMENT_SECONDS);
  });
  it('uses remaining length when less than 40s remains', () => {
    const s = computeSegment(180, 150);
    expect(s.start).toBe(150);
    expect(s.duration).toBe(30);
  });
  it('clamps start so at least MIN_SEGMENT_SECONDS remain', () => {
    const s = computeSegment(180, 179.5);
    expect(s.start).toBe(180 - MIN_SEGMENT_SECONDS);
    expect(s.duration).toBe(MIN_SEGMENT_SECONDS);
  });
  it('clamps negative start to 0', () => {
    const s = computeSegment(180, -10);
    expect(s.start).toBe(0);
    expect(s.duration).toBe(SEGMENT_SECONDS);
  });
  it('handles songs shorter than 40s', () => {
    const s = computeSegment(20, 0);
    expect(s.start).toBe(0);
    expect(s.duration).toBe(20);
  });
  it('handles very short songs', () => {
    const s = computeSegment(3, 0);
    expect(s.start).toBe(0);
    expect(s.duration).toBe(3);
  });
});

describe('clampStart', () => {
  it('never exceeds duration - MIN_SEGMENT_SECONDS', () => {
    expect(clampStart(100, 999)).toBe(100 - MIN_SEGMENT_SECONDS);
  });
  it('never goes below 0', () => {
    expect(clampStart(2, -5)).toBe(0);
  });
});
