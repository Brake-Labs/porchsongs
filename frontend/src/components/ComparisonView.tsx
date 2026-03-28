import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn, copyToClipboard as copyText } from '@/lib/utils';

function CopyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  );
}

interface ComparisonViewProps {
  rewritten: string;
  onRewrittenChange: (value: string) => void;
  headerLeft?: ReactNode;
  flat?: boolean;
  onShowOriginal?: () => void;
}

export default function ComparisonView({
  rewritten,
  onRewrittenChange,
  headerLeft,
  flat,
  onShowOriginal,
}: ComparisonViewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (copyText(rewritten)) {
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 1500);
    } else {
      toast.error('Failed to copy');
    }
  };

  return (
    <Card className={cn('flex flex-col flex-1 min-h-0 overflow-hidden', flat && 'border-0 shadow-none rounded-none bg-transparent')}>
      <CardHeader className={cn('flex items-center justify-between gap-2', flat && 'md:hidden')}>
        {headerLeft || <span>Your Version</span>}
        <div className="flex items-center gap-1.5 shrink-0">
          {onShowOriginal && (
            <Button variant="secondary" size="sm" onClick={onShowOriginal}>
              Show Original
            </Button>
          )}
        </div>
      </CardHeader>
      <div className="relative flex-1 min-h-0 group/copy bg-card shadow-[inset_0_1px_4px_rgba(0,0,0,0.04)] rounded-sm">
        <Textarea
          className="h-full border-0 rounded-none p-3 sm:p-4 text-xs sm:text-code bg-transparent resize-none overflow-y-auto overscroll-y-contain cursor-text focus-visible:ring-0"
          value={rewritten}
          onChange={e => onRewrittenChange(e.target.value)}
          aria-label="Rewritten content editor"
        />
        <button
          className="absolute top-2 right-2 p-1.5 rounded-md bg-card/80 hover:bg-card border border-border/50 text-muted-foreground hover:text-foreground opacity-0 group-hover/copy:opacity-100 focus:opacity-100 transition-opacity cursor-pointer"
          onClick={handleCopy}
          aria-label="Copy to clipboard"
        >
          {copied ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          ) : (
            <CopyIcon />
          )}
        </button>
      </div>
    </Card>
  );
}
