import { useState, useEffect } from 'react';

/** Detects whether the app is running as an installed PWA (standalone mode). */
export default function useIsStandalone(): boolean {
  const [standalone, setStandalone] = useState(() => {
    if (typeof window === 'undefined') return false;
    // iOS Safari
    if ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone) return true;
    // Standard display-mode media query (Android Chrome, desktop)
    return window.matchMedia('(display-mode: standalone)').matches;
  });

  useEffect(() => {
    const mq = window.matchMedia('(display-mode: standalone)');
    const handler = (e: MediaQueryListEvent) => setStandalone(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return standalone;
}
