import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;

const SheetOverlay = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out',
      className
    )}
    {...props}
  />
));
SheetOverlay.displayName = 'SheetOverlay';

interface SheetContentProps
  extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: 'left' | 'right';
}

const SheetContent = forwardRef<HTMLDivElement, SheetContentProps>(
  ({ className, children, side = 'left', ...props }, ref) => (
    <DialogPrimitive.Portal>
      <SheetOverlay />
      <DialogPrimitive.Content
        ref={ref}
        aria-describedby={undefined}
        className={cn(
          'fixed z-50 flex flex-col bg-card shadow-lg focus:outline-none',
          'inset-y-0 w-64',
          side === 'left' &&
            'left-0 data-[state=open]:animate-sheet-in-left data-[state=closed]:animate-sheet-out-left',
          side === 'right' &&
            'right-0 data-[state=open]:animate-sheet-in-right data-[state=closed]:animate-sheet-out-right',
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
);
SheetContent.displayName = 'SheetContent';

export { Sheet, SheetTrigger, SheetClose, SheetContent };
