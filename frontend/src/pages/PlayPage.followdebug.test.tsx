import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Outlet } from 'react-router-dom';
import api from '@/api';
import PlayPage from '@/pages/PlayPage';
import type { Song } from '@/types';

/**
 * The Follow diagnostics switch, which lives in the chart actions menu.
 *
 * It used to be a chip floating over the bottom-right of the chart, which is
 * where the last line of a verse tends to be. It is an operator tool, so it now
 * sits with the other things you reach for deliberately, and the panel it opens
 * is off until it is asked for.
 */

const captureEnabledMock = vi.fn(() => false);
vi.mock('@/extensions', async () => {
  const actual = await vi.importActual<typeof import('@/extensions')>('@/extensions');
  return { ...actual, useFollowCaptureEnabled: () => captureEnabledMock() };
});

vi.mock('@/api', () => ({
  default: {
    getSong: vi.fn(),
    updateSong: vi.fn().mockResolvedValue({}),
    downloadSongPdf: vi.fn().mockResolvedValue(undefined),
  },
  STORAGE_KEYS: {
    CURRENT_SONG_ID: 'test_current_song_id',
    PERFORMANCE_LAYOUT: 'test_perf_layout',
    PERFORMANCE_VERSION: 'test_perf_version',
    WAKE_LOCK: 'test_wake_lock',
    CHORD_INSTRUMENT: 'test_chord_instrument',
    CHORD_TUNING: 'test_chord_tuning',
  },
}));

vi.mock('@/components/TunerDialog', () => ({ default: () => null }));

function makeSong(): Song {
  return {
    id: 1,
    uuid: 'abc-123',
    profile_id: 1,
    kind: 'chart',
    title: 'Amazing Grace',
    artist: 'John Newton',
    original_content: '[G]Amazing grace',
    rewritten_content: '[G]Amazing grace',
    font_size: null,
    folder: null,
    status: 'ready',
    current_version: 1,
  } as unknown as Song;
}

function renderPlay() {
  return render(
    <MemoryRouter initialEntries={['/app/play/abc-123']}>
      <Routes>
        <Route element={<Outlet context={{ llmSettings: { model: '' } }} />}>
          <Route path="/app/play/:uuid" element={<PlayPage />} />
        </Route>
        <Route path="/app/library" element={<div>library</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Chart actions' }));
  await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
}

describe('PlayPage Follow debug switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    captureEnabledMock.mockReturnValue(false);
    (api.getSong as ReturnType<typeof vi.fn>).mockResolvedValue(makeSong());
  });

  it('is not in the menu for an account without Follow capture', async () => {
    // The account setting is the only gate. A menu item naming a tool you have
    // no access to is a worse answer than not offering it.
    const user = userEvent.setup();
    renderPlay();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chart actions' })).toBeInTheDocument());
    await openMenu(user);

    expect(screen.queryByRole('menuitem', { name: /Follow debug/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Download PDF' })).toBeInTheDocument();
  });

  it('offers it alongside the other chart actions when capture is on', async () => {
    const user = userEvent.setup();
    captureEnabledMock.mockReturnValue(true);
    renderPlay();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chart actions' })).toBeInTheDocument());
    await openMenu(user);

    expect(screen.getByRole('menuitem', { name: 'Show Follow debug' })).toBeInTheDocument();
  });

  it('turns the panel on, and says so the next time the menu is opened', async () => {
    const user = userEvent.setup();
    captureEnabledMock.mockReturnValue(true);
    renderPlay();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chart actions' })).toBeInTheDocument());

    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Show Follow debug' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Follow debug overlay')).toBeInTheDocument(),
    );

    // The label reports the state rather than repeating the offer: the switch
    // and the panel's own Hide button are the same switch.
    await openMenu(user);
    expect(screen.getByRole('menuitem', { name: 'Hide Follow debug' })).toBeInTheDocument();
  });

  it('turns it off again from the menu', async () => {
    const user = userEvent.setup();
    captureEnabledMock.mockReturnValue(true);
    localStorage.setItem('porchsongs.followDebugHud', 'shown');
    renderPlay();
    await waitFor(() => expect(screen.getByLabelText('Follow debug overlay')).toBeInTheDocument());

    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Hide Follow debug' }));

    await waitFor(() =>
      expect(screen.queryByLabelText('Follow debug overlay')).not.toBeInTheDocument(),
    );
  });
});
