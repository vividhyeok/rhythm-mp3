import type { MusicalEvent, MusicalEventKind, MusicalVoice, Onset } from '../types';

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function classifyKind(o: Onset): MusicalEventKind {
  const attack = o.attack ?? o.strength;
  const sustain = o.sustain ?? 0;
  const flatness = o.flatness ?? 0.25;

  // Low, sharp transients are usually the most convincing kick proxy.
  if (o.low >= 0.50 && o.centroid < 0.42 && attack >= 0.28) return 'KICK';

  // Bright, short, noisy attacks tend to behave like hats/cymbal ticks.
  if (o.high >= 0.50 && o.centroid >= 0.52 && sustain < 0.22) return 'HAT';

  // Broadband mid/high transients are a useful snare/clap proxy.
  if (attack >= 0.34 && o.low < 0.46 && o.mid + o.high >= 0.58 && flatness >= 0.12) {
    return 'SNARE';
  }

  // Sustained low-frequency energy is more useful as a bass/riff gesture than a drum hit.
  if (o.low >= 0.40 && sustain >= 0.16) return 'BASS';

  // Tonal sustained events become melodic holds or phrase anchors.
  if (sustain >= 0.28 && flatness <= 0.48) return 'HARMONIC';

  if (o.strength >= 0.76) return 'ACCENT';

  // Ambiguous events are routed by timbre so they still form a coherent voice.
  if (o.high > o.low && o.centroid > 0.48) return 'HAT';
  if (o.low > o.high && sustain > 0.10) return 'BASS';
  return 'SNARE';
}

function voiceFor(kind: MusicalEventKind): MusicalVoice {
  if (kind === 'KICK' || kind === 'SNARE' || kind === 'HAT' || kind === 'FILL') return 'DRUMS';
  if (kind === 'BASS') return 'BASS';
  if (kind === 'HARMONIC') return 'MELODY';
  return 'ACCENT';
}

function markFills(events: MusicalEvent[], beatSec: number): void {
  if (events.length < 3) return;
  const fastGap = Math.max(0.09, beatSec * 0.42);

  for (let i = 1; i < events.length - 1; i++) {
    const a = events[i - 1];
    const b = events[i];
    const c = events[i + 1];
    const ab = b.time - a.time;
    const bc = c.time - b.time;
    const transient = b.duration < 0.22 && b.attack > 0.35;
    if (transient && ab > 0.04 && bc > 0.04 && ab <= fastGap && bc <= fastGap) {
      b.isFill = true;
      if (b.kind === 'HAT' || b.kind === 'SNARE' || b.kind === 'ACCENT') {
        b.kind = 'FILL';
        b.voice = 'DRUMS';
      }
    }
  }
}

/**
 * Convert low-level onsets into perceptual musical events.
 *
 * This intentionally does not pretend to be source separation. The goal is to
 * produce stable roles that are useful for charting: drum-like attacks, bass
 * gestures, sustained harmonic gestures, accents and short fills.
 */
export function classifyMusicalEvents(
  onsets: Onset[],
  bpm: number,
): { events: MusicalEvent[]; phraseSec: number } {
  const beatSec = 60 / Math.min(240, Math.max(40, bpm));
  const phraseSec = Math.min(4.5, Math.max(1.8, beatSec * 4));

  const events: MusicalEvent[] = onsets.map((o) => {
    const kind = classifyKind(o);
    const sustain = Math.min(1.8, Math.max(0, o.sustain ?? 0));
    return {
      time: o.time,
      strength: clamp01(o.strength),
      duration: sustain,
      kind,
      voice: voiceFor(kind),
      low: clamp01(o.low),
      mid: clamp01(o.mid),
      high: clamp01(o.high),
      centroid: clamp01(o.centroid),
      attack: clamp01(o.attack ?? o.strength),
      flatness: clamp01(o.flatness ?? 0.25),
      isFill: false,
    };
  });

  markFills(events, beatSec);
  return { events, phraseSec };
}
