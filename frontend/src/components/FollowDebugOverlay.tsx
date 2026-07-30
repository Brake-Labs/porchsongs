import { cn } from '@/lib/utils';
import type { FollowEstimate, LyricState } from '@/lib/followAlign';
import type { SignalError } from '@/lib/followSignal';
import type { FollowArbiterEvent } from '@/hooks/useFollow';

interface FollowDebugOverlayProps {
  estimate: FollowEstimate | null;
  lyricStates: LyricState[];
  recentWords: string[];
  running: boolean;
  recording: boolean;
  error: SignalError | null;
  lastArbiter?: FollowArbiterEvent | null;
}

const STATUS_STYLE: Record<string, string> = {
  locked: 'bg-primary text-white',
  ambiguous: 'bg-warning-bg text-warning-text',
  searching: 'bg-panel text-muted-foreground',
  disabled: 'bg-panel text-muted-foreground',
};

function lineText(states: LyricState[], stateIndex: number): string {
  return states[stateIndex]?.tokens.join(' ') ?? '';
}

/**
 * Read-only diagnostics for the Follow tracker: current status/confidence, the
 * top candidate positions with their probabilities and lyric text, and the most
 * recent recognized words. This is what makes the aligner's behavior visible so
 * thresholds can be judged (and recorded for offline tuning).
 */
export default function FollowDebugOverlay({
  estimate,
  lyricStates,
  recentWords,
  running,
  recording,
  error,
  lastArbiter,
}: FollowDebugOverlayProps) {
  const status = estimate?.status ?? 'searching';
  return (
    <div className="text-xs font-mono" aria-label="Follow debug overlay">
      <div className="flex items-center gap-2 mb-2">
        <span className={cn('rounded px-2 py-0.5 font-semibold uppercase', STATUS_STYLE[status])}>
          {status}
        </span>
        <span className="text-muted-foreground">
          conf {(estimate?.confidence ?? 0).toFixed(2)}
        </span>
        {running && (
          <span className="flex items-center gap-1 text-primary">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
            live
          </span>
        )}
        {recording && <span className="text-danger">● rec</span>}
      </div>

      {error && (
        <div className="mb-2 text-danger" role="alert">
          signal error: {error.type}
        </div>
      )}

      <ol className="space-y-1">
        {(estimate?.top ?? []).map((c) => (
          <li key={c.stateIndex} className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-muted-foreground">#{c.renderIndex}</span>
            <span className="relative h-3 w-16 shrink-0 overflow-hidden rounded bg-panel">
              <span
                className="absolute inset-y-0 left-0 bg-primary"
                style={{ width: `${Math.round(c.p * 100)}%` }}
              />
            </span>
            <span className="w-9 shrink-0 tabular-nums text-muted-foreground">
              {c.p.toFixed(2)}
            </span>
            <span className="truncate text-foreground">{lineText(lyricStates, c.stateIndex)}</span>
          </li>
        ))}
      </ol>

      <div className="mt-2 border-t border-border pt-2 text-muted-foreground">
        <span className="mr-1 uppercase">heard:</span>
        <span className="text-foreground">{recentWords.join(' ') || '—'}</span>
      </div>

      {lastArbiter && (
        <div className="mt-1 text-muted-foreground">
          <span className="mr-1 uppercase">llm:</span>
          <span className="text-foreground">
            {lastArbiter.choice != null ? `chose line #${lastArbiter.choice}` : 'unsure'} of{' '}
            [{lastArbiter.candidates.join(', ')}]
          </span>
        </div>
      )}
    </div>
  );
}
