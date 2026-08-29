import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import api from '@/api';
import PlayPage from '@/pages/PlayPage';
import type { Song } from '@/types';

/**
 * Playing a stored tab.
 *
 * The chart surface below this branch reads content a document does not have,
 * and its "this chart is empty" state would otherwise claim a perfectly good tab
 * PDF was blank. That is the failure these tests exist to prevent.
 */

vi.mock('@/api', () => ({
  default: {
    getSong: vi.fn(),
    updateSong: vi.fn().mockResolvedValue({}),
    downloadSongPdf: vi.fn().mockResolvedValue(undefined),
    fetchSongFile: vi.fn(),
    downloadSongFile: vi.fn().mockResolvedValue(undefined),
    keptSongFiles: vi.fn().mockResolvedValue(new Set()),
    keepSongFileOffline: vi.fn().mockResolvedValue(undefined),
    forgetSongFileOffline: vi.fn().mockResolvedValue(undefined),
  },
  STORAGE_KEYS: {
    CURRENT_SONG_ID: 'test_current_song_id',
    PERFORMANCE_LAYOUT: 'test_perf_layout',
    PERFORMANCE_VERSION: 'test_perf_version',
    WAKE_LOCK: 'test_wake_lock',
  },
}));

vi.mock('@/components/TunerDialog', () => ({ default: () => null }));

// Stood in for, because pdf.js has its own tests and rasterising in jsdom would
// be testing canvas rather than this page.
vi.mock('@/components/DocumentSheet', () => ({
  default: ({ data }: { data: ArrayBuffer | null }) => (
    <div data-testid="document-sheet">{data ? `bytes:${data.byteLength}` : 'no bytes yet'}</div>
  ),
}));

function makeDocument(overrides: Partial<Song> = {}): Song {
  return {
    id: 2,
    uuid: 'doc-123',
    profile_id: 1,
    kind: 'document',
    title: 'Blackberry Blossom',
    artist: 'Trad',
    original_content: '',
    rewritten_content: '',
    font_size: null,
    tags: [],
    status: 'ready',
    current_version: 1,
    file: {
      filename: 'Blackberry Blossom.pdf',
      content_type: 'application/pdf',
      size_bytes: 4096,
      page_count: 3,
      sha256: 'a'.repeat(64),
    },
    ...overrides,
  } as unknown as Song;
}

function renderAt(uuid: string, ctx: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter initialEntries={[`/app/play/${uuid}`]}>
      <Routes>
        <Route element={<Outlet context={{ llmSettings: { model: '' }, ...ctx }} />}>
          <Route path="/app/play/:uuid" element={<PlayPage />} />
        </Route>
        <Route path="/app/library" element={<div>library list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const mockGetSong = api.getSong as ReturnType<typeof vi.fn>;
const mockFetchFile = api.fetchSongFile as ReturnType<typeof vi.fn>;
const mockDownloadFile = api.downloadSongFile as ReturnType<typeof vi.fn>;
const mockKeptFiles = api.keptSongFiles as ReturnType<typeof vi.fn>;
const mockKeep = api.keepSongFileOffline as ReturnType<typeof vi.fn>;
const mockForget = api.forgetSongFileOffline as ReturnType<typeof vi.fn>;

describe('PlayPage with a stored tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockKeptFiles.mockResolvedValue(new Set());
  });

  it('renders the document sheet, not the empty-chart state', async () => {
    mockGetSong.mockResolvedValue(makeDocument());
    mockFetchFile.mockResolvedValue(new ArrayBuffer(16));
    renderAt('doc-123');

    // findByTestId would resolve on the sheet's "no bytes yet" state, before the
    // fetch settles. Wait for the content, not the element.
    expect(await screen.findByText('bytes:16')).toBeInTheDocument();
    expect(screen.queryByText('This chart is empty')).not.toBeInTheDocument();
  });

  it('fetches the bytes in a second request, keyed to the song', async () => {
    mockGetSong.mockResolvedValue(makeDocument());
    mockFetchFile.mockResolvedValue(new ArrayBuffer(16));
    renderAt('doc-123');

    await screen.findByTestId('document-sheet');
    expect(mockFetchFile).toHaveBeenCalledWith('doc-123', expect.any(String));
    expect(mockFetchFile).toHaveBeenCalledTimes(1);
  });

  it('shows the title and artist while the bytes are still loading', async () => {
    // A tab is several megabytes over whatever connection the venue has, so the
    // header has to be useful before the file lands.
    mockGetSong.mockResolvedValue(makeDocument());
    mockFetchFile.mockReturnValue(new Promise(() => {}));
    renderAt('doc-123');

    expect(await screen.findByText('Blackberry Blossom')).toBeInTheDocument();
    expect(screen.getByTestId('document-sheet')).toHaveTextContent('no bytes yet');
  });

  it('explains a failed file fetch and offers a way back', async () => {
    mockGetSong.mockResolvedValue(makeDocument());
    mockFetchFile.mockRejectedValue(new Error('Could not load this file: 503'));
    renderAt('doc-123');

    expect(await screen.findByText('Could not load this tab')).toBeInTheDocument();
    expect(screen.getByText('Could not load this file: 503')).toBeInTheDocument();
    // Two match: the chrome's back arrow, and the button in the error state.
    expect(screen.getAllByRole('button', { name: 'Back to library' })).toHaveLength(2);
  });

  it('downloads the original under its stored filename', async () => {
    mockGetSong.mockResolvedValue(makeDocument());
    mockFetchFile.mockResolvedValue(new ArrayBuffer(16));
    renderAt('doc-123');
    await screen.findByTestId('document-sheet');

    await userEvent.click(screen.getByLabelText('Tab actions'));
    await userEvent.click(await screen.findByText('Download original'));

    await waitFor(() =>
      expect(mockDownloadFile).toHaveBeenCalledWith('doc-123', 'Blackberry Blossom.pdf'),
    );
  });

  it('offers no rewrite action on a stored tab', async () => {
    // The backend answers a document with 409 on every text route, so the menu
    // must not offer one.
    mockGetSong.mockResolvedValue(makeDocument());
    mockFetchFile.mockResolvedValue(new ArrayBuffer(16));
    renderAt('doc-123');
    await screen.findByTestId('document-sheet');

    await userEvent.click(screen.getByLabelText('Tab actions'));
    expect(await screen.findByText('Download original')).toBeInTheDocument();
    expect(screen.queryByText('Rewrite with AI')).not.toBeInTheDocument();
  });

  it('keeps the tuner, which does not care what is on the sheet', async () => {
    mockGetSong.mockResolvedValue(makeDocument());
    mockFetchFile.mockResolvedValue(new ArrayBuffer(16));
    renderAt('doc-123');
    await screen.findByTestId('document-sheet');

    expect(screen.getByLabelText('Open tuner')).toBeInTheDocument();
  });

  it('never asks for a file when the song is a chart', async () => {
    mockGetSong.mockResolvedValue({
      ...makeDocument(),
      kind: 'chart',
      rewritten_content: 'C F C\nMy words',
      file: null,
    });
    renderAt('doc-123');

    await waitFor(() => expect(screen.queryByText(/Loading chart/)).not.toBeInTheDocument());
    expect(mockFetchFile).not.toHaveBeenCalled();
  });
});

