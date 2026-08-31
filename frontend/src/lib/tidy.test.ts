import { describe, it, expect } from 'vitest';
import {
  buildProposals,
  findKnownArtistIn,
  hasChange,
  knownArtistNames,
  matchKnownArtist,
} from './tidy';
import type { Song } from '@/types';

let nextId = 1;

function makeSong(overrides: Partial<Song> = {}): Song {
  const id = nextId++;
  return {
    id,
    uuid: `uuid-${id}`,
    user_id: 1,
    profile_id: 1,
    kind: 'chart',
    title: 'Salt Creek',
    artist: null,
    original_content: 'G C G',
    rewritten_content: 'G C G',
    changes_summary: null,
    source_url: null,
    tags: [],
    font_size: null,
    status: 'ready',
    current_version: 1,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
    file: null,
    ...overrides,
  } as Song;
}

function makeDocument(filename: string, overrides: Partial<Song> = {}): Song {
  return makeSong({
    kind: 'document',
    // What `upload_document` stores: the filename minus its extension.
    title: filename.replace(/\.pdf$/i, ''),
    original_content: '',
    rewritten_content: '',
    file: {
      filename,
      content_type: 'application/pdf',
      size_bytes: 1024,
      page_count: 2,
      sha256: 'a'.repeat(64),
    },
    ...overrides,
  } as Partial<Song>);
}

describe('knownArtistNames', () => {
  it('collects distinct artists, longest name first', () => {
    const names = knownArtistNames([
      makeSong({ artist: 'Neil Young' }),
      makeSong({ artist: 'neil young' }),
      makeSong({ artist: 'Neil Young & Crazy Horse' }),
      makeSong({ artist: null }),
      makeSong({ artist: '   ' }),
    ]);
    expect(names).toEqual(['Neil Young & Crazy Horse', 'Neil Young']);
  });
});

describe('matchKnownArtist', () => {
  const known = ['Neil Young & Crazy Horse', 'Carter Family', 'Neil Young', 'Sun'];

  it('takes an artist off the end and keeps the rest as the title', () => {
    expect(matchKnownArtist('Wildwood Flower Carter Family', known)).toEqual({
      artist: 'Carter Family',
      remainder: 'Wildwood Flower',
    });
  });

  it('takes an artist off the front', () => {
    expect(matchKnownArtist('Carter Family Wildwood Flower', known)).toEqual({
      artist: 'Carter Family',
      remainder: 'Wildwood Flower',
    });
  });

  it('prefers the longer of two names that both match', () => {
    expect(matchKnownArtist('Powderfinger Neil Young & Crazy Horse', known)?.artist)
      .toBe('Neil Young & Crazy Horse');
  });

  it('ignores an artist buried in the middle', () => {
    expect(matchKnownArtist('Song For Carter Family Tonight', known)).toBeNull();
  });

  it('will not consume the whole title', () => {
    expect(matchKnownArtist('Carter Family', known)).toBeNull();
  });

  it('ignores a short single-word artist that is also an ordinary word', () => {
    expect(matchKnownArtist('Here Comes The Sun', known)).toBeNull();
  });

  it('matches across punctuation differences', () => {
    expect(matchKnownArtist('Wildwood Flower - Carter-Family', known)?.artist)
      .toBe('Carter Family');
  });
});

describe('findKnownArtistIn', () => {
  it('finds a whole-phrase match anywhere in the text', () => {
    expect(findKnownArtistIn('Trad. arr. Carter Family\nCapo 2', ['Carter Family']))
      .toBe('Carter Family');
  });

  it('does not match a fragment of a longer word', () => {
    expect(findKnownArtistIn('Sunshine on my shoulders', ['Sun'])).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(findKnownArtistIn('   ', ['Carter Family'])).toBeNull();
  });
});

