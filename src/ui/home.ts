import { audioEngine } from '../audio/engine';
import { addSong, deleteSong, getBestForSong, listSongs } from '../storage/db';
import { session } from '../state';
import { formatTime } from '../util/segment';
import { el, show } from './screen';
import { mountSegment } from './segment';
import { openSettingsModal } from './settings';

export function mountHome(root: HTMLElement): () => void {
  const container = el('div', 'screen home');

  container.appendChild(el('div', 'title-blink', 'MP3 RHYTHM'));
  container.appendChild(el('div', 'subtitle', '// LCD 4-KEY AUTO-CHART //'));

  const btnRow = el('div', 'btn-row');
  const importBtn = el('button', 'btn primary', '+ IMPORT MP3');
  const settingsBtn = el('button', 'btn', 'SETTINGS');
  btnRow.appendChild(importBtn);
  btnRow.appendChild(settingsBtn);
  container.appendChild(btnRow);

  const status = el('div', 'status-line', 'DRAG & DROP MP3 FILES ANYWHERE');
  container.appendChild(status);

  const listEl = el('div', 'song-list');
  container.appendChild(listEl);

  const footer = el('div', 'footer-hint', 'SELECT A SONG TO CONTINUE');
  container.appendChild(footer);

  root.appendChild(container);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'audio/mpeg,audio/mp3,audio/*';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  root.appendChild(fileInput);

  let disposed = false;

  async function refreshList(): Promise<void> {
    const songs = await listSongs();
    if (disposed) return;
    listEl.innerHTML = '';
    if (songs.length === 0) {
      listEl.appendChild(el('div', 'song-empty', '[ NO SONGS - IMPORT AN MP3 ]'));
      return;
    }
    for (const s of songs) {
      const best = await getBestForSong(s.id);
      if (disposed) return;
      const row = el('div', 'song-row');
      const name = el('span', 'song-name', s.name);
      name.title = s.name;
      const dur = el('span', 'song-dur', formatTime(s.duration));
      const state = el('span', 'song-state', best ? 'PLAYED' : 'NEW');
      const bestEl = el(
        'span',
        'song-best',
        best ? `BEST ${String(best.score).padStart(7, '0')} [${best.grade}]` : 'BEST -------',
      );
      const del = el('button', 'btn tiny danger', 'DEL');
      del.onclick = async (ev) => {
        ev.stopPropagation();
        await deleteSong(s.id);
        if (session.song?.id === s.id) {
          session.song = null;
          session.buffer = null;
        }
        void refreshList();
      };
      row.appendChild(name);
      row.appendChild(dur);
      row.appendChild(state);
      row.appendChild(bestEl);
      row.appendChild(del);
      row.onclick = () => {
        session.song = s;
        session.buffer = null;
        show(mountSegment);
      };
      listEl.appendChild(row);
    }
  }

  async function handleFiles(files: FileList | File[]): Promise<void> {
    const arr = Array.from(files);
    for (const f of arr) {
      status.textContent = `IMPORTING: ${f.name} ...`;
      try {
        const buffer = await audioEngine.decodeBlob(f);
        if (buffer.duration < 6) {
          status.textContent = `SKIPPED (TOO SHORT): ${f.name}`;
          continue;
        }
        await addSong({
          id: crypto.randomUUID(),
          name: f.name.replace(/\.[^.]+$/, ''),
          duration: buffer.duration,
          addedAt: Date.now(),
          blob: f,
        });
        status.textContent = `ADDED: ${f.name}`;
      } catch {
        status.textContent = `FAILED TO DECODE: ${f.name}`;
      }
    }
    void refreshList();
  }

  importBtn.onclick = () => fileInput.click();
  settingsBtn.onclick = () => openSettingsModal();
  fileInput.onchange = () => {
    if (fileInput.files && fileInput.files.length > 0) {
      void handleFiles(fileInput.files);
    }
    fileInput.value = '';
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    container.classList.add('drag-over');
  };
  const onDragLeave = () => container.classList.remove('drag-over');
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    container.classList.remove('drag-over');
    if (e.dataTransfer?.files?.length) void handleFiles(e.dataTransfer.files);
  };
  container.addEventListener('dragover', onDragOver);
  container.addEventListener('dragleave', onDragLeave);
  container.addEventListener('drop', onDrop);

  void refreshList();

  return () => {
    disposed = true;
    container.removeEventListener('dragover', onDragOver);
    container.removeEventListener('dragleave', onDragLeave);
    container.removeEventListener('drop', onDrop);
  };
}
