import type { Chart, Difficulty } from '../types';
import { analyzeFrames } from './dsp';
import { detectOnsets } from './onset';
import { estimateTempo } from './tempo';
import { generateChart } from '../chart/chartgen';

export type AnalysisStage =
  | 'DECODING AUDIO'
  | 'ANALYZING ONSETS'
  | 'DETECTING BEATS'
  | 'BUILDING CHART';

export interface AnalyzeInput {
  /** mono-mixable AudioBuffer of the full song */
  buffer: AudioBuffer;
  /** segment start in seconds */
  start: number;
  /** segment duration in seconds */
  duration: number;
  difficulty: Difficulty;
  seed: number;
  onStage?: (stage: AnalysisStage, progress?: number) => void;
}

/** Extract a mono Float32Array of the requested segment from an AudioBuffer. */
export function extractMono(
  buffer: AudioBuffer,
  start: number,
  duration: number,
): { samples: Float32Array; sampleRate: number } {
  const sr = buffer.sampleRate;
  const offset = Math.max(0, Math.floor(start * sr));
  const len = Math.max(0, Math.min(buffer.length - offset, Math.floor(duration * sr)));
  const out = new Float32Array(len);
  const ch0 = buffer.getChannelData(0);
  if (buffer.numberOfChannels > 1) {
    const ch1 = buffer.getChannelData(1);
    for (let i = 0; i < len; i++) out[i] = (ch0[offset + i] + ch1[offset + i]) * 0.5;
  } else {
    for (let i = 0; i < len; i++) out[i] = ch0[offset + i];
  }
  return { samples: out, sampleRate: sr };
}

/**
 * Full auto-chart pipeline:
 * decode segment -> frame features -> onset detection -> tempo -> chart.
 */
export async function analyzeSegment(input: AnalyzeInput): Promise<Chart> {
  const { buffer, start, duration, difficulty, seed, onStage } = input;

  onStage?.('DECODING AUDIO', 0);
  const { samples, sampleRate } = extractMono(buffer, start, duration);
  onStage?.('DECODING AUDIO', 1);

  onStage?.('ANALYZING ONSETS', 0);
  const features = await analyzeFrames(samples, sampleRate, (p) =>
    onStage?.('ANALYZING ONSETS', p * 0.8),
  );
  const onsets = detectOnsets(features);
  onStage?.('ANALYZING ONSETS', 1);

  onStage?.('DETECTING BEATS', 0);
  const tempo = estimateTempo(features.flux, features.hopSec);
  onStage?.('DETECTING BEATS', 1);

  onStage?.('BUILDING CHART', 0);
  const chart = generateChart(onsets, {
    difficulty,
    seed,
    bpm: tempo.bpm,
    beatPhaseSec: tempo.beatPhaseSec,
    duration,
  });
  onStage?.('BUILDING CHART', 1);

  return chart;
}
