import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DocumentSheet from '@/components/DocumentSheet';

/**
 * pdf.js is mocked wholesale. These tests are about the surface a performer
 * touches, which is paging, zoom, and what happens when a file will not open;
 * none of that needs a real rasteriser, and running one in jsdom would test
 * canvas rather than this component.
 */

const { openPdf, closePdf, renderPage, cancelRender } = vi.hoisted(() => ({
  openPdf: vi.fn(),
  closePdf: vi.fn().mockResolvedValue(undefined),
  renderPage: vi.fn(),
  cancelRender: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/pdfViewer', () => ({ openPdf, closePdf, renderPage, cancelRender }));

/** A stand-in for a pdf.js RenderTask. */
function fakeTask(promise: Promise<void> = Promise.resolve()) {
  return { promise, cancel: vi.fn() };
}

function fakePdf(numPages: number) {
  return { numPages, getPage: vi.fn() };
}

const BYTES = new ArrayBuffer(8);

beforeEach(() => {
  vi.clearAllMocks();
  renderPage.mockImplementation(() => Promise.resolve(fakeTask()));
  closePdf.mockResolvedValue(undefined);
  cancelRender.mockResolvedValue(undefined);
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

it('re-renders the page at a larger scale when zoom changes', async () => {
  openPdf.mockResolvedValue(fakePdf(1));
  render(<DocumentSheet data={BYTES} />);
  await screen.findByText('1 / 1');
  const lastWidth = (): number => {
    const calls = renderPage.mock.calls;
    return (calls[calls.length - 1]?.[4] as number) ?? 1;
  };
  const zoomAtFit = lastWidth();

  await userEvent.click(screen.getByLabelText('Zoom in'));
  await screen.findByText('125%');
  await waitFor(() => {
    expect(lastWidth()).toBeGreaterThan(zoomAtFit);
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

it('cancels a running render before starting the next one', async () => {
  // pdf.js refuses two renders against one canvas, and cancel() only asks: the
  // previous task has to be awaited before the next render touches the canvas.
  // Discarding the result was not enough, and a real browser failed with
  // "Cannot use the same canvas during multiple render() operations" on the
  // first page turn.
  openPdf.mockResolvedValue(fakePdf(4));
  const firstTask = fakeTask(new Promise(() => {}));
  renderPage.mockImplementationOnce(() => Promise.resolve(firstTask));
  render(<DocumentSheet data={BYTES} />);
  await screen.findByText('1 / 4');

  await userEvent.click(screen.getByLabelText('Next page'));
  await waitFor(() => expect(cancelRender).toHaveBeenCalledWith(firstTask));
});

it('stops a render still running when the sheet unmounts', async () => {
  openPdf.mockResolvedValue(fakePdf(1));
  const task = fakeTask(new Promise(() => {}));
  renderPage.mockImplementation(() => Promise.resolve(task));
  const { unmount } = render(<DocumentSheet data={BYTES} />);
  await screen.findByText('1 / 1');

  unmount();
  await waitFor(() => expect(cancelRender).toHaveBeenCalledWith(task));
});

/**
 * Turning pages with a hand that is holding an instrument.
 *
 * The buttons are 44px at the bottom edge of the screen, which on a phone
 * propped on a stand is the far corner. A swipe is a target the size of the
 * page.
 */
describe('gestures', () => {
  /** jsdom builds no TouchEvent, so the handlers are driven directly. */
  function swipe(
    el: HTMLElement,
    { from, to, ms = 120 }: { from: number; to: number; ms?: number },
  ) {
    const touch = (x: number) => ({ clientX: x, clientY: 200 });
    fireEvent.touchStart(el, { touches: [touch(from)] });
    vi.advanceTimersByTime(ms);
    fireEvent.touchEnd(el, { changedTouches: [touch(to)] });
  }

  async function ready(pages = 3) {
    openPdf.mockResolvedValue(fakePdf(pages));
    render(<DocumentSheet data={BYTES} />);
    await waitFor(() => expect(screen.getByLabelText('Page 1')).toBeInTheDocument());
    return screen.getByTestId('document-scroll');
  }

  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('turns forward on a swipe left and back on a swipe right', async () => {
    const el = await ready();

    swipe(el, { from: 300, to: 100 });
    await waitFor(() => expect(screen.getByLabelText('Page 2')).toBeInTheDocument());

    swipe(el, { from: 100, to: 300 });
    await waitFor(() => expect(screen.getByLabelText('Page 1')).toBeInTheDocument());
  });

  it('stops at the ends rather than wrapping', async () => {
    const el = await ready(2);

    swipe(el, { from: 100, to: 300 });
    expect(screen.getByLabelText('Page 1')).toBeInTheDocument();

    swipe(el, { from: 300, to: 100 });
    await waitFor(() => expect(screen.getByLabelText('Page 2')).toBeInTheDocument());
    swipe(el, { from: 300, to: 100 });
    expect(screen.getByLabelText('Page 2')).toBeInTheDocument();
  });

  it('ignores a mostly vertical drag, which is a scroll', async () => {
    const el = await ready();

    fireEvent.touchStart(el, { touches: [{ clientX: 300, clientY: 100 }] });
    fireEvent.touchEnd(el, { changedTouches: [{ clientX: 240, clientY: 500 }] });

    expect(screen.getByLabelText('Page 1')).toBeInTheDocument();
  });

  it('ignores a short drag, which is a wobble', async () => {
    const el = await ready();
    swipe(el, { from: 300, to: 270 });
    expect(screen.getByLabelText('Page 1')).toBeInTheDocument();
  });

  it('ignores a slow drag, which was meant to pan', async () => {
    const el = await ready();
    swipe(el, { from: 300, to: 100, ms: 900 });
    expect(screen.getByLabelText('Page 1')).toBeInTheDocument();
  });

  it('pans a zoomed page instead of turning, until it reaches the edge', async () => {
    const el = await ready();
    // A zoomed page: wider than its box, and scrolled to the middle.
    Object.defineProperty(el, 'scrollWidth', { value: 1000, configurable: true });
    Object.defineProperty(el, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty(el, 'scrollLeft', { value: 300, writable: true, configurable: true });

    swipe(el, { from: 300, to: 100 });
    expect(screen.getByLabelText('Page 1')).toBeInTheDocument();

    // Panned to the right-hand edge, the same gesture now turns the page.
    (el as unknown as { scrollLeft: number }).scrollLeft = 600;
    swipe(el, { from: 300, to: 100 });
    await waitFor(() => expect(screen.getByLabelText('Page 2')).toBeInTheDocument());
  });

  it('toggles zoom on a double tap', async () => {
    const el = await ready();
    const tap = () => {
      fireEvent.touchStart(el, { touches: [{ clientX: 200, clientY: 200 }] });
      fireEvent.touchEnd(el, { changedTouches: [{ clientX: 200, clientY: 200 }] });
    };

    tap();
    tap();
    await waitFor(() => expect(screen.getByLabelText(/Zoom: 200 percent/)).toBeInTheDocument());

    tap();
    tap();
    await waitFor(() => expect(screen.getByLabelText(/Zoom: 100 percent/)).toBeInTheDocument());
  });

  it('does not zoom on two taps far apart in time', async () => {
    const el = await ready();
    const tap = () => {
      fireEvent.touchStart(el, { touches: [{ clientX: 200, clientY: 200 }] });
      fireEvent.touchEnd(el, { changedTouches: [{ clientX: 200, clientY: 200 }] });
    };

    tap();
    vi.advanceTimersByTime(600);
    tap();

    expect(screen.getByLabelText(/Zoom: 100 percent/)).toBeInTheDocument();
  });

  it('leaves a pinch to the browser', async () => {
    const el = await ready();
    fireEvent.touchStart(el, {
      touches: [{ clientX: 300, clientY: 200 }, { clientX: 100, clientY: 200 }],
    });
    fireEvent.touchEnd(el, { changedTouches: [{ clientX: 100, clientY: 200 }] });

    expect(screen.getByLabelText('Page 1')).toBeInTheDocument();
  });

  it('flashes the page number, since the bar is not where your eyes are', async () => {
    const el = await ready();
    swipe(el, { from: 300, to: 100 });

    await waitFor(() => expect(screen.getAllByText('2 / 3').length).toBe(2));
    vi.advanceTimersByTime(1400);
    await waitFor(() => expect(screen.getAllByText('2 / 3').length).toBe(1));
  });
});
