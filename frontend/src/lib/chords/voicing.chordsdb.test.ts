/**
 * Cross-check the generated shapes against a published chord database.
 *
 * Every shape this app draws is computed (see ./voicing.ts for why: nothing open
 * covers mandolin and banjo, let alone alternate tunings). Computed shapes need
 * an outside opinion, and `@tombatossals/chords-db` is that opinion for the two
 * instruments it does cover. It is a devDependency: nothing here ships.
 *
 * What this test is and is not. It is a regression floor on ranking quality, so
 * that a scoring change which starts emitting odd shapes fails CI. It is not an
 * equality check, and the thresholds are deliberately below the measured rates,
 * because the two disagree for reasons that are not bugs:
 *
 *   - chords-db has gaps. It lists no x32000 for Cmaj7, which is the shape in
 *     every beginner book.
 *   - We add open chord tones it leaves out. Its C#m is x4212x; ours is x42120,
 *     the same fingering with the high E ringing.
 *   - We refuse rootless voicings (see theory.ts). Its ukulele C9 is 0201, which
 *     contains no C. In a dictionary that is a lookup result nobody can use.
 *   - It orders positions up the neck; we rank open positions first. Its first
 *     C#m7 is a 4th-position barre, ours is x42100.
 *
 * The specific shapes people actually look up are pinned exactly, by hand, in
 * ./voicing.test.ts. That is the test that fails when ranking gets worse in a
 * way that matters; this one is the broad net.
 */

import guitarDb from '@tombatossals/chords-db/lib/guitar.json';
import ukuleleDb from '@tombatossals/chords-db/lib/ukulele.json';
import { findInstrument, findTuning } from './instruments';
import { generateVoicings } from './voicing';
import { CHORD_QUALITIES, ROOT_PITCH_CLASSES, chordName } from './theory';

