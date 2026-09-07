export type Judgement = 'PERFECT' | 'GREAT' | 'GOOD' | 'MISS';

export const WINDOW_PERFECT = 0.045; // 45ms
export const WINDOW_GREAT = 0.09;    // 90ms
export const WINDOW_GOOD = 0.14;     // 140ms

/** Judge an absolute timing error (seconds). Returns null when outside all windows. */
export function judgeError(absErrorSec: number): Judgement | null {
  if (absErrorSec <= WINDOW_PERFECT) return 'PERFECT';
  if (absErrorSec <= WINDOW_GREAT) return 'GREAT';
  if (absErrorSec <= WINDOW_GOOD) return 'GOOD';
  return null;
}

export const JUDGE_WEIGHT: Record<Judgement, number> = {
  PERFECT: 1.0,
  GREAT: 0.8,
  GOOD: 0.5,
  MISS: 0.0,
};

export const MAX_SCORE = 1_000_000;

export interface Counts {
  perfect: number;
  great: number;
  good: number;
  miss: number;
}

export function emptyCounts(): Counts {
  return { perfect: 0, great: 0, good: 0, miss: 0 };
}

export function countOf(c: Counts, j: Judgement): number {
  switch (j) {
    case 'PERFECT': return c.perfect;
    case 'GREAT': return c.great;
    case 'GOOD': return c.good;
    case 'MISS': return c.miss;
  }
}

export function addCount(c: Counts, j: Judgement): void {
  switch (j) {
    case 'PERFECT': c.perfect++; break;
    case 'GREAT': c.great++; break;
    case 'GOOD': c.good++; break;
    case 'MISS': c.miss++; break;
  }
}

function weightedSum(c: Counts): number {
  return c.perfect * 1.0 + c.great * 0.8 + c.good * 0.5;
}

/** Accuracy in percent (0..100) over judged notes. */
export function computeAccuracy(c: Counts): number {
  const total = c.perfect + c.great + c.good + c.miss;
  if (total === 0) return 0;
  return (weightedSum(c) / total) * 100;
}

/** Score normalized so that all-PERFECT equals 1,000,000. */
export function computeScore(c: Counts, totalNotes: number): number {
  if (totalNotes <= 0) return 0;
  return Math.round((weightedSum(c) / totalNotes) * MAX_SCORE);
}

export function computeGrade(accuracy: number): string {
  if (accuracy >= 95) return 'S';
  if (accuracy >= 90) return 'A';
  if (accuracy >= 80) return 'B';
  if (accuracy >= 70) return 'C';
  return 'D';
}
