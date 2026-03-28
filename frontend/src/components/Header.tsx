import { Link } from 'react-router-dom';
import useWakeLock from '@/hooks/useWakeLock';
import useTheme from '@/hooks/useTheme';
import { cn } from '@/lib/utils';
import type { AuthUser } from '@/types';

interface HeaderProps {
  user: AuthUser | null;
  authRequired: boolean;
  onLogout: () => void;
  isPremium?: boolean;
  leftSlot?: React.ReactNode;
}

export default function Header({ user, authRequired, onLogout, isPremium, leftSlot }: HeaderProps) {
  const wakeLock = useWakeLock();
  const { resolved: currentTheme, toggle: toggleTheme } = useTheme();
  const logoTo = isPremium ? '/' : '/app/rewrite';

  return (
    <header className="bg-linear-to-r from-header-bg-from to-header-bg-to text-header-text border-b border-header-border">
      <div className="flex justify-between items-center px-3 sm:px-8 py-2 sm:py-2.5 max-w-[1800px] mx-auto">
      <div className="flex items-center gap-0 min-w-0">
        {leftSlot}
        <Link
          className="flex items-baseline gap-0 no-underline text-inherit cursor-pointer shrink-0"
          to={logoTo}
        >
          <img src="/logo.svg" alt="" className="w-7 h-7 sm:w-9 sm:h-9 mr-2 sm:mr-2.5 self-center" />
          <h1 className="text-lg sm:text-2xl font-bold tracking-tight">porchsongs</h1>
        </Link>
        <span className="text-sm opacity-70 ml-4 hidden md:inline">Make every song yours</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          className="bg-black/5 border border-border text-header-text p-1.5 rounded-full cursor-pointer hover:bg-black/10 transition-colors"
          onClick={toggleTheme}
          aria-label={currentTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={currentTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {currentTheme === 'dark' ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          )}
        </button>
        {wakeLock.supported && (
          <button
            className={cn(
              'border text-xs px-2 sm:px-3 py-1.5 rounded-full cursor-pointer transition-colors text-header-text hover:bg-black/10',
              wakeLock.active
                ? 'bg-primary/10 border-primary/30'
                : 'bg-black/5 border-border opacity-70 hover:opacity-100'
            )}
            onClick={wakeLock.toggle}
            title={wakeLock.active ? 'Screen staying awake, click to disable' : 'Keep screen awake while viewing song'}
          >
            Stay Awake
          </button>
        )}
        {user && (
          <span className="text-xs opacity-70 hidden sm:inline">{user.name}</span>
        )}
        {authRequired && (
          <button
            className="bg-black/5 border border-border text-header-text text-xs px-2 sm:px-3 py-1.5 rounded-full cursor-pointer hover:bg-black/10 transition-colors"
            onClick={onLogout}
          >
            Log out
          </button>
        )}
      </div>
      </div>
    </header>
  );
}
