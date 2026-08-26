import { useCallback, useMemo, useRef, useState } from 'react';
import { STORAGE_KEYS } from '@/api';
import type { ChordSelection } from '@/components/chords/ChordExplorer';
import {
  DEFAULT_INSTRUMENT,
  findInstrument,
  findTuning,
  type Instrument,
  type Tuning,
} from '@/lib/chords/instruments';
import { chordsUsedIn } from '@/lib/chords/songChords';
import { CHORD_QUALITIES, type Chord } from '@/lib/chords/theory';

/**
 * State for the chord panel on the play route.
 *
 * Lives here rather than inside the panel so closing it does not throw away
 * where you had got to. Someone checking a shape, glancing back at the words,
 * and opening it again is the normal way to use this, and landing back on the
 * first chord of the song every time would make that annoying.
 *
 * Deliberately not in the URL, unlike the library's filters and the chord page
 * itself. This is a tool opened over a performance, the way the tuner is, not a
 * view of something worth linking to. `TunerDialog` is the precedent.
 */

/** Where the panel starts when the chart names no chords at all: a plain C. */
const FALLBACK_CHORD: Chord = { root: 0, quality: CHORD_QUALITIES[0]! };

function rememberedInstrument(): { instrument: Instrument; tuning: Tuning } {
  const instrument =
    findInstrument(localStorage.getItem(STORAGE_KEYS.CHORD_INSTRUMENT) ?? '') ?? DEFAULT_INSTRUMENT;
  // Read against the instrument that was actually resolved, so a stored
  // "baritone" left over from a ukulele cannot survive onto a banjo.
  const tuning =
    findTuning(instrument, localStorage.getItem(STORAGE_KEYS.CHORD_TUNING) ?? '') ??
    instrument.tunings[0]!;
  return { instrument, tuning };
}

export interface ChordPanelState {
  open: boolean;
  /** Open it, or close it. Seeds the chord from the chart on the first open. */
  toggle: () => void;
  close: () => void;
  /** The chords this chart uses, for the shortcut row. Empty for a tab PDF. */
  songChords: Chord[];
  selection: ChordSelection;
  change: (next: Partial<ChordSelection>) => void;
  showAllQualities: boolean;
  toggleAllQualities: () => void;
}

export default function useChordPanel(songText: string): ChordPanelState {
  const songChords = useMemo(() => chordsUsedIn(songText), [songText]);
  const [open, setOpen] = useState(false);
  const [showAllQualities, setShowAllQualities] = useState(false);
  const [selection, setSelection] = useState<ChordSelection>(() => {
    const { instrument, tuning } = rememberedInstrument();
    return { instrument, tuning, chord: FALLBACK_CHORD, capo: 0 };
  });

  // Which chart the opening chord was taken from. The seed happens on open
  // rather than on load because the song arrives after this hook first runs, and
  // it happens once per chart rather than once per open so that reopening keeps
  // your place. Playing a different song is a different chart, and gets its own
  // seed.
  const seededFor = useRef<string | null>(null);

  const toggle = useCallback(() => {
    if (!open && seededFor.current !== songText) {
      seededFor.current = songText;
      const first = songChords[0];
      if (first) setSelection(prev => ({ ...prev, chord: first }));
    }
    setOpen(prev => !prev);
  }, [open, songText, songChords]);

  const close = useCallback(() => setOpen(false), []);

  const change = useCallback(
    (next: Partial<ChordSelection>) => {
      const instrument = next.instrument ?? selection.instrument;
      // Switching instrument resets the tuning: "baritone" means nothing on a
      // banjo. Mirrors what ChordsPage does with the same callback.
      const tuning = next.tuning ?? (next.instrument ? next.instrument.tunings[0]! : selection.tuning);
      localStorage.setItem(STORAGE_KEYS.CHORD_INSTRUMENT, instrument.slug);
      localStorage.setItem(STORAGE_KEYS.CHORD_TUNING, tuning.slug);
      setSelection({
        instrument,
        tuning,
        chord: next.chord ?? selection.chord,
        capo: next.capo ?? selection.capo,
      });
    },
    [selection],
  );

  const toggleAllQualities = useCallback(() => setShowAllQualities(prev => !prev), []);

  return {
    open,
    toggle,
    close,
    songChords,
    selection,
    change,
    showAllQualities,
    toggleAllQualities,
  };
}
