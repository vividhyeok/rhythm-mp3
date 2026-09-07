export type Difficulty = 'EASY' | 'NORMAL' | 'HARD';

export interface SongMeta {
  id: string;
  name: string;
  duration: number; // seconds
  addedAt: number;  // epoch ms
}

export interface StoredSong extends SongMeta {
  blob: Blob;
}

/** A single playable note. time is seconds relative to segment start. */
export interface NoteEvent {
  time: number;     // seconds, relative to segment start
  lane: number;     // 0..3
  strength: number; // 0..1, onset strength at generation time
}

export interface Chart {
  notes: NoteEvent[]; // sorted by time, then lane
  bpm: number;
  duration: number;   // segment duration in seconds
  difficulty: Difficulty;
}

/** Raw detected onset with timbral features (pre chart-generation). */
export interface Onset {
  time: number;      // seconds relative to segment start
  strength: number;  // 0..1 normalized
  low: number;       // low band energy ratio 0..1
  mid: number;       // mid band energy ratio 0..1
  high: number;      // high band energy ratio 0..1
  centroid: number;  // normalized spectral centroid 0..1
}

export interface ScoreRecord {
  key: string;        // `${songId}|${startMs}|${difficulty}`
  songId: string;
  startMs: number;
  difficulty: Difficulty;
  score: number;
  accuracy: number;   // 0..100
  maxCombo: number;
  perfect: number;
  great: number;
  good: number;
  miss: number;
  grade: string;
  playedAt: number;   // epoch ms
}

export interface GameResult {
  score: number;
  accuracy: number;
  maxCombo: number;
  perfect: number;
  great: number;
  good: number;
  miss: number;
  grade: string;
  totalNotes: number;
}
