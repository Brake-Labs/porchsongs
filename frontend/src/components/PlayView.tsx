import { useState, useEffect, useImperativeHandle, useRef, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { uploadFollowLog, useFollowCaptureEnabled } from '@/extensions';
import FollowControls from '@/components/FollowControls';
import { useFollow } from '@/hooks/useFollow';
import { useFollowScroll } from '@/hooks/useFollowScroll';
import { normalizeSong } from '@/lib/followAlign';
import { transposeChart } from '@/lib/chords/transpose';
import { createSpeechSignal } from '@/lib/followSpeech';
import { commitFollowEstimate, INITIAL_COMMIT_STATE } from '@/lib/followCommit';
import usePerformanceLayout from '@/hooks/usePerformanceLayout';
import type { Song } from '@/types';
import type { FollowWarning } from '@/lib/followHealth';

/**
 * The performance sheet: a chord chart rendered for playing from, not editing.
 *
 * Extracted from LibraryTab, where it lived behind an early return and was only
 * reachable as a mode inside the library list. Playing a chart is the point of the
 * product, so it gets its own module and its own route (see pages/PlayPage).
 * Rendering behaviour is unchanged.
 */

const PRE_BASE_CLASS = 'font-mono text-xs sm:text-code leading-snug whitespace-pre text-foreground';

const GRID_COL_CLASSES: Record<number, string> = {
  2: 'grid grid-cols-2 gap-4',
  3: 'grid grid-cols-3 gap-4',
  4: 'grid grid-cols-4 gap-4',
};

/** Column preference: 'auto' lets the layout decide, or force a fixed count. */
export type ColumnPref = 'auto' | 1 | 2 | 3 | 4;
export type SongVersion = 'rewritten' | 'original';

/**
 * The size range the stepper can reach, in px.
 *
 * A whole number of pixels anywhere in here, rather than a ladder of seven
 * preset sizes. The ladder was a reaction to the 23-step range input it
 * replaced, which was 80px wide and 4px tall and unusable on a touch screen, but
 * it answered that with a second problem: the size you wanted was often between
 * two rungs, and the top rung stopped at 32px whether or not the chart was on a
 * music stand across the room. The bottom fits a dense chart on a phone; the top
 * is legible from further away than anyone stands from a stand.
 */
export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 64;

/** Hold an arbitrary px value inside the range, rounded to whole pixels. */
export function clampFontSize(px: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(px)));
}

/**
 * One pixel up or down. `null` means auto, and stepping off auto starts from
 * the size the layout had picked, so the first tap is a nudge rather than a
 * jump to somewhere unrelated.
 */
export function stepFontSize(current: number | null, direction: 1 | -1, autoSize = 16): number {
  return clampFontSize((current ?? autoSize) + direction);
}

interface FontSizeStepperProps {
  /** Current override, or null for auto. */
  value: number | null;
  /** Size the auto layout picked, used as the starting point when stepping off auto. */
  autoSize?: number;
  onChange: (next: number | null) => void;
  /** Called when the user finishes changing, for persistence. */
  onCommit?: (next: number | null) => void;
}

export function FontSizeStepper({ value, autoSize, onChange, onCommit }: FontSizeStepperProps) {
  const apply = (next: number | null) => {
    onChange(next);
    onCommit?.(next);
  };
  const atMin = value !== null && value <= FONT_SIZE_MIN;
  const atMax = value !== null && value >= FONT_SIZE_MAX;

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Text size">
      <button
        type="button"
        onClick={() => apply(stepFontSize(value, -1, autoSize))}
        disabled={atMin}
        // 44px minimum: this is a control you hit while holding an instrument.
        className="min-w-[2.75rem] min-h-[2.75rem] flex items-center justify-center rounded-md border border-border bg-transparent text-sm text-muted-foreground hover:bg-panel hover:text-foreground disabled:opacity-40 cursor-pointer"
        aria-label="Smaller text"
      >
        A&minus;
      </button>
      {/* Reads out the size, and resets. It used to be a toggle, which meant the
          button labelled "Auto" was the one that turned auto off. Now it says
          what is in force and does the one thing that has any meaning while it
          says it: on auto there is nothing to reset, so it is inert. */}
      <button
        type="button"
        onClick={() => apply(null)}
        disabled={value === null}
        className="min-w-[2.75rem] min-h-[2.75rem] px-2 flex items-center justify-center rounded-md border border-border bg-transparent text-xs text-muted-foreground hover:bg-panel hover:text-foreground disabled:hover:bg-transparent disabled:hover:text-muted-foreground cursor-pointer disabled:cursor-default whitespace-nowrap"
        title={value === null ? 'Sized to fit the screen' : 'Reset to auto size'}
        aria-label={value === null ? 'Text size: auto' : `Text size: ${Math.round(value)}px. Reset to auto`}
      >
        {value === null ? 'Auto' : `${Math.round(value)}px`}
      </button>
      <button
        type="button"
        onClick={() => apply(stepFontSize(value, 1, autoSize))}
        disabled={atMax}
        className="min-w-[2.75rem] min-h-[2.75rem] flex items-center justify-center rounded-md border border-border bg-transparent text-sm text-muted-foreground hover:bg-panel hover:text-foreground disabled:opacity-40 cursor-pointer"
        aria-label="Larger text"
      >
        A+
      </button>
    </div>
  );
}

