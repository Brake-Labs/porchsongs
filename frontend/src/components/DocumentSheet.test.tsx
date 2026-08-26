import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DocumentSheet from '@/components/DocumentSheet';

/**
 * pdf.js is mocked wholesale. These tests are about the surface a performer
 * touches, which is paging, zoom, and what happens when a file will not open;
 * none of that needs a real rasteriser, and running one in jsdom would test
 * canvas rather than this component.
 */

const { openPdf, closePdf, renderPage } = vi.hoisted(() => ({
  openPdf: vi.fn(),
  closePdf: vi.fn().mockResolvedValue(undefined),
  renderPage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/pdfViewer', () => ({ openPdf, closePdf, renderPage }));

function fakePdf(numPages: number) {
  return { numPages, getPage: vi.fn() };
}

const BYTES = new ArrayBuffer(8);

beforeEach(() => {
  vi.clearAllMocks();
  renderPage.mockResolvedValue(undefined);
  closePdf.mockResolvedValue(undefined);
});

it('shows a spinner until the document parses', async () => {
  let resolve: (v: unknown) => void = () => {};
  openPdf.mockReturnValue(new Promise((r) => (resolve = r)));
  render(<DocumentSheet data={BYTES} />);

  expect(screen.getByText('Loading tab...')).toBeInTheDocument();
  resolve(fakePdf(2));
  await waitFor(() => expect(screen.queryByText('Loading tab...')).not.toBeInTheDocument());
});

it('reports the page count and starts on page one', async () => {
  openPdf.mockResolvedValue(fakePdf(12));
  const onPageCount = vi.fn();
  render(<DocumentSheet data={BYTES} onPageCount={onPageCount} />);

  expect(await screen.findByText('1 / 12')).toBeInTheDocument();
  expect(onPageCount).toHaveBeenCalledWith(12);
});

it('pages forward and back, and stops at both ends', async () => {
  openPdf.mockResolvedValue(fakePdf(2));
  render(<DocumentSheet data={BYTES} />);
  await screen.findByText('1 / 2');

  // At page one there is nowhere back to go, so the control says so rather than
  // silently doing nothing under a thumb.
  expect(screen.getByLabelText('Previous page')).toBeDisabled();

  await userEvent.click(screen.getByLabelText('Next page'));
  expect(await screen.findByText('2 / 2')).toBeInTheDocument();
  expect(screen.getByLabelText('Next page')).toBeDisabled();

  await userEvent.click(screen.getByLabelText('Previous page'));
  expect(await screen.findByText('1 / 2')).toBeInTheDocument();
});

it('turns pages from the keyboard, for a pedal or a bluetooth turner', async () => {
  openPdf.mockResolvedValue(fakePdf(3));
  render(<DocumentSheet data={BYTES} />);
  await screen.findByText('1 / 3');

  await userEvent.keyboard('{ArrowRight}');
  expect(await screen.findByText('2 / 3')).toBeInTheDocument();

  await userEvent.keyboard('{ArrowLeft}');
  expect(await screen.findByText('1 / 3')).toBeInTheDocument();
});

it('re-renders the page at the new scale when zoom changes', async () => {
  openPdf.mockResolvedValue(fakePdf(1));
  render(<DocumentSheet data={BYTES} />);
  await screen.findByText('1 / 1');
  const lastWidth = (): number => {
    const calls = renderPage.mock.calls;
    return calls[calls.length - 1]?.[3] as number;
  };
  const widthAtFit = lastWidth();

  await userEvent.click(screen.getByLabelText('Zoom in'));
  await screen.findByText('125%');
  await waitFor(() => {
    expect(lastWidth()).toBeGreaterThan(widthAtFit);
  });
});

it('explains a file it cannot open instead of showing a blank sheet', async () => {
  openPdf.mockRejectedValue(new Error('Invalid PDF structure.'));
  render(<DocumentSheet data={BYTES} />);

  expect(await screen.findByText('Could not open this file')).toBeInTheDocument();
  expect(screen.getByText('Invalid PDF structure.')).toBeInTheDocument();
});

it('releases the document on unmount', async () => {
  const pdf = fakePdf(1);
  openPdf.mockResolvedValue(pdf);
  const { unmount } = render(<DocumentSheet data={BYTES} />);
  await screen.findByText('1 / 1');

  unmount();
  await waitFor(() => expect(closePdf).toHaveBeenCalledWith(pdf));
});
