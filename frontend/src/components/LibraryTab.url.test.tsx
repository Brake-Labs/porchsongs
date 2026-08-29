import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import LibraryTab from '@/components/LibraryTab';
import type { AppShellContext } from '@/layouts/AppShell';
import type { Song, ChatMessage } from '@/types';

/**
 * The library's filters are the query string, not component state.
 *
 * These tests are written against the URL rather than against what is on
 * screen, because the URL is the part that is new and the part a link, a
 * reload, or the Back button actually carries. What each filter *does* to the
 * list is covered by the artist and tag suites; what is checked here is that
 * the address says so.
 */

const mockOutletContext: Partial<AppShellContext> = {};
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useOutletContext: () => mockOutletContext,
    useParams: () => ({}),
  };
});

vi.mock('@/api', () => ({
  default: {
    listSongs: vi.fn(),
    updateSong: vi.fn(),
    deleteSong: vi.fn(),
    getSongRevisions: vi.fn(),
    renameTag: vi.fn(),
    deleteTag: vi.fn(),
    downloadSongPdf: vi.fn(),
    suggestTags: vi.fn(),
  },
  STORAGE_KEYS: {
    DRAFT_INPUT: 'test_draft_input',
    DRAFT_INSTRUCTION: 'test_draft_instruction',
    SPLIT_PERCENT: 'test_split_pct',
    CURRENT_SONG_ID: 'test_current_song_id',
    LIBRARY_LAYOUT: 'test_library_layout',
    LIBRARY_BROWSE_MODE: 'test_library_browse_mode',
    LAST_SURFACE: 'test_last_surface',
    PERFORMANCE_LAYOUT: 'test_performance_layout',
    PERFORMANCE_VERSION: 'test_performance_version',
  },
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), promise: vi.fn() },
}));

import api from '@/api';

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: 1,
    uuid: `test-uuid-${String(overrides.id ?? 1)}`,
    user_id: 1,
    profile_id: 1,
    title: 'Test Song',
    artist: 'Test Artist',
    source_url: null,
    original_content: 'Original lyrics',
    rewritten_content: 'Rewritten lyrics',
    changes_summary: null,
    llm_provider: null,
    llm_model: null,
    font_size: null,
    tags: [],
    status: 'completed',
    current_version: 1,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  } as Song;
}

function setupContext(): void {
  Object.assign(mockOutletContext, {
    profile: { id: 1, user_id: 'u1', display_name: 'Test', parse_prompt: '', chat_prompt: '' },
    llmSettings: { model: 'gpt-4o', reasoning_effort: 'high' },
    rewriteResult: null,
    rewriteMeta: null,
    currentSongId: null,
    currentSongUuid: null,
    chatMessages: [] as ChatMessage[],
    setChatMessages: vi.fn(),
    onNewRewrite: vi.fn(),
    onSongSaved: vi.fn(),
    onContentUpdated: vi.fn(),
    onChangeModel: vi.fn(),
    reasoningEffort: 'high',
    onChangeReasoningEffort: vi.fn(),
    models: [] as string[],
    onOpenSettings: vi.fn(),
    onLoadSong: vi.fn(),
  });
}

/** Reports the current address, and offers a stand-in for the Back button. */
function UrlProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <div data-testid="url">{location.pathname + location.search}</div>
      <button data-testid="go-back" onClick={() => navigate(-1)}>back</button>
    </>
  );
}

/** Stands in for the play route, and reports where its back button would go. */
function PlayProbe() {
  const location = useLocation();
  const state = location.state as { from?: string } | null;
  return <div data-testid="play-from">{state?.from ?? ''}</div>;
}

const SONGS = [
  makeSong({ id: 1, title: 'Old Man', artist: 'Neil Young', tags: ['Gigs'] }),
  makeSong({ id: 2, title: 'Harvest Moon', artist: 'Neil Young' }),
  makeSong({ id: 3, title: 'Miss Ohio', artist: 'Gillian Welch' }),
];

