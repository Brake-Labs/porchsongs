import { renderHook, act } from '@testing-library/react';
import { useFollowScroll } from './useFollowScroll';

/** Build a scroll container with one addressable, geometry-stubbed line. */
function makeContainer(opts: { clientHeight: number; scrollTop: number; lineTop: number; lineH: number }) {
  const el = document.createElement('div');
  const line = document.createElement('span');
  line.setAttribute('data-line', '5');
  el.appendChild(line);
  Object.defineProperty(el, 'clientHeight', { value: opts.clientHeight, configurable: true });
  el.scrollTop = opts.scrollTop;
  Object.defineProperty(line, 'offsetTop', { value: opts.lineTop, configurable: true });
  Object.defineProperty(line, 'offsetHeight', { value: opts.lineH, configurable: true });
  el.scrollTo = vi.fn();
  return { el, line };
}

describe('useFollowScroll', () => {
  it('scrolls to center a target that is outside the central band', () => {
    // line at y=1000 in a 400px viewport currently scrolled to top -> way below center
    const { el } = makeContainer({ clientHeight: 400, scrollTop: 0, lineTop: 1000, lineH: 20 });
    const ref = { current: el };
    renderHook(() => useFollowScroll(ref, 5, { enabled: true, reducedMotion: true }));
    // targetCenter = 1010, desired top = 1010 - 200 = 810
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 810, behavior: 'auto' });
  });

  it('does not scroll when the target is already within the band', () => {
    // viewportCenter = 200, target center = 210 -> within 0.22*400=88 band
    const { el } = makeContainer({ clientHeight: 400, scrollTop: 0, lineTop: 200, lineH: 20 });
    const ref = { current: el };
    renderHook(() => useFollowScroll(ref, 5, { enabled: true }));
    expect(el.scrollTo).not.toHaveBeenCalled();
  });

  it('pauses on a manual wheel gesture and resumes on demand', () => {
    const { el } = makeContainer({ clientHeight: 400, scrollTop: 0, lineTop: 1000, lineH: 20 });
    const ref = { current: el };
    const { result } = renderHook(() => useFollowScroll(ref, 5, { enabled: true }));
    expect(result.current.paused).toBe(false);
    act(() => {
      el.dispatchEvent(new Event('wheel'));
    });
    expect(result.current.paused).toBe(true);
    act(() => result.current.resume());
    expect(result.current.paused).toBe(false);
  });

  it('does nothing when disabled', () => {
    const { el } = makeContainer({ clientHeight: 400, scrollTop: 0, lineTop: 1000, lineH: 20 });
    const ref = { current: el };
    renderHook(() => useFollowScroll(ref, 5, { enabled: false }));
    expect(el.scrollTo).not.toHaveBeenCalled();
  });

  it('animates smoothly for a small in-view move', () => {
    // line center 310 vs viewport center 200: outside the 8% band, distance 110 < 400.
    const { el } = makeContainer({ clientHeight: 400, scrollTop: 0, lineTop: 300, lineH: 20 });
    const ref = { current: el };
    renderHook(() => useFollowScroll(ref, 5, { enabled: true }));
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 110, behavior: 'smooth' });
  });

  it('jumps instantly for a large catch-up (even without reduced motion)', () => {
    const { el } = makeContainer({ clientHeight: 400, scrollTop: 0, lineTop: 1000, lineH: 20 });
    const ref = { current: el };
    renderHook(() => useFollowScroll(ref, 5, { enabled: true }));
    // desired 810, distance > one viewport -> instant.
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 810, behavior: 'auto' });
  });
});

describe('useFollowScroll recenter', () => {
  it('centres a line that the dead zone would have left alone', () => {
    // Within the band, so the follow-along effect deliberately does not move. A
    // human asking to be re-centred must still be obeyed, otherwise the tap looks
    // broken on exactly the small drift someone taps to correct.
    const { el } = makeContainer({ clientHeight: 400, scrollTop: 0, lineTop: 200, lineH: 20 });
    const ref = { current: el };
    const { result } = renderHook(() => useFollowScroll(ref, 5, { enabled: true, reducedMotion: true }));
    expect(el.scrollTo).not.toHaveBeenCalled();

    act(() => result.current.recenter(5));

    expect(el.scrollTo).toHaveBeenCalledWith({ top: 10, behavior: 'auto' });
  });

  it('ignores the rate limit, so two taps in a row both move the page', () => {
    const { el } = makeContainer({ clientHeight: 400, scrollTop: 0, lineTop: 1000, lineH: 20 });
    const ref = { current: el };
    const { result } = renderHook(() => useFollowScroll(ref, 5, { enabled: true, reducedMotion: true }));
    const before = (el.scrollTo as ReturnType<typeof vi.fn>).mock.calls.length;

    act(() => result.current.recenter(5));
    act(() => result.current.recenter(5));

    expect((el.scrollTo as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before + 2);
  });

  it('re-arms auto-follow, because a tap also ends the manual scroll', () => {
    const { el } = makeContainer({ clientHeight: 400, scrollTop: 0, lineTop: 1000, lineH: 20 });
    const ref = { current: el };
    const { result } = renderHook(() => useFollowScroll(ref, 5, { enabled: true, reducedMotion: true }));
    act(() => { el.dispatchEvent(new Event('wheel')); });
    expect(result.current.paused).toBe(true);

    act(() => result.current.recenter(5));

    expect(result.current.paused).toBe(false);
  });

  it('falls back to the current target when called with no index', () => {
    const { el } = makeContainer({ clientHeight: 400, scrollTop: 0, lineTop: 1000, lineH: 20 });
    const ref = { current: el };
    const { result } = renderHook(() => useFollowScroll(ref, 5, { enabled: true, reducedMotion: true }));
    (el.scrollTo as ReturnType<typeof vi.fn>).mockClear();

    act(() => result.current.recenter());

    expect(el.scrollTo).toHaveBeenCalledWith({ top: 810, behavior: 'auto' });
  });

  it('does nothing when there is no target at all', () => {
    const { el } = makeContainer({ clientHeight: 400, scrollTop: 0, lineTop: 1000, lineH: 20 });
    const ref = { current: el };
    const { result } = renderHook(() => useFollowScroll(ref, null, { enabled: true }));

    act(() => result.current.recenter());

    expect(el.scrollTo).not.toHaveBeenCalled();
  });

  it('does not throw for a line that is not rendered', () => {
    const { el } = makeContainer({ clientHeight: 400, scrollTop: 0, lineTop: 1000, lineH: 20 });
    const ref = { current: el };
    const { result } = renderHook(() => useFollowScroll(ref, 5, { enabled: true }));
    (el.scrollTo as ReturnType<typeof vi.fn>).mockClear();

    act(() => result.current.recenter(999));

    expect(el.scrollTo).not.toHaveBeenCalled();
  });
});
