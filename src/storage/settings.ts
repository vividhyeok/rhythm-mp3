export interface Settings {
  /** ms added to input time when judging (positive = judge later) */
  inputOffsetMs: number;
  /** ms added to song time when rendering notes (positive = notes earlier) */
  visualOffsetMs: number;
  /** seconds a note takes to travel from spawn to the judgement line */
  approachSec: number;
}

const KEY = 'rhythm-mp3-settings-v1';

export const DEFAULT_SETTINGS: Settings = {
  inputOffsetMs: 0,
  visualOffsetMs: 0,
  approachSec: 1.4,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      inputOffsetMs: clampNum(parsed.inputOffsetMs, -200, 200, DEFAULT_SETTINGS.inputOffsetMs),
      visualOffsetMs: clampNum(parsed.visualOffsetMs, -200, 200, DEFAULT_SETTINGS.visualOffsetMs),
      approachSec: clampNum(parsed.approachSec, 0.8, 2.2, DEFAULT_SETTINGS.approachSec),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage may be unavailable; ignore
  }
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : NaN;
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
