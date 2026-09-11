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

export type MusicalEventKind =
  | 'KICK'
  | 'SNARE'
  | 'HAT'
  | 'BASS'
  | 'HARMONIC'
  | 'ACCENT'
  | 'FILL';

export type MusicalVoice = 'DRUMS' | 'BASS' | 'MELODY' | 'ACCENT';

/** A perceptual musical event used by the human-like chart generator. */
export interface MusicalEvent {
  time: number;
  strength: number;
  duration: number;
  kind: MusicalEventKind;
  voice: MusicalVoice;
  low: number;
  mid: number;
  high: number;
  centroid: number;
  attack: number;
  flatness: number;
  isFill: boolean;
}

/** A single playable note. duration > 0 means a hold note. */
export interface NoteEvent {
  time: number;     // seconds, relative to segment start
  lane: number;     // 0..3
  strength: number; // 0..1, source event strength
  duration?: number;
  sourceKind?: MusicalEventKind;
}

export interface Chart {
  notes: NoteEvent[]; // sorted by time, then lane
  bpm: number;
  duration: number;   // segment duration in seconds
  difficulty: Difficulty;
}

/** Raw detected onset with timbral features (pre musical-event classification). */
export interface Onset {
  time: number;      // seconds relative to segment start
  strength: number;  // 0..1 normalized
  low: number;       // low band energy ratio 0..1
  mid: number;       // mid band energy ratio 0..1
  high: number;      // high band energy ratio 0..1
  centroid: number;  // normalized spectral centroid 0..1
  attack?: number;   // normalized transient sharpness 0..1
  sustain?: number;  // estimated seconds until local energy decay
  flatness?: number; // spectral flatness 0..1
  rms?: number;      // normalized local loudness hint
}

/** Reusable DSP output so chart variants can be regenerated without re-analysis. */
export interface ChartSource {
  onsets: Onset[];
  events: MusicalEvent[];
  bpm: number;
  beatPhaseSec: number;
  tempoConfidence: number;
  phraseSec: number;
}

export interface ChartVariantRecord {
  variant: number;
  chart: Chart;
}

/** Persisted in IndexedDB so a chart survives reload/browser restart. */
export interface ChartCacheRecord {
  key: string;
  songId: string;
  startMs: number;
  durationMs: number;
  difficulty: Difficulty;
  source: ChartSource;
  variants: ChartVariantRecord[];
  updatedAt: number;
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
