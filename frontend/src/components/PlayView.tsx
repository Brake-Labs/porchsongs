import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { isFollowDebugEnabled } from '@/lib/followDebug';
import FollowControls from '@/components/FollowControls';
import { useFollow } from '@/hooks/useFollow';
import { useFollowScroll } from '@/hooks/useFollowScroll';
import { normalizeSong } from '@/lib/followAlign';
import { createCannedSignal, scriptFromSong } from '@/lib/followSignal';
import { createSpeechSignal } from '@/lib/followSpeech';
import { isCommittableEstimate } from '@/lib/followHealth';
import usePerformanceLayout from '@/hooks/usePerformanceLayout';
import type { Song } from '@/types';

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
 * Discrete font sizes for the stepper.
 *
 * Replaces a 23-step range input that was 80px wide and 4px tall, which is an
 * unusable control on a touch screen and was the primary text-size affordance on
 * the one screen you look at from six feet away. The steps are the sizes people
 * actually want; the top end reaches a tablet on a music stand.
 */
export const FONT_STEPS = [12, 14, 16, 18, 22, 26, 32] as const;

/** Nearest step to an arbitrary px value, so a legacy stored size lands cleanly. */
export function nearestFontStep(px: number): number {
  return FONT_STEPS.reduce((best, step) =>
    Math.abs(step - px) < Math.abs(best - px) ? step : best,
  );
}

/** Step up or down from the current size. `null` means auto. */
export function stepFontSize(current: number | null, direction: 1 | -1, autoSize = 16): number {
  const from = current === null ? nearestFontStep(autoSize) : nearestFontStep(current);
  const index = FONT_STEPS.indexOf(from as (typeof FONT_STEPS)[number]);
  const next = Math.min(FONT_STEPS.length - 1, Math.max(0, index + direction));
  return FONT_STEPS[next]!;
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
  const atMin = value !== null && value <= FONT_STEPS[0];
  const atMax = value !== null && value >= FONT_STEPS[FONT_STEPS.length - 1]!;

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
      <button
        type="button"
        onClick={() => apply(value === null ? stepFontSize(null, 0 as 1, autoSize) : null)}
        className="min-w-[2.75rem] min-h-[2.75rem] px-2 flex items-center justify-center rounded-md border border-border bg-transparent text-xs text-muted-foreground hover:bg-panel hover:text-foreground cursor-pointer whitespace-nowrap"
        title={value === null ? 'Auto size' : 'Reset to auto size'}
        aria-label={value === null ? 'Text size: auto' : `Text size: ${value}px. Reset to auto`}
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

interface PerformanceSheetProps {
  song: Song;
  version: SongVersion;
  className?: string;
  fontSizeOverride?: number | null;
  columnsPref?: ColumnPref;
  /** LLM model for the Follow arbiter; empty string disables it. */
  llmModel?: string;
  /** Reports the auto-computed font size so a parent can seed its stepper. */
  onAutoFontSize?: (px: number | undefined) => void;
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
  llmModel,
  onAutoFontSize,
}: PerformanceSheetProps) {
  const text = version === 'original' ? song.original_content : song.rewritten_content;
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
  const debug = isFollowDebugEnabled();
  const micSupported = useMemo(
    () => typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window),
    [],
  );
  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  // Only commit the highlight/scroll on a confident lock; hold steady while the
  // tracker is searching or torn between repeated lines, so the page doesn't
  // chase every ambiguous flicker.
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  useEffect(() => {
    if (!followOn) {
      setActiveIndex(null);
      return;
    }
    const e = follow.estimate;
    // Commit only on a confident, UNAMBIGUOUS estimate. When two positions are
    // near-tied (e.g. an opening verse that is identical to the closing verse,
    // which is genuinely undecidable from the audio), hold the last committed
    // line instead of guessing, and move once a distinguishing line is sung.
    // Shared with the health check so it can never warn "nothing matches" about
    // a chart that is visibly following along.
    if (isCommittableEstimate(e) && e?.renderIndex != null) {
      setActiveIndex(e.renderIndex);
    }
  }, [follow.estimate, followOn]);
  const { paused, resume } = useFollowScroll(sheetRef, activeIndex, { enabled: followOn, reducedMotion });

  const startMic = useCallback(() => {
    setFollowOn(true);
    follow.start(() => createSpeechSignal());
  }, [follow]);
  const startDemo = useCallback(() => {
    setFollowOn(true);
    follow.start(() => createCannedSignal(scriptFromSong(text)));
  }, [follow, text]);
  const stopFollow = useCallback(() => {
    setFollowOn(false);
    follow.stop();
  }, [follow]);
  const toggleFollow = useCallback(() => {
    if (followOn) stopFollow();
    else startMic();
  }, [followOn, stopFollow, startMic]);

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
  const saveJson = useCallback(() => {
    downloadRecording(follow.stopRecording(), `follow-recording-${Date.now()}.json`);
  }, [follow]);

  // While following we present a single scrolling column (teleprompter) with the
  // current line highlighted; when off, the sheet renders exactly as before.
  const lines = useMemo(() => text.split('\n'), [text]);

  return (
    <div className={cn('relative', className)}>
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
          <pre className={PRE_BASE_CLASS} style={fontStyle}>
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
          <pre className={PRE_BASE_CLASS} style={fontStyle}>{text}</pre>
        )}
      </div>

      {(norm.hasLyrics || debug) && (
        <FollowControls
          follow={follow}
          followOn={followOn}
          paused={paused}
          micSupported={micSupported}
          lyricStates={norm.lyricStates}
          debug={debug}
          onToggleFollow={toggleFollow}
          onResume={resume}
          onDemo={startDemo}
          onSaveJson={saveJson}
        />
      )}
    </div>
  );
}

export default PerformanceSheet;
