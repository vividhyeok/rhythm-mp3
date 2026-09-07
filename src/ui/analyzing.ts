import { analyzeSegment, type AnalysisStage } from '../analysis/analyzer';
import { session } from '../state';
import { hashString } from '../util/random';
import { el, show } from './screen';
import { mountGame } from './game';
import { mountSegment } from './segment';

export function mountAnalyzing(root: HTMLElement): () => void {
  const container = el('div', 'screen analyzing');
  container.appendChild(el('div', 'screen-title', 'ANALYZING'));

  const log = el('div', 'analyze-log');
  container.appendChild(log);

  const barWrap = el('div', 'progress-wrap');
  const bar = el('div', 'progress-bar');
  barWrap.appendChild(bar);
  container.appendChild(barWrap);

  const errBox = el('div', 'status-line');
  container.appendChild(errBox);

  const backBtn = el('button', 'btn', '< BACK');
  backBtn.style.display = 'none';
  container.appendChild(backBtn);

  root.appendChild(container);

  let disposed = false;
  backBtn.onclick = () => show(mountSegment);

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

  void (async () => {
    const { song, buffer, segmentStart, segmentDuration, difficulty } = session;
    if (!song || !buffer) {
      errBox.textContent = 'ERROR: NO SONG LOADED';
      backBtn.style.display = '';
      return;
    }
    try {
      const seed = hashString(`${song.id}|${Math.round(segmentStart * 1000)}|${difficulty}`);
      const chart = await analyzeSegment({
        buffer,
        start: segmentStart,
        duration: segmentDuration,
        difficulty,
        seed,
        onStage,
      });
      if (disposed) return;
      session.chart = chart;
      const done = el('div', 'log-line', `> CHART READY: ${chart.notes.length} NOTES @ ~${chart.bpm} BPM`);
      log.appendChild(done);
      bar.style.width = '100%';
      setTimeout(() => {
        if (!disposed) show(mountGame);
      }, 600);
    } catch (err) {
      if (disposed) return;
      errBox.textContent = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
      backBtn.style.display = '';
    }
  })();

  return () => {
    disposed = true;
  };
}
