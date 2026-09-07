export const SEGMENT_SECONDS = 40;
export const MIN_SEGMENT_SECONDS = 5;

/** Clamp a desired start so that at least MIN_SEGMENT_SECONDS remain. */
export function clampStart(songDuration: number, start: number): number {
  const maxStart = Math.max(0, songDuration - MIN_SEGMENT_SECONDS);
  return Math.min(Math.max(0, start), maxStart);
}

/** Compute the playable segment: 40s from start, or whatever remains. */
export function computeSegment(
  songDuration: number,
  desiredStart: number,
): { start: number; duration: number } {
  const start = clampStart(songDuration, desiredStart);
  const duration = Math.min(SEGMENT_SECONDS, Math.max(0, songDuration - start));
  return { start, duration };
}

/** Format seconds as MM:SS.s */
export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  const whole = Math.floor(s);
  const tenth = Math.floor((s - whole) * 10);
  return `${String(m).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${tenth}`;
}
