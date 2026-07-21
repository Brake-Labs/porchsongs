import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import type { ChangeEvent } from 'react';

interface ModelSelectorProps {
  model: string;
  models: string[];
  onChangeModel: (model: string) => void;
  onOpenSettings: () => void;
}

export default function ModelSelector({ model, models, onChangeModel, onOpenSettings }: ModelSelectorProps) {
  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === '__manage__') {
      onOpenSettings();
      return;
    }
    if (!val) return;
    onChangeModel(val);
  };

  if (!models.length && !model) {
    return (
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm text-muted-foreground">
          No models available.{' '}
          <Button variant="link-inline" onClick={onOpenSettings}>Open Settings</Button> to choose one.
        </span>
      </div>
    );
  }

  const hasCurrent = !!model && models.includes(model);

  return (
    <div className="flex items-center gap-2 mb-3">
      <Select
        value={model}
        onChange={handleChange}
        className="w-full sm:w-auto sm:min-w-[220px] py-1.5 px-2.5 text-sm"
        aria-label="Model"
      >
        {!model && <option value="">Select model...</option>}
        {model && !hasCurrent && <option value={model}>{model}</option>}
        {models.map(m => (
          <option key={m} value={m}>{m}</option>
        ))}
        <option value="__manage__">Manage models...</option>
      </Select>
    </div>
  );
}
