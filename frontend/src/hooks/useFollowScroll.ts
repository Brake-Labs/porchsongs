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
  const { enabled, reducedMotion = false, minIntervalMs = 400, bandRatio = 0.22 } = opts;
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

  // Center the target line when it changes.
  useEffect(() => {
    if (!enabled || paused || targetIndex == null) return;
    const el = containerRef.current;
    if (!el) return;
    const target = el.querySelector(`[data-line="${targetIndex}"]`);
    if (!(target instanceof HTMLElement)) return;

    const now = Date.now();
    if (now - lastScrollAtRef.current < minIntervalMs) return;

    const targetCenter = target.offsetTop + target.offsetHeight / 2;
    const viewportCenter = el.scrollTop + el.clientHeight / 2;
    const band = el.clientHeight * bandRatio;
    if (Math.abs(viewportCenter - targetCenter) < band) return; // already centered enough

    lastScrollAtRef.current = now;
    el.scrollTo({
      top: Math.max(0, targetCenter - el.clientHeight / 2),
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  }, [targetIndex, enabled, paused, containerRef, minIntervalMs, bandRatio, reducedMotion]);

  const resume = useCallback(() => {
    lastScrollAtRef.current = 0;
    setPaused(false);
  }, []);

  return { paused, resume };
}
