import { audioEngine } from '../audio/engine';
import {
  addCount,
  computeAccuracy,
  computeGrade,
  computeScore,
  emptyCounts,
  judgeError,
  WINDOW_GOOD,
  type Judgement,
} from '../game/judgement';
import { saveScore, scoreKey, getScore } from '../storage/db';
import { loadSettings } from '../storage/settings';
import { session } from '../state';
import { formatTime } from '../util/segment';
import { el, show } from './screen';
import { mountResult } from './result';
import { mountHome } from './home';

const W = 520;
const H = 720;
const JUDGE_Y = H - 150;
const LANE_TOP = 108;
const COUNT_IN = 1.8;
const FADE_SEC = 2.0;
const END_LINGER = 1.2;
const HOLD_RELEASE_GRACE = 0.12;

const LANE_KEYS = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
const LANE_LABELS = ['D', 'F', 'J', 'K'];

const INK = '#23291d';
const INK_DIM = 'rgba(35,41,29,0.45)';
const INK_FAINT = 'rgba(35,41,29,0.18)';
const LCD = '#b9c0a8';

interface RNote {
  time: number;
  lane: number;
  duration: number;
  judged: boolean;
  holding: boolean;
  judgement: Judgement | null;
  headJudgement: Judgement | null;
  hitAt: number;
}

