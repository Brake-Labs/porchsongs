import { useState, type ReactNode } from 'react';
import { AppShellProviders } from '@/contexts/AppShellContext';
import { defaults, split, type AppShellTestValue } from '@/test/app-shell-mocks';

export type { AppShellTestValue } from '@/test/app-shell-mocks';

/** Provides AppShell's contexts from a flat partial value. */
export function TestAppShell({ value = {}, children }: { value?: Partial<AppShellTestValue>; children: ReactNode }) {
  // Defaults once per mount, so their functions keep a stable identity.
  const [base] = useState(defaults);
  const v = split(value, base);
  return (
    <AppShellProviders settings={v.settings} parse={v.parse} workshop={v.workshop} workshopActions={v.workshopActions}>
      {children}
    </AppShellProviders>
  );
}
