import type {
  AuthConfig,
  AuthUser,
  ChatHistoryRow,
  ChatResult,
  FolderSuggestion,
  ParseResult,
  Profile,
  Song,
  SongRevision,
  UrlScrapeResult,
} from '@/types';
import client, {
  getAccessToken,
  setAccessToken,
  setRefreshToken,
  tryRefresh,
} from '@/lib/api-client';
import { tryRestoreSession as _tryRestoreSession } from '@/extensions';
import * as offlineStore from '@/lib/offlineStore';
import { currentOwnerId, isNetworkFailure } from '@/lib/offlineIdentity';

// --- Storage keys ---
const STORAGE_KEYS = {
  REFRESH_TOKEN: 'porchsongs_refresh_token',
  CURRENT_SONG_ID: 'porchsongs_current_song_id',
  DRAFT_INPUT: 'porchsongs_draft_input',
  DRAFT_INSTRUCTION: 'porchsongs_draft_instruction',
  SPLIT_PERCENT: 'porchsongs_split_pct',
  WAKE_LOCK: 'porchsongs_wake_lock',
  MODEL: 'porchsongs_model',
  REASONING_EFFORT: 'porchsongs_reasoning_effort',
  THEME: 'porchsongs_theme',
  HAS_REWRITTEN: 'porchsongs_has_rewritten',
  LIBRARY_LAYOUT: 'porchsongs_library_layout',
  LIBRARY_BROWSE_MODE: 'porchsongs_library_browse_mode',
  PERFORMANCE_LAYOUT: 'porchsongs_performance_layout',
  PERFORMANCE_VERSION: 'porchsongs_performance_version',
  // Which surface the user was last on ('play' | 'workshop' | 'library').
  // CURRENT_SONG_ID records WHICH song but not WHERE, so a PWA relaunch used to
  // drop someone who force-quit mid-performance into the rewrite editor. Every
  // surface must write this, including the library: an unrecorded surface leaves
  // a stale value behind and the relaunch restores to wherever the user was
  // *before* the one they actually quit from.
  LAST_SURFACE: 'porchsongs_last_surface',
} as const;

export { STORAGE_KEYS };

// --- Shared helpers ---

function _getAuthHeaders(): Record<string, string> {
  const token = getAccessToken();
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

/** Error with optional error_type from the backend. */
export type ApiError = Error & { errorType?: string };

/** Thrown when a mid-stream SSE connection is lost (e.g. mobile tab suspended). */
export class ConnectionLostError extends Error {
  constructor() {
    super('Connection lost');
    this.name = 'ConnectionLostError';
  }
}

function _parseApiError(body: unknown, fallback: string): string {
  const b = body as { detail?: string | { message?: string; error?: string; detail?: string } };
  if (!b.detail) return fallback;

  if (typeof b.detail === 'object') {
    return b.detail.detail || b.detail.message || b.detail.error || fallback;
  }

  return b.detail;
}

/**
 * Pull the machine-readable error slug out of an error body.
 *
 * Two shapes are in the wild and both must work:
 *  - `detail.error_type` — what the OSS backend emits (see `_require_gateway`,
 *    which returns `error_type: "gateway_not_configured"`).
 *  - `detail.error` — what the premium guard middleware emits for
 *    `max_songs_exceeded`, `quota_exceeded`, `rate_limited`,
 *    `service_at_capacity`, `content_too_large` and friends.
 *
 * Only the first was read, so every premium guard error arrived with
 * `errorType === undefined` and the only way to recognise one was substring
 * matching its English `message`. That coupled the upgrade affordances to exact
 * prose, so rewording a message silently removed them.
 */
export function _extractErrorType(body: unknown): string | undefined {
  const b = body as { detail?: { error_type?: unknown; error?: unknown }; error_type?: unknown };
  const candidates =
    typeof b.detail === 'object' && b.detail !== null
      ? [b.detail.error_type, b.detail.error]
      : [b.error_type];
  // Return the first candidate that is actually a string. `detail.error` is not
  // guaranteed to hold a slug (nested `{"error": {...}}` bodies exist upstream),
  // and consumers call `errorType.startsWith('provider_')` (isProviderError,
  // RewriteTab, ChatPanel), which throws on an object or a boolean.
  return candidates.find((c): c is string => typeof c === 'string');
}

/** True when the error originated from the AI provider, not PorchSongs. */
export function isProviderError(err: unknown): boolean {
  const errorType = (err as ApiError | undefined)?.errorType;
  return typeof errorType === 'string' && errorType.startsWith('provider_');
}

/**
 * Raw fetch with the bearer token, retried once through a token refresh.
 *
 * The generated client handles this for JSON routes, but multipart uploads and
 * binary downloads bypass it, and each one that did was carrying its own copy of
 * the 401-refresh dance.
 */
async function _authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const withAuth = (): RequestInit => ({
    ...init,
    headers: { ...(init.headers ?? {}), ..._getAuthHeaders() },
  });
  let res = await fetch(url, withAuth());
  if (res.status === 401) {
    if (await tryRefresh()) {
      res = await fetch(url, withAuth());
    } else {
      window.dispatchEvent(new CustomEvent('porchsongs-logout'));
      throw new Error('Authentication required. Please log in.');
    }
  }
  return res;
}

