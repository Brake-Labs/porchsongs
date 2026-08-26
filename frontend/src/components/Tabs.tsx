import { useNavigate, useLocation } from 'react-router-dom';
import { Tabs as TabsRoot, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { getDefaultSettingsTab, getExtraTopLevelTabs } from '@/extensions';
import type { TopLevelTab } from '@/extensions';

export interface TabItem {
  key: string;
  path: string;
  label: string;
}

export function buildTabItems(isPremium: boolean, isAdmin: boolean): TabItem[] {
  const tabs: TabItem[] = [
    // Library first: the app is for playing charts you already have, so the
    // common case on opening it is "find my song", not "add a new one".
    { key: 'library', path: '/app/library', label: 'Library' },
    { key: 'rewrite', path: '/app/rewrite', label: 'Import' },
    { key: 'chords', path: '/app/chords', label: 'Chords' },
    { key: 'settings', path: `/app/settings/${getDefaultSettingsTab(isPremium)}`, label: 'Settings' },
  ];
  const extra: TopLevelTab[] = getExtraTopLevelTabs(isPremium, isAdmin);
  return [...tabs, ...extra];
}

const MATCH_PREFIXES = ['/app/rewrite', '/app/library', '/app/settings', '/app/admin', '/app/chords'] as const;

export function activeKeyFromPath(pathname: string): string {
  if (pathname.startsWith(MATCH_PREFIXES[0])) return 'rewrite';
  if (pathname.startsWith(MATCH_PREFIXES[1])) return 'library';
  if (pathname.startsWith(MATCH_PREFIXES[2])) return 'settings';
  if (pathname.startsWith(MATCH_PREFIXES[3])) return 'admin';
  if (pathname.startsWith(MATCH_PREFIXES[4])) return 'chords';
  // Library is the home surface, so an unmatched path (notably /app/play/:uuid,
  // which renders chromeless and shows no tab bar) highlights Library rather than
  // the import screen.
  return 'library';
}

interface TabsProps {
  onNewSong?: () => void;
}

export default function Tabs({ onNewSong }: TabsProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { isPremium, currentAuthUser } = useAuth();
  const isAdmin = currentAuthUser?.role === 'admin';
  const tabItems = buildTabItems(isPremium, isAdmin);
  const active = activeKeyFromPath(pathname);

  const handleTabClick = (key: string) => {
    // The "Import" tab starts a fresh song (reset + go to the import surface)
    // rather than just navigating, so it doubles as the always-visible create
    // action. Falls back to plain navigation if no handler is wired.
    if (key === 'rewrite' && onNewSong) {
      onNewSong();
      return;
    }
    const tab = tabItems.find(t => t.key === key);
    if (tab) navigate(tab.path);
  };

  return (
    <TabsRoot value={active}>
      <TabsList>
        {tabItems.map(t => (
          <TabsTrigger
            key={t.key}
            value={t.key}
            onClick={() => handleTabClick(t.key)}
          >
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </TabsRoot>
  );
}
