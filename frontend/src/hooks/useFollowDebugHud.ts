import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether the Follow diagnostics panel is showing.
 *
 * Shared rather than owned by the panel, because the control that opens it and
 * the panel itself are on opposite sides of the tree: the switch is an item in
 * the chart actions menu on the play route, and the panel is layered over the
 * performance sheet several levels down. Threading a prop between them would
 * mean widening `PerformanceSheet`'s signature for something it does not use.
 *
 * The preference is remembered across songs. The panel remounts on every song,
 * so a per-mount choice would come back over and over through a set. It starts
 * closed: turning capture on for an account says logs may be uploaded, not that
 * diagnostics should sit over the bottom-right of every chart from then on.
 */
const HUD_STORAGE_KEY = 'porchsongs.followDebugHud';

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Storage is the source of truth, read fresh rather than cached in a module
 * variable: it returns a boolean, so React compares it by value and a re-read
 * cannot loop, and nothing has to be reset between tests or kept in step.
 *
 * `session` is the fallback for private mode and for storage being disabled,
 * where the choice cannot outlive the tab but still has to work inside it.
 */
let session = false;
let storageUsable = true;

function getSnapshot(): boolean {
  if (!storageUsable) return session;
  try {
    return window.localStorage.getItem(HUD_STORAGE_KEY) === 'shown';
  } catch {
    storageUsable = false;
    return session;
  }
}

export function setFollowDebugHud(open: boolean): void {
  session = open;
  try {
    window.localStorage.setItem(HUD_STORAGE_KEY, open ? 'shown' : 'hidden');
  } catch {
    storageUsable = false;
  }
  for (const listener of listeners) listener();
}

export default function useFollowDebugHud(): [boolean, () => void] {
  const open = useSyncExternalStore(subscribe, getSnapshot, () => false);
  const toggle = useCallback(() => setFollowDebugHud(!open), [open]);
  return [open, toggle];
}
