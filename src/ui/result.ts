import { session } from '../state';
import { el, show } from './screen';
import { mountGame } from './game';
import { mountHome } from './home';

export function mountResult(root: HTMLElement): () => void {
  const r = session.result;
  const container = el('div', 'screen result');

  if (!r || !session.song) {
    show(mountHome);
    return () => {};
  }

  container.appendChild(el('div', 'screen-title', 'RESULT'));
  container.appendChild(el('div', 'song-title', session.song.name));

  const gradeRow = el('div', 'grade-row');
  gradeRow.appendChild(el('div', 'grade-box', r.grade));
  const scoreCol = el('div', 'score-col');
  scoreCol.appendChild(el('div', 'result-score', String(r.score).padStart(7, '0')));
  if (session.isNewBest) {
    scoreCol.appendChild(el('div', 'new-best blink', '* NEW BEST *'));
  } else if (session.bestScore !== null) {
    scoreCol.appendChild(el('div', 'best-line', `BEST ${String(session.bestScore).padStart(7, '0')}`));
  }
  gradeRow.appendChild(scoreCol);
  container.appendChild(gradeRow);

  const stats = el('div', 'stats-grid');
  const rows: Array<[string, string]> = [
    ['ACCURACY', `${r.accuracy.toFixed(2)}%`],
    ['MAX COMBO', String(r.maxCombo)],
    ['PERFECT', String(r.perfect)],
    ['GREAT', String(r.great)],
    ['GOOD', String(r.good)],
    ['MISS', String(r.miss)],
  ];
  for (const [k, v] of rows) {
    stats.appendChild(el('span', 'stat-key', k));
    stats.appendChild(el('span', 'stat-val', v));
  }
  container.appendChild(stats);

  const diffLine = el(
    'div',
    'status-line',
    `${session.difficulty} / START ${session.segmentStart.toFixed(1)}s / ${r.totalNotes} NOTES`,
  );
  container.appendChild(diffLine);

  const btnRow = el('div', 'btn-row');
  const retryBtn = el('button', 'btn primary', 'RETRY [R]');
  const homeBtn = el('button', 'btn', 'SONG SELECT [ESC]');
  btnRow.appendChild(retryBtn);
  btnRow.appendChild(homeBtn);
  container.appendChild(btnRow);

  root.appendChild(container);

  retryBtn.onclick = () => show(mountGame);
  homeBtn.onclick = () => show(mountHome);

  const onKey = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.code === 'KeyR') {
      e.preventDefault();
      show(mountGame);
    } else if (e.code === 'Escape' || e.code === 'Enter') {
      e.preventDefault();
      show(mountHome);
    }
  };
  window.addEventListener('keydown', onKey);

  return () => {
    window.removeEventListener('keydown', onKey);
  };
}
