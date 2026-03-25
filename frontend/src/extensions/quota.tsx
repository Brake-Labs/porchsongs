/** OSS stub: premium overlay replaces this with real quota UI. */
import type { ReactNode } from 'react';
import type { TokenUsage } from '@/types';

export function QuotaBanner(): null {
  return null;
}

export function OnboardingBanner({ children }: { children?: ReactNode }): ReactNode {
  return children ?? null;
}

export function QuotaUpgradeLink(_props: { className?: string }): null {
  return null;
}

export function isQuotaError(_message: string): boolean {
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
