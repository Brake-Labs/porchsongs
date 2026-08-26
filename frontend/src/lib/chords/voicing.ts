/**
 * Generate playable chord shapes for an arbitrary tuning.
 *
 * The dictionary covers guitar, ukulele, mandolin, and banjo in several tunings
 * each, and no open dataset covers that set, so shapes are computed rather than
 * looked up. The risk in computing them is well known: a naive enumerator emits
 * shapes that are correct on paper and impossible under a hand. Almost all of
 * the code here is therefore about *ranking*, not about finding notes.
 *
 * The check on that ranking lives in ./voicing.chordsdb.test.ts, which asserts
 * that for guitar and ukulele the shapes we rank first are shapes that appear in
 * a published chord database. That test is the reason to trust this file.
 */

import type { GuitarString, Instrument, Tuning } from './instruments';
import type { Chord } from './theory';

/** A fret number, or null for a string that is not sounded. */
export type Fret = number | null;

export interface Barre {
  fret: number;
  /** Diagram-order string indices the barring finger covers, inclusive. */
  fromString: number;
  toString: number;
  finger: number;
}

export interface Voicing {
  /** One entry per string in diagram order. null means muted. */
  frets: Fret[];
  /** Left-hand finger per string: 1-4, or null for open or muted. */
  fingers: (number | null)[];
  barre: Barre | null;
  /** Lowest fretted fret, i.e. where the diagram window starts. 0 if all open. */
  baseFret: number;
  /** Sounding MIDI notes, ascending. */
  notes: number[];
  /** Lower is better. Exposed for tests and debugging, not for display. */
  score: number;
}

/** Highest fret the generator will reach for. Past this it stops being a chord anyone looks up. */
const MAX_FRET = 12;
/** Hard cap on shapes returned, before the caller trims further. */
const MAX_RESULTS = 8;

/**
 * Which frets a given string may take.
 *
 * `null` (muted) is always allowed; the ranking decides whether muting is worth
 * it. An open string is allowed only when the open note is in the chord, which
 * is what stops the generator emitting shapes with a wrong note ringing.
 */
function candidateFrets(
  string: GuitarString,
  chordPcs: Set<number>,
  windowLo: number,
  windowHi: number,
): Fret[] {
  const out: Fret[] = [null];
  if (chordPcs.has(string.midi % 12)) out.push(0);
  // A short string (the banjo drone) is open or nothing below its anchor: there
  // is no neck under it there. Its anchor fret behaves like that string's nut.
  const anchor = string.shortFrom ?? 0;
  for (let f = Math.max(1, windowLo, anchor); f <= windowHi; f++) {
    if (chordPcs.has((string.midi + f) % 12)) out.push(f);
  }
  return out;
}

/**
 * Walk every combination of per-string choices, pruning branches that can no
 * longer contain every required chord tone.
 *
 * The flat cartesian product is up to 6^6 per fret window and there are twelve
 * windows, which is enough to be felt on a phone. The prune is what makes it
 * cheap: once the strings still to be chosen number fewer than the chord tones
 * still missing, nothing below that branch can be a valid chord.
 */
function walkCombinations(
  options: Fret[][],
  required: number[],
  stringMidis: number[],
  visit: (frets: Fret[]) => void,
): void {
  const frets: Fret[] = new Array<Fret>(options.length).fill(null);

  const recurse = (i: number, missing: Set<number>): void => {
    if (missing.size > options.length - i) return;
    if (i === options.length) {
      if (missing.size === 0) visit([...frets]);
      return;
    }
    for (const choice of options[i]!) {
      frets[i] = choice;
      if (choice === null) {
        recurse(i + 1, missing);
        continue;
      }
      const pc = (stringMidis[i]! + choice) % 12;
      if (missing.has(pc)) {
        const next = new Set(missing);
        next.delete(pc);
        recurse(i + 1, next);
      } else {
        recurse(i + 1, missing);
      }
    }
    frets[i] = null;
  };

  recurse(0, new Set(required));
}

interface Fingering {
  fingers: (number | null)[];
  barre: Barre | null;
  /** Number of fingers the shape needs. More than four means unplayable. */
  count: number;
}

/**
 * Assign left-hand fingers, reaching for a barre only when one is needed.
 *
 * Two rules here do most of the work of keeping generated shapes honest, and
 * both were added after the generator produced shapes that no hand can make:
 *
 * A barre cannot cross an open string. The index finger lying flat at fret 1
 * presses every string it spans, so guitar "103211" (an F with the A string
 * ringing open inside the barre) is not a fingering, it is a diagram. Without
 * this rule it outranked the real F barre chord, because it appears to use
 * fewer fingers.
 *
 * A barre is only used when the shape cannot be fingered without one. Barring
 * is always *possible* wherever the lowest fret repeats, and counting it as one
 * finger made easy open chords look easier still: D (xx0232) came out as a barre
 * chord, which is not how anyone plays or teaches it.
 */