/** chords-db groups chords under these keys, spelling sharps out. */
const DB_GROUPS = ['C', 'Csharp', 'D', 'Eb', 'E', 'F', 'Fsharp', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Our suffix to theirs. Omitted entries (like "5") have no counterpart there. */
const DB_SUFFIX: Record<string, string> = {
  '': 'major', m: 'minor', '7': '7', m7: 'm7', maj7: 'maj7', sus2: 'sus2', sus4: 'sus4',
  '6': '6', m6: 'm6', add9: 'add9', '9': '9', dim: 'dim', aug: 'aug', '7sus4': '7sus4',
  m7b5: 'm7b5', dim7: 'dim7', mmaj7: 'mmaj7', madd9: 'madd9', maj9: 'maj9', m9: 'm9',
  '11': '11', '13': '13', '7b5': '7b5', '7#5': 'aug7', '7b9': '7b9', '7#9': '7#9', '6/9': '69',
};

interface DbPosition {
  frets: number[];
  baseFret: number;
}

/**
 * chords-db stores frets relative to `baseFret`, with -1 for muted and 0 for
 * open. Normalise to absolute fret numbers so the two can be compared.
 */
function toAbsolute(position: DbPosition): string {
  return position.frets
    .map(f => (f === -1 ? 'x' : f === 0 ? '0' : String(f + position.baseFret - 1)))
    .join('-');
}

/** Same fretted pattern, ignoring whether untouched strings ring or are damped. */
function shapeOf(key: string): string {
  return key.split('-').map(f => (f === 'x' || f === '0' ? '.' : f)).join('-');
}

interface Agreement {
  checked: number;
  /** Chords where one of our shapes is one chords-db publishes. */
  anyMatch: number;
  /** Chords where chords-db's first shape is among ours, compared by fretted pattern. */
  theirFirstFound: number;
  /**
   * Chords where the shape we show *first* is one chords-db publishes.
   *
   * The strict one, and the one that matters most: the page offers several
   * shapes easiest-first, so most people read the first and stop. The two
   * measures above are satisfied by a good shape being somewhere in eight, which
   * is a much easier bar and looks away from the only shape most people see.
   */
  topMatch: number;
}

function measure(db: typeof guitarDb, instrumentSlug: string, tuningSlug: string): Agreement {
  const instrument = findInstrument(instrumentSlug)!;
  const tuning = findTuning(instrument, tuningSlug)!;
  const result: Agreement = { checked: 0, anyMatch: 0, theirFirstFound: 0, topMatch: 0 };

  for (const root of ROOT_PITCH_CLASSES) {
    for (const quality of CHORD_QUALITIES) {
      if (!quality.common) continue;
      const dbSuffix = DB_SUFFIX[quality.suffix];
      if (!dbSuffix) continue;

      const group = (db.chords as Record<string, { suffix: string; positions: DbPosition[] }[]>)[DB_GROUPS[root]!];
      const entry = group?.find(c => c.suffix === dbSuffix);
      if (!entry?.positions.length) continue;

      const ours = generateVoicings(instrument, tuning, { root, quality })
        .map(v => v.frets.map(f => (f === null ? 'x' : String(f))).join('-'));
      if (!ours.length) continue;

      const theirs = entry.positions.map(toAbsolute);
      result.checked++;
      if (ours.some(o => theirs.includes(o))) result.anyMatch++;
      if (ours.map(shapeOf).includes(shapeOf(theirs[0]!))) result.theirFirstFound++;
      if (theirs.includes(ours[0]!)) result.topMatch++;
    }
  }
  return result;
}

describe('agreement with a published chord database', () => {
  // Measured when written: guitar 79% / 74% / 44%, ukulele 92% / 92% / 78%. The
  // floors sit below that so ordinary scoring tweaks do not fail the build,
  // while a change that makes the generator produce odd shapes does.
  //
  // The top-shape figure is much lower than the other two, and most of that gap
  // is the four reasons in this file's header rather than bad shapes: chords-db
  // lists about four positions per chord and orders them up the neck, while we
  // rank open positions first and add open chord tones it leaves out. A guitar
  // has far more than four valid voicings for most chords. It is still the
  // number worth watching, because it is the only one of the three that
  // constrains the shape a reader actually sees, so it gets its own floor.
  it.each([
    { label: 'guitar', db: guitarDb, instrument: 'guitar', tuning: 'standard', anyMatch: 0.7, theirFirst: 0.65, top: 0.4 },
    { label: 'ukulele', db: ukuleleDb, instrument: 'ukulele', tuning: 'standard', anyMatch: 0.85, theirFirst: 0.85, top: 0.72 },
  ])('$label shapes mostly appear in the published set', ({ db, instrument, tuning, anyMatch, theirFirst, top }) => {
    const r = measure(db as typeof guitarDb, instrument, tuning);
    expect(r.checked).toBeGreaterThan(100);
    expect(r.anyMatch / r.checked).toBeGreaterThanOrEqual(anyMatch);
    expect(r.theirFirstFound / r.checked).toBeGreaterThanOrEqual(theirFirst);
    expect(r.topMatch / r.checked, 'top-ranked shape agreement').toBeGreaterThanOrEqual(top);
  });

  it('agrees on the open chords a beginner learns first', () => {
    // No threshold here: for the chords that carry the page, our top shape must
    // be one somebody published, exactly.
    const cases: [string, string, string][] = [
      ['guitar', 'C', 'x-3-2-0-1-0'],
      ['guitar', 'A', 'x-0-2-2-2-0'],
      ['guitar', 'G', '3-2-0-0-0-3'],
      ['guitar', 'E', '0-2-2-1-0-0'],
      ['guitar', 'D', 'x-x-0-2-3-2'],
      ['guitar', 'Am', 'x-0-2-2-1-0'],
      ['guitar', 'Em', '0-2-2-0-0-0'],
      ['guitar', 'Dm', 'x-x-0-2-3-1'],
      ['ukulele', 'C', '0-0-0-3'],
      ['ukulele', 'F', '2-0-1-0'],
      ['ukulele', 'G', '0-2-3-2'],
      ['ukulele', 'Am', '2-0-0-0'],
    ];

    for (const [instrumentSlug, name, expected] of cases) {
      const db = instrumentSlug === 'guitar' ? guitarDb : ukuleleDb;
      const root = ROOT_PITCH_CLASSES.find(pc => chordName({ root: pc, quality: CHORD_QUALITIES[0]! }) === name.replace(/m$/, ''))!;
      const quality = CHORD_QUALITIES.find(q => q.suffix === (name.endsWith('m') ? 'm' : ''))!;
      const instrument = findInstrument(instrumentSlug)!;
      const ours = generateVoicings(instrument, findTuning(instrument, 'standard')!, { root, quality });
      const oursTop = ours[0]!.frets.map(f => (f === null ? 'x' : String(f))).join('-');

      const group = (db.chords as Record<string, { suffix: string; positions: DbPosition[] }[]>)[DB_GROUPS[root]!];
      const entry = group!.find(c => c.suffix === (quality.suffix === 'm' ? 'minor' : 'major'))!;
      const theirs = entry.positions.map(toAbsolute);

      expect(oursTop, `${instrumentSlug} ${name}`).toBe(expected);
      expect(theirs, `${instrumentSlug} ${name} should be published`).toContain(expected);
    }
  });
});
