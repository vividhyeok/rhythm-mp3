import { openDB, type IDBPDatabase } from 'idb';
import type { ChartCacheRecord, ScoreRecord, SongMeta, StoredSong } from '../types';

const DB_NAME = 'rhythm-mp3-db';
const DB_VERSION = 2;

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
        if (!db.objectStoreNames.contains('charts')) {
          const store = db.createObjectStore('charts', { keyPath: 'key' });
          store.createIndex('songId', 'songId');
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
  const tx = db.transaction(['songs', 'scores', 'charts'], 'readwrite');
  await tx.objectStore('songs').delete(id);

  const scoreKeys = (await tx.objectStore('scores').getAllKeys()) as string[];
  for (const k of scoreKeys) {
    if (typeof k === 'string' && k.startsWith(id + '|')) {
      await tx.objectStore('scores').delete(k);
    }
  }

  const chartStore = tx.objectStore('charts');
  const chartKeys = await chartStore.index('songId').getAllKeys(id);
  for (const k of chartKeys) await chartStore.delete(k);

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

export async function getChartCache(key: string): Promise<ChartCacheRecord | null> {
  const db = await getDb();
  const rec = (await db.get('charts', key)) as ChartCacheRecord | undefined;
  return rec ?? null;
}

export async function saveChartCache(rec: ChartCacheRecord): Promise<void> {
  const db = await getDb();
  await db.put('charts', rec);
}

export async function countCachedCharts(songId: string): Promise<number> {
  const db = await getDb();
  return await db.countFromIndex('charts', 'songId', songId);
}