export function assignFingers(frets: Fret[]): Fingering {
  const fretted = frets
    .map((f, i) => ({ f, i }))
    .filter((x): x is { f: number; i: number } => x.f !== null && x.f > 0);

  const fingers: (number | null)[] = frets.map(() => null);
  if (fretted.length === 0) return { fingers, barre: null, count: 0 };

  const minFret = Math.min(...fretted.map(x => x.f));
  const atMin = fretted.filter(x => x.f === minFret);
  const above = fretted.filter(x => x.f > minFret).sort((a, b) => a.f - b.f || a.i - b.i);

  const assignPlain = (): Fingering => {
    let next = 1;
    for (const x of [...atMin, ...above].sort((a, b) => a.f - b.f || a.i - b.i)) {
      fingers[x.i] = Math.min(next++, 4);
    }
    return { fingers, barre: null, count: fretted.length };
  };

  if (fretted.length <= 4 || atMin.length < 2) return assignPlain();

  const from = Math.min(...atMin.map(x => x.i));
  const to = Math.max(...atMin.map(x => x.i));
  for (let i = from; i <= to; i++) {
    // Muted strings under the barre are fine (the finger deadens them). An open
    // string is not: the barre would fret it.
    if (frets[i] === 0) return assignPlain();
  }

  const barre: Barre = { fret: minFret, fromString: from, toString: to, finger: 1 };
  for (const x of atMin) fingers[x.i] = 1;
  let next = 2;
  for (const x of above) fingers[x.i] = Math.min(next++, 4);
  return { fingers, barre, count: 1 + above.length };
}

export interface VoicingOptions {
  /** How many shapes to return. Defaults to MAX_RESULTS. */
  limit?: number;
  /** Highest fret to search. Defaults to MAX_FRET. */
  maxFret?: number;
}

/** Below this, a string is carrying bass rather than just being the lowest of a set. C3. */
const BASS_REGISTER = 48;

/**
 * Whether "is the root in the bass?" is a meaningful question on this instrument.
 *
 * It needs two things, and both were learned from shapes that came out wrong.
 *
 * A string that is both leftmost and lowest. A re-entrant ukulele and a 5-string
 * banjo have neither: standard uke G is 0232, whose lowest sounding note is D.
 * Scoring those on root-in-bass demotes every shape a player would recognise.
 *
 * And that string has to be in bass register. Baritone ukulele and mandolin both
 * have a lowest string that is merely the lowest of four, an octave above a
 * guitar's. Treating D3 as bass made the generator mute it to keep a G chord off
 * its fifth, so baritone G came out as x003 instead of the 0003 in every chart,
 * and mandolin C as a 5th-position chop instead of open. An inversion only reads
 * as an inversion when there is real bass underneath it.
 */
function hasTrueBassString(strings: GuitarString[]): boolean {
  const lowest = Math.min(...strings.map(s => s.midi));
  return strings[0]!.midi === lowest && lowest < BASS_REGISTER;
}

function scoreVoicing(
  frets: Fret[],
  strings: GuitarString[],
  chord: Chord,
  fingering: Fingering,
  optionalMissing: number,
  bassMatters: boolean,
): number {
  const sounding = frets
    .map((f, i) => (f === null ? null : strings[i]!.midi + f))
    .filter((n): n is number => n !== null);

  const frettedFrets = frets.filter((f): f is number => f !== null && f > 0);
  const span = frettedFrets.length ? Math.max(...frettedFrets) - Math.min(...frettedFrets) : 0;
  const baseFret = frettedFrets.length ? Math.min(...frettedFrets) : 0;
  const openCount = frets.filter(f => f === 0).length;

  // Muting is priced by pitch, not by position in the diagram.
  //
  // Skipping the strings below the bass note is ordinary (guitar D is xx0232);
  // silencing a string that sits *above* something already ringing throws away
  // voice for nothing, and a chord dictionary that does it looks broken. Pitch
  // is what separates the two, and position cannot stand in for it here: a
  // re-entrant ukulele's leftmost string is its second highest, and a banjo's
  // leftmost is its highest of all.
  const lowestSounding = sounding.length ? Math.min(...sounding) : Infinity;
  let muteCost = 0;
  for (let i = 0; i < frets.length; i++) {
    if (frets[i] !== null) continue;
    // A drone is not muted so much as not picked. Leaving the banjo's 5th
    // string out of a chord that has no G in it is what every player does, and
    // pricing it as a muted string made D come out as a 7th-fret barre.
    if (strings[i]!.shortFrom !== undefined) muteCost += 0.5;
    // Skipping the low strings is a six-string idiom. On four strings you strum
    // all of them and every one you drop is a quarter of the chord's voice, so
    // there is no cheap mute: baritone uke C came out as x010 rather than the
    // 2010 in every chart, buying one finger with a whole string.
    else if (strings.length < 5) muteCost += 6;
    else muteCost += strings[i]!.midi < lowestSounding ? 1.5 : 6;
  }

  // Muting a string with ringing strings on both sides of it needs a spare
  // fingertip laid across the neck, and is what most separates a shape a person
  // plays from a shape a program found.
  const first = frets.findIndex(f => f !== null);
  const last = frets.length - 1 - [...frets].reverse().findIndex(f => f !== null);
  let innerMuted = 0;
  for (let i = first; i <= last; i++) if (frets[i] === null) innerMuted++;

  let score = 0;
  score += baseFret * 1.6;
  score += span * 2.2;
  score += fingering.count * 1.4;
  score += muteCost;
  score += innerMuted * 14;
  score -= openCount * 1.6;
  score -= sounding.length * 0.6;
  // Dropping the fifth is allowed, but a shape that keeps it should win whenever
  // it costs about the same: uke F7 came out as 2310 rather than the 2313 in
  // every chart, one finger cheaper and a note short.
  score += optionalMissing * 4;
  if (fingering.barre) score += 2;
  if (bassMatters && sounding.length > 0) {
    const lowest = Math.min(...sounding);
    if (lowest % 12 !== chord.root % 12) score += 9;
  }
  return score;
}

