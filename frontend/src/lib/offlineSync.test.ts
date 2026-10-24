import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as store from '@/lib/offlineStore';
import api, { _resetLibrarySyncForTests } from '@/api';
import client from '@/lib/api-client';
import type { Song } from '@/types';

/**
 * How the offline mirror is kept in step with the library through the API layer.
 *
 * The goal is that every chart the user owns can be opened with no connection, not
 * only the ones on surfaces they happened to visit while online.
 */

const OWNER = 7;

vi.mock('@/lib/offlineIdentity', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/offlineIdentity')>('@/lib/offlineIdentity');
  return { ...actual, currentOwnerId: () => 7 };
});

vi.mock('@/lib/api-client', () => ({
  default: { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
  getAccessToken: () => null,
  setAccessToken: vi.fn(),
  setRefreshToken: vi.fn(),
  tryRefresh: vi.fn(),
}));

const mocked = client as unknown as Record<'GET' | 'POST' | 'PUT' | 'DELETE', ReturnType<typeof vi.fn>>;

function song(uuid: string, overrides: Partial<Song> = {}): Song {
  return {
    id: Number(uuid.replace(/\D/g, '')) || 1,
    uuid,
    user_id: OWNER,
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

async function mirrored(): Promise<string[]> {
  return (await store.getSongs(OWNER)).map((s) => s.uuid).sort();
}

beforeEach(async () => {
  await store._resetForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('porchsongs-offline');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
  _resetLibrarySyncForTests();
  for (const fn of Object.values(mocked)) fn.mockReset();
});

describe('offline mirror sync', () => {
  it('a list filtered to one profile does not evict other profiles’ charts', async () => {
    // RewriteTab checks for existing songs with listSongs(profile.id). That list
    // used to prune the mirror, dropping every chart in any other profile.
    mocked.GET.mockResolvedValueOnce({ data: [song('a1'), song('b2', { profile_id: 2 })] });
    await api.listSongs();
    await vi.waitFor(async () => expect(await mirrored()).toEqual(['a1', 'b2']));

    mocked.GET.mockResolvedValueOnce({ data: [song('a1')] });
    await api.listSongs(1);
    // Give the fire-and-forget write a chance to land before asserting nothing moved.
    await new Promise((r) => setTimeout(r, 20));
    expect(await mirrored()).toEqual(['a1', 'b2']);
  });

  it('an unfiltered list still drops charts deleted elsewhere', async () => {
    mocked.GET.mockResolvedValueOnce({ data: [song('a1'), song('b2')] });
    await api.listSongs();
    await vi.waitFor(async () => expect(await mirrored()).toEqual(['a1', 'b2']));
    mocked.GET.mockResolvedValueOnce({ data: [song('a1')] });
    await api.listSongs();
    await vi.waitFor(async () => expect(await mirrored()).toEqual(['a1']));
  });

  it('a newly saved chart is mirrored without a library reload', async () => {
    mocked.POST.mockResolvedValueOnce({ data: song('n1') });
    await api.saveSong({ title: 'New' });
    await vi.waitFor(async () => expect(await mirrored()).toEqual(['n1']));
  });

  it('an edit replaces the mirrored copy, so offline play shows the new version', async () => {
    mocked.GET.mockResolvedValueOnce({ data: [song('a1', { rewritten_content: 'old' })] });
    await api.listSongs();
    await vi.waitFor(async () => expect(await mirrored()).toEqual(['a1']));

    mocked.PUT.mockResolvedValueOnce({
      data: song('a1', { rewritten_content: 'new', updated_at: '2026-02-01T00:00:00Z' }),
    });
    await api.updateSong('a1', { rewritten_content: 'new' });
    await vi.waitFor(async () =>
      expect((await store.getSong(OWNER, 'a1'))?.rewritten_content).toBe('new'),
    );
  });

  it('a deleted chart leaves the mirror immediately', async () => {
    mocked.GET.mockResolvedValueOnce({ data: [song('a1'), song('b2')] });
    await api.listSongs();
    await vi.waitFor(async () => expect(await mirrored()).toEqual(['a1', 'b2']));
    mocked.DELETE.mockResolvedValueOnce({ data: { ok: true } });
    await api.deleteSong('b2');
    await vi.waitFor(async () => expect(await mirrored()).toEqual(['a1']));
  });

  describe('syncOfflineLibrary', () => {
    it('mirrors the whole library when nothing has loaded it yet', async () => {
      // A session opened straight onto a chart never renders the library, and used
      // to leave only that one chart available offline.
      mocked.GET.mockResolvedValueOnce({ data: [song('a1'), song('b2'), song('c3')] });
      await api.syncOfflineLibrary();
      expect(mocked.GET).toHaveBeenCalledTimes(1);
      expect(mocked.GET.mock.calls[0]?.[1]).toEqual({ params: { query: { profile_id: undefined } } });
      await vi.waitFor(async () => expect(await mirrored()).toEqual(['a1', 'b2', 'c3']));
    });

    it('costs no request once the library has been loaded', async () => {
      mocked.GET.mockResolvedValueOnce({ data: [song('a1')] });
      await api.listSongs();
      await api.syncOfflineLibrary();
      expect(mocked.GET).toHaveBeenCalledTimes(1);
    });

    it('does not duplicate a library load that is still in flight', async () => {
      let resolve!: (v: unknown) => void;
      mocked.GET.mockReturnValueOnce(new Promise((r) => (resolve = r)));
      const pending = api.listSongs();
      await api.syncOfflineLibrary();
      expect(mocked.GET).toHaveBeenCalledTimes(1);
      resolve({ data: [song('a1')] });
      await pending;
    });

    it('a filtered list does not count as having synced the library', async () => {
      mocked.GET.mockResolvedValueOnce({ data: [song('a1')] });
      await api.listSongs(1);
      mocked.GET.mockResolvedValueOnce({ data: [song('a1'), song('b2')] });
      await api.syncOfflineLibrary();
      expect(mocked.GET).toHaveBeenCalledTimes(2);
    });

    it('swallows a dead network and tries again next time', async () => {
      mocked.GET.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await expect(api.syncOfflineLibrary()).resolves.toBeUndefined();
      mocked.GET.mockResolvedValueOnce({ data: [song('a1')] });
      await api.syncOfflineLibrary();
      expect(mocked.GET).toHaveBeenCalledTimes(2);
    });
  });
});
