import { analyzeSegment, type AnalysisStage } from '../analysis/analyzer';
import { generateChart } from '../chart/chartgen';
import { getChartCache, saveChartCache } from '../storage/db';
import { session } from '../state';
import type { Chart, ChartCacheRecord, ChartSource } from '../types';
import { hashString } from '../util/random';
import { el, show } from './screen';
import { mountGame } from './game';
import { mountSegment } from './segment';

const PREVIEW_W = 520;
const PREVIEW_H = 120;
const MAX_SAVED_VARIANTS = 8;

export function mountAnalyzing(root: HTMLElement): () => void {
  const container = el('div', 'screen analyzing');
  container.appendChild(el('div', 'screen-title', 'ANALYZING'));

  const log = el('div', 'analyze-log');
  container.appendChild(log);

  const barWrap = el('div', 'progress-wrap');
  const bar = el('div', 'progress-bar');
  barWrap.appendChild(bar);
  container.appendChild(barWrap);

  const preview = document.createElement('canvas');
  preview.width = PREVIEW_W;
  preview.height = PREVIEW_H;
  preview.style.width = '100%';
  preview.style.maxWidth = `${PREVIEW_W}px`;
  preview.style.border = '2px solid #23291d';
  preview.style.display = 'none';
  container.appendChild(preview);

  const summary = el('div', 'status-line');
  container.appendChild(summary);

  const btnRow = el('div', 'btn-row');
  const backBtn = el('button', 'btn', '< BACK');
  const regenBtn = el('button', 'btn', 'REGENERATE');
  const playBtn = el('button', 'btn primary', 'PLAY CHART >');
  regenBtn.style.display = 'none';
  playBtn.style.display = 'none';
  btnRow.appendChild(backBtn);
  btnRow.appendChild(regenBtn);
  btnRow.appendChild(playBtn);
  container.appendChild(btnRow);

  root.appendChild(container);

  let disposed = false;
  let cache: ChartCacheRecord | null = null;
  backBtn.onclick = () => show(mountSegment);
  playBtn.onclick = () => show(mountGame);

  const stageLines = new Map<AnalysisStage, HTMLElement>();

  function onStage(stage: AnalysisStage, progress?: number): void {
    if (disposed) return;
    let line = stageLines.get(stage);
    if (!line) {
      line = el('div', 'log-line');
      log.appendChild(line);
      stageLines.set(stage, line);
    }
    const p = progress === undefined ? '' : ` ${Math.round(progress * 100)}%`;
    const done = progress === 1;
    line.textContent = `> ${stage}...${done ? ' OK' : p}`;
    if (progress !== undefined) {
      const stages: AnalysisStage[] = ['DECODING AUDIO', 'ANALYZING ONSETS', 'DETECTING BEATS', 'BUILDING CHART'];
      const idx = stages.indexOf(stage);
      const total = (idx + progress) / stages.length;
      bar.style.width = `${Math.round(total * 100)}%`;
    }
  }

  function drawPreview(chart: Chart): void {
    const g = preview.getContext('2d')!;
    g.fillStyle = '#b9c0a8';
    g.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
    g.strokeStyle = 'rgba(35,41,29,0.35)';
    g.lineWidth = 1;
    for (let lane = 1; lane < 4; lane++) {
      const y = 10 + lane * 25;
      g.beginPath();
      g.moveTo(8, y);
      g.lineTo(PREVIEW_W - 8, y);
      g.stroke();
    }
    for (const note of chart.notes) {
      const x = 8 + (note.time / chart.duration) * (PREVIEW_W - 16);
      const y = 12 + note.lane * 25;
      g.fillStyle = '#23291d';
      g.fillRect(Math.round(x), y, 2, 18);
    }
    preview.style.display = '';
  }

  function chartSeed(baseKey: string, variant: number): number {
    return hashString(`${baseKey}|variant:${variant}`);
  }

  function buildVariant(source: ChartSource, baseKey: string, variant: number): Chart {
    return generateChart(source.onsets, {
      difficulty: session.difficulty,
      seed: chartSeed(baseKey, variant),
      bpm: source.bpm,
      beatPhaseSec: source.beatPhaseSec,
      tempoConfidence: source.tempoConfidence,
      duration: session.segmentDuration,
    });
  }

  function findCachedVariant(rec: ChartCacheRecord | null, variant: number): Chart | null {
    return rec?.variants.find((v) => v.variant === variant)?.chart ?? null;
  }

  async function rememberVariant(
    baseKey: string,
    source: ChartSource,
    chart: Chart,
    variant: number,
  ): Promise<void> {
    const song = session.song;
    if (!song) return;

    const existing = cache ?? (await getChartCache(baseKey));
    const variants = (existing?.variants ?? []).filter((v) => v.variant !== variant);
    variants.push({ variant, chart });
    variants.sort((a, b) => a.variant - b.variant);

    // Keep the default chart plus the most recent variants without allowing unbounded growth.
    let kept = variants;
    if (variants.length > MAX_SAVED_VARIANTS) {
      const base = variants.find((v) => v.variant === 0);
      const tail = variants.filter((v) => v.variant !== 0).slice(-(MAX_SAVED_VARIANTS - (base ? 1 : 0)));
      kept = base ? [base, ...tail] : tail;
    }

    cache = {
      key: baseKey,
      songId: song.id,
      startMs: Math.round(session.segmentStart * 1000),
      durationMs: Math.round(session.segmentDuration * 1000),
      difficulty: session.difficulty,
      source,
      variants: kept,
      updatedAt: Date.now(),
    };
    await saveChartCache(cache);
  }

  function showReady(chart: Chart, source: ChartSource, loadedFromCache = false): void {
    session.chart = chart;
    drawPreview(chart);
    bar.style.width = '100%';
    const nps = chart.duration > 0 ? chart.notes.length / chart.duration : 0;
    const conf = Math.round(source.tempoConfidence * 100);
    const cached = loadedFromCache ? '  |  SAVED' : '';
    summary.textContent = `NOTES ${chart.notes.length}  |  ${nps.toFixed(1)} NPS  |  BPM ~${chart.bpm}  |  BEAT CONF ${conf}%  |  VAR ${session.chartVariant + 1}${cached}`;
    if (source.tempoConfidence < 0.25) {
      const warn = el('div', 'log-line', '> LOW BEAT CONFIDENCE: GRID SNAP REDUCED');
      log.appendChild(warn);
    }
    regenBtn.style.display = '';
    playBtn.style.display = '';
  }

  void (async () => {
    const { song, buffer, segmentStart, segmentDuration, difficulty } = session;
    if (!song || !buffer) {
      summary.textContent = 'ERROR: NO SONG LOADED';
      return;
    }

    const baseKey = `${song.id}|${Math.round(segmentStart * 1000)}|${Math.round(segmentDuration * 1000)}|${difficulty}`;

    try {
      if (session.analysisSource && session.analysisKey === baseKey) {
        const chart = buildVariant(session.analysisSource, baseKey, session.chartVariant);
        showReady(chart, session.analysisSource);
      } else {
        cache = await getChartCache(baseKey);
        if (cache) {
          session.chartVariant = 0;
          session.analysisSource = cache.source;
          session.analysisKey = baseKey;
          const chart = findCachedVariant(cache, 0) ?? buildVariant(cache.source, baseKey, 0);
          log.appendChild(el('div', 'log-line', '> LOADED SAVED ANALYSIS - DSP SKIPPED'));
          showReady(chart, cache.source, true);
          if (!findCachedVariant(cache, 0)) void rememberVariant(baseKey, cache.source, chart, 0);
        } else {
          session.chartVariant = 0;
          const result = await analyzeSegment({
            buffer,
            start: segmentStart,
            duration: segmentDuration,
            difficulty,
            seed: chartSeed(baseKey, 0),
            onStage,
          });
          if (disposed) return;
          session.analysisSource = result.source;
          session.analysisKey = baseKey;
          showReady(result.chart, result.source);
          void rememberVariant(baseKey, result.source, result.chart, 0);
        }
      }
    } catch (err) {
      if (disposed) return;
      summary.textContent = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }

    regenBtn.onclick = () => {
      if (!session.analysisSource || session.analysisKey !== baseKey) return;
      session.chartVariant++;
      const saved = findCachedVariant(cache, session.chartVariant);
      const chart = saved ?? buildVariant(session.analysisSource, baseKey, session.chartVariant);
      showReady(chart, session.analysisSource, Boolean(saved));
      if (!saved) void rememberVariant(baseKey, session.analysisSource, chart, session.chartVariant);
    };
  })();

  return () => {
    disposed = true;
  };
}
