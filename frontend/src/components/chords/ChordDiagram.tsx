import { useId } from 'react';
import type { Instrument, Tuning } from '@/lib/chords/instruments';
import type { Voicing } from '@/lib/chords/voicing';
import { cn } from '@/lib/utils';

/**
 * One chord shape, drawn as the grid every chord book uses.
 *
 * Inline SVG rather than a font or images: it scales to any size without going
 * soft on a phone, it prints, it colours itself from the theme's currentColor,
 * and the alt text can describe the actual shape rather than saying "chord
 * diagram". It is drawn from the same `Voicing` the generator returns, so a
 * diagram can never drift from the notes the audio plays.
 */

interface ChordDiagramProps {
  voicing: Voicing;
  instrument: Instrument;
  /**
   * The tuning the shape was generated for, which is where the banjo drone's
   * anchor lives. It has to come from here rather than from the instrument's
   * first tuning: a capo moves the anchor, and the diagram has to move with it.
   */
  tuning: Tuning;
  /** Fret the capo sits at. Drawn in place of the nut, since that is what the
   *  shape is played against and what its fret numbers count from. 0 for none. */
  capo?: number;
  /** Overall width in px. Height follows from the string and fret counts. */
  size?: number;
  /** Prefixed to the screen-reader description, e.g. "C, shape 1 of 6". The
   *  shape itself is always described after it: a name alone tells a screen
   *  reader user which diagram this is, but not how to play it. */
  label?: string;
  className?: string;
}

const STRING_GAP = 22;
const FRET_GAP = 26;
const PAD_X = 18;
const PAD_TOP = 26;
const PAD_BOTTOM = 22;
const DOT_R = 8;

/** Spoken description of a shape, so the diagram is not a blank to a screen reader. */
export function describeVoicing(voicing: Voicing, instrument: Instrument, capo = 0): string {
  const parts = voicing.frets.map((fret, i) => {
    const stringNumber = voicing.frets.length - i;
    if (fret === null) return `string ${stringNumber} muted`;
    if (fret === 0) return `string ${stringNumber} open`;
    return `string ${stringNumber} fret ${fret}`;
  });
  const barre = voicing.barre ? `, barred at fret ${voicing.barre.fret}` : '';
  // Fret numbers mean nothing without saying where they are counted from.
  const withCapo = capo > 0 ? `, capo ${capo}, frets counted from the capo` : '';
  return `${instrument.name}: ${parts.join(', ')}${barre}${withCapo}`;
}

