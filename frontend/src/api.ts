import type {
  AuthConfig,
  AuthUser,
  ChatHistoryRow,
  ChatResult,
  ParseResult,
  Profile,
  ProviderConnection,
  ProvidersResponse,
  SavedModel,
  Song,
  SongRevision,
} from '@/types';
import client, {
  getAccessToken,
  setAccessToken,
  setRefreshToken,
  tryRefresh,
} from '@/lib/api-client';
import { tryRestoreSession as _tryRestoreSession } from '@/extensions';

// --- Storage keys ---
const STORAGE_KEYS = {
  REFRESH_TOKEN: 'porchsongs_refresh_token',
  CURRENT_SONG_ID: 'porchsongs_current_song_id',
  DRAFT_INPUT: 'porchsongs_draft_input',
  DRAFT_INSTRUCTION: 'porchsongs_draft_instruction',
  SPLIT_PERCENT: 'porchsongs_split_pct',
  WAKE_LOCK: 'porchsongs_wake_lock',
  PROVIDER: 'porchsongs_provider',
  MODEL: 'porchsongs_model',
  REASONING_EFFORT: 'porchsongs_reasoning_effort',
  THEME: 'porchsongs_theme',
  HAS_REWRITTEN: 'porchsongs_has_rewritten',
  LIBRARY_LAYOUT: 'porchsongs_library_layout',
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

function _parseApiError(body: unknown, fallback: string): string {
  const b = body as { detail?: string | { message?: string; error?: string } };
  if (!b.detail) return fallback;

  if (typeof b.detail === 'object') {
    return b.detail.message || b.detail.error || fallback;
  }

  return b.detail;
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
  throw new Error(message);
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
      const err = new Error(message) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');
    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '';
    let result: T | null = null;

    for (;;) {
      const { done, value } = await reader.read();
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
            const err = JSON.parse(payload) as { detail: string | { message?: string; error?: string } };
            const msg = typeof err.detail === 'object'
              ? (err.detail.message || err.detail.error || 'Stream error')
              : (err.detail || 'Stream error');
            throw new Error(msg);
          }
          eventType = '';
        }
      }
    }

    if (!result) throw new Error('Stream ended without result');
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
}

const api = {
  getAuthConfig,
  logout,
  tryRestoreSession: _tryRestoreSession as () => Promise<AuthUser | null>,

  // Profiles
  listProfiles: async () => {
    const { data, error } = await client.GET('/api/profiles');
    if (error) _throwApiError(error, 'Failed to list profiles');
    return data as Profile[];
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
  parseImage: async (body: { profile_id: number; image: string; provider: string; model: string; api_key?: string }) => {
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

  // Songs
  listSongs: async (profileId?: number) => {
    const { data, error } = await client.GET('/api/songs', {
      params: { query: { profile_id: profileId } },
    });
    if (error) _throwApiError(error, 'Failed to list songs');
    return data as Song[];
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
  getSong: async (ref: string) => {
    const { data, error } = await client.GET('/api/songs/{song_ref}', {
      params: { path: { song_ref: ref } },
    });
    if (error) _throwApiError(error, 'Failed to get song');
    return data as Song;
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

  // Profile Models (saved provider+model combos)
  listProfileModels: async (profileId: number) => {
    const { data, error } = await client.GET('/api/profiles/{profile_id}/models', {
      params: { path: { profile_id: profileId } },
    });
    if (error) _throwApiError(error, 'Failed to list models');
    return data as SavedModel[];
  },
  addProfileModel: async (profileId: number, body: { provider: string; model: string }) => {
    const { data, error } = await client.POST('/api/profiles/{profile_id}/models', {
      params: { path: { profile_id: profileId } },
      body,
    });
    if (error) _throwApiError(error, 'Failed to add model');
    return data as SavedModel;
  },
  deleteProfileModel: async (profileId: number, modelId: number) => {
    const { error } = await client.DELETE('/api/profiles/{profile_id}/models/{model_id}', {
      params: { path: { profile_id: profileId, model_id: modelId } },
    });
    if (error) _throwApiError(error, 'Failed to delete model');
  },

  // Provider Connections
  listProviderConnections: async (profileId: number) => {
    const { data, error } = await client.GET('/api/profiles/{profile_id}/connections', {
      params: { path: { profile_id: profileId } },
    });
    if (error) _throwApiError(error, 'Failed to list connections');
    return data as ProviderConnection[];
  },
  addProviderConnection: async (profileId: number, body: { provider: string; api_base?: string }) => {
    const { data, error } = await client.POST('/api/profiles/{profile_id}/connections', {
      params: { path: { profile_id: profileId } },
      body: body as never,
    });
    if (error) _throwApiError(error, 'Failed to add connection');
    return data as ProviderConnection;
  },
  deleteProviderConnection: async (profileId: number, connectionId: number) => {
    const { error } = await client.DELETE('/api/profiles/{profile_id}/connections/{connection_id}', {
      params: { path: { profile_id: profileId, connection_id: connectionId } },
    });
    if (error) _throwApiError(error, 'Failed to delete connection');
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

  // Providers
  listProviders: async () => {
    const { data, error } = await client.GET('/api/providers');
    if (error) _throwApiError(error, 'Failed to list providers');
    return data as ProvidersResponse;
  },
  listProviderModels: async (provider: string, apiBase?: string) => {
    const { data, error } = await client.GET('/api/providers/{provider}/models', {
      params: { path: { provider }, query: { api_base: apiBase } },
    });
    if (error) _throwApiError(error, 'Failed to list models');
    return data as string[];
  },
};

export default api;
