import { useMemo } from 'react';
import {
  INSTRUMENTS,
  withCapo,
  type Instrument,
  type Tuning,
} from '@/lib/chords/instruments';
import {
  CHORD_QUALITIES,
  ROOT_PITCH_CLASSES,
  chordFullName,
  chordName,
  noteName,
  roleByPitchClass,
  type Accidentals,
  type Chord,
} from '@/lib/chords/theory';
import { generateVoicings } from '@/lib/chords/voicing';
import useChordAudio from '@/hooks/useChordAudio';
import ChordDiagram from './ChordDiagram';
import { cn } from '@/lib/utils';

/**
 * The chord dictionary itself: pick an instrument, a tuning, a chord, and read
 * the shapes.
 *
 * Shared by the in-app page and the public one, so it takes its whole state as
 * props and reports changes upward. Both callers keep that state in the URL,
 * which is what makes a chord linkable and gives each one something to rank for.
 */

export interface ChordSelection {
  instrument: Instrument;
  tuning: Tuning;
  chord: Chord;
  capo: number;
  accidentals: Accidentals;
}

interface ChordExplorerProps {
  selection: ChordSelection;
  onChange: (next: Partial<ChordSelection>) => void;
  /** Show the full quality list rather than only the common ones. */
  showAllQualities: boolean;
  onToggleAllQualities: () => void;
  className?: string;
}

/** Capo positions offered. Past the 7th you are usually better off transposing. */
const CAPO_POSITIONS = [0, 1, 2, 3, 4, 5, 6, 7];

const ROLE_LABEL: Record<string, string> = {
  root: 'root',
  third: '3rd',
  fifth: '5th',
  seventh: '7th',
  extension: 'ext',
};

