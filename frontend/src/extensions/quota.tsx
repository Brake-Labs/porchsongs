/** OSS stub: premium overlay replaces this with real quota UI. */
import type { ReactNode } from 'react';
import type { TokenUsage } from '@/types';

export function QuotaBanner(): null {
  return null;
}

export function OnboardingBanner({
  children,
}: {
  children?: ReactNode;
  /** Whether the viewer is a confirmed new user. Ignored by the OSS stub. */
  show?: boolean;
}): ReactNode {
  return children ?? null;
}

export function QuotaUpgradeLink(_props: { className?: string }): null {
  return null;
}

export function isQuotaError(_message: string, _errorType?: string): boolean {
  return false;
}

/**
 * Chart-count status for the library. Premium renders a count and, at or above
 * the plan cap, an upgrade banner.
 *
 * Placement rule the premium implementation must honour: silent below 80% of the
 * cap, a quiet count row from 80%, a banner with an upgrade link at or above the
 * cap. Showing "3 of 40" to a brand new user is noise.
 */
export function SongCapNotice(_props: { count: number; className?: string }): null {
  return null;
}

/**
 * True when the account may read but not write.
 *
 * Premium returns true when the user holds more charts than their plan allows,
 * which happens after a paid plan lapses. Reads, playback, export, and delete are
 * never blocked, so this only gates edit affordances.
 *
 * Rule for consumers: do NOT grey out or disable controls. Keep them visible and
 * enabled, and replace the action with a one-line inline explanation plus an
 * upgrade link. A dead grey button tells the user nothing about why.
 */
export function useReadOnly(): boolean {
  return false;
}

/**
 * True when this account has Follow diagnostics capture switched on.
 *
 * The capture controls (Record / Save logs and the tracker overlay) are an
 * operator tool, not a user feature, so something has to opt in. Self-hosted
 * porchsongs opts in with `?followdebug`, which is why this stub can honestly
 * return false: nothing is lost without a premium layer. Premium reads a setting
 * an admin turns on for their own account, because the sessions worth capturing
 * happen on a phone running the installed app, where there is no address bar to
 * put a query string in.
 */
export function useFollowCaptureEnabled(): boolean {
  return false;
}

export function UsageFooter({ tokenUsage }: { tokenUsage: TokenUsage }): ReactNode {
  if (tokenUsage.input_tokens === 0 && tokenUsage.output_tokens === 0) return null;
  return (
    <div className="px-4 py-1.5 border-t border-border text-xs text-muted-foreground flex justify-between" aria-live="polite">
      <span>
        Tokens used: {(tokenUsage.input_tokens + tokenUsage.output_tokens).toLocaleString()}
      </span>
      <span>
        {tokenUsage.input_tokens.toLocaleString()} in / {tokenUsage.output_tokens.toLocaleString()} out
      </span>
    </div>
  );
}
