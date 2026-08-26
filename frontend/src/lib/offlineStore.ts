import { openDB, type IDBPDatabase } from 'idb';
import type { Profile, Song } from '@/types';

/**
 * A local mirror of the things needed to open and play a chart with no connection.
 *
 * Scoped to a user id, deliberately. IndexedDB is origin-scoped, so a single shared
 * store on the shared tablet this feature exists for would hand the next person to
 * sign in the previous person's entire library. Every read checks the stored owner
 * and refuses to answer for anybody else, and `clear()` runs on logout.
 *
 * Read-only by design. Editing and importing still require a connection; queueing
 * writes and reconciling conflicts is a much larger problem than reading is.
 */

const DB_NAME = 'porchsongs-offline';
// 2 added FILES. The upgrade only ever creates missing stores, so an existing
// mirror keeps its charts rather than being rebuilt from the network.
const DB_VERSION = 2;

const SONGS = 'songs';
const META = 'meta';
const FILES = 'files';

/** Keys in the meta store. */
const OWNER_KEY = 'ownerId';
const SYNCED_AT_KEY = 'syncedAt';
const PROFILES_KEY = 'profiles';

let _dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!_dbPromise) {
    _dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(SONGS)) {
          database.createObjectStore(SONGS, { keyPath: 'uuid' });
        }
        if (!database.objectStoreNames.contains(META)) {
          database.createObjectStore(META);
        }
        if (!database.objectStoreNames.contains(FILES)) {
          database.createObjectStore(FILES, { keyPath: 'uuid' });
        }
      },
    });
  }
  return _dbPromise;
}

/** True when IndexedDB is usable. Absent in some private-browsing modes. */
export function isSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

async function owner(): Promise<number | null> {
  const value = await (await db()).get(META, OWNER_KEY);
  return typeof value === 'number' ? value : null;
}

/**
 * Point the store at a user, wiping it first if it belonged to somebody else.
 *
 * Called on sign-in. The wipe is the important half: without it, switching accounts
 * on one device leaves the previous library readable.
 */
export async function setOwner(userId: number): Promise<void> {
  if (!isSupported()) return;
  const current = await owner();
  if (current !== null && current !== userId) {
    await clear();
  }
  await (await db()).put(META, userId, OWNER_KEY);
}

/** Wipe everything. Called on logout and on an owner change. */
export async function clear(): Promise<void> {
  if (!isSupported()) return;
  const database = await db();
  const tx = database.transaction([SONGS, META, FILES], 'readwrite');
  await Promise.all([
    tx.objectStore(SONGS).clear(),
    tx.objectStore(META).clear(),
    tx.objectStore(FILES).clear(),
    tx.done,
  ]);
}

/**
 * Mirror the full song list.
 *
 * Eager rather than lazy: `GET /api/songs` returns every song with its full content
 * in one unpaginated response, so one call covers the whole library for a few MB. A
 * lazy read-through would leave most charts unopenable offline, which is the case
 * that matters.
 *
 * Only changed rows are written. A full rewrite on every library visit would churn
 * megabytes for nothing.
 */
export async function putSongs(userId: number, songs: Song[]): Promise<void> {
  if (!isSupported()) return;
  await setOwner(userId);
  const database = await db();
  const existing = new Map<string, Song>(
    (await database.getAll(SONGS)).map((s: Song) => [s.uuid, s]),
  );

  const tx = database.transaction([SONGS, META, FILES], 'readwrite');
  const store = tx.objectStore(SONGS);
  const files = tx.objectStore(FILES);
  const incoming = new Set<string>();

  for (const song of songs) {
    incoming.add(song.uuid);
    const prev = existing.get(song.uuid);
    if (!prev || prev.updated_at !== song.updated_at) {
      store.put(song);
    }
  }
  // Drop anything deleted elsewhere, so the mirror cannot resurrect a chart the user
  // removed on another device. A kept tab goes with its song: a stored PDF whose
  // library row is gone is megabytes nobody can see, reach, or delete.
  for (const uuid of existing.keys()) {
    if (!incoming.has(uuid)) {
      store.delete(uuid);
      files.delete(uuid);
    }
  }
  tx.objectStore(META).put(Date.now(), SYNCED_AT_KEY);
  await tx.done;
}

/** Mirror a single song, e.g. after opening one that was not in the list. */
export async function putSong(userId: number, song: Song): Promise<void> {
  if (!isSupported()) return;
  await setOwner(userId);
  await (await db()).put(SONGS, song);
}

/** Every mirrored song, or [] when the store belongs to somebody else. */
export async function getSongs(userId: number): Promise<Song[]> {
  if (!isSupported()) return [];
  if ((await owner()) !== userId) return [];
  return (await (await db()).getAll(SONGS)) as Song[];
}

