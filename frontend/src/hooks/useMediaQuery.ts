import { useState, useEffect } from 'react';

/** Tracks a CSS media query, so a component can render one layout or another
 * instead of mounting both and hiding one. Rendering both is not free: every
 * control exists twice for tests and screen readers, and effects in the hidden
 * copy still run. */
export default function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
