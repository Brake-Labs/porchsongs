import { renderHook } from '@testing-library/react';
import usePerformanceLayout from './usePerformanceLayout';

/**
 * The chart's layout solver, at the one input it cannot do anything sensible
 * with: a container that has been hidden.
 *
 * The chord panel hides the chart at phone width rather than unmounting it, so
 * its effects keep running against an element whose box is now 0x0. Solving
 * against that answers with the minimum font.
 */

const TEXT = [
  '[Verse 1]',
  'G           C        G',
  'Oh I will twine with my mingled waves',
  'D                    G',
  'And the pale aronatus',
].join('\n');

function sizedContainer(width: number, height: number): HTMLElement {
  const el = document.createElement('div');
  resize(el, width, height);
  return el;
}

function resize(el: HTMLElement, width: number, height: number): void {
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
}

describe('usePerformanceLayout', () => {
  it('measures a container that has a size', () => {
    const ref = { current: sizedContainer(900, 700) };
    const { result } = renderHook(() => usePerformanceLayout(ref, TEXT, 'auto'));

    expect(result.current.fontSize).toBeGreaterThan(10);
  });

  it('keeps the last real measurement when the container is hidden', () => {
    // Without this the chart drops to the minimum font while it is off screen,
    // which is invisible until the panel closes and the chart comes back at
    // 10px for a frame. Tapping the size stepper in that window would step from
    // 10 rather than from the size that was actually being read.
    const el = sizedContainer(900, 700);
    const ref = { current: el };
    const { result, rerender } = renderHook(
      ({ pref }: { pref: number | 'auto' }) => usePerformanceLayout(ref, TEXT, pref),
      { initialProps: { pref: 'auto' as number | 'auto' } },
    );

    const measured = result.current.fontSize;
    expect(measured).toBeGreaterThan(10);

    // What `display: none` does to the box. Changing the column preference is
    // just a way to make the effect run again while it is in that state.
    resize(el, 0, 0);
    rerender({ pref: 1 });

    expect(result.current.fontSize).toBe(measured);
  });
});
