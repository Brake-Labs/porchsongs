import { useEffect } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import useTuner from '@/hooks/useTuner';
import TunerGauge from '@/components/TunerGauge';

export type TuningStatus = 'intune' | 'close' | 'off' | 'idle';

interface TunerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const tuningColorClass: Record<TuningStatus, string> = {
  intune: 'text-tuner-intune',
  close: 'text-tuner-close',
  off: 'text-tuner-off',
  idle: 'text-muted-foreground',
};

export default function TunerDialog({ open, onOpenChange }: TunerDialogProps) {
  const tuner = useTuner();

  // Auto-start when dialog opens, stop when it closes
  useEffect(() => {
    if (open) {
      tuner.start();
    } else {
      tuner.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      tuner.stop();
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tuner</DialogTitle>
          <DialogPrimitive.Close
            className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer p-1 rounded-sm"
            aria-label="Close tuner"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </DialogPrimitive.Close>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col items-center gap-2">
            {tuner.status === 'error' ? (
              <ErrorState errorType={tuner.errorType} onRetry={tuner.start} />
            ) : (
              <>
                <TunerGauge cents={tuner.cents} status={tuner.tuningStatus} />

                {/* Note display */}
                <div className="text-center mt-1">
                  <span
                    className={cn(
                      'font-display text-[56px] sm:text-[72px] leading-none transition-colors duration-200',
                      tuningColorClass[tuner.tuningStatus],
                      tuner.tuningStatus === 'intune' && 'scale-105',
                    )}
                    style={{
                      transition: 'color 200ms ease-out, transform 200ms ease-out',
                      display: 'inline-block',
                      transform: tuner.tuningStatus === 'intune' ? 'scale(1.05)' : 'scale(1)',
                    }}
                  >
                    {tuner.note ?? '--'}
                  </span>
                  {tuner.octave !== null && (
                    <sub className="text-base text-muted-foreground ml-0.5">{tuner.octave}</sub>
                  )}
                </div>

                {/* Cents */}
                <p className="font-mono text-xs sm:text-sm text-muted-foreground">
                  {tuner.note
                    ? `${tuner.cents > 0 ? '+' : ''}${tuner.cents} cents`
                    : 'Play a note...'}
                </p>

                {/* Status indicator */}
                {tuner.status === 'listening' && (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    <span className="text-xs text-muted-foreground">Listening...</span>
                  </div>
                )}
              </>
            )}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function ErrorState({ errorType, onRetry }: { errorType: string | null; onRetry: () => void }) {
  let icon: React.ReactNode;
  let heading: string;
  let message: string;
  let showRetry = true;

  switch (errorType) {
    case 'permission-denied':
      icon = (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground" aria-hidden="true">
          <line x1="1" y1="1" x2="23" y2="23" />
          <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
          <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .28-.02.56-.06.83" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      );
      heading = 'Microphone access needed';
      message = 'Allow microphone access in your browser settings, then try again.';
      break;
    case 'not-found':
      icon = (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground" aria-hidden="true">
          <line x1="1" y1="1" x2="23" y2="23" />
          <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
          <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .28-.02.56-.06.83" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      );
      heading = 'No microphone detected';
      message = 'Connect a microphone and try again.';
      break;
    case 'insecure-context':
      icon = (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 9.9-1" />
        </svg>
      );
      heading = 'Secure connection required';
      message = 'Microphone access requires HTTPS or localhost. Try accessing this page via localhost instead.';
      showRetry = false;
      break;
    case 'unsupported':
      icon = (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      );
      heading = 'Browser not supported';
      message = "Your browser doesn't support audio input. Try Chrome or Firefox.";
      showRetry = false;
      break;
    default:
      icon = null;
      heading = 'Something went wrong';
      message = 'An unexpected error occurred.';
  }

  return (
    <div className="flex flex-col items-center gap-3 py-6">
      {icon}
      <h3 className="text-base font-semibold text-foreground">{heading}</h3>
      <p className="text-sm text-muted-foreground text-center max-w-xs">{message}</p>
      {showRetry && (
        <button
          className="mt-2 text-sm px-4 py-2 rounded-md bg-primary text-white cursor-pointer hover:bg-primary-hover transition-colors"
          onClick={onRetry}
        >
          Try Again
        </button>
      )}
    </div>
  );
}
