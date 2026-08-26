import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import api from '@/api';
import LibraryTab from '@/components/LibraryTab';
import type { AppShellContext } from '@/layouts/AppShell';
import type { Song } from '@/types';

/**
 * A stored tab in the library.
 *
 * Most of what matters here is what a document must NOT get: the chart preview,
 * a version number, or the menu items whose backends answer a document with a
 * 409. Offering an action that cannot succeed is worse than not offering it.
 */

const CHART = vi.hoisted<Song>(() => ({
  id: 1,
  uuid: 'chart-uuid',
  user_id: 1,
  profile_id: 1,
  kind: 'chart',
  title: 'Amazing Grace',
  artist: 'John Newton',
  source_url: null,
  original_content: 'Amazing grace how sweet the sound',
  rewritten_content: 'Amazing grace how sweet the sound',
  changes_summary: null,
  llm_provider: null,
  llm_model: null,
  status: 'completed',
  current_version: 3,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
  file: null,
}) as unknown as Song);

const DOCUMENT = vi.hoisted<Song>(() => ({
  id: 2,
  uuid: 'doc-uuid',
  user_id: 1,
  profile_id: 1,
  kind: 'document',
  title: 'Blackberry Blossom',
  artist: 'Trad',
  source_url: null,
  original_content: '',
  rewritten_content: '',
  changes_summary: null,
  llm_provider: null,
  llm_model: null,
  status: 'ready',
  current_version: 1,
  created_at: '2025-01-02T00:00:00Z',
  updated_at: '2025-01-02T00:00:00Z',
  file: {
    filename: 'Blackberry Blossom.pdf',
    content_type: 'application/pdf',
    size_bytes: 4096,
    page_count: 3,
    sha256: 'a'.repeat(64),
  },
}) as unknown as Song);

vi.mock('@/extensions', async () => {
  const actual = await vi.importActual<typeof import('@/extensions')>('@/extensions');
  return { ...actual, SongCapNotice: () => null };
});

vi.mock('@/api', () => ({
  default: {
    listSongs: vi.fn(),
    getSong: vi.fn(),
    getSongRevisions: vi.fn().mockResolvedValue([]),
    uploadDocument: vi.fn(),
  },
  STORAGE_KEYS: {
    CURRENT_SONG_ID: 'test_song_id',
    LIBRARY_LAYOUT: 'test_library_layout',
    PERFORMANCE_LAYOUT: 'test_perf_layout',
    PERFORMANCE_VERSION: 'test_perf_version',
  },
}));

const stubContext = {
  profile: { id: 1, is_default: true },
  llmSettings: { model: '', reasoning_effort: 'high' },
  onLoadSong: vi.fn(),
} as unknown as AppShellContext;

function renderLibrary(entry = '/app/library') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route element={<Outlet context={stubContext} />}>
          <Route path="/app/library" element={<LibraryTab />} />
          <Route path="/app/library/:id" element={<LibraryTab />} />
        </Route>
        <Route path="/app/play/:uuid" element={<div>PLAY ROUTE</div>} />
        <Route path="/app/rewrite" element={<div>IMPORT ROUTE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const mockListSongs = api.listSongs as ReturnType<typeof vi.fn>;
const mockUpload = api.uploadDocument as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('documents in the library list', () => {
  it('labels a stored tab with its page count instead of a lyric preview', async () => {
    mockListSongs.mockResolvedValue([DOCUMENT]);
    renderLibrary();
    expect(await screen.findByText('Blackberry Blossom')).toBeInTheDocument();
    expect(screen.getByText('PDF')).toBeInTheDocument();
    expect(screen.getByText('3 pages')).toBeInTheDocument();
  });

  it('does not show a version number on a stored tab', async () => {
    // current_version is 1 for a document and always will be, but the chart row
    // renders "v3" from the same line, so the suppression is worth pinning.
    mockListSongs.mockResolvedValue([CHART, DOCUMENT]);
    renderLibrary();
    await screen.findByText('Blackberry Blossom');
    expect(screen.getByText(/v3/)).toBeInTheDocument();
    expect(screen.queryByText(/v1/)).not.toBeInTheDocument();
  });

  it('offers rename but not rewrite or AI folder suggestion on a stored tab', async () => {
    mockListSongs.mockResolvedValue([DOCUMENT]);
    renderLibrary();
    await screen.findByText('Blackberry Blossom');
    await userEvent.click(screen.getByLabelText('Song actions'));

    expect(await screen.findByText('Rename')).toBeInTheDocument();
    expect(screen.queryByText('Rewrite')).not.toBeInTheDocument();
    expect(screen.queryByText(/Suggest a folder with AI/)).not.toBeInTheDocument();
  });

  it('still offers rewrite on a chart', async () => {
    mockListSongs.mockResolvedValue([CHART]);
    renderLibrary();
    await screen.findByText('Amazing Grace');
    await userEvent.click(screen.getByLabelText('Song actions'));
    expect(await screen.findByText('Rewrite')).toBeInTheDocument();
  });

  it('sends a deep link to a stored tab to the play route', async () => {
    // The inline library view is the chart performance surface and reads text a
    // document does not have; landing there shows an empty sheet.
    mockListSongs.mockResolvedValue([DOCUMENT]);
    renderLibrary('/app/library/doc-uuid');
    expect(await screen.findByText('PLAY ROUTE')).toBeInTheDocument();
  });
});

describe('adding a tab', () => {
  it('uploads a picked PDF and puts it at the top of the library', async () => {
    mockListSongs.mockResolvedValue([CHART]);
    mockUpload.mockResolvedValue(DOCUMENT);
    renderLibrary();
    await screen.findByText('Amazing Grace');

    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'tab.pdf', {
      type: 'application/pdf',
    });
    await userEvent.upload(screen.getByTestId('tab-upload-input'), file);

    await waitFor(() => expect(mockUpload).toHaveBeenCalledWith(1, file));
    expect(await screen.findByText('Blackberry Blossom')).toBeInTheDocument();
  });

  it('keeps the uploads that worked and names only the ones that failed', async () => {
    // The common shape of a multi-file drop. Discarding the successes because one
    // file was bad would mean re-picking the whole folder.
    mockListSongs.mockResolvedValue([]);
    mockUpload
      .mockResolvedValueOnce(DOCUMENT)
      .mockRejectedValueOnce(new Error('Unsupported file type. PDF only.'));
    renderLibrary();
    await screen.findByText('Your library is empty');

    const good = new File([new Uint8Array([0x25])], 'good.pdf', { type: 'application/pdf' });
    const bad = new File([new Uint8Array([0x47])], 'bad.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByTestId('tab-upload-input'), [good, bad]);

    expect(await screen.findByText('Blackberry Blossom')).toBeInTheDocument();
    expect(await screen.findByText(/bad\.pdf: Unsupported file type/)).toBeInTheDocument();
  });

  it('offers storing a tab as a way out of an empty library', async () => {
    mockListSongs.mockResolvedValue([]);
    renderLibrary();
    expect(await screen.findByText('Your library is empty')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add a tab PDF/ })).toBeInTheDocument();
  });
});
