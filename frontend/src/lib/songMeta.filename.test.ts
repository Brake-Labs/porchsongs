import { describe, it, expect } from 'vitest';
import { guessFilenameMeta, titleCaseIfFlat } from './songMeta';

describe('guessFilenameMeta', () => {
  it('splits a filename on an explicit separator', () => {
    expect(guessFilenameMeta('Wildwood Flower - Carter Family.pdf')).toEqual({
      title: 'Wildwood Flower',
      artist: 'Carter Family',
    });
  });

  it('reads underscores as spaces', () => {
    expect(guessFilenameMeta('wildwood_flower_-_carter_family.pdf')).toEqual({
      title: 'Wildwood Flower',
      artist: 'Carter Family',
    });
  });

  it('takes a trailing parenthetical as the artist', () => {
    expect(guessFilenameMeta('Blackbird (The Beatles).pdf')).toEqual({
      title: 'Blackbird',
      artist: 'The Beatles',
    });
  });

  it('does not take a chart annotation as the artist', () => {
    // Rejected as an artist, but left in the title: "Capo 2" is a real fact about
    // this chart, and dropping it would lose something the user put there.
    expect(guessFilenameMeta('Blackbird (Capo 2).pdf')).toEqual({
      title: 'Blackbird (Capo 2)',
      artist: '',
    });
    expect(guessFilenameMeta('Blackbird (Key of G).pdf').artist).toBe('');
    expect(guessFilenameMeta('Blackbird (easy).pdf').artist).toBe('');
    // `cleanTitle` already drops this handful outright.
    expect(guessFilenameMeta('Blackbird (Live).pdf')).toEqual({ title: 'Blackbird', artist: '' });
  });

  it('strips a leading track number before splitting', () => {
    // Without the strip this splits on its own separator into "03" by "Blackbird".
    expect(guessFilenameMeta('03 - Blackbird.pdf')).toEqual({ title: 'Blackbird', artist: '' });
    expect(guessFilenameMeta('03. Blackbird.pdf')).toEqual({ title: 'Blackbird', artist: '' });
  });

  it('keeps a number that is part of the title', () => {
    expect(guessFilenameMeta('99 Red Balloons.pdf').title).toBe('99 Red Balloons');
    expect(guessFilenameMeta('1979.pdf').title).toBe('1979');
  });

  it('strips duplicate and version marks', () => {
    expect(guessFilenameMeta('Wildwood Flower (1).pdf').title).toBe('Wildwood Flower');
    expect(guessFilenameMeta('Wildwood Flower_v2.pdf').title).toBe('Wildwood Flower');
    expect(guessFilenameMeta('Wildwood Flower - Copy.pdf').title).toBe('Wildwood Flower');
    expect(guessFilenameMeta('wildwood_flower_v2 (1).pdf').title).toBe('Wildwood Flower');
  });

  it('title-cases a name that arrived with no capitals', () => {
    expect(guessFilenameMeta('the weight of the world.pdf').title).toBe('The Weight of the World');
  });

  it('leaves a name the user capitalised alone', () => {
    expect(guessFilenameMeta('AC-DC.pdf').title).toBe('AC-DC');
    expect(guessFilenameMeta('Wildwood flower.pdf').title).toBe('Wildwood flower');
  });

  it('title-cases an all-lowercase name even when the act spells it that way', () => {
    // The known cost of the flat-name rule. An all-lowercase filename is a sloppy
    // filename far more often than it is k.d. lang, and the tidy screen shows
    // every row for editing before anything is written.
    expect(guessFilenameMeta('k.d. lang.pdf').title).toBe('K.d. Lang');
  });

  it('reads dots as spaces only in the download-site shape', () => {
    expect(guessFilenameMeta('Wildwood.Flower.Carter.Family.pdf').title)
      .toBe('Wildwood Flower Carter Family');
    // One dot and no spaces is an abbreviation, not a separator.
    expect(guessFilenameMeta('Mr.Bojangles.pdf').title).toBe('Mr.Bojangles');
  });

  it('gives no artist when the filename has no structure', () => {
    // The tidy screen tries the user's own artist list on this; the parser will
    // not invent a split that the filename does not contain.
    expect(guessFilenameMeta('wildwood flower carter family.pdf')).toEqual({
      title: 'Wildwood Flower Carter Family',
      artist: '',
    });
  });

  it('returns empty for a filename with nothing in it', () => {
    expect(guessFilenameMeta('')).toEqual({ title: '', artist: '' });
    expect(guessFilenameMeta('.pdf')).toEqual({ title: '', artist: '' });
  });
});

describe('titleCaseIfFlat', () => {
  it('capitalises a flat string and keeps small words down', () => {
    expect(titleCaseIfFlat('a hard rain is gonna fall')).toBe('A Hard Rain Is Gonna Fall');
    expect(titleCaseIfFlat('the weight of the world')).toBe('The Weight of the World');
  });

  it('leaves anything with a capital in it untouched', () => {
    expect(titleCaseIfFlat('AC/DC')).toBe('AC/DC');
    expect(titleCaseIfFlat('Wildwood flower')).toBe('Wildwood flower');
  });

  it('capitalises a small word at either end', () => {
    expect(titleCaseIfFlat('the end')).toBe('The End');
  });
});
