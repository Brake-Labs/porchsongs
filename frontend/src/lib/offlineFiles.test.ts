import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as store from '@/lib/offlineStore';
import api from '@/api';

/**
 * The rules for reaching a stored tab's bytes.
 *
 * The interesting cases are all about when the network is and is not used. A kept
 * tab must open with no request at all, because the reason it was kept is that
 * there may be no connection where it gets played.
 */

const OWNER = 7;

vi.mock('@/lib/offlineIdentity', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/offlineIdentity')>('@/lib/offlineIdentity');
  return { ...actual, currentOwnerId: () => 7 };
});

const bytes = (n: number, fill = 1) => new Uint8Array(n).fill(fill).buffer;

async function freshDb() {
  await store._resetForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('porchsongs-offline');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  // No vi.resetModules(): a fresh module graph gives api its own offlineStore
  // instance, whose still-open connection makes deleteDatabase block forever.
  await freshDb();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fetch stub that records how often it was called. */
function stubFetch(impl: () => Promise<Response> | Response) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

function pdfResponse(body: ArrayBuffer) {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/pdf' },
  });
}

describe('fetchSongFile', () => {
  it('opens a kept tab without touching the network', async () => {
    // The whole point of keeping one. A request here is a request that fails in a
    // barn with no signal.
    await store.putFile(OWNER, 'doc-1', bytes(64), 'sha-current');
    const fetchFn = stubFetch(() => pdfResponse(bytes(999)));

    const got = await api.fetchSongFile('doc-1', 'sha-current');

    expect(got.byteLength).toBe(64);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refetches when the kept copy is stale, and refreshes it', async () => {
    await store.putFile(OWNER, 'doc-1', bytes(64, 1), 'sha-old');
    const fetchFn = stubFetch(() => pdfResponse(bytes(128, 2)));

    const got = await api.fetchSongFile('doc-1', 'sha-new');

    expect(got.byteLength).toBe(128);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await vi.waitFor(async () => {
      const kept = await store.getFile(OWNER, 'doc-1');
      expect(kept?.sha256).toBe('sha-new');
      expect(kept?.size).toBe(128);
    });
  });

  it('goes to the network for a tab that was never kept', async () => {
    const fetchFn = stubFetch(() => pdfResponse(bytes(32)));
    const got = await api.fetchSongFile('doc-1', 'sha-current');
    expect(got.byteLength).toBe(32);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not start keeping a tab just because it was opened', async () => {
    // Keeping is a choice. Caching every tab somebody looks at would fill the
    // device with the exact megabytes this design set out not to sync.
    stubFetch(() => pdfResponse(bytes(32)));
    await api.fetchSongFile('doc-1', 'sha-current');
    expect(await store.getFile(OWNER, 'doc-1')).toBeNull();
  });

  it('falls back to a kept copy when the network is gone', async () => {
    await store.putFile(OWNER, 'doc-1', bytes(64), 'sha-old');
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));

    // Stale by digest, but a possibly old tab beats no tab when you are playing.
    const got = await api.fetchSongFile('doc-1', 'sha-new');
    expect(got.byteLength).toBe(64);
  });

  it('reports the failure when the network is gone and nothing was kept', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(api.fetchSongFile('doc-1', 'sha-current')).rejects.toThrow();
  });

  it('does not serve a kept copy on a real error response', async () => {
    // A 404 means the tab is gone, not that the connection dropped. Answering it
    // from the cache would keep a deleted tab playable forever.
    await store.putFile(OWNER, 'doc-1', bytes(64), 'sha-old');
    stubFetch(() => new Response('nope', { status: 404 }));
    await expect(api.fetchSongFile('doc-1', 'sha-new')).rejects.toThrow(/404/);
  });
});

describe('keeping and forgetting', () => {
  it('downloads and keeps a tab on request', async () => {
    stubFetch(() => pdfResponse(bytes(256)));
    await api.keepSongFileOffline('doc-1', 'sha-current');

    const kept = await store.getFile(OWNER, 'doc-1');
    expect(kept?.sha256).toBe('sha-current');
    expect(kept?.size).toBe(256);
    expect(await api.keptSongFiles()).toEqual(new Set(['doc-1']));
  });

  it('keeps nothing when the download fails', async () => {
    stubFetch(() => new Response('nope', { status: 500 }));
    await expect(api.keepSongFileOffline('doc-1', 'sha')).rejects.toThrow();
    expect(await store.getFile(OWNER, 'doc-1')).toBeNull();
  });

  it('forgets a tab and reclaims the space', async () => {
    await store.putFile(OWNER, 'doc-1', bytes(2048), 'sha');
    expect(await api.keptSongFilesSize()).toBe(2048);

    await api.forgetSongFileOffline('doc-1');

    expect(await api.keptSongFiles()).toEqual(new Set());
    expect(await api.keptSongFilesSize()).toBe(0);
  });
});
