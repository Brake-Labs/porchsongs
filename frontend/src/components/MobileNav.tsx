import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Sheet, SheetContent, SheetClose } from '@/components/ui/sheet';
import { buildTabItems, activeKeyFromPath } from '@/components/Tabs';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { isPremium, currentAuthUser } = useAuth();
  const isAdmin = currentAuthUser?.role === 'admin';
  const navItems = buildTabItems(isPremium, isAdmin);
  const active = activeKeyFromPath(pathname);

  const handleNav = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  return (
    <div className="md:hidden">
      <button
        className="p-2 -ml-1 text-header-text hover:bg-black/10 rounded-md transition-colors"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left">
          <DialogPrimitive.Title className="sr-only">Navigation menu</DialogPrimitive.Title>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold text-foreground">Navigation</span>
            <SheetClose asChild>
              <button
                className="p-1 text-muted-foreground hover:text-foreground rounded-md transition-colors"
                aria-label="Close navigation menu"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </SheetClose>
          </div>
          <nav className="flex flex-col py-2">
            {navItems.map(item => (
              <button
                key={item.key}
                className={cn(
                  'flex items-center px-4 py-3 text-sm text-left transition-colors',
                  active === item.key
                    ? 'text-primary font-semibold bg-primary-light'
                    : 'text-muted-foreground hover:text-foreground hover:bg-panel'
                )}
                onClick={() => handleNav(item.path)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  );
}
