import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import TidyPage from './TidyPage';
import type { Song } from '@/types';

vi.mock('@/api', () => ({
  default: { listSongs: vi.fn(), updateSong: vi.fn() },
}));

// Hoisted, because `vi.mock` is lifted above the file's own declarations.
const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

import api from '@/api';

const mockListSongs = vi.mocked(api.listSongs);
const mockUpdateSong = vi.mocked(api.updateSong);

let nextId = 1;

function makeSong(overrides: Partial<Song> = {}): Song {
  const id = nextId++;
  return {
    id,
    uuid: `uuid-${id}`,
    user_id: 1,
    profile_id: 1,
    kind: 'chart',
    title: 'Shady Grove',
    artist: null,
    original_content: 'G C G',
    rewritten_content: 'G C G',
    changes_summary: null,
    source_url: null,
    tags: [],
    font_size: null,
    status: 'ready',
    current_version: 1,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
    file: null,
    ...overrides,
  } as Song;
}

function makeDocument(filename: string): Song {
  return makeSong({
    kind: 'document',
    title: filename.replace(/\.pdf$/i, ''),
    original_content: '',
    rewritten_content: '',
    file: {
      filename,
      content_type: 'application/pdf',
      size_bytes: 1024,
      page_count: 2,
      sha256: 'a'.repeat(64),
    },
  } as Partial<Song>);
}

async function renderPage(songs: Song[]) {
  mockListSongs.mockResolvedValue(songs);
  render(
    <MemoryRouter initialEntries={['/app/library/tidy']}>
      <TidyPage />
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: 'Name the unknowns' });
}

/** The title and artist inputs on one song's row. */
function fieldsFor(uuid: string) {
  const row = screen.getByTestId(`tidy-row-${uuid}`);
  return {
    row,
    checkbox: within(row).getByRole('checkbox'),
    title: within(row).getAllByRole('textbox')[0]!,
    artist: within(row).getAllByRole('textbox')[1]!,
  };
}

beforeEach(() => {
  nextId = 1;
  vi.clearAllMocks();
  // Echo back whatever was written, the way the API does.
  mockUpdateSong.mockImplementation(async (ref, body) =>
    makeSong({ uuid: ref, ...body } as Partial<Song>),
  );
});

