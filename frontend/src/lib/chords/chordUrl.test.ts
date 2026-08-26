import {
  allChordPaths,
  chordPath,
  chordSlug,
  parseChordSlug,
  parseRootSlug,
  qualitySlug,
  resolveChordRoute,
  rootSlug,
} from './chordUrl';
import { CHORD_QUALITIES, ROOT_PITCH_CLASSES, chordName, findQuality } from './theory';
import { INSTRUMENTS, findInstrument } from './instruments';

describe('root slugs', () => {
  it('spells black notes the way players write them', () => {
    expect(rootSlug(10)).toBe('b-flat');
    expect(rootSlug(1)).toBe('c-sharp');
    expect(rootSlug(3)).toBe('e-flat');
    expect(rootSlug(6)).toBe('f-sharp');
  });

  it('accepts the other spelling of the same note', () => {
    expect(parseRootSlug('a-sharp')).toBe(parseRootSlug('b-flat'));
    expect(parseRootSlug('d-flat')).toBe(parseRootSlug('c-sharp'));
    expect(parseRootSlug('G-Sharp')).toBe(8);
  });

  it('rejects nonsense', () => {
    expect(parseRootSlug('h')).toBeNull();
    expect(parseRootSlug('')).toBeNull();
  });
});

describe('quality slugs', () => {
  it('spells out characters a URL should not carry', () => {
    expect(qualitySlug('')).toBe('major');
    expect(qualitySlug('m')).toBe('minor');
    expect(qualitySlug('7#9')).toBe('7-sharp-9');
    expect(qualitySlug('m7b5')).toBe('m7-flat-5');
    expect(qualitySlug('6/9')).toBe('6-9');
  });

  it('gives every quality a distinct slug', () => {
    const slugs = CHORD_QUALITIES.map(q => qualitySlug(q.suffix));
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('never produces a slug needing URL encoding', () => {
    for (const quality of CHORD_QUALITIES) {
      const slug = qualitySlug(quality.suffix);
      expect(slug, quality.suffix).toMatch(/^[a-z0-9-]+$/);
      expect(encodeURIComponent(slug)).toBe(slug);
    }
  });
});

describe('chord slugs round-trip', () => {
  it('parses back every chord it can generate', () => {
    for (const root of ROOT_PITCH_CLASSES) {
      for (const quality of CHORD_QUALITIES) {
        const chord = { root, quality };
        const slug = chordSlug(chord);
        const parsed = parseChordSlug(slug);
        expect(parsed, slug).not.toBeNull();
        expect(parsed!.root).toBe(root);
        expect(parsed!.quality.suffix).toBe(quality.suffix);
      }
    }
  });

  it('gives every chord a distinct slug', () => {
    const slugs: string[] = [];
    for (const root of ROOT_PITCH_CLASSES) {
      for (const quality of CHORD_QUALITIES) slugs.push(chordSlug({ root, quality }));
    }
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('splits roots and qualities that both contain hyphens', () => {
    // "c-sharp-7-sharp-9" has to break after the root, not at the first hyphen.
    const parsed = parseChordSlug('c-sharp-7-sharp-9');
    expect(parsed).not.toBeNull();
    expect(chordName(parsed!)).toBe('C#7#9');
  });

  it('reads a flat spelling as the same chord as the sharp one', () => {
    const flat = parseChordSlug('b-flat-m7')!;
    const sharp = parseChordSlug('a-sharp-m7')!;
    expect(flat.root).toBe(sharp.root);
    expect(flat.quality.suffix).toBe('m7');
  });

  it('rejects a slug with no quality or an unknown one', () => {
    expect(parseChordSlug('g')).toBeNull();
    expect(parseChordSlug('g-diminished')).toBeNull();
    expect(parseChordSlug('h-major')).toBeNull();
    expect(parseChordSlug('')).toBeNull();
  });
});

describe('resolveChordRoute', () => {
  const guitar = findInstrument('guitar')!;

  it('resolves an instrument, chord, and default tuning', () => {
    const route = resolveChordRoute('guitar', 'g-major')!;
    expect(route.instrument).toBe(guitar);
    expect(route.tuning.slug).toBe('standard');
    expect(chordName(route.chord)).toBe('G');
    expect(route.shouldRedirect).toBe(false);
  });

  it('honours a tuning when one is given and falls back when it is unknown', () => {
    expect(resolveChordRoute('guitar', 'g-major', 'dadgad')!.tuning.slug).toBe('dadgad');
    expect(resolveChordRoute('guitar', 'g-major', 'nonsense')!.tuning.slug).toBe('standard');
    // Baritone belongs to the ukulele, not the guitar.
    expect(resolveChordRoute('guitar', 'g-major', 'baritone')!.tuning.slug).toBe('standard');
  });

  it('flags a non-canonical spelling so the page can redirect to one URL', () => {
    // Two URLs for one chord splits whatever ranking the page earns.
    const route = resolveChordRoute('guitar', 'a-sharp-m7')!;
    expect(route.shouldRedirect).toBe(true);
    expect(chordSlug(route.chord)).toBe('b-flat-m7');
  });

  it('returns null rather than guessing', () => {
    expect(resolveChordRoute('bouzouki', 'g-major')).toBeNull();
    expect(resolveChordRoute('guitar', 'not-a-chord')).toBeNull();
    expect(resolveChordRoute(undefined, 'g-major')).toBeNull();
    expect(resolveChordRoute('guitar', undefined)).toBeNull();
  });
});

describe('chordPath', () => {
  it('builds paths under whichever base it is given', () => {
    const chord = { root: 7, quality: findQuality('m7')! };
    expect(chordPath('/chords', findInstrument('banjo')!, chord)).toBe('/chords/banjo/g-m7');
    expect(chordPath('/app/chords', findInstrument('banjo')!, chord)).toBe('/app/chords/banjo/g-m7');
  });
});

describe('allChordPaths', () => {
  const paths = allChordPaths('/chords');

  it('covers every common chord on every instrument', () => {
    const commonQualities = CHORD_QUALITIES.filter(q => q.common).length;
    expect(paths).toHaveLength(INSTRUMENTS.length * commonQualities * 12);
  });

  it('has no duplicates, so the sitemap lists each page once', () => {
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('resolves every path it publishes', () => {
    for (const path of paths) {
      const [, , instrument, chord] = path.split('/');
      expect(resolveChordRoute(instrument, chord), path).not.toBeNull();
    }
  });
});
