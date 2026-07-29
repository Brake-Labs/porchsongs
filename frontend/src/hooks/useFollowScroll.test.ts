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
});
