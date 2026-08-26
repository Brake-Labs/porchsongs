import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import ChordExplorer from './ChordExplorer';
import { chordName, type Chord } from '@/lib/chords/theory';
import type { ChordPanelState } from '@/hooks/useChordPanel';
import { cn } from '@/lib/utils';

/**
 * The chord dictionary, opened beside a chart you are playing.
 *
 * The whole reason this is not just a link to /app/chords is the row at the
 * top: the chords this chart actually uses, one tap away. Mid-song, with an
 * instrument in your lap, hunting for a root and a quality in a twelve by
 * fourteen grid is not something anyone is going to do.
 *
 * One element for both layouts rather than a drawer and a panel. On a phone it
 * fills the surface and the chart is hidden behind it with `display: none`,
 * which takes the chart out of the tab order and out of the accessibility tree
 * and so gives a full screen without needing a portal or a focus trap. From
 * `lg` up the same element is a column beside the chart, which reflows to make
 * room.
 */

interface ChordPanelProps {
  state: ChordPanelState;
  className?: string;
}

export default function ChordPanel({ state, className }: ChordPanelProps) {
  const { songChords, selection, change, showAllQualities, toggleAllQualities, close } = state;
  const headingId = useId();
  const songChordsId = useId();
  const ref = useRef<HTMLElement>(null);

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

  return (
    <aside
      ref={ref}
      tabIndex={-1}
      aria-labelledby={headingId}
      onKeyDown={handleKeyDown}
      className={cn(
        'flex flex-col min-h-0 bg-background focus:outline-none',
        'lg:border-l lg:border-border',
        className,
      )}
    >
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
