import { openDB, type IDBPDatabase } from 'idb';
import type { ScoreRecord, SongMeta, StoredSong } from '../types';

const DB_NAME = 'rhythm-mp3-db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('songs')) {
          db.createObjectStore('songs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('scores')) {
          db.createObjectStore('scores', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

export async function addSong(song: StoredSong): Promise<void> {
  const db = await getDb();
  await db.put('songs', song);
}

export async function listSongs(): Promise<SongMeta[]> {
  const db = await getDb();
  const all = (await db.getAll('songs')) as StoredSong[];
  return all
    .map(({ id, name, duration, addedAt }) => ({ id, name, duration, addedAt }))
    .sort((a, b) => a.addedAt - b.addedAt);
}

export async function getSongBlob(id: string): Promise<Blob | null> {
  const db = await getDb();
  const s = (await db.get('songs', id)) as StoredSong | undefined;
  return s ? s.blob : null;
}

export async function deleteSong(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('songs', id);
  const keys = (await db.getAllKeys('scores')) as string[];
  const tx = db.transaction('scores', 'readwrite');
  for (const k of keys) {
    if (typeof k === 'string' && k.startsWith(id + '|')) {
      await tx.store.delete(k);
    }
  }
  await tx.done;
}

export function scoreKey(songId: string, startMs: number, difficulty: string): string {
  return `${songId}|${Math.round(startMs)}|${difficulty}`;
}

/** Save a score; keeps only the best per key. Returns true if this is a new best. */
export async function saveScore(rec: ScoreRecord): Promise<boolean> {
  const db = await getDb();
  const existing = (await db.get('scores', rec.key)) as ScoreRecord | undefined;
  if (!existing || rec.score > existing.score) {
    await db.put('scores', rec);
    return true;
  }
  return false;
}

export async function getScore(key: string): Promise<ScoreRecord | null> {
  const db = await getDb();
  const r = (await db.get('scores', key)) as ScoreRecord | undefined;
  return r ?? null;
}

/** Best score across all segments/difficulties of a song. */
export async function getBestForSong(songId: string): Promise<ScoreRecord | null> {
  const db = await getDb();
  const all = (await db.getAll('scores')) as ScoreRecord[];
  let best: ScoreRecord | null = null;
  for (const r of all) {
    if (r.songId === songId && (!best || r.score > best.score)) best = r;
  }
  return best;
}
