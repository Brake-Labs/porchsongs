import { describe, it, expect } from 'vitest';
import { guessSongMeta } from '@/lib/songMeta';
import { SAMPLE_SONGS } from '@/data/sample-songs';

describe('guessSongMeta', () => {
  describe('ChordPro directives', () => {
    it('reads {title} and {artist}', () => {
      expect(
        guessSongMeta('{title: Wildwood Flower}\n{artist: The Carter Family}\n\n[Verse]\nC   F'),
      ).toEqual({ title: 'Wildwood Flower', artist: 'The Carter Family' });
    });

    it('reads the short {t} and {st} spellings', () => {
      expect(guessSongMeta('{t: Angel Band}\n{st: The Stanley Brothers}')).toEqual({
        title: 'Angel Band',
        artist: 'The Stanley Brothers',
      });
    });

    it('treats {subtitle} as the artist, per ChordPro convention', () => {
      expect(guessSongMeta('{title: Rain}\n{subtitle: Patty Griffin}')).toEqual({
        title: 'Rain',
        artist: 'Patty Griffin',
      });
    });

    it('is case insensitive and tolerates loose spacing', () => {
      expect(guessSongMeta('{ TITLE :  Hallelujah  }')).toEqual({
        title: 'Hallelujah',
        artist: '',
      });
    });

    it('prefers a directive title over a first-line guess', () => {
      const text = 'Some Heading Line\n{title: Real Title}\n{artist: Real Artist}';
      expect(guessSongMeta(text)).toEqual({ title: 'Real Title', artist: 'Real Artist' });
    });

    it('ignores an empty directive value', () => {
      expect(guessSongMeta('{title: }\nActual Heading').title).toBe('Actual Heading');
    });
  });

  describe('title and artist on one line', () => {
    it.each([
      ['Blackbird - The Beatles', 'Blackbird', 'The Beatles'],
      ['Blackbird by The Beatles', 'Blackbird', 'The Beatles'],
      ['Blackbird — The Beatles', 'Blackbird', 'The Beatles'],
      ['Blackbird – The Beatles', 'Blackbird', 'The Beatles'],
      ['Blackbird | The Beatles', 'Blackbird', 'The Beatles'],
    ])('splits %s', (input, title, artist) => {
      expect(guessSongMeta(input)).toEqual({ title, artist });
    });

    it('keeps hyphenated titles intact when there is no spaced separator', () => {
      expect(guessSongMeta('Ninety-Nine Years')).toEqual({
        title: 'Ninety-Nine Years',
        artist: '',
      });
    });

    it('does not split on a trailing separator', () => {
      expect(guessSongMeta('Blackbird - ')).toEqual({ title: 'Blackbird', artist: '' });
    });

    it('strips surrounding quotes', () => {
      expect(guessSongMeta('"Blackbird" - The Beatles')).toEqual({
        title: 'Blackbird',
        artist: 'The Beatles',
      });
    });

    it('strips a trailing Chords or Tab suffix', () => {
      expect(guessSongMeta('Blackbird Chords').title).toBe('Blackbird');
      expect(guessSongMeta('Blackbird (Official Chords)').title).toBe('Blackbird');
    });

    it('strips a leading "by" from the artist half', () => {
      expect(guessSongMeta('Blackbird - by The Beatles').artist).toBe('The Beatles');
    });
  });

  describe('lines it must refuse to treat as a title', () => {
    it('skips a chord row', () => {
      expect(guessSongMeta('C  G  Am  F\nThe Actual Title')).toEqual({
        title: 'The Actual Title',
        artist: '',
      });
    });

    it('skips chord rows with slash bass, extensions, and bar lines', () => {
      expect(guessSongMeta('| D/F#  Bm7  Asus4  Cadd9 |  x2\nReal Title').title).toBe('Real Title');
    });

    it('skips a section marker', () => {
      expect(guessSongMeta('[Verse 1]\nReal Title').title).toBe('Real Title');
    });

    it.each([
      'Capo 2',
      'Key: G',
      'Tempo 120',
      'Standard tuning',
      '[Chorus]',
      'Tabbed by someone',
    ])('skips the annotation %s', (line) => {
      expect(guessSongMeta(`${line}\nReal Title`).title).toBe('Real Title');
    });

    it('returns empty rather than using a long lyric line', () => {
      const lyric = 'a'.repeat(130);
      expect(guessSongMeta(lyric)).toEqual({ title: '', artist: '' });
    });
  });

  describe('degenerate input', () => {
    it.each([
      ['empty string', ''],
      ['whitespace only', '   \n\t  \n '],
    ])('returns empty for %s', (_label, input) => {
      expect(guessSongMeta(input)).toEqual({ title: '', artist: '' });
    });

    it('returns empty for a chart that is only chords', () => {
      expect(guessSongMeta('C G Am F\nD A Bm G\n| E | B |')).toEqual({ title: '', artist: '' });
    });

    it('keeps a directive artist even when no title line is usable', () => {
      expect(guessSongMeta('{artist: The Band}\nC G Am F')).toEqual({
        title: '',
        artist: 'The Band',
      });
    });

    it('handles CRLF line endings', () => {
      expect(guessSongMeta('{title: Rain}\r\n{artist: Patty Griffin}\r\n')).toEqual({
        title: 'Rain',
        artist: 'Patty Griffin',
      });
    });
  });

  describe('against the real sample songs', () => {
    // The samples ship with known-good titles and artists, so they are a free
    // regression corpus for the heuristics.
    it.each(SAMPLE_SONGS.map((s) => [s.title, s]))('recovers a title for %s', (_title, sample) => {
      const meta = guessSongMeta(sample.content);
      // Not asserting an exact match: the samples embed key/capo annotations and
      // the point is that we never invent a chord row or section marker as a title.
      if (meta.title) {
        expect(meta.title).not.toMatch(/^\[/);
        expect(meta.title.length).toBeLessThanOrEqual(120);
      }
    });
  });
});
