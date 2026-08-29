import type { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Tabs as TabsRoot, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { getDefaultSettingsTab, getExtraTopLevelTabs } from '@/extensions';
import type { TopLevelTab } from '@/extensions';

export interface TabItem {
  key: string;
  path: string;
  label: string;
  match?: string[];
  badge?: ReactNode;
}

export function buildTabItems(isPremium: boolean, isAdmin: boolean): TabItem[] {
  const extra: TopLevelTab[] = getExtraTopLevelTabs(isPremium, isAdmin);
  return [
    // Library first: the app is for playing charts you already have, so the
    // common case on opening it is "find my song", not "add a new one".
    { key: 'library', path: '/app/library', label: 'Library' },
    { key: 'rewrite', path: '/app/rewrite', label: 'Import' },
    { key: 'chords', path: '/app/chords', label: 'Chords' },
    // Extra tabs go before Settings, not after it. Settings is where you go to
    // configure the things the other tabs do, so it reads last; appending after
    // it stranded every premium surface on the far side of the one tab that is
    // conventionally the end of a nav.
    ...extra,
    { key: 'settings', path: `/app/settings/${getDefaultSettingsTab(isPremium)}`, label: 'Settings' },
  ];
}

/** Built-in surfaces and the prefixes that light them. */
const BUILT_IN_MATCHES: [string, string][] = [
  ['/app/rewrite', 'rewrite'],
  ['/app/library', 'library'],
  ['/app/settings', 'settings'],
  ['/app/chords', 'chords'],
];

export function activeKeyFromPath(pathname: string, extra: TabItem[] = []): string {
  // Extra tabs first, so a premium surface can claim a path without OSS knowing
  // it exists. '/app/admin' used to be listed above by name, which meant every
  // new premium screen needed a change here to become highlightable.
  for (const tab of extra) {
    for (const prefix of tab.match ?? [tab.path]) {
      if (pathname.startsWith(prefix)) return tab.key;
    }
  }
  for (const [prefix, key] of BUILT_IN_MATCHES) {
    if (pathname.startsWith(prefix)) return key;
  }
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
  const active = activeKeyFromPath(pathname, tabItems);

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
            {t.badge}
          </TabsTrigger>
        ))}
      </TabsList>
    </TabsRoot>
  );
}
