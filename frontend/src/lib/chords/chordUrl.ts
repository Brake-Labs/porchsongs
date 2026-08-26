/**
 * URL slugs for chord pages.
 *
 * Every chord gets its own address (`/chords/ukulele/b-flat-m7`) rather than
 * living behind picker state on one page. People search for "Bb m7 ukulele
 * chord", and a single page with everything hidden behind clicks has nothing for
 * that query to land on. It also means a chord can be linked to and bookmarked.
 *
 * Slugs are canonical in one direction only: several spellings parse, one is
 * generated. `a-sharp-m7` and `b-flat-m7` are the same chord, and the page
 * canonicalises to whichever spelling this table calls that pitch class, so
 * crawlers see one URL per chord rather than two.
 */

import { CHORD_QUALITIES, NOTE_NAMES, type Chord, type PitchClass } from './theory';
import { INSTRUMENTS, findInstrument, findTuning, type Instrument, type Tuning } from './instruments';

/**
 * The spelling each pitch class gets in a URL.
 *
 * Derived from the display names rather than written out again, so a URL can
 * never claim a spelling the page does not use: /chords/ukulele/b-flat-m7 shows
 * Bbm7 because both come from the same entry in NOTE_NAMES.
 */
const ROOT_SLUGS: string[] = NOTE_NAMES.map(name => {
  const letter = name[0]!.toLowerCase();
  if (name.endsWith('#')) return `${letter}-sharp`;
  if (name.length > 1 && name.endsWith('b')) return `${letter}-flat`;
  return letter;
});

/** Accepted alternative spellings, mapped to the same pitch class. */
const ROOT_ALIASES: Record<string, PitchClass> = {
  'd-flat': 1, 'd-sharp': 3, 'f-flat': 4, 'e-sharp': 5,
  'g-flat': 6, 'g-sharp': 8, 'a-sharp': 10, 'c-flat': 11, 'b-sharp': 0,
};

export function rootSlug(pc: PitchClass): string {
  return ROOT_SLUGS[((pc % 12) + 12) % 12]!;
}

export function parseRootSlug(slug: string): PitchClass | null {
  const lower = slug.toLowerCase();
  const index = ROOT_SLUGS.indexOf(lower);
  if (index >= 0) return index;
  return ROOT_ALIASES[lower] ?? null;
}

/**
 * Quality suffixes carry characters a URL should not: "#", "b" that means flat,
 * and "/". Spell them out rather than percent-encoding, which is unreadable in a
 * search result and easy to get wrong on a copy-paste.
 */
function encodeSuffix(suffix: string): string {
  if (suffix === '') return 'major';
  if (suffix === 'm') return 'minor';
  return suffix
    .replace(/#/g, '-sharp-')
    .replace(/\//g, '-')
    .replace(/b(?=\d)/g, '-flat-')
    .replace(/-+/g, '-')
    .replace(/-$/, '')
    .toLowerCase();
}

const QUALITY_BY_SLUG = new Map(CHORD_QUALITIES.map(q => [encodeSuffix(q.suffix), q]));

export function qualitySlug(suffix: string): string {
  return encodeSuffix(suffix);
}

/** The slug for one chord, without the instrument, e.g. "b-flat-m7". */
export function chordSlug(chord: Chord): string {
  return `${rootSlug(chord.root)}-${encodeSuffix(chord.quality.suffix)}`;
}

/** Full path to a chord page under a given base ("/chords" or "/app/chords"). */
export function chordPath(base: string, instrument: Instrument, chord: Chord): string {
  return `${base}/${instrument.slug}/${chordSlug(chord)}`;
}

/**
 * Split "b-flat-m7" into its root and quality.
 *
 * Both halves can contain hyphens ("c-sharp" and "7-sharp-9"), so this tries the
 * longest root spelling first rather than splitting on the first hyphen.
 */
export function parseChordSlug(slug: string): Chord | null {
  const lower = slug.toLowerCase();
  const candidates = [...ROOT_SLUGS, ...Object.keys(ROOT_ALIASES)].sort((a, b) => b.length - a.length);
  for (const candidate of candidates) {
    if (!lower.startsWith(`${candidate}-`)) continue;
    const root = parseRootSlug(candidate);
    if (root === null) continue;
    const quality = QUALITY_BY_SLUG.get(lower.slice(candidate.length + 1));
    if (quality) return { root, quality };
  }
  return null;
}

export interface ChordRoute {
  instrument: Instrument;
  tuning: Tuning;
  chord: Chord;
  /** True when the URL as given is not the one we would generate for this chord. */
  shouldRedirect: boolean;
}

/**
 * Resolve the `:instrument` and `:chord` params of a chord page.
 *
 * Returns null for anything unrecognised so the route can render a 404 rather
 * than quietly showing a different chord than the URL asked for.
 */
export function resolveChordRoute(
  instrumentParam: string | undefined,
  chordParam: string | undefined,
  tuningParam?: string,
): ChordRoute | null {
  if (!instrumentParam || !chordParam) return null;
  const instrument = findInstrument(instrumentParam);
  if (!instrument) return null;
  const chord = parseChordSlug(chordParam);
  if (!chord) return null;
  const tuning = (tuningParam && findTuning(instrument, tuningParam)) || instrument.tunings[0]!;
  return {
    instrument,
    tuning,
    chord,
    shouldRedirect: chordParam.toLowerCase() !== chordSlug(chord) || instrumentParam !== instrument.slug,
  };
}

/** Every chord page the site publishes, for the sitemap and the index page. */
export function allChordPaths(base: string): string[] {
  const paths: string[] = [];
  for (const instrument of INSTRUMENTS) {
    for (const quality of CHORD_QUALITIES) {
      if (!quality.common) continue;
      for (let root = 0; root < 12; root++) {
        paths.push(chordPath(base, instrument, { root, quality }));
      }
    }
  }
  return paths;
}
