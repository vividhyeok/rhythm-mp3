import { audioEngine } from '../audio/engine';
import { getSongBlob } from '../storage/db';
import { session } from '../state';
import { computeSegment, formatTime, SEGMENT_SECONDS } from '../util/segment';
import type { Difficulty } from '../types';
import { el, show } from './screen';
import { mountAnalyzing } from './analyzing';
import { mountHome } from './home';

const WAVE_W = 880;
const WAVE_H = 150;

export function mountSegment(root: HTMLElement): () => void {
  const song = session.song;
  const container = el('div', 'screen segment');

  if (!song) {
    show(mountHome);
    return () => {};
  }

  const header = el('div', 'screen-header');
  const backBtn = el('button', 'btn tiny', '< BACK');
  header.appendChild(backBtn);
  header.appendChild(el('span', 'screen-title', 'SEGMENT SELECT'));
  container.appendChild(header);

  container.appendChild(el('div', 'song-title', song.name));

  const status = el('div', 'status-line', 'LOADING...');
  container.appendChild(status);

  const waveCanvas = document.createElement('canvas');
  waveCanvas.className = 'waveform';
  waveCanvas.width = WAVE_W;
  waveCanvas.height = WAVE_H;
  container.appendChild(waveCanvas);

  const timeLine = el('div', 'time-line', '--:--.- / --:--.-');
  container.appendChild(timeLine);

  const selLine = el('div', 'sel-line', 'START --:--.-  LEN --.-s  END --:--.-');
  container.appendChild(selLine);

  const ctrlRow = el('div', 'btn-row');
  const playBtn = el('button', 'btn', 'PLAY');
  const markBtn = el('button', 'btn primary', '[M] START HERE');
  ctrlRow.appendChild(playBtn);
  ctrlRow.appendChild(markBtn);
  container.appendChild(ctrlRow);

  const diffRow = el('div', 'btn-row diff-row');
  diffRow.appendChild(el('span', 'form-label', 'DIFFICULTY:'));
  const diffBtns: HTMLButtonElement[] = [];
  for (const d of ['EASY', 'NORMAL', 'HARD'] as Difficulty[]) {
    const b = el('button', 'btn tiny', d);
    if (d === session.difficulty) b.classList.add('active');
    b.onclick = () => {
      session.difficulty = d;
      for (const x of diffBtns) x.classList.toggle('active', x.textContent === d);
    };
    diffBtns.push(b);
    diffRow.appendChild(b);
  }
  container.appendChild(diffRow);

  const goBtn = el('button', 'btn primary big', 'ANALYZE & PLAY >');
  container.appendChild(goBtn);

  container.appendChild(
    el('div', 'footer-hint', '[SPACE] PLAY/PAUSE   [M] MARK START   [<-/->] SEEK 5s   CLICK WAVE = SEEK'),
  );

  root.appendChild(container);

  // ---- state ----
  let disposed = false;
  let buffer: AudioBuffer | null = null;
  let peaks: Float32Array | null = null;
  let startMark = 0;
  let raf = 0;
  let objectUrl: string | null = null;
  const audio = new Audio();
  audio.preload = 'auto';

  const g = waveCanvas.getContext('2d')!;

  function segDuration(): number {
    if (!buffer) return SEGMENT_SECONDS;
    return computeSegment(buffer.duration, startMark).duration;
  }

  function markStart(t: number): void {
    if (!buffer) return;
    startMark = computeSegment(buffer.duration, t).start;
    updateSelLine();
    drawWave();
  }

  function updateSelLine(): void {
    const d = segDuration();
    selLine.textContent = `START ${formatTime(startMark)}  LEN ${d.toFixed(1)}s  END ${formatTime(startMark + d)}`;
  }

  function computePeaks(buf: AudioBuffer, buckets: number): Float32Array {
    const ch = buf.getChannelData(0);
    const out = new Float32Array(buckets);
    const per = Math.max(1, Math.floor(ch.length / buckets));
    for (let b = 0; b < buckets; b++) {
      const off = b * per;
      let max = 0;
      for (let i = 0; i < per; i += 16) {
        const v = Math.abs(ch[off + i]);
        if (v > max) max = v;
      }
      out[b] = max;
    }
    return out;
  }

  function drawWave(): void {
    if (!buffer || !peaks) return;
    const dur = buffer.duration;
    g.fillStyle = '#b9c0a8';
    g.fillRect(0, 0, WAVE_W, WAVE_H);

    // waveform
    g.fillStyle = 'rgba(35,41,29,0.75)';
    const midY = WAVE_H / 2;
    for (let x = 0; x < WAVE_W; x++) {
      const p = peaks[Math.floor((x / WAVE_W) * peaks.length)] ?? 0;
      const h = Math.max(1, p * (WAVE_H - 8));
      g.fillRect(x, midY - h / 2, 1, h);
    }

    // selected region
    const d = segDuration();
    const x0 = (startMark / dur) * WAVE_W;
    const x1 = ((startMark + d) / dur) * WAVE_W;
    g.fillStyle = 'rgba(35,41,29,0.28)';
    g.fillRect(x0, 0, x1 - x0, WAVE_H);
    g.fillStyle = '#23291d';
    g.fillRect(x0, 0, 2, WAVE_H);
    g.fillRect(x1 - 2, 0, 2, WAVE_H);
    // start flag
    g.fillRect(x0, 0, 10, 10);
    g.font = 'bold 10px "Courier New", monospace';
    g.fillText('S', x0 + 2, 9);

    // playhead
    const px = (audio.currentTime / dur) * WAVE_W;
    g.fillStyle = '#23291d';
    g.fillRect(px - 1, 0, 2, WAVE_H);
  }

  function tick(): void {
    if (disposed) return;
    if (buffer) {
      timeLine.textContent = `${formatTime(audio.currentTime)} / ${formatTime(buffer.duration)}`;
      drawWave();
    }
    raf = requestAnimationFrame(tick);
  }

  function togglePlay(): void {
    if (!buffer) return;
    if (audio.paused) {
      void audio.play();
      playBtn.textContent = 'PAUSE';
    } else {
      audio.pause();
      playBtn.textContent = 'PLAY';
    }
  }

  function seekBy(dt: number): void {
    if (!buffer) return;
    audio.currentTime = Math.min(buffer.duration, Math.max(0, audio.currentTime + dt));
  }

  // ---- events ----
  backBtn.onclick = () => show(mountHome);
  playBtn.onclick = togglePlay;
  markBtn.onclick = () => markStart(audio.currentTime);
  goBtn.onclick = () => {
    if (!buffer) return;
    session.buffer = buffer;
    session.segmentStart = startMark;
    session.segmentDuration = segDuration();
    show(mountAnalyzing);
  };

  let seeking = false;
  const seekFromEvent = (e: PointerEvent) => {
    if (!buffer) return;
    const rect = waveCanvas.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * buffer.duration;
  };
  waveCanvas.addEventListener('pointerdown', (e) => {
    seeking = true;
    waveCanvas.setPointerCapture(e.pointerId);
    seekFromEvent(e);
  });
  waveCanvas.addEventListener('pointermove', (e) => {
    if (seeking) seekFromEvent(e);
  });
  waveCanvas.addEventListener('pointerup', () => {
    seeking = false;
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.repeat) return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        togglePlay();
        break;
      case 'KeyM':
        e.preventDefault();
        markStart(audio.currentTime);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        seekBy(-5);
        break;
      case 'ArrowRight':
        e.preventDefault();
        seekBy(5);
        break;
    }
  };
  window.addEventListener('keydown', onKey);

  audio.addEventListener('ended', () => {
    playBtn.textContent = 'PLAY';
  });

  // ---- load song ----
  void (async () => {
    try {
      const blob = await getSongBlob(song.id);
      if (disposed || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      audio.src = objectUrl;
      buffer = await audioEngine.decodeBlob(blob);
      if (disposed) return;
      session.buffer = buffer;
      peaks = computePeaks(buffer, WAVE_W * 2);
      startMark = computeSegment(buffer.duration, 0).start;
      status.textContent = 'READY - PRESS PLAY, FIND YOUR SPOT, HIT [M]';
      updateSelLine();
      tick();
    } catch {
      if (!disposed) status.textContent = 'ERROR: FAILED TO LOAD AUDIO';
    }
  })();

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    audio.pause();
    audio.src = '';
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
}
