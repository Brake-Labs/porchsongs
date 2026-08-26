import { render, screen } from '@testing-library/react';
import ChordDiagram, { describeVoicing } from './ChordDiagram';
import { findInstrument, findTuning, withCapo } from '@/lib/chords/instruments';
import { assignFingers, generateVoicings, type Fret, type Voicing } from '@/lib/chords/voicing';
import { findQuality } from '@/lib/chords/theory';

const guitar = findInstrument('guitar')!;
const guitarStandard = findTuning(guitar, 'standard')!;
const banjo = findInstrument('banjo')!;
const banjoOpenG = banjo.tunings[0]!;

/** A shape stated directly, for cases that should not depend on how ranking orders things. */
function voicingFor(frets: Fret[]): Voicing {
  const { fingers, barre } = assignFingers(frets);
  const fretted = frets.filter((f): f is number => f !== null && f > 0);
  return {
    frets,
    fingers,
    barre,
    baseFret: fretted.length ? Math.min(...fretted) : 0,
    notes: [],
    score: 0,
  };
}

function shapeFor(instrumentSlug: string, tuningSlug: string, root: number, suffix: string) {
  const instrument = findInstrument(instrumentSlug)!;
  const tuning = findTuning(instrument, tuningSlug)!;
  return generateVoicings(instrument, tuning, { root, quality: findQuality(suffix)! })[0]!;
}

describe('describeVoicing', () => {
  it('reads out the shape string by string, numbered as a player would', () => {
    // Guitar C is x32010. String 6 is the muted one; strings are numbered from
    // the highest, which is the opposite of the diagram's left-to-right order.
    const c = shapeFor('guitar', 'standard', 0, '');
    expect(describeVoicing(c, guitar)).toBe(
      'Guitar: string 6 muted, string 5 fret 3, string 4 fret 2, string 3 open, string 2 fret 1, string 1 open',
    );
  });

  it('mentions a barre when the shape has one', () => {
    const f = shapeFor('guitar', 'standard', 5, '');
    expect(describeVoicing(f, guitar)).toContain('barred at fret 1');
  });
});

describe('ChordDiagram', () => {
  it('labels itself for screen readers rather than rendering a silent graphic', () => {
    const c = shapeFor('guitar', 'standard', 0, '');
    render(<ChordDiagram voicing={c} instrument={guitar} tuning={guitarStandard} />);
    const image = screen.getByRole('img');
    expect(image).toHaveAccessibleName(/string 5 fret 3/);
  });

  it('keeps describing the shape when given a label', () => {
    // The label says which diagram this is; without the shape after it a screen
    // reader user learns there are six pictures and nothing about any of them.
    const c = shapeFor('guitar', 'standard', 0, '');
    render(<ChordDiagram voicing={c} instrument={guitar} tuning={guitarStandard} label="C major, shape 1" />);
    const name = screen.getByRole('img').getAttribute('aria-labelledby')!;
    const text = document.getElementById(name)!.textContent!;
    expect(text.startsWith('C major, shape 1.')).toBe(true);
    expect(text).toContain('string 5 fret 3');
  });

  it('says where fret numbers are counted from when a capo is fitted', () => {
    const c = shapeFor('guitar', 'standard', 0, '');
    render(<ChordDiagram voicing={c} instrument={guitar} tuning={guitarStandard} capo={3} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(/capo 3, frets counted from the capo/);
  });

  it('draws the capo in place of the nut rather than a label that will not fit', () => {
    const c = shapeFor('guitar', 'standard', 0, '');
    const { container } = render(
      <ChordDiagram voicing={c} instrument={guitar} tuning={guitarStandard} capo={3} />,
    );
    const nut = container.querySelector('line[stroke-width="5"]')!;
    expect(nut.getAttribute('class')).toContain('stroke-primary');
    // The old text label was drawn past the right edge of the viewBox.
    expect([...container.querySelectorAll('text')].map(t => t.textContent)).not.toContain('capo 3');
  });

  it('draws a nut for an open shape and a fret number for one up the neck', () => {
    const { container: open } = render(
      <ChordDiagram voicing={shapeFor('guitar', 'standard', 0, '')} instrument={guitar} tuning={guitarStandard} />,
    );
    // The nut is the one thick horizontal line. The position label sits to the
    // left of the grid; finger numbers are text too, so match on the anchor.
    expect(open.querySelectorAll('line[stroke-width="5"]').length).toBe(1);
    expect(open.querySelector('text[text-anchor="end"]')).toBeNull();

    // A shape whose frets run past the window is drawn from its lowest fret and
    // labelled with it, the way a chord book does, rather than padding the top
    // with empty frets. Built by hand so the test does not depend on ranking.
    const high = voicingFor([7, 9, 9, 8, 7, 7]); // B barre, 7th position
    const { container } = render(<ChordDiagram voicing={high} instrument={guitar} tuning={guitarStandard} />);
    expect(container.querySelectorAll('line[stroke-width="5"]').length).toBe(0);
    expect(container.querySelector('text[text-anchor="end"]')?.textContent).toBe('7');
  });

  it('marks muted strings with a cross and open ones with a circle', () => {
    // Guitar D (xx0232): two muted, one open.
    const { container } = render(
      <ChordDiagram voicing={shapeFor('guitar', 'standard', 2, '')} instrument={guitar} tuning={guitarStandard} />,
    );
    expect(container.querySelectorAll('g[stroke-linecap="round"] line')).toHaveLength(4); // two crosses
    expect(container.querySelectorAll('circle[fill="none"]')).toHaveLength(1);
  });

  it('stops the banjo drone short instead of drawing frets that are not under it', () => {
    // The 5th string is anchored at the 5th fret. Drawn full length, the diagram
    // claims four frets of neck that do not exist.
    const g = generateVoicings(banjo, banjoOpenG, { root: 7, quality: findQuality('')! })[0]!;
    const { container } = render(<ChordDiagram voicing={g} instrument={banjo} tuning={banjoOpenG} />);
    const strings = [...container.querySelectorAll('line[stroke-width="1.5"][opacity="0.55"]')];
    expect(strings).toHaveLength(5);

    const lengths = strings.map(s => Number(s.getAttribute('y2')) - Number(s.getAttribute('y1')));
    const [drone, ...rest] = lengths;
    expect(drone).toBeLessThan(Math.min(...rest));
    // And it gets its own little nut where it starts.
    expect(container.querySelectorAll('line[stroke-width="4"]')).toHaveLength(1);
  });

  it('moves the drone stub up with the capo', () => {
    // A banjo capo raises the 5th string too (a spike), so its anchor sits
    // closer to the capo: three frets above it rather than five above the nut.
    // Drawing the stub from the nut-relative anchor would put it off the grid.
    const capoed = withCapo(banjoOpenG, 2);
    const a = generateVoicings(banjo, capoed, { root: 9, quality: findQuality('')! })[0]!;
    const { container } = render(
      <ChordDiagram voicing={a} instrument={banjo} tuning={capoed} capo={2} />,
    );
    const stubNut = container.querySelector('line[stroke-width="4"]');
    expect(stubNut).not.toBeNull();

    const uncapoed = render(
      <ChordDiagram voicing={a} instrument={banjo} tuning={banjoOpenG} />,
    ).container.querySelector('line[stroke-width="4"]')!;
    expect(Number(stubNut!.getAttribute('y1'))).toBeLessThan(Number(uncapoed.getAttribute('y1')));
  });
});