function PickerButton({
  active,
  onClick,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'px-3 py-1.5 rounded-md text-sm font-semibold border transition-colors cursor-pointer',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ring-offset-background',
        active
          ? 'bg-primary text-white border-primary'
          : 'bg-card text-foreground border-border hover:bg-panel',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export default function ChordExplorer({
  selection,
  onChange,
  showAllQualities,
  onToggleAllQualities,
  className,
}: ChordExplorerProps) {
  const { instrument, tuning, chord, capo, accidentals } = selection;
  const audio = useChordAudio();

  // The capo is modelled as a retuning, so everything downstream (shapes, note
  // names, audio) is consistent without any of it knowing a capo exists.
  const soundingTuning = useMemo(() => withCapo(tuning, capo), [tuning, capo]);

  const voicings = useMemo(
    () => generateVoicings(instrument, soundingTuning, chord, { limit: 6 }),
    [instrument, soundingTuning, chord],
  );

  const qualities = showAllQualities ? CHORD_QUALITIES : CHORD_QUALITIES.filter(q => q.common);
  const roles = useMemo(() => roleByPitchClass(chord), [chord]);
  const name = chordName(chord, accidentals);

  return (
    <div className={cn('flex flex-col gap-8', className)}>
      <section className="rounded-xl border border-border bg-card p-4 sm:p-6 flex flex-col gap-6">
        <Field label="Instrument">
          {INSTRUMENTS.map(option => (
            <PickerButton
              key={option.slug}
              active={option.slug === instrument.slug}
              onClick={() =>
                onChange({ instrument: option, tuning: option.tunings[0]!, capo: 0 })
              }
            >
              {option.name}
            </PickerButton>
          ))}
        </Field>

        {instrument.tunings.length > 1 && (
          <Field label="Tuning">
            {instrument.tunings.map(option => (
              <PickerButton
                key={option.slug}
                active={option.slug === tuning.slug}
                onClick={() => onChange({ tuning: option })}
                title={option.description}
              >
                {option.name}
                <span className="ml-2 font-mono text-xs opacity-70">{option.description}</span>
              </PickerButton>
            ))}
          </Field>
        )}

        <Field label="Root">
          {ROOT_PITCH_CLASSES.map(pc => (
            <PickerButton
              key={pc}
              active={pc === chord.root}
              onClick={() => onChange({ chord: { ...chord, root: pc } })}
              className="min-w-11 font-mono"
            >
              {noteName(pc, accidentals)}
            </PickerButton>
          ))}
          <button
            type="button"
            onClick={() => onChange({ accidentals: accidentals === 'sharp' ? 'flat' : 'sharp' })}
            className="px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-panel transition-colors cursor-pointer"
          >
            {accidentals === 'sharp' ? 'Show flats' : 'Show sharps'}
          </button>
        </Field>

        <Field label="Quality">
          {qualities.map(option => (
            <PickerButton
              key={option.suffix}
              active={option.suffix === chord.quality.suffix}
              onClick={() => onChange({ chord: { ...chord, quality: option } })}
              title={option.label}
            >
              <span className="font-mono">{option.suffix || 'maj'}</span>
            </PickerButton>
          ))}
          <button
            type="button"
            onClick={onToggleAllQualities}
            className="px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-panel transition-colors cursor-pointer"
          >
            {showAllQualities ? 'Show fewer' : `Show all ${CHORD_QUALITIES.length}`}
          </button>
        </Field>

        <Field label="Capo">
          {CAPO_POSITIONS.map(fret => (
            <PickerButton
              key={fret}
              active={fret === capo}
              onClick={() => onChange({ capo: fret })}
              className="min-w-10 font-mono"
            >
              {fret === 0 ? 'None' : fret}
            </PickerButton>
          ))}
        </Field>
      </section>

      <section className="flex flex-col gap-4">
        <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="font-display text-4xl leading-none">{name}</h2>
          <p className="text-muted-foreground">
            {chordFullName(chord, accidentals)} on {instrument.name.toLowerCase()}
            {instrument.tunings.length > 1 && `, ${tuning.name.toLowerCase()} tuning`}
            {capo > 0 && `, capo ${capo}`}
          </p>
        </header>

        <p className="text-sm text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
          {chord.quality.tones.map(tone => {
            const pc = (chord.root + tone.interval) % 12;
            return (
              <span key={`${tone.interval}-${tone.role}`} className="font-mono">
                {noteName(pc, accidentals)}
                <span className="ml-1 opacity-60 not-italic">
                  {ROLE_LABEL[roles.get(pc) ?? tone.role]}
                  {tone.optional && ' · optional'}
                </span>
              </span>
            );
          })}
        </p>

        {capo > 0 && (
          <p className="text-sm text-muted-foreground">
            Fret numbers are counted from the capo. Shapes are the ones you finger, so with the
            capo on {capo} these sound as {name}.
          </p>
        )}

        {voicings.length === 0 ? (
          <p className="rounded-lg border border-border bg-panel px-4 py-6 text-sm text-muted-foreground">
            There is no way to play {name} on {instrument.name.toLowerCase()} in this tuning. It
            needs more separate notes than the instrument has strings within a hand&apos;s reach.
            Try a nearby chord, or a different instrument.
          </p>
        ) : (
          <ul className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(160px,1fr))] list-none p-0 m-0">
            {voicings.map((voicing, index) => (
              <li
                key={voicing.frets.join('-')}
                className="rounded-xl border border-border bg-card p-3 flex flex-col items-center gap-2"
              >
                <ChordDiagram
                  voicing={voicing}
                  instrument={instrument}
                  tuning={soundingTuning}
                  capo={capo}
                  size={150}
                  label={`${name}, shape ${index + 1} of ${voicings.length}`}
                />
                <div className="flex items-center gap-2 w-full justify-between">
                  <span className="font-mono text-xs text-muted-foreground">
                    {voicing.barre ? `Barre ${voicing.barre.fret}` : voicing.baseFret === 0 ? 'Open' : `Fret ${voicing.baseFret}`}
                  </span>
                  {audio.supported && (
                    <button
                      type="button"
                      onClick={() => audio.play(voicing.notes)}
                      className="px-2.5 py-1 rounded-md text-xs font-semibold text-primary hover:bg-primary-light transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      aria-label={`Hear ${name}, shape ${index + 1}`}
                    >
                      Hear it
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