async function renderLibrary(route = '/app/library', songs: Song[] = SONGS) {
  vi.mocked(api.listSongs).mockResolvedValue(songs);
  render(
    <MemoryRouter initialEntries={[route]}>
      <UrlProbe />
      <Routes>
        <Route path="/app/library" element={<LibraryTab />} />
        <Route path="/app/play/:uuid" element={<PlayProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  // Every assertion below depends on the fetch having landed: the artist filter
  // is only reconciled against real songs once it has.
  await waitFor(() => expect(screen.queryByText('Loading songs...')).not.toBeInTheDocument());
}

/** The query string as a plain object, so param order cannot make a test brittle. */
function params(): Record<string, string> {
  const url = screen.getByTestId('url').textContent ?? '';
  return Object.fromEntries(new URLSearchParams(url.split('?')[1] ?? ''));
}

describe('LibraryTab filters in the URL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setupContext();
  });

  it('puts the browse axis in the address, in both directions', async () => {
    const user = userEvent.setup();
    await renderLibrary();
    expect(params()).toEqual({});

    await user.click(screen.getByTestId('browse-mode-artists'));
    expect(params()).toEqual({ view: 'artists' });

    // Written out rather than dropped even though 'songs' is the fallback: an
    // absent `view` means "whatever this browser last chose", which is weaker
    // than what the link is being asked to say.
    await user.click(screen.getByTestId('browse-mode-songs'));
    expect(params()).toEqual({ view: 'songs' });
  });

  it('opens the artist a link names, rather than clearing it before the songs arrive', async () => {
    await renderLibrary('/app/library?view=artists&artist=neil%20young');

    expect(screen.getByText('Old Man')).toBeInTheDocument();
    expect(screen.getByText('Harvest Moon')).toBeInTheDocument();
    expect(screen.queryByText('Miss Ohio')).not.toBeInTheDocument();
    // The picker is not on screen, and the link is still intact.
    expect(screen.queryByTestId('artist-grid')).not.toBeInTheDocument();
    expect(params()).toEqual({ view: 'artists', artist: 'neil young' });
  });

  it('records drilling into an artist and coming back out', async () => {
    const user = userEvent.setup();
    await renderLibrary('/app/library?view=artists');

    await user.click(screen.getByTestId('artist-card-neil young'));
    expect(params()).toEqual({ view: 'artists', artist: 'neil young' });

    await user.click(screen.getByTestId('artist-back'));
    expect(params()).toEqual({ view: 'artists' });
  });

  it('drops an artist nothing matches instead of showing an empty list under its name', async () => {
    await renderLibrary('/app/library?view=artists&artist=nobody%20at%20all');

    await waitFor(() => expect(screen.getByTestId('artist-grid')).toBeInTheDocument());
    expect(params()).toEqual({ view: 'artists' });
  });

  it('restores a tag filter from a link, and writes one back when a pill is picked', async () => {
    const user = userEvent.setup();
    await renderLibrary('/app/library?tags=Gigs');

    expect(screen.getByText('Old Man')).toBeInTheDocument();
    expect(screen.queryByText('Miss Ohio')).not.toBeInTheDocument();

    await user.click(screen.getByText('All'));
    expect(params()).toEqual({});

    await user.click(screen.getByTestId('tag-pill-Gigs'));
    expect(params()).toEqual({ tags: 'Gigs' });
  });

  it('restores the search box from a link, and follows what is typed into it', async () => {
    const user = userEvent.setup();
    await renderLibrary('/app/library?q=ohio');

    const box = screen.getByPlaceholderText('Search songs by title or artist...');
    expect(box).toHaveValue('ohio');
    expect(screen.getByText('Miss Ohio')).toBeInTheDocument();
    expect(screen.queryByText('Old Man')).not.toBeInTheDocument();

    await user.clear(box);
    await user.type(box, 'old');
    expect(params()).toEqual({ q: 'old' });

    // An empty box is no filter at all, so the parameter goes rather than
    // sitting there empty.
    await user.clear(box);
    expect(params()).toEqual({});
  });

  it('carries the sort key and direction, and writes neither when they are the default', async () => {
    const user = userEvent.setup();
    await renderLibrary();

    await user.selectOptions(screen.getByLabelText('Sort songs by'), 'title');
    expect(params()).toEqual({ sort: 'title' });

    await user.click(screen.getByLabelText('Sort descending'));
    expect(params()).toEqual({ sort: 'title', dir: 'asc' });

    await user.selectOptions(screen.getByLabelText('Sort songs by'), 'date');
    expect(params()).toEqual({ dir: 'asc' });
  });

  it('lets a link ask for the picker by chart count, pointed the way that means', async () => {
    const user = userEvent.setup();
    await renderLibrary('/app/library?view=artists&artistSort=count');

    // Descending without being told: `artistDir` falls back to what the key
    // means, so the link does not have to spell it out.
    const cards = screen.getAllByTestId(/^artist-card-/);
    expect(cards[0]).toHaveTextContent('Neil Young');

    await user.selectOptions(screen.getByLabelText('Sort artists by'), 'name');
    expect(params()).toEqual({ view: 'artists' });
  });

  it('ignores an artist left behind in the query when the axis is songs', async () => {
    // Hand-edited or half-cleaned URLs reach this. An `artist` the mode on
    // screen gives no way to see or clear must not quietly narrow the list.
    await renderLibrary('/app/library?view=songs&artist=neil%20young');

    expect(screen.getByText('Old Man')).toBeInTheDocument();
    expect(screen.getByText('Miss Ohio')).toBeInTheDocument();
  });

  it('falls back to the defaults for values it does not recognise', async () => {
    // The remembered axis is what an unreadable `view` has to fall back to, and
    // it is deliberately the opposite of what the component would show if the
    // garbage value were simply passed through. Without that, every assertion
    // here also passes with no validation at all: an unmatched `<select value>`
    // is rendered by React as its first option, and every other read of these
    // values is an equality test with a default branch behind it.
    localStorage.setItem('test_library_browse_mode', 'artists');
    await renderLibrary('/app/library?view=nope&sort=bogus&dir=sideways&artistSort=whatever');

    expect(screen.getByTestId('artist-grid')).toBeInTheDocument();
    // And nothing is rewritten: the address is left as it was found.
    expect(params()).toEqual({
      view: 'nope',
      sort: 'bogus',
      dir: 'sideways',
      artistSort: 'whatever',
    });

    await userEvent.setup().click(screen.getByTestId('artist-card-neil young'));
    // The song list, sorted the default way, rather than a blank screen.
    expect(screen.getByText('Old Man')).toBeInTheDocument();
    expect(screen.getByLabelText('Sort songs by')).toHaveValue('date');
    expect(screen.getByLabelText('Sort descending')).toBeInTheDocument();
  });

  it('renames the tag in place rather than stacking the old name behind Back', async () => {
    // Reconciling the filter after a rename is not navigation. Pushing would
    // leave Back on a tag that no longer exists, showing an empty list with
    // no pill to clear it.
    const user = userEvent.setup();
    vi.mocked(api.renameTag).mockResolvedValue(undefined as never);
    await renderLibrary();

    // One real entry to come back to, so a pushed rename would be visible here.
    await user.click(screen.getByTestId('tag-pill-Gigs'));
    expect(params()).toEqual({ tags: 'Gigs' });

    await user.click(screen.getByRole('button', { name: 'Actions for Gigs' }));
    await user.click(await screen.findByText('Rename'));
    const input = await screen.findByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Shows');
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    await waitFor(() => expect(params()).toEqual({ tags: 'Shows' }));

    await user.click(screen.getByTestId('go-back'));
    expect(params()).toEqual({});
  });

  it('clears the filters it is leaving behind in one step when the axis changes', async () => {
    const user = userEvent.setup();
    await renderLibrary('/app/library?tags=Gigs&q=old&sort=title');

    await user.click(screen.getByTestId('browse-mode-artists'));

    // The tags and the query go; the sort is not a filter and stays.
    expect(params()).toEqual({ view: 'artists', sort: 'title' });

    // And all of it in one navigation. Back returns to the whole previous view
    // rather than unwinding a parameter at a time, which is what would happen
    // if each cleared filter were its own write.
    await user.click(screen.getByTestId('go-back'));
    expect(params()).toEqual({ tags: 'Gigs', q: 'old', sort: 'title' });
  });

  it('leaves Back able to escape, rather than one entry per keystroke', async () => {
    const user = userEvent.setup();
    await renderLibrary();

    await user.click(screen.getByTestId('browse-mode-artists'));
    await user.type(screen.getByPlaceholderText('Search artists...'), 'neil');
    expect(params()).toEqual({ view: 'artists', q: 'neil' });

    // Four characters typed, and one press of Back leaves the artist view
    // entirely: the search box replaces rather than pushes.
    await user.click(screen.getByTestId('go-back'));
    expect(params()).toEqual({});
  });

  it('does not let a link change which axis this browser opens at', async () => {
    const user = userEvent.setup();
    localStorage.setItem('test_library_browse_mode', 'songs');
    await renderLibrary('/app/library?view=artists');

    expect(screen.getByTestId('artist-grid')).toBeInTheDocument();
    expect(localStorage.getItem('test_library_browse_mode')).toBe('songs');

    // Using the control is the thing that changes the default.
    await user.click(screen.getByTestId('browse-mode-songs'));
    expect(localStorage.getItem('test_library_browse_mode')).toBe('songs');
    await user.click(screen.getByTestId('browse-mode-artists'));
    expect(localStorage.getItem('test_library_browse_mode')).toBe('artists');
  });

  it('keeps a bare library URL meaning the same thing for as long as Back can reach it', async () => {
    const user = userEvent.setup();
    await renderLibrary();

    await user.click(screen.getByTestId('browse-mode-artists'));
    expect(screen.getByTestId('artist-grid')).toBeInTheDocument();

    // Back onto the plain /app/library the session opened at. The preference
    // the toggle just wrote is for the next visit, so it must not reach back and
    // redefine an address already in the history stack.
    await user.click(screen.getByTestId('go-back'));
    expect(params()).toEqual({});
    expect(screen.queryByTestId('artist-grid')).not.toBeInTheDocument();
    expect(screen.getByText('Old Man')).toBeInTheDocument();
  });

  it('opens the library at the remembered axis when the link does not say', async () => {
    localStorage.setItem('test_library_browse_mode', 'artists');
    await renderLibrary();

    expect(screen.getByTestId('artist-grid')).toBeInTheDocument();
    // Nothing is written to the address on arrival: the library is still at its
    // plain URL until the user actually asks for something.
    expect(params()).toEqual({});
  });

  it('hands the filters to the play route so its back button can return to them', async () => {
    const user = userEvent.setup();
    await renderLibrary('/app/library?view=artists&artist=neil%20young');

    await user.click(screen.getByText('Old Man'));

    const from = screen.getByTestId('play-from').textContent ?? '';
    expect(from.split('?')[0]).toBe('/app/library');
    expect(Object.fromEntries(new URLSearchParams(from.split('?')[1] ?? ''))).toEqual({
      view: 'artists',
      artist: 'neil young',
    });
  });
});
