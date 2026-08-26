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
  /**
   * False when no hand can make this shape, whatever the finger count.
   *
   * Distinct from `count > 4`. A shape can need only four fingers and still be
   * impossible, because fingers cannot reach around each other.
   */
  playable: boolean;
}


/**
 * Frets where two notes must be taken by one flat finger rather than two.
 *
 * Two fingertips can sit on the same fret several strings apart, which is how
 * anyone plays G (320003, middle and ring at the 3rd fret across all six
 * strings). What they cannot do is reach *around* a finger that is further up
 * the neck between them: to fret the 1st fret of the high E while the ring and
 * pinky hold the 3rd fret of the G and B strings, the finger would have to
 * approach from behind the others. Only a flat index finger covers that, and
 * only across a gap wider than a hand can arch over, which is why a narrow gap
 * is exempt (guitar D, xx0232, arches over the B string).
 *
 * How narrow depends on the instrument, and counting strings is a stand-in for
 * measuring the neck. Four courses of a mandolin span roughly an inch, so a hand
 * covers the whole fretboard and the reach barely applies; six guitar strings
 * span more than twice that. Ignoring the difference rejected mandolin D7
 * (2032), which anyone can play.
 */
function barreRequiredAt(frets: Fret[]): number[] {
  const arch = frets.length <= 4 ? 3 : 2;
  const byFret = new Map<number, number[]>();
  frets.forEach((fret, i) => {
    if (fret === null || fret === 0) return;
    byFret.set(fret, [...(byFret.get(fret) ?? []), i]);
  });

  const required: number[] = [];
  for (const [fret, strings] of byFret) {
    if (strings.length < 2) continue;
    const lo = Math.min(...strings);
    const hi = Math.max(...strings);
    if (hi - lo <= arch) continue;
    for (let i = lo + 1; i < hi; i++) {
      const between = frets[i];
      if (between !== null && between !== undefined && between > fret) {
        required.push(fret);
        break;
      }
    }
  }
  return required;
}

/** Whether a flat finger can lie across this fret without hitting an open or silent string. */
function barreFits(frets: Fret[], fret: number): boolean {
  const strings = frets.map((f, i) => (f === fret ? i : -1)).filter(i => i >= 0);
  if (strings.length < 2) return false;
  const lo = Math.min(...strings);
  const hi = Math.max(...strings);
  for (let i = lo; i <= hi; i++) {
    // A flat finger frets every string it spans, so nothing inside the barre can
    // be open and nothing inside it can be silent either. An open string would
    // be pushed onto the barre fret; a muted one would be sounded there, which is
    // how guitar F5 came out as 133x11 with a barre drawn straight through the
    // cross on the D string, sounding a G# the chord does not contain.
    if (frets[i] === 0 || frets[i] === null) return false;
  }
  return true;
}

/**
 * Work out how a hand would hold this shape, or report that none can.
 *
 * Three rules do most of the work of keeping generated shapes honest, and all
 * three were added after the generator produced shapes no hand can make:
 *
 * A barre cannot cross an open or muted string. The index finger lying flat
 * frets every string it spans, so guitar "103211" (an F with the A string
 * ringing open inside the barre) is not a fingering, it is a drawing, and
 * "133x11" sounds the G# it claims to be silencing.
 *
 * When a barre is *required* and cannot be placed, the shape is impossible and
 * is dropped. This is the rule the first two were missing: declining the barre
 * used to fall through to separate fingers and emit the shape anyway.
 *
 * A barre is otherwise a choice, taken when the shape cannot be fingered without
 * one or when three strings share the lowest fret. Barring is always *possible*
 * wherever that fret repeats, and treating every such shape as a barre made easy
 * open chords look easier still: D (xx0232) came out as a barre chord, which is
 * not how anyone plays it. Requiring a fifth finger before reaching for one was
 * too strict the other way: ukulele Bbm7 (1111) came out as four separate
 * fingers on one fret, which is precisely what a barre is for.
 */
export function assignFingers(frets: Fret[]): Fingering {
  const fretted = frets
    .map((f, i) => ({ f, i }))
    .filter((x): x is { f: number; i: number } => x.f !== null && x.f > 0);

  const fingers: (number | null)[] = frets.map(() => null);
  if (fretted.length === 0) return { fingers, barre: null, count: 0, playable: true };

  const minFret = Math.min(...fretted.map(x => x.f));
  const atMin = fretted.filter(x => x.f === minFret);
  const above = fretted.filter(x => x.f > minFret).sort((a, b) => a.f - b.f || a.i - b.i);

  const unplayable: Fingering = { fingers, barre: null, count: fretted.length, playable: false };

  const assignPlain = (): Fingering => {
    let next = 1;
    for (const x of [...atMin, ...above].sort((a, b) => a.f - b.f || a.i - b.i)) {
      fingers[x.i] = Math.min(next++, 4);
    }
    return { fingers, barre: null, count: fretted.length, playable: true };
  };

  const withBarre = (): Fingering => {
    const from = Math.min(...atMin.map(x => x.i));
    const to = Math.max(...atMin.map(x => x.i));
    for (const x of atMin) fingers[x.i] = 1;
    let next = 2;
    for (const x of above) fingers[x.i] = Math.min(next++, 4);
    return {
      fingers,
      barre: { fret: minFret, fromString: from, toString: to, finger: 1 },
      count: 1 + above.length,
      playable: true,
    };
  };

  // A shape can demand a barre in a place no barre can go, and when it does the
  // answer is that the shape is impossible, not that it gets separate fingers
  // anyway. Declining the barre and falling through to assignPlain is what let
  // guitar Bb out as x10331: index on the A string and middle on the high E, four
  // strings apart at the 1st fret, with the ring and pinky at the 3rd fret in
  // between. Only the index finger barres, and only at the lowest fret it holds.
  const required = barreRequiredAt(frets);
  if (required.length > 0) {
    if (required.length > 1) return unplayable;
    if (required[0] !== minFret) return unplayable;
    if (!barreFits(frets, minFret)) return unplayable;
    return withBarre();
  }

  // Otherwise a barre is a choice. Take it when the shape cannot be fingered
  // without one, or when three strings share the lowest fret, which is what a
  // barre is for. Guitar D (xx0232) has two and stays a three-finger chord.
  const needsBarre = fretted.length > 4;
  const worthBarring = atMin.length >= 3;
  if (atMin.length < 2 || (!needsBarre && !worthBarring)) return assignPlain();
  if (!barreFits(frets, minFret)) return assignPlain();
  return withBarre();
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
      if (!fingering.playable || fingering.count > 4) return;

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
