import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { render } from '@testing-library/react';
import ChordsPage from './ChordsPage';

/**
 * The page's real job is keeping the chord in the URL, so most of this is about
 * navigation rather than rendering. A chord that only lives in component state
 * cannot be linked, bookmarked, or found by a search engine, which is the whole
 * reason the route carries it.
 */

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderAt(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/app/chords" element={<ChordsPage />} />
        <Route path="/app/chords/:instrument" element={<ChordsPage />} />
        <Route path="/app/chords/:instrument/:chord" element={<ChordsPage />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

const at = () => screen.getByTestId('location').textContent;

describe('routing', () => {
  it('sends a bare /app/chords to a real chord', () => {
    renderAt('/app/chords');
    expect(at()).toBe('/app/chords/guitar/c-major');
  });

  it('renders the chord named in the URL', () => {
    renderAt('/app/chords/ukulele/b-flat-m7');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Bbm7');
    expect(at()).toBe('/app/chords/ukulele/b-flat-m7');
  });

  it('collapses two spellings of one chord onto a single address', () => {
    // Otherwise the page competes with itself for the same search result.
    renderAt('/app/chords/ukulele/a-sharp-m7');
    expect(at()).toBe('/app/chords/ukulele/b-flat-m7');
  });

  it('redirects an unreadable chord rather than quietly showing another one', () => {
    renderAt('/app/chords/guitar/not-a-chord');
    expect(at()).toBe('/app/chords/guitar/c-major');
  });

  it('redirects an instrument it does not have', () => {
    renderAt('/app/chords/bouzouki/g-major');
    expect(at()).toBe('/app/chords/guitar/c-major');
  });
});

describe('picking', () => {
  it('puts a new chord in the path', async () => {
    const user = userEvent.setup();
    renderAt('/app/chords/guitar/c-major');
    await user.click(screen.getByRole('button', { name: 'G' }));
    expect(at()).toBe('/app/chords/guitar/g-major');
    await user.click(screen.getByRole('button', { name: 'm7' }));
    expect(at()).toBe('/app/chords/guitar/g-m7');
  });

  it('keeps tuning and capo in the query, and leaves defaults out of it', async () => {
    const user = userEvent.setup();
    renderAt('/app/chords/guitar/c-major');

    await user.click(screen.getByRole('button', { name: /DADGAD/ }));
    expect(at()).toBe('/app/chords/guitar/c-major?tuning=dadgad');

    await user.click(screen.getByRole('button', { name: '3' }));
    expect(at()).toBe('/app/chords/guitar/c-major?tuning=dadgad&capo=3');

    await user.click(screen.getByRole('button', { name: 'None' }));
    expect(at()).toBe('/app/chords/guitar/c-major?tuning=dadgad');

    await user.click(screen.getByRole('button', { name: /Standard/ }));
    expect(at()).toBe('/app/chords/guitar/c-major');
  });

  it('drops a tuning that belongs to the old instrument when switching', async () => {
    // "dadgad" means nothing on a banjo, and carrying it over would leave the
    // URL claiming a tuning the page is not showing.
    const user = userEvent.setup();
    renderAt('/app/chords/guitar/c-major?tuning=dadgad');
    await user.click(screen.getByRole('button', { name: 'Banjo' }));
    expect(at()).toBe('/app/chords/banjo/c-major');
  });

  it('ignores a tuning in the URL that the instrument does not have', () => {
    renderAt('/app/chords/banjo/c-major?tuning=dadgad');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('C');
  });
});

describe('display', () => {
  it('shows the shapes for the chord, with the standard one first', () => {
    renderAt('/app/chords/guitar/c-major');
    const shapes = screen.getAllByRole('img');
    expect(shapes.length).toBeGreaterThan(1);
    expect(shapes[0]).toHaveAccessibleName('C, shape 1 of ' + shapes.length);
  });

  it('names the notes in the chord and which is optional', () => {
    renderAt('/app/chords/guitar/c-major');
    const notes = screen.getByText('root').closest('p')!;
    expect(notes.textContent).toContain('C');
    expect(notes.textContent).toContain('E');
    expect(notes.textContent).toContain('G');
    expect(notes.textContent).toContain('optional');
  });

  it('spells the chord the way its URL does', () => {
    // The heading, the address, and the server-rendered title all come from one
    // table, so a page cannot call itself Bbm7 in one place and A#m7 in another.
    renderAt('/app/chords/guitar/b-flat-major');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Bb');
    expect(screen.getByRole('button', { name: 'Bb' })).toHaveAttribute('aria-pressed', 'true');
    expect(at()).toBe('/app/chords/guitar/b-flat-major');
  });

  it('reveals the long tail of qualities on request', async () => {
    const user = userEvent.setup();
    renderAt('/app/chords/guitar/c-major');
    expect(screen.queryByRole('button', { name: 'dim7' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Show all/ }));
    expect(screen.getByRole('button', { name: 'dim7' })).toBeInTheDocument();
  });

  it('says so when a chord cannot be played, instead of showing nothing', () => {
    // F#maj9 needs four separate notes that will not fit under one hand on four
    // strings. Silence would read as a broken page.
    renderAt('/app/chords/ukulele/f-sharp-maj9');
    expect(screen.getByText(/no way to play/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });
});
