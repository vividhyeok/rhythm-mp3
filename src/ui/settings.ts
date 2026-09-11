import { audioEngine } from '../audio/engine';
import { loadSettings, saveSettings, type Settings } from '../storage/settings';
import { el } from './screen';

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Modal dialog for calibration & speed settings. Appended to document.body. */
export function openSettingsModal(): void {
  const settings = loadSettings();

  const overlay = el('div', 'modal-overlay');
  const panel = el('div', 'modal panel');
  panel.appendChild(el('h2', 'panel-title', 'SETTINGS'));

  const makeRow = (label: string, input: HTMLElement, hint: string) => {
    const row = el('div', 'form-row');
    row.appendChild(el('label', 'form-label', label));
    row.appendChild(input);
    row.appendChild(el('span', 'form-hint', hint));
    return row;
  };

  const inputOffset = document.createElement('input');
  inputOffset.type = 'number';
  inputOffset.min = '-200';
  inputOffset.max = '200';
  inputOffset.step = '5';
  inputOffset.value = String(settings.inputOffsetMs);

  const visualOffset = document.createElement('input');
  visualOffset.type = 'number';
  visualOffset.min = '-200';
  visualOffset.max = '200';
  visualOffset.step = '5';
  visualOffset.value = String(settings.visualOffsetMs);

  const speed = document.createElement('select');
  const speeds: Array<[string, number]> = [
    ['SLOW', 1.8],
    ['NORMAL', 1.4],
    ['FAST', 1.1],
  ];
  for (const [label, v] of speeds) {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = label;
    if (Math.abs(v - settings.approachSec) < 0.01) o.selected = true;
    speed.appendChild(o);
  }

  panel.appendChild(makeRow('INPUT OFFSET (MS)', inputOffset, '+ IF YOU HIT EARLY'));
  panel.appendChild(makeRow('VISUAL OFFSET (MS)', visualOffset, '+ IF NOTES FEEL LATE'));
  panel.appendChild(makeRow('NOTE SPEED', speed, 'FALL SPEED'));

  const calibrationStatus = el('div', 'status-line', 'AUTO CALIBRATION: 2 COUNT-IN CLICKS + 8 TAPS');
  panel.appendChild(calibrationStatus);
  const calibrateBtn = el('button', 'btn', 'AUTO CALIBRATE [SPACE]');
  panel.appendChild(calibrateBtn);

  let calibrating = false;
  let calibrationStart = 0;
  let calibrationCtx: AudioContext | null = null;
  let lastBeatIndex = -1;
  let errors: number[] = [];
  const interval = 0.5;

  const onCalibrationKey = (e: KeyboardEvent) => {
    if (!calibrating || e.repeat || e.code !== 'Space' || !calibrationCtx) return;
    e.preventDefault();
    const now = calibrationCtx.currentTime;
    const beatIndex = Math.round((now - calibrationStart) / interval);
    if (beatIndex < 2 || beatIndex > 9 || beatIndex === lastBeatIndex) return;
    const beatTime = calibrationStart + beatIndex * interval;
    const errMs = (now - beatTime) * 1000;
    if (Math.abs(errMs) > 220) return;
    lastBeatIndex = beatIndex;
    errors.push(errMs);
    calibrationStatus.textContent = `CALIBRATION: ${errors.length}/8 TAPS`;

    if (errors.length >= 8) {
      calibrating = false;
      window.removeEventListener('keydown', onCalibrationKey);
      const med = median(errors);
      const recommended = Math.max(-200, Math.min(200, Math.round((-med) / 5) * 5));
      inputOffset.value = String(recommended);
      calibrationStatus.textContent = `DONE: MEDIAN ${med >= 0 ? '+' : ''}${Math.round(med)}MS -> INPUT OFFSET ${recommended >= 0 ? '+' : ''}${recommended}MS`;
      calibrateBtn.textContent = 'CALIBRATE AGAIN';
    }
  };

  calibrateBtn.onclick = async () => {
    if (calibrating) return;
    const ctx = audioEngine.ctx;
    await ctx.resume();
    calibrationCtx = ctx;
    calibrationStart = ctx.currentTime + 0.7;
    lastBeatIndex = -1;
    errors = [];
    calibrating = true;
    calibrateBtn.textContent = 'LISTEN...';
    calibrationStatus.textContent = 'WAIT 2 CLICKS, THEN TAP SPACE ON EACH CLICK';
    window.addEventListener('keydown', onCalibrationKey);

    for (let i = 0; i < 10; i++) {
      const at = calibrationStart + i * interval;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = i < 2 ? 700 : 1050;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.05);
    }
  };

  const close = () => {
    calibrating = false;
    window.removeEventListener('keydown', onCalibrationKey);
    overlay.remove();
  };

  const btnRow = el('div', 'btn-row');
  const saveBtn = el('button', 'btn primary', 'SAVE & CLOSE');
  saveBtn.onclick = () => {
    const next: Settings = {
      inputOffsetMs: Number(inputOffset.value) || 0,
      visualOffsetMs: Number(visualOffset.value) || 0,
      approachSec: Number(speed.value) || 1.4,
    };
    saveSettings(next);
    close();
  };
  btnRow.appendChild(saveBtn);
  panel.appendChild(btnRow);

  overlay.appendChild(panel);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.body.appendChild(overlay);
}
