import { type ChangeEvent } from 'react';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';

interface ModelsTabProps {
  model: string;
  models: string[];
  onChangeModel: (model: string) => void;
  reasoningEffort: string;
  onChangeReasoningEffort: (value: string) => void;
}

export default function ModelsTab({
  model,
  models,
  onChangeModel,
  reasoningEffort,
  onChangeReasoningEffort,
}: ModelsTabProps) {
  const hasCurrent = !!model && models.includes(model);

  return (
    <div className="flex flex-col gap-6">
      {/* Model */}
      <div className="pb-4 border-b border-border">
        <Label>Model</Label>
        <p className="text-sm text-muted-foreground mb-2">
          Choose which model handles parsing and chat. Models are served through
          the PorchSongs gateway, so there are no keys to manage.
        </p>
        {models.length > 0 ? (
          <Select
            value={model}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => onChangeModel(e.target.value)}
            className="max-w-[320px]"
            aria-label="Model"
          >
            {!model && <option value="">Select model...</option>}
            {model && !hasCurrent && <option value={model}>{model}</option>}
            {models.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </Select>
        ) : (
          <div className="flex flex-col gap-1 max-w-[320px]">
            <p className="text-sm text-muted-foreground italic">
              No models available from the gateway. Enter a model id to use it directly.
            </p>
            <Input
              value={model}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onChangeModel(e.target.value)}
              placeholder="e.g. personal-ps-anthropic:claude-sonnet-4-6"
              aria-label="Model id"
            />
          </div>
        )}
      </div>

      {/* Reasoning effort */}
      <div>
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
    </div>
  );
}
