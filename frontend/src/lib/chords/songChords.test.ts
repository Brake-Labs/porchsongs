import { chordName } from './theory';
import { chordsUsedIn, MAX_SONG_CHORDS } from './songChords';

const names = (text: string): string[] => chordsUsedIn(text).map(chordName);

describe('chordsUsedIn', () => {
  it('reads chords bracketed inline with the words', () => {
    const song = [
      '[Verse 1]',
      '[G]Amazing grace how [C]sweet the sound',
      'That [G]saved a wretch like [D7]me',
    ].join('\n');

    expect(names(song)).toEqual(['G', 'C', 'D7']);
  });

  it('reads chords written on their own line above the words', () => {
    const song = [
      '[Chorus]',
      'G           C        G',
      'Oh I will twine with my mingled waves',
      'D                    G',
      'And the pale aronatus',
    ].join('\n');

    expect(names(song)).toEqual(['G', 'C', 'D']);
  });

  it('keeps section markers out', () => {
    // Every bracketed token is offered to the parser, so the only thing keeping
    // "[Verse 1]" from becoming a chord is that it does not parse as one.
    const song = ['[Intro]', '[Verse 1]', '[Chorus]', '[Bridge]', '[Outro]', '[G]words'].join('\n');

    expect(names(song)).toEqual(['G']);
  });

  it('does not mistake lyrics for chords', () => {
    // A capital A at the start of a line is a chord in a chord row and an
    // article in a sentence. Only lines the classifier calls chord rows are
    // read, which is what tells the two apart.
    const song = [
      'A long time ago in a town far away',
      'B side of the record, C level effort',
      'E everyone sang',
    ].join('\n');

    expect(names(song)).toEqual([]);
  });

  it('reports each chord once, in the order it first appears', () => {
    const song = '[D]one [A]two [D]three [G]four [A]five';

    expect(names(song)).toEqual(['D', 'A', 'G']);
  });

  it('reads a chart that uses both formats at once', () => {
    // A "Chords used" row at the top and bracketed chords in the body. Running
    // one pass as a fallback for the other would drop half of this.
    const song = [
      'Key: G',
      'Am  F  C  G',
      '',
      '[Verse]',
      '[Am]Hello [F]darkness my [C]old friend',
    ].join('\n');

    expect(names(song)).toEqual(['Am', 'F', 'C', 'G']);
  });

  it('strips the parentheses a chord row sometimes wears', () => {
    const song = ['(G)      (C)      (D)', 'Words underneath the chords'].join('\n');

    expect(names(song)).toEqual(['G', 'C', 'D']);
  });

  it('stops at a readable number rather than listing everything', () => {
    // The row is a shortcut, not an inventory.
    const many = Array.from({ length: 40 }, (_, i) => `[${'CDEFGAB'[i % 7]!}${i % 2 ? 'm7' : 'maj7'}]x`).join(' ');

    expect(chordsUsedIn(many).length).toBeLessThanOrEqual(MAX_SONG_CHORDS);
  });

  it('reports chords in the order they appear, not one format before the other', () => {
    // The value of the first entry is not academic: it is the chord the panel
    // opens on. Reading every bracketed chord before every chord row put a
    // chorus ahead of the intro on any chart that mixes the two.
    const song = [
      'G       C       D',
      'Words underneath the chords',
      '',
      '[Verse 2]',
      '[Am]Later [F]on in the song',
    ].join('\n');

    expect(names(song)).toEqual(['G', 'C', 'D', 'Am', 'F']);
  });

  it("reads a chart's own \"Chords used\" legend", () => {
    // normalizeSong files this as metadata, which is right for Follow and wrong
    // here: it is the one line where a chart lists its chords on purpose.
    const song = [
      'Chords used: G C D Em',
      '',
      '[Verse]',
      'G       C',
      'the words',
    ].join('\n');

    expect(names(song)).toEqual(['G', 'C', 'D', 'Em']);
  });

  it('survives a bracketed token that names something on Object.prototype', () => {
    // Every bracketed token is handed to the parser, and a chart is arbitrary
    // text. This runs inside a useMemo during the play route's render, so a
    // throw here is a blank screen rather than a missing pill.
    expect(names('[GtoString]words [G]real')).toEqual(['G']);
  });

  it('returns nothing for an empty or wordless chart', () => {
    expect(chordsUsedIn('')).toEqual([]);
    expect(chordsUsedIn('   \n\n  ')).toEqual([]);
  });
});