/** The transpose stepper's reach. ±11 covers every key; past that is octaves. */
export const TRANSPOSE_MIN = -11;
export const TRANSPOSE_MAX = 11;

interface TransposeControlProps {
  /** Sounding-key offset from the chart as written, in semitones. */
  transpose: number;
  onTransposeChange: (next: number) => void;
}

/**
 * The transpose stepper, Ultimate Guitar style: ♭ and ♯ step the sounding key
 * by a semitone, the middle button reads out the offset and resets it.
 */
export function TransposeControl({ transpose, onTransposeChange }: TransposeControlProps) {
  const stepClass =
    'min-w-[2.75rem] min-h-[2.75rem] flex items-center justify-center rounded-md border border-border bg-transparent text-sm text-muted-foreground hover:bg-panel hover:text-foreground disabled:opacity-40 cursor-pointer';

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Transpose">
      <button
        type="button"
        onClick={() => onTransposeChange(Math.max(TRANSPOSE_MIN, transpose - 1))}
        disabled={transpose <= TRANSPOSE_MIN}
        className={stepClass}
        aria-label="Down a semitone"
      >
        &#9837;
      </button>
      <button
        type="button"
        onClick={() => onTransposeChange(0)}
        disabled={transpose === 0}
        className="min-w-[2.75rem] min-h-[2.75rem] px-2 flex items-center justify-center rounded-md border border-border bg-transparent text-xs text-muted-foreground hover:bg-panel hover:text-foreground disabled:hover:bg-transparent disabled:hover:text-muted-foreground cursor-pointer disabled:cursor-default whitespace-nowrap"
        title={transpose === 0 ? "In the chart's own key" : "Back to the chart's own key"}
        aria-label={
          transpose === 0
            ? 'Transpose: as written'
            : `Transposed ${transpose > 0 ? 'up' : 'down'} ${Math.abs(transpose)} semitone${Math.abs(transpose) === 1 ? '' : 's'}. Reset to the written key`
        }
      >
        {transpose === 0 ? '0' : transpose > 0 ? `+${transpose}` : `${transpose}`}
      </button>
      <button
        type="button"
        onClick={() => onTransposeChange(Math.min(TRANSPOSE_MAX, transpose + 1))}
        disabled={transpose >= TRANSPOSE_MAX}
        className={stepClass}
        aria-label="Up a semitone"
      >
        &#9839;
      </button>
    </div>
  );
}

interface PerformanceSheetProps {
  song: Song;
  version: SongVersion;
  className?: string;
  fontSizeOverride?: number | null;
  columnsPref?: ColumnPref;
  /**
   * Semitones to shift the *written* chords by: the transpose offset minus the
   * capo. Applied here rather than upstream so everything below (Follow, the
   * layout solver, the columns) reads the chart the player is looking at.
   */
  transposeSemitones?: number;
  /** LLM model for the Follow arbiter; empty string disables it. */
  llmModel?: string;
  /** Reports the auto-computed font size so a parent can seed its stepper. */
  onAutoFontSize?: (px: number | undefined) => void;
  /**
   * Imperative access to the Follow toggle, for a control that lives outside
   * this component (the play route's bottom bar). A ref rather than a prop
   * round-trip because iOS only grants the mic inside a real user gesture: the
   * bar's click handler has to reach startMic synchronously, and a state
   * change plus effect would run after the gesture has expired.
   */
  followHandleRef?: React.Ref<FollowHandle>;
  /** Reports the Follow state the bar button renders; null when Follow does not apply. */
  onFollowStatus?: (status: FollowStatus | null) => void;
}

