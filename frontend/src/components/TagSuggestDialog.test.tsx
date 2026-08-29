import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FolderSuggestDialog from '@/components/FolderSuggestDialog';
import type { Song } from '@/types';

vi.mock('@/api', () => ({
  default: { suggestFolder: vi.fn() },
}));

import api from '@/api';

const mockSuggestFolder = vi.mocked(api.suggestFolder);

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: 7,
    uuid: 'abc-123',
    user_id: 1,
    profile_id: 1,
    title: 'Wildwood Flower',
    artist: 'The Carter Family',
    source_url: null,
    original_content: 'C F C',
    rewritten_content: 'C F C',
    changes_summary: null,
    llm_provider: null,
    llm_model: null,
    font_size: null,
    folder: null,
    status: 'completed',
    current_version: 1,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  } as Song;
}

function renderDialog(props: Partial<React.ComponentProps<typeof FolderSuggestDialog>> = {}) {
  const onPick = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <FolderSuggestDialog
      open
      onOpenChange={onOpenChange}
      song={makeSong()}
      model="gpt-4o"
      canUseAi
      onPick={onPick}
      onOpenSettings={vi.fn()}
      {...props}
    />,
  );
  return { onPick, onOpenChange };
}

describe('FolderSuggestDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSuggestFolder.mockResolvedValue([]);
  });

  it('names the price before it spends anything', async () => {
    renderDialog();

    // The cost is on screen, and no call has happened yet: opening the dialog
    // must never be what charges you.
    expect(screen.getByText('Uses 1 AI credit.')).toBeInTheDocument();
    expect(mockSuggestFolder).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Suggest a folder' }));
    await waitFor(() => expect(mockSuggestFolder).toHaveBeenCalledTimes(1));
    expect(mockSuggestFolder).toHaveBeenCalledWith(7, 'gpt-4o');
  });

  it('ranks existing folders above the proposed new one and marks the new one', async () => {
    mockSuggestFolder.mockResolvedValue([
      { folder: 'Hymns', is_new: false },
      { folder: 'Campfire', is_new: false },
      { folder: 'Carter Family', is_new: true },
    ]);
    renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Suggest a folder' }));

    const options = await screen.findAllByRole('button', { name: /Hymns|Campfire|Carter Family/ });
    expect(options.map((b) => b.textContent)).toEqual([
      'Hymns',
      'Campfire',
      'Carter FamilyNew folder',
    ]);
  });

  it('files nothing until a suggestion is tapped', async () => {
    mockSuggestFolder.mockResolvedValue([{ folder: 'Hymns', is_new: false }]);
    const { onPick } = renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Suggest a folder' }));
    await screen.findByRole('button', { name: 'Hymns' });
    // The suggestion is on screen and the chart is still unfiled.
    expect(onPick).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Hymns' }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ uuid: 'abc-123' }), 'Hymns');
  });

  it('gives a user with no folders a new one to accept', async () => {
    mockSuggestFolder.mockResolvedValue([{ folder: 'Carter Family', is_new: true }]);
    const { onPick } = renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Suggest a folder' }));
    await userEvent.click(await screen.findByRole('button', { name: /Carter Family/ }));

    expect(onPick).toHaveBeenCalledWith(expect.anything(), 'Carter Family');
  });

  it('offers nothing to spend when no model is configured', async () => {
    renderDialog({ canUseAi: false });

    // A self-hoster with no gateway gets an explanation, not a dead button, and
    // the rest of filing keeps working by hand.
    expect(
      screen.getByText(/Select a model to use the AI options/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suggest a folder' })).not.toBeInTheDocument();
    expect(screen.queryByText('Uses 1 AI credit.')).not.toBeInTheDocument();
  });

  it('surfaces a failure and offers a retry rather than an empty list', async () => {
    mockSuggestFolder.mockRejectedValue(
      Object.assign(new Error('The AI provider is having issues.'), {
        errorType: 'provider_error',
      }),
    );
    renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Suggest a folder' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The AI provider is having issues.');
    expect(screen.getByText('Issue with the AI provider')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says so plainly when nothing usable came back', async () => {
    mockSuggestFolder.mockResolvedValue([]);
    renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Suggest a folder' }));

    expect(await screen.findByText(/No suggestion this time/)).toBeInTheDocument();
  });
});
