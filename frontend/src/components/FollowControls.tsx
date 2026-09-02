import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import FollowDebugOverlay from '@/components/FollowDebugOverlay';
import useFollowDebugHud from '@/hooks/useFollowDebugHud';
import type { UseFollowResult } from '@/hooks/useFollow';
import type { FollowWarning } from '@/lib/followHealth';
import type { LyricState } from '@/lib/followAlign';

interface FollowControlsProps {
  follow: UseFollowResult;
  followOn: boolean;
  paused: boolean;
  /** Computed upstream (PerformanceSheet), shared with the bar's Follow button. */
  warning: FollowWarning | null;
  lyricStates: LyricState[];
  debug: boolean;
  onResume: () => void;
  onSaveJson: () => void;
  /** Outcome of the last save, so a phone user knows whether it left the device. */
  saveState: 'idle' | 'saving' | 'uploaded' | 'downloaded';
}

/**
 * The visible Follow-mode chrome layered over the performance sheet: warnings,
 * the "Resume follow" affordance after a manual scroll, and (only when the
 * account has Follow capture enabled) the diagnostics HUD with its record/save
 * controls. The primary Follow toggle lives in the play route's bottom bar.
 */
export default function FollowControls({
  follow,
  followOn,
  paused,
  warning,
  lyricStates,
  debug,
  onResume,
  onSaveJson,
  saveState,
}: FollowControlsProps) {
  const [hudOpen, toggleHud] = useFollowDebugHud();

  return (
    <>
      <div className="absolute right-2 top-2 z-20 flex flex-col items-end gap-1">
        {/* A mic error drops Follow back off, so this has to survive followOn
            going false or the failure would vanish silently. */}
        {warning && (
          <div
            role={warning.fatal ? 'alert' : 'status'}
            className={cn(
              'w-64 max-w-[70vw] rounded-md border px-3 py-2 text-left shadow-sm',
              warning.fatal
                ? 'border-danger bg-danger-light text-danger'
                : 'border-warning-border bg-warning-bg text-warning-text',
            )}
          >
            <p className="text-xs font-semibold">{warning.heading}</p>
            <p className="mt-0.5 text-[11px] leading-snug opacity-90">{warning.message}</p>
          </div>
        )}
      </div>

      {/* Resume affordance after a manual scroll */}
      {followOn && paused && (
        <button
          type="button"
          onClick={onResume}
          className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-lg cursor-pointer"
        >
          Resume follow
        </button>
      )}

      {/* Diagnostics HUD, only for an account with Follow capture switched on,
          and only once it has been asked for from the chart actions menu. It
          covers the bottom-right of the chart, which is where the last line of a
          verse tends to be, so it is off unless someone is actually watching the
          aligner. The Hide button here and the menu item are the same switch. */}
      {debug && hudOpen && (
        <div className="absolute bottom-3 right-3 z-20 w-80 max-w-[calc(100%-1.5rem)] max-h-[60%] overflow-auto rounded-lg border border-border bg-card text-foreground shadow-2xl ring-1 ring-black/10">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Follow · debug</span>
            <button
              type="button"
              onClick={toggleHud}
              aria-expanded
              aria-label="Hide Follow debug panel"
              className="cursor-pointer rounded px-1.5 py-0.5 text-muted-foreground hover:bg-panel hover:text-foreground"
            >
              Hide
            </button>
          </div>
          <div className="p-3">
            <FollowDebugOverlay
              estimate={follow.estimate}
              lyricStates={lyricStates}
              recentWords={follow.recentWords}
              running={follow.running}
              recording={follow.recording}
              error={follow.error}
              stage={follow.stage}
              lastArbiter={follow.lastArbiter}
            />
          </div>
          <div className="flex flex-wrap gap-1.5 border-t border-border bg-panel px-3 py-2">
            {follow.recording ? (
              <Button size="sm" variant="secondary" onClick={onSaveJson} disabled={saveState === 'saving'}>
                {saveState === 'saving' ? 'Saving...' : 'Save logs'}
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={follow.startRecording}>
                Record
              </Button>
            )}
            {/* Whether it left the device is the only part a phone user cannot
                check for themselves, so it is stated rather than implied. */}
            {saveState === 'uploaded' && (
              <span role="status" className="self-center text-[11px] text-green-600">
                Saved to server
              </span>
            )}
            {saveState === 'downloaded' && (
              <span role="status" className="self-center text-[11px] text-muted-foreground">
                Downloaded to this device
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );
}
