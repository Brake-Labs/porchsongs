import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseFollowScrollOptions {
  /** Whether follow-scrolling is active. */
  enabled: boolean;
  /** Jump instead of smooth-animate (respect prefers-reduced-motion). */
  reducedMotion?: boolean;
  /** Minimum ms between programmatic scrolls (rate limit). */
  minIntervalMs?: number;
  /** Central "dead zone" as a fraction of viewport height; inside it we don't scroll. */
  bandRatio?: number;
}

export interface UseFollowScrollResult {
  /** True once the user has scrolled by hand (auto-scroll suspended). */
  paused: boolean;
  /** Re-arm auto-scroll (the "Resume follow" affordance). */
  resume: () => void;
  /**
   * Centre a line right now, ignoring the dead zone and the rate limit, and re-arm
   * auto-scroll.
   *
   * The effect below only fires when `targetIndex` changes, which is right for
   * following along but wrong for a human asking to be re-centred: tapping the line
   * that is already the target would do nothing at all, and that is exactly the tap
   * someone makes when the highlight is correct but the page has drifted. Pass an
   * index to centre that line, or omit it for the current target.
   */
  recenter: (index?: number) => void;
}

/**
 * Keeps the element `[data-line="targetIndex"]` centered in a scroll container
 * while `enabled`. Debounced by a rate limit, quiet inside a central hysteresis
 * band (so tiny drifts don't jitter), and it steps aside the moment the user
 * scrolls by hand (wheel/touch/keyboard) until they resume. Our own programmatic
 * scrolls are ignored so they don't trip the manual-pause.
 */
export function useFollowScroll(
  containerRef: React.RefObject<HTMLElement | null>,
  targetIndex: number | null,
  opts: UseFollowScrollOptions,
): UseFollowScrollResult {
  const { enabled, reducedMotion = false, minIntervalMs = 250, bandRatio = 0.08 } = opts;
  const [paused, setPaused] = useState(false);
  const lastScrollAtRef = useRef(0);

  // Manual scroll (a human gesture) suspends auto-follow. wheel/touch/keydown are
  // only emitted by real user input, never by our programmatic scrollTo, so no
  // guard against our own scrolls is needed here.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;
    const onManual = () => {
      setPaused(true);
    };
    el.addEventListener('wheel', onManual, { passive: true });
    el.addEventListener('touchmove', onManual, { passive: true });
    el.addEventListener('keydown', onManual);
    return () => {
      el.removeEventListener('wheel', onManual);
      el.removeEventListener('touchmove', onManual);
      el.removeEventListener('keydown', onManual);
    };
  }, [containerRef, enabled]);

  // Reset pause when follow turns off.
  useEffect(() => {
    if (!enabled) setPaused(false);
  }, [enabled]);

  // Keeping the latest target in a ref so `recenter()` can be called with no
  // argument without being recreated on every line change.
  const targetIndexRef = useRef(targetIndex);
  targetIndexRef.current = targetIndex;

  /**
   * Scroll a line to the middle.
   *
   * `force` skips the dead zone and the rate limit. Those two exist to stop the
   * page twitching while it follows along, and both are wrong when a human has
   * asked to be re-centred.
   */
  const centerLine = useCallback(
    (index: number, force: boolean) => {
      const el = containerRef.current;
      if (!el) return;
      const target = el.querySelector(`[data-line="${index}"]`);
      if (!(target instanceof HTMLElement)) return;

      const now = Date.now();
      if (!force && now - lastScrollAtRef.current < minIntervalMs) return;

      const targetCenter = target.offsetTop + target.offsetHeight / 2;
      const viewportCenter = el.scrollTop + el.clientHeight / 2;
      const band = el.clientHeight * bandRatio;
      // Already centred enough. Skipped when forced, so a deliberate tap always
      // moves the page rather than appearing to do nothing.
      if (!force && Math.abs(viewportCenter - targetCenter) < band) return;

      const desiredTop = Math.max(0, targetCenter - el.clientHeight / 2);
      // Small line-to-line moves animate smoothly; a big catch-up (verse jump, or
      // the arbiter relocating us) jumps instantly so it can't lag behind the song.
      const bigJump = Math.abs(desiredTop - el.scrollTop) > el.clientHeight;
      lastScrollAtRef.current = now;
      el.scrollTo({
        top: desiredTop,
        behavior: reducedMotion || bigJump ? 'auto' : 'smooth',
      });
    },
    [containerRef, minIntervalMs, bandRatio, reducedMotion],
  );

  // Center the target line when it changes.
  useEffect(() => {
    if (!enabled || paused || targetIndex == null) return;
    centerLine(targetIndex, false);
  }, [targetIndex, enabled, paused, centerLine]);

  const resume = useCallback(() => {
    lastScrollAtRef.current = 0;
    setPaused(false);
  }, []);

  const recenter = useCallback(
    (index?: number) => {
      const target = index ?? targetIndexRef.current;
      // A tap is also the user saying they are done scrolling by hand, so auto-follow
      // picks up from the line they just chose. The rate limit is not reset here:
      // `force` is what lets this bypass it, and zeroing the timestamp as well would
      // make that flag untestable by making it redundant.
      setPaused(false);
      if (target == null) return;
      centerLine(target, true);
    },
    [centerLine],
  );

  return { paused, resume, recenter };
}