describe('TidyPage', () => {
  it('lists only songs with no artist', async () => {
    await renderPage([
      makeSong({ uuid: 'has-artist', title: 'Salt Creek', artist: 'Bill Monroe' }),
      makeSong({ uuid: 'no-artist', title: 'Shady Grove', artist: null }),
    ]);

    expect(screen.getByTestId('tidy-row-no-artist')).toBeInTheDocument();
    expect(screen.queryByTestId('tidy-row-has-artist')).not.toBeInTheDocument();
  });

  it('pre-fills a document row from its filename and pre-ticks it', async () => {
    await renderPage([makeDocument('Wildwood Flower - Carter Family.pdf')]);

    const { title, artist, checkbox } = fieldsFor('uuid-1');
    expect(title).toHaveValue('Wildwood Flower');
    expect(artist).toHaveValue('Carter Family');
    expect(checkbox).toBeChecked();
    expect(screen.getByText('Artist from the filename')).toBeInTheDocument();
  });

  it('shows the evidence the guess was read from', async () => {
    await renderPage([makeDocument('Wildwood Flower - Carter Family.pdf')]);
    expect(screen.getByText('Wildwood Flower - Carter Family.pdf')).toBeInTheDocument();
  });

  it('leaves a row with nothing found unticked and offers the quick fills', async () => {
    await renderPage([makeSong({ uuid: 'plain', title: 'Shady Grove' })]);

    const { checkbox, row } = fieldsFor('plain');
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toBeDisabled();
    expect(within(row).getByRole('button', { name: 'Traditional' })).toBeInTheDocument();
  });

  it('writes nothing until the changes are applied', async () => {
    await renderPage([makeDocument('Wildwood Flower - Carter Family.pdf')]);
    expect(mockUpdateSong).not.toHaveBeenCalled();
  });

  it('applies only the ticked rows, and only the fields that changed', async () => {
    const user = userEvent.setup();
    await renderPage([
      makeDocument('Wildwood Flower - Carter Family.pdf'),
      makeDocument('Blackbird (The Beatles).pdf'),
    ]);

    await user.click(fieldsFor('uuid-2').checkbox);
    await user.click(screen.getByRole('button', { name: 'Apply 1 change' }));

    await waitFor(() => expect(mockUpdateSong).toHaveBeenCalledTimes(1));
    expect(mockUpdateSong).toHaveBeenCalledWith('uuid-1', {
      title: 'Wildwood Flower',
      artist: 'Carter Family',
    });
  });

  it('ticks a row as soon as it is edited', async () => {
    const user = userEvent.setup();
    await renderPage([makeSong({ uuid: 'plain', title: 'Shady Grove' })]);

    await user.type(fieldsFor('plain').artist, 'Doc Watson');

    expect(fieldsFor('plain').checkbox).toBeChecked();
    expect(screen.getByRole('button', { name: 'Apply 1 change' })).toBeEnabled();
  });

  it('fills the artist from a quick fill', async () => {
    const user = userEvent.setup();
    await renderPage([makeSong({ uuid: 'plain', title: 'Shady Grove' })]);

    await user.click(within(fieldsFor('plain').row).getByRole('button', { name: 'Traditional' }));

    expect(fieldsFor('plain').artist).toHaveValue('Traditional');
    await user.click(screen.getByRole('button', { name: 'Apply 1 change' }));
    await waitFor(() =>
      expect(mockUpdateSong).toHaveBeenCalledWith('plain', { artist: 'Traditional' }),
    );
  });

  it('writes null rather than an empty string when a field is cleared', async () => {
    const user = userEvent.setup();
    await renderPage([makeSong({ uuid: 'plain', title: 'Shady Grove' })]);

    await user.clear(fieldsFor('plain').title);
    await user.click(screen.getByRole('button', { name: 'Apply 1 change' }));

    await waitFor(() => expect(mockUpdateSong).toHaveBeenCalledWith('plain', { title: null }));
  });

  it('drops a named row off the list and leaves the rest', async () => {
    const user = userEvent.setup();
    await renderPage([
      makeDocument('Wildwood Flower - Carter Family.pdf'),
      makeSong({ uuid: 'plain', title: 'Shady Grove' }),
    ]);

    await user.click(screen.getByRole('button', { name: 'Apply 1 change' }));

    await waitFor(() => expect(screen.queryByTestId('tidy-row-uuid-1')).not.toBeInTheDocument());
    expect(screen.getByTestId('tidy-row-plain')).toBeInTheDocument();
  });

  it('offers an undo that puts the old values back', async () => {
    const user = userEvent.setup();
    await renderPage([makeDocument('Wildwood Flower - Carter Family.pdf')]);

    await user.click(screen.getByRole('button', { name: 'Apply 1 change' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());

    const [, options] = toastSuccess.mock.calls[0]!;
    mockUpdateSong.mockClear();
    await options.action.onClick();

    await waitFor(() =>
      expect(mockUpdateSong).toHaveBeenCalledWith('uuid-1', {
        title: 'Wildwood Flower - Carter Family',
        artist: null,
      }),
    );
  });

  it('reports a partial failure instead of claiming everything saved', async () => {
    const user = userEvent.setup();
    await renderPage([
      makeDocument('Wildwood Flower - Carter Family.pdf'),
      makeDocument('Blackbird (The Beatles).pdf'),
    ]);

    mockUpdateSong.mockImplementation(async (ref, body) => {
      if (ref === 'uuid-2') throw new Error('nope');
      return makeSong({ uuid: ref, ...body } as Partial<Song>);
    });

    await user.click(screen.getByRole('button', { name: 'Apply 2 changes' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Saved 1. 1 could not be saved.'),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    // The row that failed is still there to try again.
    expect(screen.getByTestId('tidy-row-uuid-2')).toBeInTheDocument();
  });

  it('shows an empty state when every song has an artist', async () => {
    await renderPage([makeSong({ artist: 'Bill Monroe' })]);
    expect(screen.getByText('Nothing to sort out')).toBeInTheDocument();
  });

  it('never presents a load failure as an empty library', async () => {
    mockListSongs.mockRejectedValue(new Error('Session expired'));
    render(
      <MemoryRouter initialEntries={['/app/library/tidy']}>
        <TidyPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Session expired')).toBeInTheDocument();
    expect(screen.queryByText('Nothing to sort out')).not.toBeInTheDocument();
  });

  it('counts what the free pass found', async () => {
    await renderPage([
      makeDocument('Wildwood Flower - Carter Family.pdf'),
      makeSong({ uuid: 'plain', title: 'Shady Grove' }),
    ]);
    expect(
      screen.getByText(/2 songs have no artist\. 1 of them can be named/),
    ).toBeInTheDocument();
  });
});
