import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import ChordExplorer, { InstrumentField } from './ChordExplorer';
import { STORAGE_KEYS } from '@/api';
import { chordName, type Chord } from '@/lib/chords/theory';
import type { ChordPanelState } from '@/hooks/useChordPanel';
import { cn } from '@/lib/utils';

/**
 * The chord dictionary, opened beside a chart you are playing.
 *
 * The whole reason this is not just a link to /app/chords is the row near the
 * top: the chords this chart actually uses, one tap away. Mid-song, with an
 * instrument in your lap, hunting for a root and a quality in a twelve by
 * fourteen grid is not something anyone is going to do.
 *
 * One element for both layouts rather than a drawer and a panel. On a phone it
 * fills the surface and the chart is hidden behind it with `display: none`,
 * which takes the chart out of the tab order and out of the accessibility tree
 * and so gives a full screen without needing a portal or a focus trap. From
 * `lg` up the same element is a column beside the chart, which reflows to make
 * room, and can be dragged wider.
 */

/**
 * Width limits for the docked column, in px.
 *
 * The floor is about where two diagrams stop fitting side by side; below that
 * the panel is a single column of shapes and the chart has lost width for
 * nothing. The ceiling is where it stops being a sidebar. `DEFAULT_WIDTH` is
 * 22rem, which is what it was fixed at before it could be dragged.
 */
const MIN_WIDTH = 280;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 352;
/** Width the chart keeps whatever the panel is dragged to. */
const CHART_MIN_WIDTH = 360;
/** One press of an arrow key on the handle. */
const KEYBOARD_STEP = 16;

function clampWidth(px: number): number {
  const room =
    typeof window === 'undefined' ? MAX_WIDTH : window.innerWidth - CHART_MIN_WIDTH;
  return Math.round(Math.min(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, room)), Math.max(MIN_WIDTH, px)));
}

function readStoredWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_KEYS.CHORD_PANEL_WIDTH));
    return Number.isFinite(stored) && stored > 0 ? clampWidth(stored) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

interface ChordPanelProps {
  state: ChordPanelState;
  className?: string;
}

export default function ChordPanel({ state, className }: ChordPanelProps) {
  const { songChords, selection, change, showAllQualities, toggleAllQualities, close } = state;
  const headingId = useId();
  const songChordsId = useId();
  const ref = useRef<HTMLElement>(null);

  // Read on mount rather than held above, because the panel unmounts when it is
  // closed and storage is already the thing that carries the width between
  // sessions.
  const [width, setWidth] = useState(readStoredWidth);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const applyWidth = useCallback((next: number) => {
    const clamped = clampWidth(next);
    setWidth(clamped);
    try {
      window.localStorage.setItem(STORAGE_KEYS.CHORD_PANEL_WIDTH, String(clamped));
    } catch {
      /* storage unavailable; the drag still works for this session */
    }
  }, []);

  // A window that shrinks below what the stored width leaves the chart takes the
  // panel down with it, rather than pushing the chart off the side.
  useEffect(() => {
    const onResize = () => setWidth(prev => clampWidth(prev));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Focus lands in the panel when it opens, so a keyboard or screen reader user
  // is put where they just asked to go, and so Escape below has something to
  // fire on. It goes back to whatever opened it on the way out: closing with the
  // panel's own button unmounts the element focus is sitting on, and the browser
  // then drops focus to <body>, restarting Tab at the top of the surface.
  useEffect(() => {
    const opener = document.activeElement;
    ref.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // Bound to the panel rather than the window on purpose. A window listener
  // would also fire while the tuner is open over the top of this, closing both
  // with one press.
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };

  const onHandleDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    drag.current = { startX: event.clientX, startWidth: width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onHandleMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    // The panel is on the right, so dragging the handle left makes it wider.
    applyWidth(drag.current.startWidth - (event.clientX - drag.current.startX));
  };

  const onHandleUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onHandleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') applyWidth(width + KEYBOARD_STEP);
    else if (event.key === 'ArrowRight') applyWidth(width - KEYBOARD_STEP);
    else return;
    event.preventDefault();
  };

  return (
    <aside
      ref={ref}
      tabIndex={-1}
      aria-labelledby={headingId}
      onKeyDown={handleKeyDown}
      // The width rides on a custom property so it only applies from `lg` up,
      // where the class below reads it. On a phone the panel is `flex-1` and a
      // dragged width would fight the full-screen layout.
      style={{ '--chord-panel-width': `${width}px` } as React.CSSProperties}
      className={cn(
        'relative flex flex-col min-h-0 bg-background focus:outline-none',
        'lg:w-[var(--chord-panel-width)] lg:border-l lg:border-border',
        className,
      )}
    >
      {/* Drag edge. Docked layout only: on a phone the panel is the whole
          surface and there is nothing to take width from. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chord panel"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
        onKeyDown={onHandleKeyDown}
        onDoubleClick={() => applyWidth(DEFAULT_WIDTH)}
        title="Drag to resize. Double-click to reset."
        className="hidden lg:flex absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none select-none items-stretch justify-center group focus-visible:outline-none"
      >
        <div className="w-px bg-transparent group-hover:bg-primary group-active:bg-primary group-focus-visible:bg-primary transition-colors" />
      </div>

      <header className="shrink-0 flex items-center gap-2 px-3 py-1 border-b border-border">
        <h2 id={headingId} className="flex-1 font-display text-lg text-foreground">
          Chords
        </h2>
        <button
          type="button"
          onClick={close}
          aria-label="Close chords"
          className="min-w-[2.75rem] min-h-[2.75rem] inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-panel hover:text-foreground cursor-pointer"
        >
          &times;
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-5">
        {/* Which instrument you are holding decides what every shape below
            means, including the ones in the row of this song's chords, so it
            sits above them rather than under them. */}
        <div className="rounded-xl border border-border bg-card p-3">
          <InstrumentField instrument={selection.instrument} onChange={change} />
        </div>

        {songChords.length > 0 && (
          <section aria-labelledby={songChordsId}>
            <h3
              id={songChordsId}
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2"
            >
              In this song
            </h3>
            <ul className="flex flex-wrap gap-1.5 list-none p-0 m-0">
              {songChords.map(chord => (
                <li key={chordName(chord)}>
                  <SongChordButton
                    chord={chord}
                    active={isSameChord(chord, selection.chord)}
                    onClick={() => change({ chord })}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        <ChordExplorer
          compact
          showInstrument={false}
          selection={selection}
          onChange={change}
          showAllQualities={showAllQualities}
          onToggleAllQualities={toggleAllQualities}
        />
      </div>
    </aside>
  );
}

function isSameChord(a: Chord, b: Chord): boolean {
  return a.root === b.root && a.quality.suffix === b.quality.suffix;
}

function SongChordButton({
  chord,
  active,
  onClick,
}: {
  chord: Chord;
  active: boolean;
  onClick: () => void;
}) {
  const name = chordName(chord);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      // Sized for a thumb, not a mouse: this row is meant to be hit with an
      // instrument already in your hands.
      className={cn(
        'min-h-[2.75rem] px-3 rounded-md border font-mono text-sm cursor-pointer transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        active
          ? 'border-primary bg-primary text-white'
          : 'border-border bg-card text-foreground hover:border-primary hover:text-primary',
      )}
    >
      {name}
    </button>
  );
}
