import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '@/api';
import BulkLinkImportDialog, { parseUrlList } from '@/components/BulkLinkImportDialog';

/**
 * The importer's contract: every pasted link becomes exactly one library row or
 * one visible explanation of why not - a duplicate skip, or a per-row failure
 * that never halts the rest of the run - and it all happens without an LLM call.
 */

vi.mock('@/api', () => ({
  default: {
    scrapeUrl: vi.fn(),
    saveSong: vi.fn(),
  },
}));

const scrapeUrl = vi.mocked(api.scrapeUrl);
const saveSong = vi.mocked(api.saveSong);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseUrlList', () => {
  it('extracts http(s) URLs, deduped, in order, ignoring junk lines', () => {
    const text = [
      'https://a.example/one',
      'not a url',
      '  https://a.example/two  ',
      'https://a.example/one',
      'ftp://a.example/nope',
      'http://b.example/three',
    ].join('\n');
    expect(parseUrlList(text)).toEqual([
      'https://a.example/one',
      'https://a.example/two',
      'http://b.example/three',
    ]);
  });
});

function setup(overrides: Partial<Parameters<typeof BulkLinkImportDialog>[0]> = {}) {
  const onOpenChange = vi.fn();
  const onImported = vi.fn();
  render(
    <BulkLinkImportDialog
      open
      onOpenChange={onOpenChange}
      profileId={1}
      existingSourceUrls={new Set()}
      onImported={onImported}
      delayMs={0}
      {...overrides}
    />,
  );
  return { onOpenChange, onImported };
}

function pasteLinks(text: string) {
  fireEvent.change(screen.getByLabelText('Links to import'), { target: { value: text } });
}

it('counts pasted links and disables the button with none', () => {
  setup();
  expect(screen.getByRole('button', { name: /Import\s+links?/ })).toBeDisabled();
  pasteLinks('https://a.example/one\njunk\nhttps://a.example/two');
  expect(screen.getByText('2 links found')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Import 2 links/ })).toBeEnabled();
});

it('imports each link by scraping and saving it verbatim, with no AI call', async () => {
  const user = userEvent.setup();
  scrapeUrl.mockResolvedValue({
    text: 'G  C\nlyrics',
    title: 'A Song',
    artist: 'An Artist',
    source_url: 'https://a.example/one',
  });
  saveSong.mockResolvedValue({} as never);
  setup();

  pasteLinks('https://a.example/one\nhttps://a.example/two');
  await user.click(screen.getByRole('button', { name: /Import 2 links/ }));

  await screen.findByText('Done: 2 imported, 0 skipped, 0 failed');
  expect(scrapeUrl).toHaveBeenCalledTimes(2);
  expect(saveSong).toHaveBeenCalledTimes(2);
  expect(saveSong).toHaveBeenCalledWith({
    profile_id: 1,
    title: 'A Song',
    artist: 'An Artist',
    source_url: 'https://a.example/one',
    original_content: 'G  C\nlyrics',
    rewritten_content: 'G  C\nlyrics',
    tags: [],
  });
});

it('skips links already in the library without fetching them', async () => {
  const user = userEvent.setup();
  scrapeUrl.mockResolvedValue({
    text: 'x',
    title: null,
    artist: null,
    source_url: 'https://a.example/new',
  });
  saveSong.mockResolvedValue({} as never);
  setup({ existingSourceUrls: new Set(['https://a.example/old']) });

  pasteLinks('https://a.example/old\nhttps://a.example/new');
  await user.click(screen.getByRole('button', { name: /Import 2 links/ }));

  await screen.findByText('Done: 1 imported, 1 skipped, 0 failed');
  expect(scrapeUrl).toHaveBeenCalledTimes(1);
  expect(scrapeUrl).toHaveBeenCalledWith({ profile_id: 1, url: 'https://a.example/new' });
  expect(screen.getByText('Already in library')).toBeInTheDocument();
});

it('keeps going when one link fails, and says why on the row', async () => {
  const user = userEvent.setup();
  scrapeUrl
    .mockRejectedValueOnce(new Error('That page has no chart on it.'))
    .mockResolvedValueOnce({
      text: 'x',
      title: null,
      artist: null,
      source_url: 'https://a.example/two',
    });
  saveSong.mockResolvedValue({} as never);
  setup();

  pasteLinks('https://a.example/one\nhttps://a.example/two');
  await user.click(screen.getByRole('button', { name: /Import 2 links/ }));

  await screen.findByText('Done: 1 imported, 0 skipped, 1 failed');
  expect(screen.getByText('That page has no chart on it.')).toBeInTheDocument();
  expect(saveSong).toHaveBeenCalledTimes(1);
});

it('reloads the library on close only when something was imported', async () => {
  const user = userEvent.setup();
  scrapeUrl.mockResolvedValue({
    text: 'x',
    title: null,
    artist: null,
    source_url: 'https://a.example/one',
  });
  saveSong.mockResolvedValue({} as never);
  const { onOpenChange, onImported } = setup();

  pasteLinks('https://a.example/one');
  await user.click(screen.getByRole('button', { name: /Import 1 link/ }));
  await screen.findByText('Done: 1 imported, 0 skipped, 0 failed');

  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(onImported).toHaveBeenCalledTimes(1);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('does not reload the library when the run imported nothing', async () => {
  const user = userEvent.setup();
  scrapeUrl.mockRejectedValue(new Error('nope'));
  const { onImported } = setup();

  pasteLinks('https://a.example/one');
  await user.click(screen.getByRole('button', { name: /Import 1 link/ }));
  await screen.findByText('Done: 0 imported, 0 skipped, 1 failed');

  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(onImported).not.toHaveBeenCalled();
});

it('a stop request lands on the summary with the rest untouched', async () => {
  const user = userEvent.setup();
  let releaseFirst: (() => void) | undefined;
  scrapeUrl.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        releaseFirst = () =>
          resolve({ text: 'x', title: null, artist: null, source_url: 'https://a.example/one' });
      }),
  );
  saveSong.mockResolvedValue({} as never);
  setup();

  pasteLinks('https://a.example/one\nhttps://a.example/two\nhttps://a.example/three');
  await user.click(screen.getByRole('button', { name: /Import 3 links/ }));

  await user.click(await screen.findByRole('button', { name: 'Stop after this one' }));
  releaseFirst?.();

  await screen.findByText(/Done: 1 imported/);
  expect(scrapeUrl).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText('Canceled')).toHaveLength(2);
});
