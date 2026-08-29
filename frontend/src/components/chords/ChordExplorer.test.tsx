import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChordExplorer, { type ChordSelection } from './ChordExplorer';
import { INSTRUMENTS } from '@/lib/chords/instruments';
import { CHORD_QUALITIES, ROOT_PITCH_CLASSES } from '@/lib/chords/theory';

const guitar = INSTRUMENTS.find(i => i.slug === 'guitar')!;
const mandolin = INSTRUMENTS.find(i => i.slug === 'mandolin')!;
const major = CHORD_QUALITIES.find(q => q.suffix === '')!;

function selectionFor(instrument = guitar): ChordSelection {
  return {
    instrument,
    tuning: instrument.tunings[0]!,
    chord: { root: ROOT_PITCH_CLASSES[0]!, quality: major },
    capo: 0,
  };
}

function renderExplorer(overrides: Partial<React.ComponentProps<typeof ChordExplorer>> = {}) {
  const onChange = vi.fn();
  render(
    <ChordExplorer
      selection={selectionFor()}
      onChange={onChange}
      showAllQualities={false}
      onToggleAllQualities={() => {}}
      {...overrides}
    />,
  );
  return onChange;
}

/**
 * One choice, two controls, picked by `compact`.
 *
 * The chord pages have room and are partly there to show that alternate tunings
 * exist, so they keep a row of buttons carrying each tuning's notes. The panel
 * beside a chart has no room: guitar's five tunings wrapped to four rows on a
 * phone, spending roughly two hundred pixels above Root and Quality on something
 * almost nobody touches mid-song.
 */
describe('the tuning control', () => {
  it('is a single select in the panel', async () => {
    const onChange = renderExplorer({ compact: true });

    const select = screen.getByRole('combobox', { name: 'Tuning' });
    expect(select).toBeInTheDocument();
    // Every tuning is still reachable, just not all at once.
    expect(screen.getByRole('option', { name: /DADGAD/ })).toBeInTheDocument();

    await userEvent.selectOptions(select, 'dadgad');

    expect(onChange).toHaveBeenCalledWith({
      tuning: guitar.tunings.find(t => t.slug === 'dadgad'),
    });
  });

  it('names the current tuning and its notes without being opened', () => {
    renderExplorer({ compact: true });

    // The point of collapsing it is losing no information: which tuning you are
    // in, and what the strings are, both still read off the closed control.
    expect(screen.getByRole('combobox', { name: 'Tuning' })).toHaveValue('standard');
    expect(screen.getByRole('option', { name: 'Standard · E A D G B E' })).toBeInTheDocument();
  });

  it('stays a row of buttons on the chord pages', async () => {
    const onChange = renderExplorer();

    expect(screen.queryByRole('combobox', { name: 'Tuning' })).not.toBeInTheDocument();
    const dadgad = screen.getByRole('button', { name: /DADGAD/ });

    await userEvent.click(dadgad);

    expect(onChange).toHaveBeenCalledWith({
      tuning: guitar.tunings.find(t => t.slug === 'dadgad'),
    });
  });

  it('is absent either way for an instrument with one tuning', () => {
    const single = { selection: selectionFor(mandolin) };
    expect(mandolin.tunings).toHaveLength(1);

    const { unmount } = render(
      <ChordExplorer
        {...single}
        onChange={vi.fn()}
        showAllQualities={false}
        onToggleAllQualities={() => {}}
        compact
      />,
    );
    expect(screen.queryByRole('combobox', { name: 'Tuning' })).not.toBeInTheDocument();
    unmount();

    renderExplorer({ ...single });
    expect(screen.queryByText('Tuning')).not.toBeInTheDocument();
  });
});
