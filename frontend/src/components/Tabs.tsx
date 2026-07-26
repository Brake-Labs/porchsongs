import { useNavigate, useLocation } from 'react-router-dom';
import { Tabs as TabsRoot, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
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
    { key: 'rewrite', path: '/app/rewrite', label: 'Rewrite' },
    { key: 'library', path: '/app/library', label: 'Library' },
    { key: 'settings', path: `/app/settings/${getDefaultSettingsTab(isPremium)}`, label: 'Settings' },
  ];
  const extra: TopLevelTab[] = getExtraTopLevelTabs(isPremium, isAdmin);
  return [...tabs, ...extra];
}

const MATCH_PREFIXES = ['/app/rewrite', '/app/library', '/app/settings', '/app/admin'] as const;

export function activeKeyFromPath(pathname: string): string {
  if (pathname.startsWith(MATCH_PREFIXES[1])) return 'library';
  if (pathname.startsWith(MATCH_PREFIXES[2])) return 'settings';
  if (pathname.startsWith(MATCH_PREFIXES[3])) return 'admin';
  return 'rewrite';
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
    const tab = tabItems.find(t => t.key === key);
    if (tab) navigate(tab.path);
  };

  return (
    <div className="flex items-center max-w-[1800px] mx-auto">
      <TabsRoot value={active} className="min-w-0 flex-1">
        <TabsList className="mx-0">
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
      {onNewSong && (
        <Button
          size="sm"
          className="shrink-0 mr-4 sm:mr-8 my-1.5"
          onClick={onNewSong}
        >
          + New Song
        </Button>
      )}
    </div>
  );
}
