import { loadSettings, saveSettings, type Settings } from '../storage/settings';
import { el } from './screen';

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

  const btnRow = el('div', 'btn-row');
  const saveBtn = el('button', 'btn primary', 'SAVE & CLOSE');
  saveBtn.onclick = () => {
    const next: Settings = {
      inputOffsetMs: Number(inputOffset.value) || 0,
      visualOffsetMs: Number(visualOffset.value) || 0,
      approachSec: Number(speed.value) || 1.4,
    };
    saveSettings(next);
    overlay.remove();
  };
  btnRow.appendChild(saveBtn);
  panel.appendChild(btnRow);

  overlay.appendChild(panel);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}
