import { useParams, useNavigate, useOutletContext } from 'react-router-dom';
import { cn } from '@/lib/utils';
import ModelsTab from '@/components/settings/ModelsTab';
import SystemPromptsTab from '@/components/settings/SystemPromptsTab';
import type { AppShellContext } from '@/layouts/AppShell';
import { getExtraSettingsTabs, renderPremiumSettingsTab, showOssSettingsTabs } from '@/extensions';

const SETTINGS_TABS = [
  { key: 'models', label: 'Model' },
  { key: 'prompts', label: 'System Prompts' },
] as const;

export default function SettingsPage() {
  const ctx = useOutletContext<AppShellContext>();
  const {
    model,
    models,
    onChangeModel,
    profile,
    onSaveProfile,
    reasoningEffort,
    onChangeReasoningEffort,
    isPremium,
    isAdmin,
  } = ctx;
  const extraTabs = getExtraSettingsTabs(isPremium, isAdmin);
  const ossTabs = showOssSettingsTabs(isPremium) ? [...SETTINGS_TABS] : [];
  const visibleTabs = [...extraTabs, ...ossTabs];
  const defaultTab = visibleTabs[0]?.key ?? 'models';
  const { tab: activeTab = defaultTab } = useParams<{ tab: string }>();
  const navigate = useNavigate();
  const onChangeTab = (sub: string) => navigate(`/app/settings/${sub}`);

  return (
    <div>
      {visibleTabs.length > 1 && (
        <div className="flex border-b border-border mb-4">
          {visibleTabs.map(t => (
            <button
              key={t.key}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                activeTab === t.key
                  ? 'text-primary border-primary'
                  : 'text-muted-foreground border-transparent hover:text-foreground'
              )}
              onClick={() => onChangeTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {renderPremiumSettingsTab(activeTab)}

      {activeTab === 'models' && (
        <ModelsTab
          model={model}
          models={models}
          onChangeModel={onChangeModel}
          reasoningEffort={reasoningEffort}
          onChangeReasoningEffort={onChangeReasoningEffort}
        />
      )}

      {activeTab === 'prompts' && (
        <SystemPromptsTab profile={profile} onSaveProfile={onSaveProfile} />
      )}
    </div>
  );
}
