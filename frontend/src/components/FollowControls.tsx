import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import FollowDebugOverlay from '@/components/FollowDebugOverlay';
import type { UseFollowResult } from '@/hooks/useFollow';
import type { LyricState } from '@/lib/followAlign';

interface FollowControlsProps {
  follow: UseFollowResult;
  followOn: boolean;
  paused: boolean;
  micSupported: boolean;
  lyricStates: LyricState[];
  debug: boolean;
  onToggleFollow: () => void;
  onResume: () => void;
  onSaveJson: () => void;
  /** Outcome of the last save, so a phone user knows whether it left the device. */
  saveState: 'idle' | 'saving' | 'uploaded' | 'downloaded';
}

/**
 * The visible Follow-mode chrome layered over the performance sheet: the
 * primary Follow toggle, the "Resume follow" affordance after a manual scroll,
 * and (only when the account has Follow capture enabled) the diagnostics HUD with
 * its record/save controls.
 */
export default function FollowControls({
  follow,
  followOn,
  paused,
  micSupported,
  lyricStates,
  debug,
  onToggleFollow,
  onResume,
  onSaveJson,
  saveState,
}: FollowControlsProps) {
  // Non-fatal warnings ("not following") only make sense while Follow is on. A
  // fatal one has to outlive it: a mic failure now switches Follow off by
  // design, so gating purely on followOn would make the very warning this
  // component exists to show vanish the instant it fired.
  const warning = followOn || follow.warning?.fatal ? follow.warning : null;
  // "Following" next to a chart that never moves is the whole bug. Once we know
  // Follow is not working, the toggle has to stop claiming that it is.
  // "Follow error", not "Mic error": unsupported, network and aborted are all
  // fatal but none of them is a microphone problem, and the card heading beside
  // this already names the real cause.
  const label = warning?.fatal
    ? 'Follow error'
    : !followOn
      ? 'Follow'
      : warning
        ? 'Not following'
        : paused
          ? 'Paused'
          : 'Following';
  const live = followOn && !paused && !warning;

  return (
    <>
      {/* Primary toggle */}
      <div className="absolute right-2 top-2 z-20 flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={onToggleFollow}
          aria-pressed={followOn}
          aria-label={`Follow mode: ${label}`}
          title={!micSupported ? 'Voice follow needs Chrome or Edge' : 'Hands-free follow'}
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors cursor-pointer',
            followOn
              ? 'border-primary bg-primary text-white'
              : 'border-border bg-card text-foreground hover:bg-panel',
          )}
        >
          <span
            className={cn(
              'inline-block h-2 w-2 rounded-full',
              live ? 'animate-pulse bg-white' : followOn ? 'bg-white/70' : 'bg-primary',
            )}
          />
          {label}
        </button>
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

      {/* Diagnostics HUD (dev only) */}
      {debug && (
        <div className="absolute bottom-3 right-3 z-20 w-80 max-w-[calc(100%-1.5rem)] max-h-[60%] overflow-auto rounded-lg border border-border bg-card text-foreground shadow-2xl ring-1 ring-black/10">
          <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Follow · debug
          </div>
          <div className="p-3">
            <FollowDebugOverlay
              estimate={follow.estimate}
              lyricStates={lyricStates}
              recentWords={follow.recentWords}
              running={follow.running}
              recording={follow.recording}
              error={follow.error}
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
