import { describe, expect, it } from 'vitest';
import {
  computeAccuracy,
  computeGrade,
  computeScore,
  judgeError,
  MAX_SCORE,
  WINDOW_GOOD,
  WINDOW_GREAT,
  WINDOW_PERFECT,
} from '../src/game/judgement';

describe('judgeError', () => {
  it('judges PERFECT within 45ms', () => {
    expect(judgeError(0)).toBe('PERFECT');
    expect(judgeError(WINDOW_PERFECT)).toBe('PERFECT');
    expect(judgeError(0.0449)).toBe('PERFECT');
  });
  it('judges GREAT within 90ms', () => {
    expect(judgeError(WINDOW_PERFECT + 0.001)).toBe('GREAT');
    expect(judgeError(WINDOW_GREAT)).toBe('GREAT');
  });
  it('judges GOOD within 140ms', () => {
    expect(judgeError(WINDOW_GREAT + 0.001)).toBe('GOOD');
    expect(judgeError(WINDOW_GOOD)).toBe('GOOD');
  });
  it('returns null outside all windows', () => {
    expect(judgeError(WINDOW_GOOD + 0.001)).toBeNull();
    expect(judgeError(1)).toBeNull();
  });
});

describe('computeScore', () => {
  it('gives 1,000,000 for all perfect', () => {
    expect(computeScore({ perfect: 100, great: 0, good: 0, miss: 0 }, 100)).toBe(MAX_SCORE);
  });
  it('gives 0 for all miss', () => {
    expect(computeScore({ perfect: 0, great: 0, good: 0, miss: 100 }, 100)).toBe(0);
  });
  it('weights great 80% and good 50%', () => {
    expect(computeScore({ perfect: 0, great: 100, good: 0, miss: 0 }, 100)).toBe(800_000);
    expect(computeScore({ perfect: 0, great: 0, good: 100, miss: 0 }, 100)).toBe(500_000);
  });
  it('handles zero notes', () => {
    expect(computeScore({ perfect: 0, great: 0, good: 0, miss: 0 }, 0)).toBe(0);
  });
});

describe('computeAccuracy', () => {
  it('is 100 for all perfect', () => {
    expect(computeAccuracy({ perfect: 10, great: 0, good: 0, miss: 0 })).toBe(100);
  });
  it('is 0 for all miss', () => {
    expect(computeAccuracy({ perfect: 0, great: 0, good: 0, miss: 10 })).toBe(0);
  });
  it('is 0 with no judgements', () => {
    expect(computeAccuracy({ perfect: 0, great: 0, good: 0, miss: 0 })).toBe(0);
  });
});

describe('computeGrade', () => {
  it('assigns grades by accuracy', () => {
    expect(computeGrade(100)).toBe('S');
    expect(computeGrade(95)).toBe('S');
    expect(computeGrade(94.9)).toBe('A');
    expect(computeGrade(90)).toBe('A');
    expect(computeGrade(89.9)).toBe('B');
    expect(computeGrade(80)).toBe('B');
    expect(computeGrade(79.9)).toBe('C');
    expect(computeGrade(70)).toBe('C');
    expect(computeGrade(69.9)).toBe('D');
    expect(computeGrade(0)).toBe('D');
  });
});