describe('buildProposals', () => {
  it('only proposes for songs with no artist', () => {
    const proposals = buildProposals([
      makeSong({ title: 'Salt Creek', artist: 'Bill Monroe' }),
      makeSong({ title: 'Shady Grove', artist: null }),
      makeSong({ title: 'Cluck Old Hen', artist: '  ' }),
    ]);
    expect(proposals.map(p => p.song.title)).toEqual(['Cluck Old Hen', 'Shady Grove']);
  });

  it('reads a document artist out of its filename', () => {
    const [proposal] = buildProposals([
      makeDocument('Wildwood Flower - Carter Family.pdf'),
    ]);
    expect(proposal).toMatchObject({
      title: 'Wildwood Flower',
      artist: 'Carter Family',
      titleSource: 'filename',
      artistSource: 'filename',
      evidence: 'Wildwood Flower - Carter Family.pdf',
    });
  });

  it('uses the library to split a filename that has no separator', () => {
    const [proposal] = buildProposals([
      makeSong({ title: 'Keep On The Sunny Side', artist: 'Carter Family' }),
      makeDocument('wildwood_flower_carter_family_v2 (1).pdf'),
    ]);
    expect(proposal).toMatchObject({
      title: 'Wildwood Flower',
      artist: 'Carter Family',
      artistSource: 'library',
    });
  });

  it('finds a known artist credited at the top of a chart', () => {
    const [proposal] = buildProposals([
      makeSong({ title: 'Keep On The Sunny Side', artist: 'Carter Family' }),
      makeSong({
        title: 'Wildwood Flower',
        artist: null,
        rewritten_content: 'Trad. arr. Carter Family\nCapo 2\n\n[Verse]\nG   C   G',
      }),
    ]);
    expect(proposal).toMatchObject({ artist: 'Carter Family', artistSource: 'library' });
  });

  it('leaves a song alone when nothing is found', () => {
    const [proposal] = buildProposals([makeSong({ title: 'Shady Grove', artist: null })]);
    expect(proposal).toMatchObject({
      title: 'Shady Grove',
      artist: '',
      titleSource: null,
      artistSource: null,
    });
    expect(hasChange(proposal!)).toBe(false);
  });

  it('puts rows with an artist first and rows with nothing last', () => {
    const proposals = buildProposals([
      makeSong({ title: 'Shady Grove', artist: null }),
      makeDocument('wildwood flower - carter family.pdf'),
      makeDocument('blackbird_the_beatles.pdf'),
      makeSong({ title: 'Keep On The Sunny Side', artist: 'The Beatles' }),
    ]);
    // Both resolved rows lead, alphabetically by the title being proposed, and
    // the row with nothing to show sinks to the bottom.
    expect(proposals.map(p => p.title)).toEqual([
      'Blackbird',
      'Wildwood Flower',
      'Shady Grove',
    ]);
    expect(proposals.map(p => p.artistSource)).toEqual(['library', 'filename', null]);
  });

  it('sorts a tie by the title being proposed, not the one being replaced', () => {
    const proposals = buildProposals([
      makeDocument('zz_top_song - Alpha Band.pdf'),
      makeDocument('aa_first_file - Beta Band.pdf'),
    ]);
    expect(proposals.map(p => p.title)).toEqual(['Aa First File', 'Zz Top Song']);
  });

  it('never re-titles a chart that already has a title', () => {
    // The first prose line of the lyrics is what `guessSongMeta` would return,
    // and offering it over a title the user can see would be a downgrade.
    const [proposal] = buildProposals([
      makeSong({
        title: 'Caleb Meyer',
        artist: null,
        rewritten_content: 'He lived alone upon the ridge\nG   C   D',
      }),
    ]);
    expect(proposal).toMatchObject({ title: 'Caleb Meyer', titleSource: null });
  });

  it('titles a chart that has none', () => {
    const [proposal] = buildProposals([
      makeSong({ title: null, artist: null, rewritten_content: '{title: Caleb Meyer}\nG C D' }),
    ]);
    expect(proposal).toMatchObject({ title: 'Caleb Meyer', titleSource: 'chart' });
  });

  it('leaves a document title the user has already fixed', () => {
    const song = makeDocument('wildwood_flower_carter_family.pdf');
    const [proposal] = buildProposals([
      makeSong({ title: 'Keep On The Sunny Side', artist: 'Carter Family' }),
      { ...song, title: 'Wildwood Flower' } as Song,
    ]);
    // The artist is still worth finding; the title is the user's and stays put.
    expect(proposal).toMatchObject({
      title: 'Wildwood Flower',
      titleSource: null,
      artist: 'Carter Family',
      artistSource: 'library',
    });
  });

  it('does not propose a title for a document whose filename adds nothing', () => {
    const [proposal] = buildProposals([makeDocument('Shady Grove.pdf')]);
    expect(proposal).toMatchObject({ title: 'Shady Grove', titleSource: null, artistSource: null });
  });
});
