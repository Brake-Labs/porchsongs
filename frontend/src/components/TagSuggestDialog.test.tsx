import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TagSuggestDialog from '@/components/TagSuggestDialog';
import type { Song } from '@/types';

vi.mock('@/api', () => ({
  default: { suggestTags: vi.fn() },
}));

import api from '@/api';

const mockSuggestTags = vi.mocked(api.suggestTags);

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
    tags: [],
    status: 'completed',
    current_version: 1,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  } as Song;
}

function renderDialog(props: Partial<React.ComponentProps<typeof TagSuggestDialog>> = {}) {
  const onApply = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <TagSuggestDialog
      open
      onOpenChange={onOpenChange}
      song={makeSong()}
      model="gpt-4o"
      canUseAi
      onApply={onApply}
      onOpenSettings={vi.fn()}
      {...props}
    />,
  );
  return { onApply, onOpenChange };
}

describe('TagSuggestDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSuggestTags.mockResolvedValue([]);
  });

  it('names the price before it spends anything', async () => {
    renderDialog();

    // The cost is on screen, and no call has happened yet: opening the dialog
    // must never be what charges you.
    expect(screen.getByText('Uses 1 AI credit.')).toBeInTheDocument();
    expect(mockSuggestTags).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Suggest tags' }));
    await waitFor(() => expect(mockSuggestTags).toHaveBeenCalledTimes(1));
    expect(mockSuggestTags).toHaveBeenCalledWith(7, 'gpt-4o');
  });

  it('ranks tags you already use above a proposed new one and marks the new one', async () => {
    mockSuggestTags.mockResolvedValue([
      { tag: 'Hymns', count: 12 },
      { tag: 'Campfire', count: 3 },
      { tag: 'Carter Family', count: 0 },
    ]);
    renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Suggest tags' }));

    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes.map((b) => b.closest('label')!.textContent)).toEqual([
      'Hymns',
      'Campfire',
      'Carter FamilyNew tag',
    ]);
  });

  it('saves nothing until the tags are applied', async () => {
    mockSuggestTags.mockResolvedValue([{ tag: 'Hymns', count: 12 }]);
    const { onApply } = renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Suggest tags' }));
    await screen.findByRole('checkbox');
    // The suggestion is on screen and the chart is still untagged.
    expect(onApply).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Add 1 tag' }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ uuid: 'abc-123' }), ['Hymns']);
  });

  it('applies everything still ticked in one save', async () => {
    // A credit has already been spent, so ticked-by-default is the right
    // starting point. Unticking one must not cost a second run.
    mockSuggestTags.mockResolvedValue([
      { tag: 'Hymns', count: 12 },
      { tag: 'Waltz', count: 4 },
      { tag: 'Carter Family', count: 0 },
    ]);
    const { onApply } = renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Suggest tags' }));
    await screen.findAllByRole('checkbox');

    await userEvent.click(screen.getByRole('checkbox', { name: /Waltz/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add 2 tags' }));

    expect(onApply).toHaveBeenCalledWith(expect.anything(), ['Hymns', 'Carter Family']);
  });

  it('keeps the tags a song already has when it adds the new ones', async () => {
    mockSuggestTags.mockResolvedValue([
      { tag: 'Hymns', count: 12 },
      // Already on the song. Applying must not list it twice.
      { tag: 'Waltz', count: 4 },
    ]);
    const { onApply } = renderDialog({ song: makeSong({ tags: ['Waltz'] }) });

    await userEvent.click(screen.getByRole('button', { name: 'Suggest tags' }));
    await screen.findAllByRole('checkbox');
    await userEvent.click(screen.getByRole('button', { name: 'Add 2 tags' }));

    expect(onApply).toHaveBeenCalledWith(expect.anything(), ['Waltz', 'Hymns']);
  });

  it('has nothing to apply once everything is unticked', async () => {
    mockSuggestTags.mockResolvedValue([{ tag: 'Hymns', count: 12 }]);
    renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Suggest tags' }));
    await userEvent.click(await screen.findByRole('checkbox'));

    expect(screen.getByRole('button', { name: 'Add 0 tags' })).toBeDisabled();
  });

  it('offers nothing to spend when no model is configured', async () => {
    renderDialog({ canUseAi: false });

    // A self-hoster with no gateway gets an explanation, not a dead button, and
    // the rest of tagging keeps working by hand.
    expect(
      screen.getByText(/Select a model to use the AI options/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suggest tags' })).not.toBeInTheDocument();
    expect(screen.queryByText('Uses 1 AI credit.')).not.toBeInTheDocument();
  });

  it('surfaces a failure and offers a retry rather than an empty list', async () => {
    mockSuggestTags.mockRejectedValue(
      Object.assign(new Error('The AI provider is having issues.'), {
        errorType: 'provider_error',
      }),
    );
    renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Suggest tags' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The AI provider is having issues.');
    expect(screen.getByText('Issue with the AI provider')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says so plainly when nothing usable came back', async () => {
    mockSuggestTags.mockResolvedValue([]);
    renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Suggest tags' }));

    expect(await screen.findByText(/No suggestion this time/)).toBeInTheDocument();
  });
});