export interface FollowHandle {
  toggleFollow: () => void;
}

export interface FollowStatus {
  on: boolean;
  /** What the toggle should say: Follow / Following / Paused / Not following / Follow error. */
  label: string;
  /** Actively tracking: on, not paused, no warning. Drives the pulse dot. */
  live: boolean;
  micSupported: boolean;
}

/**
 * What the Follow toggle should present, from the raw hook state.
 *
 * Non-fatal warnings ("not following") only make sense while Follow is on. A
 * fatal one has to outlive it: a mic failure switches Follow off by design, so
 * gating purely on followOn would hide the very warning that explains it.
 * "Following" next to a chart that never moves was the whole of #273: once
 * Follow is not working, the toggle has to stop claiming that it is. "Follow
 * error", not "Mic error": unsupported, network and aborted are all fatal but
 * none of them is a microphone problem, and the warning card heading names the
 * real cause.
 */
export function deriveFollowPresentation(
  followOn: boolean,
  paused: boolean,
  rawWarning: FollowWarning | null,
): { warning: FollowWarning | null; label: string; live: boolean } {
  const warning = followOn || rawWarning?.fatal ? rawWarning : null;
  const label = warning?.fatal
    ? 'Follow error'
    : !followOn
      ? 'Follow'
      : warning
        ? 'Not following'
        : paused
          ? 'Paused'
          : 'Following';
  return { warning, label, live: followOn && !paused && !warning };
}

