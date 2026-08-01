import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import * as store from '@/lib/offlineStore';
import type { Profile, Song } from '@/types';

function song(uuid: string, overrides: Partial<Song> = {}): Song {
  return {
    id: 1,
    uuid,
    user_id: 1,
    profile_id: 1,
    title: `Song ${uuid}`,
    artist: 'Someone',
    original_content: 'C G Am F',
    rewritten_content: 'C G Am F',
    updated_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as unknown as Song;
}

const ALICE = 1;
const BOB = 2;

beforeEach(async () => {
  // Close before deleting: deleteDatabase blocks forever while a connection is open,
  // which hangs this test and every one after it.
  await store._resetForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('porchsongs-offline');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
});

describe('offlineStore', () => {
  it('mirrors and returns a song list', async () => {
    await store.putSongs(ALICE, [song('a'), song('b')]);
    const got = await store.getSongs(ALICE);
    expect(got.map((s) => s.uuid).sort()).toEqual(['a', 'b']);
  });

  it('returns a single song by uuid', async () => {
    await store.putSongs(ALICE, [song('a')]);
    expect((await store.getSong(ALICE, 'a'))?.uuid).toBe('a');
    expect(await store.getSong(ALICE, 'missing')).toBeNull();
  });

  describe('user scoping', () => {
    it('refuses to hand one user another user’s charts', async () => {
      // The whole reason the store is keyed by user. IndexedDB is origin-scoped, so
      // on the shared tablet this feature exists for, an unscoped store would show
      // the next person to sign in the previous person's entire library.
      await store.putSongs(ALICE, [song('a')]);
      expect(await store.getSongs(BOB)).toEqual([]);
      expect(await store.getSong(BOB, 'a')).toBeNull();
    });

    it('wipes the previous user’s data when the owner changes', async () => {
      await store.putSongs(ALICE, [song('a')]);
      await store.setOwner(BOB);
      expect(await store.getSongs(BOB)).toEqual([]);
      // And Alice's data is gone, not merely hidden.
      expect(await store.getSongs(ALICE)).toEqual([]);
    });

    it('clear() empties the store', async () => {
      await store.putSongs(ALICE, [song('a'), song('b')]);
      await store.clear();
      expect(await store.getSongs(ALICE)).toEqual([]);
    });
  });

  describe('syncing', () => {
    it('drops charts deleted elsewhere', async () => {
      await store.putSongs(ALICE, [song('a'), song('b')]);
      await store.putSongs(ALICE, [song('a')]);
      // Otherwise the mirror would resurrect a chart deleted on another device.
      expect((await store.getSongs(ALICE)).map((s) => s.uuid)).toEqual(['a']);
    });

    it('updates a chart whose updated_at changed', async () => {
      await store.putSongs(ALICE, [song('a', { title: 'Old' })]);
      await store.putSongs(ALICE, [
        song('a', { title: 'New', updated_at: '2026-02-02T00:00:00Z' }),
      ]);
      expect((await store.getSong(ALICE, 'a'))?.title).toBe('New');
    });

    it('records when it last synced', async () => {
      expect(await store.getSyncedAt()).toBeNull();
      await store.putSongs(ALICE, [song('a')]);
      expect(typeof (await store.getSyncedAt())).toBe('number');
    });

    it('putSong adds one chart without disturbing the rest', async () => {
      await store.putSongs(ALICE, [song('a')]);
      await store.putSong(ALICE, song('c'));
      expect((await store.getSongs(ALICE)).map((s) => s.uuid).sort()).toEqual(['a', 'c']);
    });
  });

  describe('profiles', () => {
    it('mirrors profiles, scoped the same way', async () => {
      // AppShell renders a full-screen error if the profile fetch fails, which would
      // make every offline route unreachable no matter what else is cached.
      const profiles = [{ id: 1, is_default: true }] as unknown as Profile[];
      await store.putProfiles(ALICE, profiles);
      expect(await store.getProfiles(ALICE)).toHaveLength(1);
      expect(await store.getProfiles(BOB)).toEqual([]);
    });
  });
});
