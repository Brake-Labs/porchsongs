import type { SetStateAction } from 'react';
import type { ChatMessage, RewriteMeta, RewriteResult, Song } from '@/types';

/** The song open in the workshop, and everything about it that outlives the tab. */
export interface WorkshopState {
  rewriteResult: RewriteResult | null;
  rewriteMeta: RewriteMeta | null;
  /** Integer id for chat requests, UUID for routing and storage. */
  currentSongId: number | null;
  currentSongUuid: string | null;
  chatMessages: ChatMessage[];
  songTitle: string;
  songArtist: string;
  /** Unsaved edits to the current song. */
  isDirty: boolean;
}

export type WorkshopAction =
  /** Open a saved song: content, meta, title and identity swap together. */
  | { type: 'loadSong'; song: Song }
  /** Replace the rewrite. `null` clears the workshop back to a blank song. */
  | { type: 'newRewrite'; result: RewriteResult | null; meta: RewriteMeta | null }
  /** The song now has (or no longer has) a saved identity. */
  | { type: 'setCurrentSong'; song: Song | null }
  | { type: 'setRewriteResult'; update: SetStateAction<RewriteResult | null> }
  | { type: 'setChatMessages'; update: SetStateAction<ChatMessage[]> }
  | { type: 'setSongTitle'; update: SetStateAction<string> }
  | { type: 'setSongArtist'; update: SetStateAction<string> }
  | { type: 'setIsDirty'; update: SetStateAction<boolean> }
  /** A parse finished: its title and artist seed the workshop. */
  | { type: 'parsed'; title: string; artist: string };

export function initialWorkshopState(currentSongUuid: string | null): WorkshopState {
  return {
    rewriteResult: null,
    rewriteMeta: null,
    currentSongId: null,
    currentSongUuid,
    chatMessages: [],
    songTitle: '',
    songArtist: '',
    isDirty: false,
  };
}

/** How a saved song reads into the workshop. */
export function songToWorkshop(song: Song): { rewriteResult: RewriteResult; rewriteMeta: RewriteMeta } {
  return {
    rewriteResult: {
      original_content: song.original_content,
      rewritten_content: song.rewritten_content,
      changes_summary: song.changes_summary || '',
    },
    rewriteMeta: {
      title: song.title ?? undefined,
      artist: song.artist ?? undefined,
      source_url: song.source_url ?? undefined,
      profile_id: song.profile_id,
      llm_provider: song.llm_provider ?? undefined,
      llm_model: song.llm_model ?? undefined,
    },
  };
}

function apply<T>(update: SetStateAction<T>, prev: T): T {
  return typeof update === 'function' ? (update as (p: T) => T)(prev) : update;
}

/** Set one field, keeping the same state object (no re-render) when nothing changed. */
function set<K extends keyof WorkshopState>(
  state: WorkshopState,
  key: K,
  update: SetStateAction<WorkshopState[K]>,
): WorkshopState {
  const next = apply(update, state[key]);
  return Object.is(next, state[key]) ? state : { ...state, [key]: next };
}

/** Identity change. Unsaved edits belong to the song they were made on. */
function withSong(state: WorkshopState, id: number | null, uuid: string | null): WorkshopState {
  if (state.currentSongId === id && state.currentSongUuid === uuid) return state;
  return {
    ...state,
    currentSongId: id,
    currentSongUuid: uuid,
    isDirty: state.currentSongUuid === uuid ? state.isDirty : false,
  };
}

export function workshopReducer(state: WorkshopState, action: WorkshopAction): WorkshopState {
  switch (action.type) {
    case 'loadSong': {
      const { rewriteResult, rewriteMeta } = songToWorkshop(action.song);
      return {
        ...withSong(state, action.song.id, action.song.uuid),
        rewriteResult,
        rewriteMeta,
        // History for this song is fetched separately; never show the last one's.
        chatMessages: [],
        songTitle: action.song.title ?? '',
        songArtist: action.song.artist ?? '',
        isDirty: false,
      };
    }
    case 'newRewrite':
      if (!action.result) {
        return { ...initialWorkshopState(null), rewriteMeta: action.meta };
      }
      return {
        ...state,
        rewriteResult: action.result,
        rewriteMeta: action.meta,
        ...(action.meta && { songTitle: action.meta.title ?? '', songArtist: action.meta.artist ?? '' }),
      };
    case 'setCurrentSong':
      return withSong(state, action.song?.id ?? null, action.song?.uuid ?? null);
    case 'setRewriteResult':
      return set(state, 'rewriteResult', action.update);
    case 'setChatMessages':
      return set(state, 'chatMessages', action.update);
    case 'setSongTitle':
      return set(state, 'songTitle', action.update);
    case 'setSongArtist':
      return set(state, 'songArtist', action.update);
    case 'setIsDirty':
      return set(state, 'isDirty', action.update);
    case 'parsed':
      return { ...state, songTitle: action.title, songArtist: action.artist };
  }
}
