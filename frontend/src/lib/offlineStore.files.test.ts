import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import * as store from '@/lib/offlineStore';
import type { Song } from '@/types';

/**
 * Keeping a tab PDF on the device.
 *
 * Charts are mirrored eagerly because the whole library is a few MB of text. A tab
 * collection is hundreds of megabytes, so a document is kept only when somebody
 * asks, and the presence of a row IS that choice. Most of what matters here is
 * that the megabytes go away when they should: on delete, on logout, and when the
 * song disappears from the library on another device.
 */

function song(uuid: string, overrides: Partial<Song> = {}): Song {
  return {
    id: 1,
    uuid,
    user_id: 1,
    profile_id: 1,
    kind: 'document',
    title: `Tab ${uuid}`,
    artist: 'Trad',
    original_content: '',
    rewritten_content: '',
    updated_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as unknown as Song;
}

const pdf = (bytes = 1024) => new Uint8Array(bytes).buffer;

const ALICE = 1;
const BOB = 2;

beforeEach(async () => {
  await store._resetForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('porchsongs-offline');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
});

describe('kept documents', () => {
  it('round-trips the bytes and the digest', async () => {
    await store.putFile(ALICE, 'a', pdf(2048), 'abc123');
    const got = await store.getFile(ALICE, 'a');
    expect(got?.sha256).toBe('abc123');
    expect(got?.size).toBe(2048);
    expect(got?.bytes.byteLength).toBe(2048);
  });

  it('reports nothing for a document that was never kept', async () => {
    await store.putSongs(ALICE, [song('a')]);
    expect(await store.getFile(ALICE, 'a')).toBeNull();
  });

  it('lists kept uuids without reading any blob', async () => {
    await store.putFile(ALICE, 'a', pdf(), 'x');
    await store.putFile(ALICE, 'b', pdf(), 'y');
    expect([...(await store.keptFileUuids(ALICE))].sort()).toEqual(['a', 'b']);
  });

  it('totals what is stored on the device', async () => {
    await store.putFile(ALICE, 'a', pdf(1000), 'x');
    await store.putFile(ALICE, 'b', pdf(2500), 'y');
    expect(await store.keptFilesSize(ALICE)).toBe(3500);
  });

  it('forgets one document without touching the others', async () => {
    await store.putFile(ALICE, 'a', pdf(), 'x');
    await store.putFile(ALICE, 'b', pdf(), 'y');
    await store.deleteFile(ALICE, 'a');
    expect(await store.getFile(ALICE, 'a')).toBeNull();
    expect(await store.getFile(ALICE, 'b')).not.toBeNull();
  });

  it('replaces the bytes and digest when a kept copy is refreshed', async () => {
    await store.putFile(ALICE, 'a', pdf(100), 'old');
    await store.putFile(ALICE, 'a', pdf(300), 'new');
    const got = await store.getFile(ALICE, 'a');
    expect(got?.sha256).toBe('new');
    expect(got?.size).toBe(300);
    expect(await store.keptFilesSize(ALICE)).toBe(300);
  });
});

describe('kept documents are scoped to their owner', () => {
  it('will not hand one user another user’s tab', async () => {
    // The shared-tablet case. IndexedDB is origin-scoped, so without this check
    // signing in as somebody else exposes their library.
    await store.putFile(ALICE, 'a', pdf(), 'x');
    expect(await store.getFile(BOB, 'a')).toBeNull();
    expect([...(await store.keptFileUuids(BOB))]).toEqual([]);
    expect(await store.keptFilesSize(BOB)).toBe(0);
  });

  it('wipes kept tabs when the owner changes', async () => {
    await store.putFile(ALICE, 'a', pdf(), 'x');
    await store.setOwner(BOB);
    expect(await store.getFile(BOB, 'a')).toBeNull();
  });

  it('wipes kept tabs on clear', async () => {
    await store.putFile(ALICE, 'a', pdf(), 'x');
    await store.clear();
    expect(await store.keptFilesSize(ALICE)).toBe(0);
  });
});

describe('orphan cleanup', () => {
  it('drops a kept tab when its song disappears from the library', async () => {
    // Deleted on another device. Without this the bytes stay forever, invisible:
    // no library row points at them and nothing offers to remove them.
    await store.putSongs(ALICE, [song('a'), song('b')]);
    await store.putFile(ALICE, 'a', pdf(4096), 'x');
    await store.putFile(ALICE, 'b', pdf(4096), 'y');

    await store.putSongs(ALICE, [song('b')]);

    expect(await store.getFile(ALICE, 'a')).toBeNull();
    expect(await store.getFile(ALICE, 'b')).not.toBeNull();
    expect(await store.keptFilesSize(ALICE)).toBe(4096);
  });

  it('keeps a tab whose song is merely unchanged', async () => {
    await store.putSongs(ALICE, [song('a')]);
    await store.putFile(ALICE, 'a', pdf(), 'x');
    await store.putSongs(ALICE, [song('a')]);
    expect(await store.getFile(ALICE, 'a')).not.toBeNull();
  });
});
