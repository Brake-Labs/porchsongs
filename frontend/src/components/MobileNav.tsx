import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Sheet, SheetContent, SheetClose } from '@/components/ui/sheet';
import { buildTabItems, activeKeyFromPath } from '@/components/Tabs';
import { useAuth } from '@/contexts/AuthContext';
import { getFeatureRequestUrl, getReportIssueUrl } from '@/extensions';
import { cn } from '@/lib/utils';

interface MobileNavProps {
  onNewSong?: () => void;
}

export default function MobileNav({ onNewSong }: MobileNavProps) {
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
          <nav className="flex flex-col py-2 flex-1">
            {navItems.map(item => (
              <button
                key={item.key}
                className={cn(
                  'flex items-center px-4 py-3 text-sm text-left transition-colors',
                  active === item.key
                    ? 'text-primary font-semibold bg-primary-light'
                    : 'text-muted-foreground hover:text-foreground hover:bg-panel'
                )}
                onClick={() => {
                  // The "New Song" item starts a fresh song, mirroring the tab bar.
                  if (item.key === 'rewrite' && onNewSong) {
                    onNewSong();
                  } else {
                    handleNav(item.path);
                  }
                  setOpen(false);
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="border-t border-border px-4 py-3 mt-auto">
            <div className="flex flex-col gap-2 text-sm">
              <a
                href={getReportIssueUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Report issue
              </a>
              <a
                href={getFeatureRequestUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Feature request
              </a>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <a
                href="https://github.com/Brake-Labs/porchsongs"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                </svg>
              </a>
              <a
                href="https://x.com/natebrake"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="X (Twitter)"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