/** One mirrored song, or null when absent or owned by somebody else. */
export async function getSong(userId: number, uuid: string): Promise<Song | null> {
  if (!isSupported()) return null;
  if ((await owner()) !== userId) return null;
  return ((await (await db()).get(SONGS, uuid)) as Song | undefined) ?? null;
}

/** Mirror the profile list, so the app shell can boot without a connection. */
export async function putProfiles(userId: number, profiles: Profile[]): Promise<void> {
  if (!isSupported()) return;
  await setOwner(userId);
  await (await db()).put(META, profiles, PROFILES_KEY);
}

export async function getProfiles(userId: number): Promise<Profile[]> {
  if (!isSupported()) return [];
  if ((await owner()) !== userId) return [];
  return ((await (await db()).get(META, PROFILES_KEY)) as Profile[] | undefined) ?? [];
}

/** When the mirror was last refreshed, or null if never. */
export async function getSyncedAt(): Promise<number | null> {
  if (!isSupported()) return null;
  const value = await (await db()).get(META, SYNCED_AT_KEY);
  return typeof value === 'number' ? value : null;
}

/**
 * A stored tab kept on this device.
 *
 * Charts are mirrored eagerly, because the whole library is a few MB of text.
 * Documents are not: a tab collection is hundreds of megabytes, so keeping one
 * is an explicit per-song choice and the presence of a row here IS that choice.
 * There is no separate flag to drift out of step with the bytes.
 */
export interface OfflineFile {
  uuid: string;
  /**
   * ArrayBuffer, not Blob.
   *
   * Both are structured-cloneable on paper, but Blob-in-IndexedDB has a long
   * history of going wrong on iOS Safari, which is the installed PWA on a music
   * stand this feature exists for. An ArrayBuffer is also what pdf.js wants, so
   * the hot path does no conversion at all.
   */
  bytes: ArrayBuffer;
  contentType: string;
  /** Digest of the bytes, matched against the song's file.sha256 to spot staleness. */
  sha256: string;
  /** Carried rather than derived, so totalling device usage reads no buffers. */
  size: number;
  savedAt: number;
}

/** Keep a document's bytes on this device. */
export async function putFile(
  userId: number,
  uuid: string,
  bytes: ArrayBuffer,
  sha256: string,
  contentType = 'application/pdf',
): Promise<void> {
  if (!isSupported()) return;
  await setOwner(userId);
  const record: OfflineFile = {
    uuid,
    bytes,
    contentType,
    sha256,
    size: bytes.byteLength,
    savedAt: Date.now(),
  };
  await (await db()).put(FILES, record);
}

/** A kept document, or null when absent or owned by somebody else. */
export async function getFile(userId: number, uuid: string): Promise<OfflineFile | null> {
  if (!isSupported()) return null;
  if ((await owner()) !== userId) return null;
  return ((await (await db()).get(FILES, uuid)) as OfflineFile | undefined) ?? null;
}

/** Stop keeping a document. The song stays in the library. */
export async function deleteFile(userId: number, uuid: string): Promise<void> {
  if (!isSupported()) return;
  if ((await owner()) !== userId) return;
  await (await db()).delete(FILES, uuid);
}

/**
 * Which documents are kept, without reading any of the blobs.
 *
 * getAllKeys rather than getAll: this answers "is the toggle on" for a list of
 * songs, and loading several hundred megabytes of PDF to render a row of
 * checkmarks would be a bug with no visible cause.
 */
export async function keptFileUuids(userId: number): Promise<Set<string>> {
  if (!isSupported()) return new Set();
  if ((await owner()) !== userId) return new Set();
  return new Set((await (await db()).getAllKeys(FILES)) as string[]);
}

/** Total bytes kept, so the app can say what it is using on this device. */
export async function keptFilesSize(userId: number): Promise<number> {
  if (!isSupported()) return 0;
  if ((await owner()) !== userId) return 0;
  const rows = (await (await db()).getAll(FILES)) as OfflineFile[];
  return rows.reduce((total, row) => total + (row.size ?? 0), 0);
}

/**
 * Test seam: close the open connection and forget it.
 *
 * Closing matters. `indexedDB.deleteDatabase` blocks indefinitely while any
 * connection is still open, so a test that deletes without closing first hangs, and
 * so does every test after it.
 */
export async function _resetForTests(): Promise<void> {
  if (_dbPromise) {
    try {
      (await _dbPromise).close();
    } catch {
      /* already closed */
    }
    _dbPromise = null;
  }
}
