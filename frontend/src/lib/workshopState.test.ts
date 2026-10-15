import { initialWorkshopState, songToWorkshop, workshopReducer, type WorkshopState } from '@/lib/workshopState';
import type { Song } from '@/types';

const song = (id: number, extra: Partial<Song> = {}): Song => ({
  id,
  uuid: `uuid-${id}`,
  profile_id: 1,
  title: `Song ${id}`,
  artist: 'Someone',
  source_url: null,
  original_content: `original ${id}`,
  rewritten_content: `rewritten ${id}`,
  changes_summary: null,
  llm_provider: null,
  llm_model: 'm',
  ...extra,
}) as Song;

function editing(state: WorkshopState): WorkshopState {
  return {
    ...state,
    chatMessages: [{ role: 'user', content: 'hi' }],
    songTitle: 'edited',
    isDirty: true,
  };
}

describe('songToWorkshop', () => {
  it('maps nullable song fields to the workshop shape', () => {
    expect(songToWorkshop(song(1, { title: null, changes_summary: null }))).toEqual({
      rewriteResult: { original_content: 'original 1', rewritten_content: 'rewritten 1', changes_summary: '' },
      rewriteMeta: {
        title: undefined,
        artist: 'Someone',
        source_url: undefined,
        profile_id: 1,
        llm_provider: undefined,
        llm_model: 'm',
      },
    });
  });
});

describe('workshopReducer', () => {
  it('opens a song in one step, dropping the previous song\'s chat and edits', () => {
    const before = editing(workshopReducer(initialWorkshopState(null), { type: 'loadSong', song: song(1) }));
    const after = workshopReducer(before, { type: 'loadSong', song: song(2) });

    expect(after).toMatchObject({
      currentSongId: 2,
      currentSongUuid: 'uuid-2',
      rewriteResult: { rewritten_content: 'rewritten 2' },
      songTitle: 'Song 2',
      chatMessages: [],
      isDirty: false,
    });
  });

  it('keeps unsaved edits when the same song gets its saved identity again', () => {
    const open = editing(workshopReducer(initialWorkshopState(null), { type: 'loadSong', song: song(1) }));
    expect(workshopReducer(open, { type: 'setCurrentSong', song: song(1) }).isDirty).toBe(true);
    expect(workshopReducer(open, { type: 'setCurrentSong', song: song(2) }).isDirty).toBe(false);
  });

  it('clears everything for a new song', () => {
    const open = editing(workshopReducer(initialWorkshopState(null), { type: 'loadSong', song: song(1) }));
    expect(workshopReducer(open, { type: 'newRewrite', result: null, meta: null })).toEqual(initialWorkshopState(null));
  });

  it('takes the title and artist from new rewrite meta', () => {
    const next = workshopReducer(initialWorkshopState(null), {
      type: 'newRewrite',
      result: { original_content: 'a', rewritten_content: 'b', changes_summary: '' },
      meta: { title: 'T', artist: 'A' },
    });
    expect(next).toMatchObject({ songTitle: 'T', songArtist: 'A' });
  });

  it('applies functional updates against the current state', () => {
    const open = workshopReducer(initialWorkshopState(null), { type: 'loadSong', song: song(1) });
    const next = workshopReducer(open, {
      type: 'setRewriteResult',
      update: prev => (prev ? { ...prev, rewritten_content: 'changed' } : prev),
    });
    expect(next.rewriteResult).toMatchObject({ original_content: 'original 1', rewritten_content: 'changed' });
  });
});
