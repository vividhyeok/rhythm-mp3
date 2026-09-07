import type { Chart, Difficulty, GameResult, SongMeta } from './types';

/** Mutable cross-screen session state (in-memory only). */
export interface Session {
  song: SongMeta | null;
  /** decoded full-song buffer, cached between segment/analyze/game screens */
  buffer: AudioBuffer | null;
  segmentStart: number;
  segmentDuration: number;
  difficulty: Difficulty;
  chart: Chart | null;
  result: GameResult | null;
  isNewBest: boolean;
  bestScore: number | null;
}

export const session: Session = {
  song: null,
  buffer: null,
  segmentStart: 0,
  segmentDuration: 40,
  difficulty: 'NORMAL',
  chart: null,
  result: null,
  isNewBest: false,
  bestScore: null,
};