/** Trigger a browser download of a recorded Follow session as JSON. */
function downloadRecording(data: unknown, name: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function PerformanceSheet({
  song,
  version,
  className,
  fontSizeOverride,
  columnsPref = 'auto',
  transposeSemitones = 0,
  llmModel,
  onAutoFontSize,
  followHandleRef,
  onFollowStatus,
}: PerformanceSheetProps) {
  const rawText = version === 'original' ? song.original_content : song.rewritten_content;
  // transposeChart never changes the line count or what normalizeSong makes of
  // a line (pinned by its tests), which is what lets everything below take the
  // transposed text without knowing a transposition happened.
  const text = useMemo(() => transposeChart(rawText, transposeSemitones), [rawText, transposeSemitones]);
  const sheetRef = useRef<HTMLDivElement>(null);

  const layout = usePerformanceLayout(sheetRef, text, columnsPref, fontSizeOverride ?? null);
  const { columns, numCols } = layout;
  const isMultiCol = numCols > 1 && columns !== null;

  const effectiveSize = fontSizeOverride ?? layout.fontSize;
  const fontStyle = effectiveSize !== undefined ? { fontSize: `${effectiveSize}px` } : undefined;

  useEffect(() => {
    onAutoFontSize?.(layout.fontSize);
  }, [layout.fontSize, onAutoFontSize]);

  // --- Follow mode ---
  const arbiter = useMemo(
    () => ({ enabled: !!llmModel, model: llmModel ?? '' }),
    [llmModel],
  );
  const follow = useFollow(text, { arbiter });
  const [followOn, setFollowOn] = useState(false);
  const norm = useMemo(() => normalizeSong(text), [text]);
  // Whether to show the capture controls (the tracker overlay, Record and Save
  // logs). An operator tool, so it is off unless the account it belongs to has
  // it switched on; the extensions seam is what knows, and OSS has no such setting so
  // its stub says no.
  const debug = useFollowCaptureEnabled();
  const micSupported = useMemo(
    () => typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window),
    [],
  );
  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  // What the chart shows. Deliberately not the raw estimate: moving one line early
  // is unnoticeable, while being thrown into another verse loses the performer
  // their place, so `followCommit` commits local moves at once and makes a distant
  // relocation prove itself first. Held in a ref because it is a fold over the
  // estimate stream, not derived state.
  const commitRef = useRef(INITIAL_COMMIT_STATE);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  useEffect(() => {
    if (!followOn) {
      commitRef.current = INITIAL_COMMIT_STATE;
      setActiveIndex(null);
      return;
    }
    const next = commitFollowEstimate(commitRef.current, follow.estimate, Date.now());
    commitRef.current = next;
    setActiveIndex(next.renderIndex);
  }, [follow.estimate, followOn]);
  const { paused, resume, recenter } = useFollowScroll(sheetRef, activeIndex, { enabled: followOn, reducedMotion });

  /**
   * Tap a line to say "I am here".
   *
   * Follow guesses from the audio and sometimes guesses wrong, most often on a
   * repeated chorus where two positions are genuinely indistinguishable. The
   * tracker has always been able to be told the answer (`reposition` collapses it
   * onto a state, and treats a human as near-certain) but nothing in the UI called
   * it, so the only way to correct a wrong lock was to stop and restart Follow.
   *
   * Doing both things matters. Repositioning fixes a wrong guess; re-centring fixes
   * a right guess that has scrolled out of view, and tapping the line that is
   * already the target would otherwise do nothing at all.
   */
  const handleLineTap = useCallback(
    (renderIndex: number) => {
      // No `followOn` guard. The only caller is the click handler on the follow
      // branch's <pre>, which does not exist when Follow is off, so a guard here
      // could never fire and would be an untestable branch claiming to be a gate.
      // Two tests pin that structure instead: no `data-line` elements exist with
      // Follow off, and they do exist with it on.
      const states = norm.lyricStates;
      if (states.length === 0) return;
      // Chord lines sit above their lyric, and section headers and blanks are not
      // states at all, so snap forward to the first lyric line at or after the tap.
      // Tapping a chord row therefore means the line it belongs to, which is what
      // it looks like it means. Past the last lyric, hold the last state.
      let stateIndex = states.findIndex(s => s.renderIndex >= renderIndex);
      if (stateIndex === -1) stateIndex = states.length - 1;
      follow.reposition(stateIndex);
      recenter(states[stateIndex]!.renderIndex);
    },
    [norm.lyricStates, follow, recenter],
  );

  /**
   * One listener on the container rather than a handler per line.
   *
   * A chart is hundreds of lines. Making each one focusable would bury a keyboard
   * user in tab stops, and the alternative of per-line click handlers allocates
   * hundreds of closures on every render of the hottest component in the app.
   */
  const handleSheetClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      // No `followOn` check: this handler and the `data-line` spans it reads only
      // exist inside the follow branch below, so with Follow off there is nothing to
      // tap and nothing listening. `handleLineTap` keeps the guard as the one
      // semantic gate.
      const line = (e.target as HTMLElement).closest?.('[data-line]');
      if (!(line instanceof HTMLElement)) return;
      const index = Number(line.dataset.line);
      if (!Number.isFinite(index)) return;
      handleLineTap(index);
    },
    [handleLineTap],
  );

  const startMic = useCallback(() => {
    setFollowOn(true);
    follow.start(() => createSpeechSignal());
  }, [follow]);
  const stopFollow = useCallback(() => {
    setFollowOn(false);
    follow.stop();
  }, [follow]);
  const toggleFollow = useCallback(() => {
    if (followOn) stopFollow();
    else startMic();
  }, [followOn, stopFollow, startMic]);

  useImperativeHandle(followHandleRef, () => ({ toggleFollow }), [toggleFollow]);

  // Shared by the bar button (via onFollowStatus) and the floating warning card.
  const {
    warning: followWarning,
    label: followLabel,
    live: followLive,
  } = deriveFollowPresentation(followOn, paused, follow.warning);
  const followAvailable = norm.hasLyrics || debug;
  useEffect(() => {
    onFollowStatus?.(
      followAvailable
        ? { on: followOn, label: followLabel, live: followLive, micSupported }
        : null,
    );
  }, [followAvailable, followOn, followLabel, followLive, micSupported, onFollowStatus]);
  // The bar must not keep rendering a Follow button for an unmounted sheet.
  useEffect(() => () => onFollowStatus?.(null), [onFollowStatus]);

  // A mic error ends the session: the signal has already released the mic, so
  // drop out of Follow rather than sitting in a "Following" state that isn't
  // listening. The error stays visible next to the toggle, and the next tap is
  // then a clean start() from a real user gesture. iOS needs that: it refuses
  // the first start() while the permission sheet is up, and granting permission
  // does not retroactively start the recognizer, so without a fresh gesture the
  // only way back into Follow mode was reloading the app.
  useEffect(() => {
    if (follow.error) setFollowOn(false);
  }, [follow.error]);
  /**
   * Finish a capture and put it somewhere it can be read from another device.
   *
   * Upload first, download as the fallback. The whole point is that the sessions
   * worth diagnosing happen on a phone, and a JSON file downloaded inside an
   * installed PWA is not something anyone gets onto a laptop. When there is no
   * server-side store (OSS, or an upload that fails) the download is still better
   * than losing the capture.
   */
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'uploaded' | 'downloaded'>('idle');
  const saveJson = useCallback(async () => {
    const recording = follow.stopRecording();
    setSaveState('saving');
    let uploaded = false;
    try {
      uploaded = await uploadFollowLog(recording);
    } catch {
      // An upload failure must not cost the capture, so fall through and download.
      uploaded = false;
    }
    if (!uploaded) {
      downloadRecording(recording, `follow-recording-${Date.now()}.json`);
    }
    setSaveState(uploaded ? 'uploaded' : 'downloaded');
  }, [follow]);

  // While following we present a single scrolling column (teleprompter) with the
  // current line highlighted; when off, the sheet renders exactly as before.
  const lines = useMemo(() => text.split('\n'), [text]);

  return (
    // A real margin, not a hairline: flush against the window edge the chart
    // reads as cut off rather than as starting there. On the outer wrapper
    // rather than the scroller, because usePerformanceLayout solves against the
    // scroller's clientWidth/Height and padding there would be counted as text
    // space.
    <div className={cn('relative px-2 sm:px-3', className)}>
      <div
        ref={sheetRef}
        className={cn(
          'relative h-full overflow-y-auto',
          // Multi-column is sized to fit the screen, so it never scrolls sideways.
          // Single column allows horizontal scroll only as a last resort: when one
          // chart line is wider than the screen even at the minimum font, scrolling
          // beats clipping a chord off the edge.
          followOn || !isMultiCol ? 'overflow-x-auto' : 'overflow-x-hidden',
          !followOn && isMultiCol && GRID_COL_CLASSES[numCols],
        )}
      >
        {followOn ? (
          <pre
            className={cn(PRE_BASE_CLASS, 'pb-8', 'cursor-pointer')}
            style={fontStyle}
            onClick={handleSheetClick}
            // Not a button or a listbox: it is a chart you can also tap. The label
            // says what a tap does, since the affordance is otherwise invisible.
            aria-label="Chart. Tap a line to move Follow to it."
          >
            {lines.map((ln, i) => {
              const isActive =
                activeIndex != null &&
                (i === activeIndex || (i === activeIndex - 1 && norm.lineKind[i] === 'chord'));
              return (
                <span
                  key={i}
                  data-line={i}
                  className="block"
                  // Tint-only highlight: no border/padding, so monospace
                  // chord/lyric alignment stays pixel-identical.
                  style={
                    isActive
                      ? {
                          background: 'color-mix(in oklab, var(--color-primary) 8%, transparent)',
                        }
                      : undefined
                  }
                >
                  {ln === '' ? '​' : ln}
                </span>
              );
            })}
          </pre>
        ) : isMultiCol && columns ? (
          columns.map((col, i) => (
            <pre
              key={i}
              className={cn(PRE_BASE_CLASS, 'min-w-0', i < columns.length - 1 && 'border-r border-border pr-4')}
              style={fontStyle}
            >
              {col}
            </pre>
          ))
        ) : (
          // pb-8: the last line otherwise ends flush against the bottom bar,
          // and on round-cornered phones reads as clipped. Inside the scroller,
          // so mid-scroll content still runs to the edge; multi-column has no
          // vertical scroll and the column packer does not know about padding,
          // so it stays as is.
          <pre className={cn(PRE_BASE_CLASS, 'pb-8')} style={fontStyle}>{text}</pre>
        )}
      </div>

      {followAvailable && (
        <FollowControls
          follow={follow}
          followOn={followOn}
          paused={paused}
          warning={followWarning}
          lyricStates={norm.lyricStates}
          debug={debug}
          onResume={resume}
          onSaveJson={saveJson}
          saveState={saveState}
        />
      )}
    </div>
  );
}

export default PerformanceSheet;