function _downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Throw a typed Error from an openapi-fetch error body. */
function _throwApiError(error: unknown, fallback: string): never {
  const message = _parseApiError(error, fallback);
  const err = new Error(message) as ApiError;
  err.errorType = _extractErrorType(error);
  throw err;
}

// --- SSE streaming (stays manual, openapi-fetch doesn't handle SSE) ---

async function _streamSse<T>(
  endpoint: string,
  data: Record<string, unknown>,
  onToken: (token: string) => void,
  signal?: AbortSignal,
  onReasoning?: (token: string) => void,
): Promise<T> {
  const doStream = async (retry: boolean): Promise<T> => {
    const res = await fetch(`/api${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._getAuthHeaders() },
      body: JSON.stringify(data),
      signal,
    });

    if (res.status === 401 && retry) {
      const refreshed = await tryRefresh();
      if (refreshed) return doStream(false);
      window.dispatchEvent(new CustomEvent('porchsongs-logout'));
      throw new Error('Authentication required. Please log in.');
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message = _parseApiError(body, `Request failed: ${res.status}`);
      const err = new Error(message) as ApiError & { status?: number };
      err.status = res.status;
      err.errorType = _extractErrorType(body);
      throw err;
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');
    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';
    let result: T | null = null;

    for (;;) {
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await reader.read();
      } catch {
        // reader.read() rejects when the connection is killed (e.g. mobile
        // browser suspended the tab).  Since we have a reader the HTTP
        // request succeeded, so the backend received it and will continue
        // the LLM call in a background task — always treat this as a
        // recoverable connection-lost rather than a hard failure.
        throw new ConnectionLostError();
      }
      const { done, value } = readResult;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7);
        } else if (line.startsWith('data: ')) {
          const payload = line.slice(6);
          if (eventType === 'token') {
            onToken(JSON.parse(payload) as string);
          } else if (eventType === 'reasoning') {
            if (onReasoning) onReasoning(JSON.parse(payload) as string);
          } else if (eventType === 'done') {
            result = JSON.parse(payload) as T;
          } else if (eventType === 'error') {
            const parsed = JSON.parse(payload) as { detail: string | { message?: string; error?: string }; error_type?: string };
            const msg = typeof parsed.detail === 'object'
              ? (parsed.detail.message || parsed.detail.error || 'Stream error')
              : (parsed.detail || 'Stream error');
            const sseErr = new Error(msg) as ApiError;
            sseErr.errorType = parsed.error_type;
            throw sseErr;
          }
          eventType = '';
        }
      }
    }

    if (!result) {
      // Stream ended without a done event — connection was dropped.
      throw new ConnectionLostError();
    }
    return result;
  };
  return doStream(true);
}

// --- Auth API ---

async function getAuthConfig(): Promise<AuthConfig> {
  const res = await fetch('/api/auth/config');
  return res.json() as Promise<AuthConfig>;
}

function logout(): void {
  setAccessToken(null);
  setRefreshToken(null);
  // Belt and braces alongside AuthContext: whichever path signs the user out, the
  // mirrored library must not survive it on a shared device.
  offlineStore.clear().catch(() => {});
}

const api = {
  getAuthConfig,
  logout,
  tryRestoreSession: _tryRestoreSession as () => Promise<AuthUser | null>,

  // Profiles
  listProfiles: async () => {
    try {
      const { data, error } = await client.GET('/api/profiles');
      if (error) _throwApiError(error, 'Failed to list profiles');
      const profiles = data as Profile[];
      const userId = currentOwnerId();
      if (userId != null) offlineStore.putProfiles(userId, profiles).catch(() => {});
      return profiles;
    } catch (err) {
      // AppShell renders a full-screen "unable to load your profile" error when this
      // fails, which would make every offline route unreachable regardless of what
      // else is cached.
      const userId = currentOwnerId();
      if (isNetworkFailure(err) && userId != null) {
        const cached = await offlineStore.getProfiles(userId);
        if (cached.length > 0) return cached;
      }
      throw err;
    }
  },
  createProfile: async (body: Partial<Profile>) => {
    const { data, error } = await client.POST('/api/profiles', {
      body: body as never,
    });
    if (error) _throwApiError(error, 'Failed to create profile');
    return data as Profile;
  },
  updateProfile: async (id: number, body: Partial<Profile>) => {
    const { data, error } = await client.PUT('/api/profiles/{profile_id}', {
      params: { path: { profile_id: id } },
      body: body as never,
    });
    if (error) _throwApiError(error, 'Failed to update profile');
    return data as Profile;
  },

  // Prompts
  getDefaultPrompts: async () => {
    const { data, error } = await client.GET('/api/prompts/defaults');
    if (error) _throwApiError(error, 'Failed to get default prompts');
    return data as { parse: string; chat: string };
  },

  // Parse (SSE, stays manual)
  parseStream: (
    data: Record<string, unknown>,
    onToken: (token: string) => void,
    signal?: AbortSignal,
    onReasoning?: (token: string) => void,
  ): Promise<ParseResult> => _streamSse<ParseResult>('/parse/stream', data, onToken, signal, onReasoning),

  // Image extract (vision OCR)
  parseImage: async (body: { profile_id: number; image: string; model: string }) => {
    const res = await fetch('/api/parse/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._getAuthHeaders() },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      const refreshed = await tryRefresh();
      if (refreshed) {
        const retry = await fetch('/api/parse/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ..._getAuthHeaders() },
          body: JSON.stringify(body),
        });
        if (!retry.ok) {
          const errBody = await retry.json().catch(() => ({}));
          throw new Error(_parseApiError(errBody, `Request failed: ${retry.status}`));
        }
        return retry.json() as Promise<{ text: string }>;
      }
      window.dispatchEvent(new CustomEvent('porchsongs-logout'));
      throw new Error('Authentication required. Please log in.');
    }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(_parseApiError(errBody, `Request failed: ${res.status}`));
    }
    return res.json() as Promise<{ text: string }>;
  },

  // File extract (PDF/text, no LLM needed)
  extractFile: async (body: { profile_id: number; file_data: string; filename: string }) => {
    const res = await fetch('/api/parse/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._getAuthHeaders() },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      const refreshed = await tryRefresh();
      if (refreshed) {
        const retry = await fetch('/api/parse/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ..._getAuthHeaders() },
          body: JSON.stringify(body),
        });
        if (!retry.ok) {
          const errBody = await retry.json().catch(() => ({}));
          throw new Error(_parseApiError(errBody, `Request failed: ${retry.status}`));
        }
        return retry.json() as Promise<{ text: string }>;
      }
      window.dispatchEvent(new CustomEvent('porchsongs-logout'));
      throw new Error('Authentication required. Please log in.');
    }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(_parseApiError(errBody, `Request failed: ${res.status}`));
    }
    return res.json() as Promise<{ text: string }>;
  },

  // URL scrape (fetches a chord page the user links to, no LLM needed)
  scrapeUrl: async (body: { profile_id: number; url: string }) => {
    const res = await fetch('/api/parse/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._getAuthHeaders() },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      const refreshed = await tryRefresh();
      if (refreshed) {
        const retry = await fetch('/api/parse/url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ..._getAuthHeaders() },
          body: JSON.stringify(body),
        });
        if (!retry.ok) {
          const errBody = await retry.json().catch(() => ({}));
          throw new Error(_parseApiError(errBody, `Request failed: ${retry.status}`));
        }
        return retry.json() as Promise<UrlScrapeResult>;
      }
      window.dispatchEvent(new CustomEvent('porchsongs-logout'));
      throw new Error('Authentication required. Please log in.');
    }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(_parseApiError(errBody, `Request failed: ${res.status}`));
    }
    return res.json() as Promise<UrlScrapeResult>;
  },

  // Songs
  listSongs: async (profileId?: number) => {
    // openapi-fetch rethrows fetch's raw TypeError on a dead network and never runs
    // its response hooks, so the offline path is a try/catch here rather than
    // anything in the middleware.
    try {
      const { data, error } = await client.GET('/api/songs', {
        params: { query: { profile_id: profileId } },
      });
      if (error) _throwApiError(error, 'Failed to list songs');
      const songs = data as Song[];
      const userId = currentOwnerId();
      // Mirror the whole list. One unpaginated response covers the entire library, so
      // a lazy per-song cache would leave most charts unopenable offline.
      if (userId != null) offlineStore.putSongs(userId, songs).catch(() => {});
      return songs;
    } catch (err) {
      // Only fall back for a genuinely dead network. Doing it on a 401 would show a
      // signed-out user a cached library.
      const userId = currentOwnerId();
      if (isNetworkFailure(err) && userId != null) {
        const cached = await offlineStore.getSongs(userId);
        if (cached.length > 0) return cached;
      }
      throw err;
    }
  },
  renameFolder: async (oldName: string, newName: string) => {
    const { error } = await client.PUT('/api/songs/folders/{folder_name}', {
      params: { path: { folder_name: oldName } },
      body: { name: newName },
    });
    if (error) _throwApiError(error, 'Failed to rename folder');
  },
  deleteFolder: async (folderName: string) => {
    const { error } = await client.DELETE('/api/songs/folders/{folder_name}', {
      params: { path: { folder_name: folderName } },
    });
    if (error) _throwApiError(error, 'Failed to delete folder');
  },
  /**
   * Ask where one chart belongs. Costs an AI credit, so it is only ever called
   * from an explicit tap, never on import or on load. Suggests; does not file.
   */
  suggestFolder: async (songId: number, model: string) => {
    const { data, error } = await client.POST('/api/folders/suggest', {
      body: { song_id: songId, model },
    });
    if (error) _throwApiError(error, 'Failed to suggest a folder');
    return (data as { suggestions: FolderSuggestion[] }).suggestions;
  },
  getSong: async (ref: string) => {
    try {
      const { data, error } = await client.GET('/api/songs/{song_ref}', {
        params: { path: { song_ref: ref } },
      });
      if (error) _throwApiError(error, 'Failed to get song');
      const song = data as Song;
      const userId = currentOwnerId();
      if (userId != null) offlineStore.putSong(userId, song).catch(() => {});
      return song;
    } catch (err) {
      const userId = currentOwnerId();
      if (isNetworkFailure(err) && userId != null) {
        const cached = await offlineStore.getSong(userId, ref);
        if (cached) return cached;
      }
      throw err;
    }
  },
  saveSong: async (body: Partial<Song>) => {
    const { data, error } = await client.POST('/api/songs', {
      body: body as never,
    });
    if (error) _throwApiError(error, 'Failed to save song');
    return data as Song;
  },
  updateSong: async (ref: string, body: Partial<Song>) => {
    const { data, error } = await client.PUT('/api/songs/{song_ref}', {
      params: { path: { song_ref: ref } },
      body: body as never,
    });
    if (error) _throwApiError(error, 'Failed to update song');
    return data as Song;
  },
  deleteSong: async (ref: string) => {
    const { error } = await client.DELETE('/api/songs/{song_ref}', {
      params: { path: { song_ref: ref } },
    });
    if (error) _throwApiError(error, 'Failed to delete song');
    // Drop a kept copy now rather than waiting for the next library sync to notice
    // the row is gone. Deleting a tab and watching the device keep the megabytes is
    // the version of this that gets reported as a bug.
    const userId = currentOwnerId();
    if (userId != null) offlineStore.deleteFile(userId, ref).catch(() => {});
  },
  getSongRevisions: async (ref: string) => {
    const { data, error } = await client.GET('/api/songs/{song_ref}/revisions', {
      params: { path: { song_ref: ref } },
    });
    if (error) _throwApiError(error, 'Failed to get revisions');
    return data as SongRevision[];
  },

  // Chat (SSE, stays manual)
  chatStream: (
    data: Record<string, unknown>,
    onToken: (token: string) => void,
    signal?: AbortSignal,
    onReasoning?: (token: string) => void,
  ): Promise<ChatResult & { version: number }> => _streamSse<ChatResult & { version: number }>('/chat/stream', data, onToken, signal, onReasoning),
  getChatHistory: async (songRef: string) => {
    const { data, error } = await client.GET('/api/songs/{song_ref}/messages', {
      params: { path: { song_ref: songRef } },
    });
    if (error) _throwApiError(error, 'Failed to get chat history');
    return data as ChatHistoryRow[];
  },

  // PDF (uses UUID)
  downloadSongPdf: async (songUuid: string, title: string | null, artist: string | null) => {
    const filename = `${title || 'Untitled'} - ${artist || 'Unknown'}.pdf`;
    let res = await fetch(`/api/songs/${songUuid}/pdf`, { headers: _getAuthHeaders() });
    if (res.status === 401) {
      const refreshed = await tryRefresh();
      if (refreshed) {
        res = await fetch(`/api/songs/${songUuid}/pdf`, { headers: _getAuthHeaders() });
      } else {
        window.dispatchEvent(new CustomEvent('porchsongs-logout'));
        throw new Error('Authentication required. Please log in.');
      }
    }
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    _downloadBlob(await res.blob(), filename);
  },

  /** Upload a tab PDF, creating a document-kind song. */
  uploadDocument: async (
    profileId: number,
    file: File,
    meta: { title?: string; artist?: string; folder?: string } = {},
  ): Promise<Song> => {
    const form = new FormData();
    form.append('profile_id', String(profileId));
    form.append('file', file);
    for (const [key, value] of Object.entries(meta)) {
      if (value) form.append(key, value);
    }
    // No Content-Type header: the browser has to set it, because only it knows the
    // multipart boundary it just generated.
    const res = await _authedFetch('/api/songs/documents', { method: 'POST', body: form });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(detail?.detail ?? `Upload failed: ${res.status}`);
    }
    return (await res.json()) as Song;
  },

  /**
   * Fetch a stored document's bytes.
   *
   * Returned as an ArrayBuffer rather than a URL because the route needs a bearer
   * token, and pdf.js fetching a URL itself would send none.
   *
   * Kept copies are consulted first when `sha256` is supplied. The digest comes
   * from the song row, so a match proves the local bytes are the current ones and
   * the request can be skipped entirely: opening a tab you have kept costs no
   * network at all, which is the point on a stage. A mismatch, or no local copy,
   * falls through to the network, and a dead network falls back to whatever is
   * kept even if the digest disagrees, because a possibly stale tab beats no tab
   * when you are about to play it.
   */
  fetchSongFile: async (songUuid: string, sha256?: string | null): Promise<ArrayBuffer> => {
    const userId = currentOwnerId();
    const cached = userId != null ? await offlineStore.getFile(userId, songUuid) : null;
    if (cached && sha256 && cached.sha256 === sha256) return cached.bytes;
    try {
      const res = await _authedFetch(`/api/songs/${songUuid}/file`);
      if (!res.ok) throw new Error(`Could not load this file: ${res.status}`);
      const bytes = await res.arrayBuffer();
      // Refresh a kept copy that had gone stale. Only ever refreshes one that
      // already exists: fetching a tab is not the same as choosing to keep it.
      if (cached && userId != null && sha256) {
        offlineStore
          .putFile(userId, songUuid, bytes, sha256, res.headers.get('content-type') ?? undefined)
          .catch(() => {});
      }
      return bytes;
    } catch (err) {
      if (isNetworkFailure(err) && cached) return cached.bytes;
      throw err;
    }
  },

  /**
   * Keep a document on this device, downloading it if it is not already here.
   *
   * Explicitly per song, never automatic. The chart mirror is eager because the
   * whole library is a few megabytes of text; a tab collection is hundreds of
   * megabytes, and syncing that on every library visit would be a bug rather than
   * a feature.
   */
  keepSongFileOffline: async (songUuid: string, sha256: string): Promise<void> => {
    const userId = currentOwnerId();
    if (userId == null) throw new Error('Offline storage is unavailable.');
    // Ask the browser not to evict this origin. Without it IndexedDB is
    // best-effort and can be cleared under storage pressure, which for this
    // feature means the tab you kept for tonight is gone tonight. Advisory and
    // may be declined, so nothing depends on the answer.
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* unsupported, or refused. Keeping still works, just evictably. */
    }
    const res = await _authedFetch(`/api/songs/${songUuid}/file`);
    if (!res.ok) throw new Error(`Could not load this file: ${res.status}`);
    await offlineStore.putFile(
      userId,
      songUuid,
      await res.arrayBuffer(),
      sha256,
      res.headers.get('content-type') ?? undefined,
    );
  },

  /** Stop keeping a document. The song stays in the library. */
  forgetSongFileOffline: async (songUuid: string): Promise<void> => {
    const userId = currentOwnerId();
    if (userId == null) return;
    await offlineStore.deleteFile(userId, songUuid);
  },

  /** Which documents are kept on this device. */
  keptSongFiles: async (): Promise<Set<string>> => {
    const userId = currentOwnerId();
    if (userId == null) return new Set();
    return await offlineStore.keptFileUuids(userId);
  },

  /** Total bytes of kept documents on this device. */
  keptSongFilesSize: async (): Promise<number> => {
    const userId = currentOwnerId();
    if (userId == null) return 0;
    return await offlineStore.keptFilesSize(userId);
  },

  /** Download a stored document under its original filename. */
  downloadSongFile: async (songUuid: string, filename: string): Promise<void> => {
    const res = await _authedFetch(`/api/songs/${songUuid}/file`);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    _downloadBlob(await res.blob(), filename);
  },

  // Models (gateway catalog)
  listModels: async (): Promise<string[]> => {
    const { data, error } = await client.GET('/api/models');
    if (error) _throwApiError(error, 'Failed to list models');
    return (data as { models: string[] }).models;
  },
};

export default api;