/**
 * All the playable shapes for a chord on a tuning, best first.
 *
 * "Best" means: low on the neck, few fingers, open strings ringing, complete,
 * and with the root underneath on instruments that have a bass string. Shapes
 * that need a fifth finger, contain a note outside the chord, or leave out a
 * tone the chord needs are not returned at all.
 */
export function generateVoicings(
  instrument: Instrument,
  tuning: Tuning,
  chord: Chord,
  options: VoicingOptions = {},
): Voicing[] {
  const limit = options.limit ?? MAX_RESULTS;
  const maxFret = options.maxFret ?? MAX_FRET;
  const strings = tuning.strings;
  const bassMatters = hasTrueBassString(strings);

  const required = chord.quality.tones.filter(t => !t.optional).map(t => (chord.root + t.interval) % 12);
  const optional = chord.quality.tones.filter(t => t.optional).map(t => (chord.root + t.interval) % 12);
  const chordPcs = new Set([...required, ...optional]);
  const minSounding = Math.min(3, chord.quality.tones.length);

  const seen = new Set<string>();
  const found: Voicing[] = [];

  const stringMidis = strings.map(s => s.midi);

  for (let lo = 1; lo <= maxFret; lo++) {
    const hi = Math.min(lo + instrument.maxSpan - 1, maxFret);
    const perString = strings.map(s => candidateFrets(s, chordPcs, lo, hi));

    walkCombinations(perString, required, stringMidis, frets => {
      const sounding = frets
        .map((f, i) => (f === null ? null : stringMidis[i]! + f))
        .filter((n): n is number => n !== null);
      if (sounding.length < minSounding) return;

      const key = frets.map(f => (f === null ? 'x' : f)).join('-');
      if (seen.has(key)) return;
      seen.add(key);

      const fingering = assignFingers(frets);
      if (fingering.count > 4) return;

      const pcs = new Set(sounding.map(n => n % 12));
      const optionalMissing = optional.filter(pc => !pcs.has(pc)).length;
      const frettedFrets = frets.filter((f): f is number => f !== null && f > 0);
      found.push({
        frets,
        fingers: fingering.fingers,
        barre: fingering.barre,
        baseFret: frettedFrets.length ? Math.min(...frettedFrets) : 0,
        notes: [...sounding].sort((a, b) => a - b),
        score: scoreVoicing(frets, strings, chord, fingering, optionalMissing, bassMatters),
      });
    });
  }

  found.sort((a, b) => a.score - b.score);
  return dropNearDuplicates(found).slice(0, limit);
}

/**
 * Trim shapes that differ only in how many strings ring.
 *
 * The enumerator will happily return xx0232, xx023x, and xxx232 for a D chord.
 * They are the same shape with fewer strings let through, and listing all three
 * makes the page look like it is padding. Keep the best-scoring member of each
 * fretted-pattern family.
 */
function dropNearDuplicates(voicings: Voicing[]): Voicing[] {
  const seenShapes = new Set<string>();
  const out: Voicing[] = [];
  for (const v of voicings) {
    // Identity is the fretted notes and where they sit; muting or opening extra
    // strings around them does not make a new shape worth showing.
    const shape = v.frets.map(f => (f === null || f === 0 ? '.' : f)).join('-');
    if (seenShapes.has(shape)) continue;
    seenShapes.add(shape);
    out.push(v);
  }
  return out;
}

/** Compact text form, e.g. "x32010" for guitar C, "10-x-9-8" past fret 9. */
export function voicingToString(voicing: Voicing): string {
  const wide = voicing.frets.some(f => f !== null && f >= 10);
  const parts = voicing.frets.map(f => (f === null ? 'x' : String(f)));
  return wide ? parts.join('-') : parts.join('');
}