describe('keeping a tab on the device', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockKeptFiles.mockResolvedValue(new Set());
    mockGetSong.mockResolvedValue(makeDocument());
    mockFetchFile.mockResolvedValue(new ArrayBuffer(16));
  });

  it('passes the content digest so a kept copy can answer without the network', async () => {
    renderAt('doc-123');
    await screen.findByTestId('document-sheet');
    expect(mockFetchFile).toHaveBeenCalledWith('doc-123', 'a'.repeat(64));
  });

  it('offers to keep a tab that is not kept yet', async () => {
    renderAt('doc-123');
    await screen.findByTestId('document-sheet');

    await userEvent.click(screen.getByLabelText('Tab actions'));
    await userEvent.click(await screen.findByText('Keep offline'));

    await waitFor(() => expect(mockKeep).toHaveBeenCalledWith('doc-123', 'a'.repeat(64)));
  });

  it('offers to stop keeping one that already is', async () => {
    mockKeptFiles.mockResolvedValue(new Set(['doc-123']));
    renderAt('doc-123');
    await screen.findByTestId('document-sheet');

    await userEvent.click(screen.getByLabelText('Tab actions'));
    await userEvent.click(await screen.findByText('Stop keeping offline'));

    await waitFor(() => expect(mockForget).toHaveBeenCalledWith('doc-123'));
  });

  it('flips the label after keeping, without a reload', async () => {
    renderAt('doc-123');
    await screen.findByTestId('document-sheet');

    await userEvent.click(screen.getByLabelText('Tab actions'));
    await userEvent.click(await screen.findByText('Keep offline'));
    await waitFor(() => expect(mockKeep).toHaveBeenCalled());

    await userEvent.click(screen.getByLabelText('Tab actions'));
    expect(await screen.findByText('Stop keeping offline')).toBeInTheDocument();
  });

  it('says so when keeping fails instead of silently not keeping', async () => {
    // "Keep this for tonight" is a promise, and a silent failure is discovered on
    // stage with no connection.
    mockKeep.mockRejectedValue(new Error('QuotaExceededError'));
    renderAt('doc-123');
    await screen.findByTestId('document-sheet');

    await userEvent.click(screen.getByLabelText('Tab actions'));
    await userEvent.click(await screen.findByText('Keep offline'));

    expect(await screen.findByText('QuotaExceededError')).toBeInTheDocument();
  });
});