export function mountGame(root: HTMLElement): () => void {
  const chartOpt = session.chart;
  const bufferOpt = session.buffer;
  const songOpt = session.song;
  const settings = loadSettings();

  const container = el('div', 'screen game');

  if (!chartOpt || !bufferOpt || !songOpt) {
    show(mountHome);
    return () => {};
  }
  const chart = chartOpt;
  const buffer = bufferOpt;
  const song = songOpt;

  const hudRow = el('div', 'game-hud-row');
  const pauseBtn = el('button', 'btn tiny', 'PAUSE [ESC]');
  const retryBtn = el('button', 'btn tiny', 'RETRY [R]');
  const quitBtn = el('button', 'btn tiny', 'QUIT');
  hudRow.appendChild(pauseBtn);
  hudRow.appendChild(retryBtn);
  hudRow.appendChild(quitBtn);
  container.appendChild(hudRow);

  const canvasWrap = el('div', 'canvas-wrap');
  const canvas = document.createElement('canvas');
  canvas.className = 'game-canvas';
  canvasWrap.appendChild(canvas);
  container.appendChild(canvasWrap);

  const pauseOverlay = el('div', 'pause-overlay');
  pauseOverlay.style.display = 'none';
  const pausePanel = el('div', 'panel');
  pausePanel.appendChild(el('h2', 'panel-title', 'PAUSED'));
  const resumeBtn = el('button', 'btn primary', 'RESUME');
  const pauseRetryBtn = el('button', 'btn', 'RETRY');
  const pauseQuitBtn = el('button', 'btn', 'QUIT');
  pausePanel.appendChild(resumeBtn);
  pausePanel.appendChild(pauseRetryBtn);
  pausePanel.appendChild(pauseQuitBtn);
  pauseOverlay.appendChild(pausePanel);
  canvasWrap.appendChild(pauseOverlay);

  root.appendChild(container);

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);

  const notes: RNote[] = chart.notes.map((n) => ({
    time: n.time,
    lane: n.lane,
    duration: Math.max(0, n.duration ?? 0),
    judged: false,
    holding: false,
    judgement: null,
    headJudgement: null,
    hitAt: -Infinity,
  }));
  const laneNotes: RNote[][] = [[], [], [], []];
  for (const n of notes) laneNotes[n.lane].push(n);
  const totalNotes = notes.length;
  const duration = chart.duration;

  const counts = emptyCounts();
  let combo = 0;
  let maxCombo = 0;
  let lastJudge: { j: Judgement; at: number } | null = null;
  let milestone: { text: string; at: number } | null = null;
  let shakeUntil = 0;
  const laneFlashUntil = [0, 0, 0, 0];
  const lanePressed = [false, false, false, false];

  const ctx = audioEngine.ctx;
  const gain = ctx.createGain();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(gain);
  gain.connect(ctx.destination);

  const startAt = ctx.currentTime + 0.08 + COUNT_IN;
  const fadeStart = Math.max(startAt, startAt + duration - FADE_SEC);
  gain.gain.setValueAtTime(1, ctx.currentTime);
  gain.gain.setValueAtTime(1, fadeStart);
  gain.gain.linearRampToValueAtTime(0.0001, startAt + duration);
  src.start(startAt, session.segmentStart, duration + 0.05);

  const songTime = () => ctx.currentTime - startAt;

  let paused = false;
  let finished = false;
  let cleanedUp = false;
  let raf = 0;

  function applyJudgement(note: RNote, j: Judgement, t: number): void {
    if (note.judged) return;
    note.judged = true;
    note.holding = false;
    note.judgement = j;
    note.hitAt = t;
    addCount(counts, j);
    if (j === 'MISS') {
      combo = 0;
    } else {
      combo++;
      if (combo > maxCombo) maxCombo = combo;
      if (combo === 50 || combo === 100 || combo === 200 || combo === 300 || combo === 500) {
        milestone = { text: `${combo} COMBO!`, at: performance.now() };
        shakeUntil = performance.now() + 180;
      }
    }
    lastJudge = { j, at: performance.now() };
  }

  function startHold(note: RNote, j: Judgement, t: number): void {
    note.holding = true;
    note.headJudgement = j;
    note.hitAt = t;
    lastJudge = { j, at: performance.now() };
  }

  function finishHold(note: RNote, t: number): void {
    applyJudgement(note, note.headJudgement ?? 'GOOD', t);
  }

  function pressLane(lane: number): void {
    const now = performance.now();
    laneFlashUntil[lane] = now + 130;
    const t = songTime() + settings.inputOffsetMs / 1000;
    let best: RNote | null = null;
    let bestErr = Infinity;
    for (const n of laneNotes[lane]) {
      if (n.judged || n.holding) continue;
      const err = Math.abs(t - n.time);
      if (err < bestErr) {
        bestErr = err;
        best = n;
      }
      if (n.time - t > WINDOW_GOOD) break;
    }
    if (best && bestErr <= WINDOW_GOOD) {
      const j = judgeError(bestErr);
      if (!j) return;
      if (best.duration > 0) startHold(best, j, t);
      else applyJudgement(best, j, t);
    }
  }

  function releaseLane(lane: number): void {
    lanePressed[lane] = false;
    if (paused || finished) return;
    const t = songTime() + settings.inputOffsetMs / 1000;
    const active = laneNotes[lane].find((n) => n.holding && !n.judged);
    if (!active) return;
    const end = active.time + active.duration;
    if (t < end - HOLD_RELEASE_GRACE) {
      applyJudgement(active, 'MISS', t);
    } else {
      finishHold(active, t);
    }
  }

  function setPaused(p: boolean): void {
    if (finished || cleanedUp) return;
    if (p === paused) return;
    paused = p;
    if (p) {
      pauseOverlay.style.display = 'flex';
      void ctx.suspend();
    } else {
      pauseOverlay.style.display = 'none';
      void ctx.resume();
    }
  }

  function retry(): void {
    teardown();
    show(mountGame);
  }

  function quit(): void {
    teardown();
    show(mountHome);
  }

  pauseBtn.onclick = () => setPaused(true);
  retryBtn.onclick = retry;
  quitBtn.onclick = quit;
  resumeBtn.onclick = () => setPaused(false);
  pauseRetryBtn.onclick = retry;
  pauseQuitBtn.onclick = quit;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      setPaused(!paused);
      return;
    }
    if (e.code === 'KeyR') {
      e.preventDefault();
      retry();
      return;
    }
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (paused || finished) return;
    const lane = LANE_KEYS.indexOf(e.code);
    if (lane >= 0) {
      e.preventDefault();
      lanePressed[lane] = true;
      pressLane(lane);
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    const lane = LANE_KEYS.indexOf(e.code);
    if (lane >= 0) releaseLane(lane);
  };

  const onVisibility = () => {
    if (document.hidden) setPaused(true);
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('visibilitychange', onVisibility);

  async function finish(): Promise<void> {
    if (finished) return;
    finished = true;
    const accuracy = computeAccuracy(counts);
    const score = computeScore(counts, totalNotes);
    const grade = computeGrade(accuracy);
    session.result = {
      score,
      accuracy,
      maxCombo,
      perfect: counts.perfect,
      great: counts.great,
      good: counts.good,
      miss: counts.miss,
      grade,
      totalNotes,
    };
    const startMs = Math.round(session.segmentStart * 1000);
    const key = scoreKey(song.id, startMs, session.difficulty);
    const prev = await getScore(key);
    session.bestScore = prev ? prev.score : null;
    session.isNewBest = await saveScore({
      key,
      songId: song.id,
      startMs,
      difficulty: session.difficulty,
      score,
      accuracy,
      maxCombo,
      perfect: counts.perfect,
      great: counts.great,
      good: counts.good,
      miss: counts.miss,
      grade,
      playedAt: Date.now(),
    });
    if (!cleanedUp) {
      teardown();
      show(mountResult);
    }
  }

  const laneW = (W - 40) / 4;
  const laneX = (i: number) => 20 + i * laneW;
  const pxPerSec = () => (JUDGE_Y - LANE_TOP) / settings.approachSec;

  function drawText(
    text: string,
    x: number,
    y: number,
    size: number,
    align: CanvasTextAlign = 'left',
    color: string = INK,
    bold = true,
  ): void {
    g.fillStyle = color;
    g.font = `${bold ? 'bold ' : ''}${size}px "Courier New", monospace`;
    g.textAlign = align;
    g.textBaseline = 'alphabetic';
    g.fillText(text, x, y);
  }

  function drawTapHead(x: number, y: number, w: number): void {
    g.fillStyle = INK;
    g.fillRect(x, y - 11, w, 22);
    g.fillStyle = LCD;
    g.fillRect(x + 3, y - 2, w - 6, 4);
  }

  function render(t: number): void {
    const nowMs = performance.now();
    const tVis = t + settings.visualOffsetMs / 1000;

    g.clearRect(0, 0, W, H);
    g.save();
    if (nowMs < shakeUntil) {
      g.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
    }

    g.fillStyle = LCD;
    g.fillRect(0, 0, W, H);

    drawText(song.name.toUpperCase().slice(0, 26), 16, 26, 14);
    drawText(session.difficulty, W - 16, 26, 14, 'right');
    const score = computeScore(counts, totalNotes);
    drawText(`SCORE ${String(score).padStart(7, '0')}`, 16, 50, 18);
    drawText(`ACC ${computeAccuracy(counts).toFixed(1)}%`, W - 16, 50, 18, 'right');

    const prog = Math.min(1, Math.max(0, t / duration));
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.strokeRect(16, 62, W - 32, 12);
    g.fillStyle = INK;
    g.fillRect(18, 64, (W - 36) * prog, 8);
    const remain = Math.max(0, duration - t);
    drawText(`-${formatTime(remain)}`, W - 16, 92, 13, 'right', INK_DIM);
    drawText(`BPM ~${chart.bpm}`, 16, 92, 13, 'left', INK_DIM);

    if (combo >= 2) {
      drawText(`${combo}`, W / 2, 150, 34, 'center');
      drawText('COMBO', W / 2, 168, 12, 'center', INK_DIM);
    }

    for (let i = 0; i < 4; i++) {
      const x = laneX(i);
      if (nowMs < laneFlashUntil[i]) {
        g.fillStyle = INK_FAINT;
        g.fillRect(x, LANE_TOP, laneW, JUDGE_Y - LANE_TOP);
      }
      g.strokeStyle = INK_DIM;
      g.lineWidth = 1;
      g.strokeRect(x, LANE_TOP, laneW, JUDGE_Y - LANE_TOP);
    }

    const pps = pxPerSec();
    const noteH = 22;
    for (const n of notes) {
      const headY = JUDGE_Y - (n.time - tVis) * pps;
      const tailY = JUDGE_Y - (n.time + n.duration - tVis) * pps;
      const x = laneX(n.lane) + 5;
      const w = laneW - 10;

      if (n.judged) {
        if (n.judgement === 'MISS') {
          const age = t - n.hitAt;
          if (age < 0.4) {
            g.strokeStyle = INK_FAINT;
            g.lineWidth = 2;
            g.strokeRect(x, Math.min(JUDGE_Y, headY) - noteH / 2, w, noteH);
          }
        }
        continue;
      }

      if (n.duration > 0) {
        if (headY < LANE_TOP - noteH && tailY < LANE_TOP - noteH) continue;
        if (tailY > H + 40) continue;
        const bodyTop = Math.max(LANE_TOP, Math.min(tailY, n.holding ? JUDGE_Y : headY));
        const bodyBottom = Math.min(JUDGE_Y, Math.max(tailY, n.holding ? JUDGE_Y : headY));
        g.fillStyle = n.holding ? INK : INK_DIM;
        g.fillRect(x + w * 0.32, bodyTop, w * 0.36, Math.max(4, bodyBottom - bodyTop));
        g.strokeStyle = INK;
        g.lineWidth = 2;
        g.strokeRect(x + w * 0.32, bodyTop, w * 0.36, Math.max(4, bodyBottom - bodyTop));
        if (n.holding) {
          g.fillStyle = INK;
          g.fillRect(x, JUDGE_Y - 9, w, 18);
        } else if (headY >= LANE_TOP - noteH && headY <= H + 40) {
          drawTapHead(x, headY, w);
        }
      } else {
        if (headY < LANE_TOP - noteH) continue;
        if (headY > H + 40) continue;
        drawTapHead(x, headY, w);
      }
    }

    for (const n of notes) {
      if (!n.judged || n.judgement === 'MISS') continue;
      const age = t - n.hitAt;
      if (age < 0 || age > 0.18) continue;
      const x = laneX(n.lane) + laneW / 2;
      const r = 10 + age * 220;
      g.strokeStyle = INK;
      g.lineWidth = Math.max(1, 3 - age * 12);
      g.strokeRect(x - r, JUDGE_Y - r, r * 2, r * 2);
    }

    g.fillStyle = INK;
    g.fillRect(16, JUDGE_Y - 3, W - 32, 6);
    for (let i = 0; i < 4; i++) {
      const cx = laneX(i) + laneW / 2;
      const pressed = lanePressed[i] || nowMs < laneFlashUntil[i];
      if (pressed) {
        g.fillStyle = INK;
        g.fillRect(laneX(i) + 4, JUDGE_Y + 12, laneW - 8, 34);
        drawText(LANE_LABELS[i], cx, JUDGE_Y + 36, 20, 'center', LCD);
      } else {
        g.strokeStyle = INK;
        g.lineWidth = 2;
        g.strokeRect(laneX(i) + 4, JUDGE_Y + 12, laneW - 8, 34);
        drawText(LANE_LABELS[i], cx, JUDGE_Y + 36, 20, 'center', INK);
      }
    }

    if (lastJudge && nowMs - lastJudge.at < 450) {
      const age = (nowMs - lastJudge.at) / 450;
      const alpha = 1 - age * age;
      const j = lastJudge.j;
      g.save();
      g.globalAlpha = alpha;
      if (j === 'PERFECT') {
        g.fillStyle = INK;
        g.fillRect(W / 2 - 110, H / 2 - 32, 220, 44);
        drawText('PERFECT', W / 2, H / 2, 28, 'center', LCD);
      } else if (j === 'GREAT') {
        g.strokeStyle = INK;
        g.lineWidth = 3;
        g.strokeRect(W / 2 - 100, H / 2 - 30, 200, 40);
        drawText('GREAT', W / 2, H / 2, 26, 'center', INK);
      } else if (j === 'GOOD') {
        drawText('GOOD', W / 2, H / 2, 22, 'center', INK_DIM);
      } else if (Math.floor(nowMs / 120) % 2 === 0) {
        drawText('MISS', W / 2, H / 2, 26, 'center', INK);
      }
      g.restore();
    }

    if (milestone && nowMs - milestone.at < 900) {
      const age = (nowMs - milestone.at) / 900;
      g.save();
      g.globalAlpha = 1 - age;
      drawText(milestone.text, W / 2, H / 2 - 60 - age * 20, 22, 'center', INK);
      g.restore();
    }

    if (t < 0) {
      const phase = -t;
      const num = Math.ceil(phase / (COUNT_IN / 3));
      g.fillStyle = 'rgba(185,192,168,0.75)';
      g.fillRect(0, 0, W, H);
      drawText(String(Math.min(3, Math.max(1, num))), W / 2, H / 2, 72, 'center', INK);
      drawText('GET READY', W / 2, H / 2 + 40, 16, 'center', INK_DIM);
    } else if (t < 0.45) {
      drawText('START!', W / 2, H / 2, 40, 'center', INK);
    }

    if (t > duration - 5 && t < duration && Math.floor(nowMs / 400) % 2 === 0) {
      drawText('ENDING...', W / 2, 108, 16, 'center', INK);
    }
    if (t > duration - FADE_SEC) {
      const a = Math.min(0.6, Math.max(0, (t - (duration - FADE_SEC)) / FADE_SEC) * 0.6);
      g.fillStyle = `rgba(35,41,29,${a * 0.35})`;
      g.fillRect(0, 0, W, H);
    }

    drawText('[ESC] PAUSE   [R] RETRY', W / 2, H - 14, 11, 'center', INK_DIM);
    g.restore();
  }

  function loop(): void {
    if (cleanedUp) return;
    const t = songTime();
    if (!paused && !finished) {
      const adjustedT = t + settings.inputOffsetMs / 1000;
      for (const laneArr of laneNotes) {
        for (const n of laneArr) {
          if (n.judged) continue;
          if (n.holding) {
            const end = n.time + n.duration;
            if (adjustedT >= end) finishHold(n, adjustedT);
            continue;
          }
          if (n.time < adjustedT - WINDOW_GOOD) {
            applyJudgement(n, 'MISS', adjustedT);
          } else {
            break;
          }
        }
      }
      render(t);
      if (t >= duration + END_LINGER) {
        void finish();
        return;
      }
    }
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  function teardown(): void {
    if (cleanedUp) return;
    cleanedUp = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    document.removeEventListener('visibilitychange', onVisibility);
    try {
      src.stop();
    } catch {
      // already stopped
    }
    try {
      src.disconnect();
      gain.disconnect();
    } catch {
      // ignore
    }
    if (ctx.state === 'suspended') void ctx.resume();
  }

  return teardown;
}
