import { useState, useEffect, useRef, useCallback, type ChangeEvent } from 'react';
import api from '@/api';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import AddModelForm from '@/components/settings/AddModelForm';
import ProviderModelGroup from '@/components/settings/ProviderModelGroup';
import type { Provider, ProviderConnection, SavedModel } from '@/types';

interface ModelsTabProps {
  provider: string;
  model: string;
  savedModels: SavedModel[];
  onSave: (provider: string, model: string) => void;
  onAddModel: (provider: string, model: string) => Promise<SavedModel | undefined>;
  onRemoveModel: (id: number) => Promise<void>;
  connections: ProviderConnection[];
  onAddConnection: (provider: string, apiBase?: string | null) => Promise<ProviderConnection | null>;
  onRemoveConnection: (id: number) => void;
  reasoningEffort: string;
  onChangeReasoningEffort: (value: string) => void;
}

export default function ModelsTab({
  provider,
  model,
  savedModels,
  onSave,
  onAddModel,
  onRemoveModel,
  connections,
  onAddConnection,
  onRemoveConnection,
  reasoningEffort,
  onChangeReasoningEffort,
}: ModelsTabProps) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [platformAvailable, setPlatformAvailable] = useState(false);
  const [prefillProvider, setPrefillProvider] = useState<string | null>(null);
  const addFormRef = useRef<HTMLDivElement>(null);

  const handleAddAnother = useCallback((prov: string) => {
    setPrefillProvider(prov);
    addFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  useEffect(() => {
    api.listProviders()
      .then(res => { setProviders(res.providers); setPlatformAvailable(res.platform_enabled); })
      .catch(() => setProviders([]));
  }, []);

  // Group saved models by provider
  const modelsByProvider = new Map<string, SavedModel[]>();
  for (const sm of savedModels) {
    const list = modelsByProvider.get(sm.provider) ?? [];
    list.push(sm);
    modelsByProvider.set(sm.provider, list);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Reasoning effort */}
      <div className="pb-4 border-b border-border">
        <Label>Default Reasoning Effort</Label>
        <p className="text-sm text-muted-foreground mb-2">
          Controls how much effort the LLM spends thinking before responding.
          Anthropic models use adaptive thinking, where the model dynamically
          decides when and how deeply to reason.
        </p>
        <Select
          value={reasoningEffort}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => onChangeReasoningEffort(e.target.value)}
          className="max-w-[200px]"
        >
          <option value="none">Off</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="xhigh">Max (Opus only)</option>
        </Select>
      </div>

      {/* Add model form */}
      <div ref={addFormRef}>
        <AddModelForm
          providers={providers}
          connections={connections}
          savedModels={savedModels}
          prefillProvider={prefillProvider}
          onPrefillConsumed={() => setPrefillProvider(null)}
          onAddConnection={onAddConnection}
          onAddModel={onAddModel}
          onActivate={onSave}
        />
      </div>

      {/* Your Models */}
      <div>
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-4">Your Models</h3>
        {connections.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No models configured yet. Add one above to get started.
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {connections.map(conn => (
              <ProviderModelGroup
                key={conn.id}
                conn={conn}
                models={modelsByProvider.get(conn.provider) ?? []}
                activeProvider={provider}
                activeModel={model}
                onActivate={onSave}
                onRemoveModel={onRemoveModel}
                onDisconnect={onRemoveConnection}
                onAddAnother={handleAddAnother}
              />
            ))}
          </div>
        )}
      </div>

      {platformAvailable && (
        <p className="text-xs text-muted-foreground text-center">
          Using{' '}
          <a href="https://any-llm.ai" target="_blank" rel="noopener noreferrer" className="underline font-medium">
            any-llm.ai
          </a>
          {' '}for key management and access
        </p>
      )}
    </div>
  );
}