export default function ChordDiagram({
  voicing,
  instrument,
  tuning,
  capo = 0,
  size = 150,
  label,
  className,
}: ChordDiagramProps) {
  const titleId = useId();
  const stringCount = tuning.strings.length;
  const fretCount = instrument.fretsShown;

  // Where the window starts. A shape that fits under the nut is drawn against
  // it; anything higher slides the window up and labels the starting fret,
  // which is how a chord book avoids drawing twelve empty frets.
  const fretted = voicing.frets.filter((f): f is number => f !== null && f > 0);
  const highest = fretted.length ? Math.max(...fretted) : 0;
  const windowStart = highest <= fretCount ? 1 : Math.min(...fretted);
  const showNut = windowStart === 1;

  const gridWidth = (stringCount - 1) * STRING_GAP;
  const gridHeight = fretCount * FRET_GAP;
  const viewWidth = gridWidth + PAD_X * 2;
  const viewHeight = gridHeight + PAD_TOP + PAD_BOTTOM;

  const x = (stringIndex: number) => PAD_X + stringIndex * STRING_GAP;
  const fretY = (fret: number) => PAD_TOP + (fret - windowStart + 1) * FRET_GAP;
  const dotY = (fret: number) => fretY(fret) - FRET_GAP / 2;

  const shape = describeVoicing(voicing, instrument, capo);
  const description = label ? `${label}. ${shape}` : shape;

  return (
    <svg
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      width={size}
      height={(size * viewHeight) / viewWidth}
      role="img"
      aria-labelledby={titleId}
      className={cn('text-foreground', className)}
    >
      <title id={titleId}>{description}</title>

      {/* Frets. The nut is the thick one, and only when the window starts at 1.
          With a capo fitted it is the capo that the shape is played against, so
          it is drawn in the accent colour: fret 1 here means one fret above the
          capo, not above the nut. */}
      {Array.from({ length: fretCount + 1 }, (_, i) => {
        const y = PAD_TOP + i * FRET_GAP;
        const isNut = i === 0 && showNut;
        const isCapo = isNut && capo > 0;
        return (
          <line
            key={`fret-${i}`}
            x1={PAD_X - (isNut ? 1 : 0)}
            x2={PAD_X + gridWidth + (isNut ? 1 : 0)}
            y1={y}
            y2={y}
            className={isCapo ? 'stroke-primary' : undefined}
            stroke={isCapo ? undefined : 'currentColor'}
            strokeWidth={isNut ? 5 : 1.5}
            strokeLinecap="square"
            opacity={isNut ? 1 : 0.35}
          />
        );
      })}

      {/* Strings.
          A banjo's 5th is short: it is anchored at the 5th fret and there is no
          neck under it below that. Drawing it full length is the most misleading
          thing a banjo diagram can do, because it implies four frets that do not
          exist. It gets a stub starting at its anchor, with its own little nut. */}
      {tuning.strings.map((string, i) => {
        const anchor = string.shortFrom ?? 0;
        const startsBelowNut = anchor > windowStart;
        const top = startsBelowNut ? fretY(anchor - 1) : PAD_TOP;
        if (top >= PAD_TOP + gridHeight) return null;
        return (
          <g key={`string-${i}`}>
            <line
              x1={x(i)}
              x2={x(i)}
              y1={top}
              y2={PAD_TOP + gridHeight}
              stroke="currentColor"
              strokeWidth={1.5}
              opacity={0.55}
            />
            {startsBelowNut && (
              <line
                x1={x(i) - 5}
                x2={x(i) + 5}
                y1={top}
                y2={top}
                stroke="currentColor"
                strokeWidth={4}
                strokeLinecap="round"
              />
            )}
          </g>
        );
      })}

      {/* Position label for a shape that sits up the neck. */}
      {!showNut && (
        <text
          x={PAD_X - 7}
          y={dotY(windowStart) + 4}
          textAnchor="end"
          fontSize={13}
          fill="currentColor"
          opacity={0.7}
          className="font-mono"
        >
          {windowStart}
        </text>
      )}

      {/* Open and muted markers above the nut. */}
      {voicing.frets.map((fret, i) => {
        if (fret === null) {
          return (
            <g key={`mute-${i}`} stroke="currentColor" strokeWidth={2} opacity={0.5} strokeLinecap="round">
              <line x1={x(i) - 5} y1={PAD_TOP - 17} x2={x(i) + 5} y2={PAD_TOP - 7} />
              <line x1={x(i) + 5} y1={PAD_TOP - 17} x2={x(i) - 5} y2={PAD_TOP - 7} />
            </g>
          );
        }
        if (fret === 0) {
          return (
            <circle
              key={`open-${i}`}
              cx={x(i)}
              cy={PAD_TOP - 12}
              r={5}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              opacity={0.6}
            />
          );
        }
        return null;
      })}

      {/* Barre, drawn under the dots so the finger numbers stay readable. */}
      {voicing.barre && (
        <rect
          x={x(voicing.barre.fromString) - DOT_R}
          y={dotY(voicing.barre.fret) - DOT_R}
          width={x(voicing.barre.toString) - x(voicing.barre.fromString) + DOT_R * 2}
          height={DOT_R * 2}
          rx={DOT_R}
          className="fill-primary"
        />
      )}

      {/* Fretted notes. */}
      {voicing.frets.map((fret, i) => {
        if (fret === null || fret === 0) return null;
        const finger = voicing.fingers[i];
        return (
          <g key={`dot-${i}`}>
            <circle cx={x(i)} cy={dotY(fret)} r={DOT_R} className="fill-primary" />
            {finger !== null && finger !== undefined && (
              <text
                x={x(i)}
                y={dotY(fret) + 4}
                textAnchor="middle"
                fontSize={11}
                fontWeight={600}
                fill="white"
                className="font-mono select-none"
              >
                {finger}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
