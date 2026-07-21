import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ModelSelector from '@/components/ModelSelector';

describe('ModelSelector', () => {
  const models = ['personal-ps-anthropic:claude-sonnet-4-6', 'ds4'];

  it('shows "No models available" when no models and no model selected', () => {
    render(
      <ModelSelector
        model=""
        models={[]}
        onChangeModel={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    );
    expect(screen.getByText(/No models available/)).toBeInTheDocument();
  });

  it('calls onOpenSettings when "Open Settings" link is clicked', async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    render(
      <ModelSelector
        model=""
        models={[]}
        onChangeModel={vi.fn()}
        onOpenSettings={onOpenSettings}
      />
    );
    await user.click(screen.getByText('Open Settings'));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('renders a select with the available models', () => {
    render(
      <ModelSelector
        model="ds4"
        models={models}
        onChangeModel={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    );
    expect(screen.getByText('personal-ps-anthropic:claude-sonnet-4-6')).toBeInTheDocument();
    expect(screen.getByText('ds4')).toBeInTheDocument();
    expect(screen.getByText('Manage models...')).toBeInTheDocument();
  });

  it('calls onChangeModel when a model is selected', async () => {
    const user = userEvent.setup();
    const onChangeModel = vi.fn();
    render(
      <ModelSelector
        model="ds4"
        models={models}
        onChangeModel={onChangeModel}
        onOpenSettings={vi.fn()}
      />
    );
    await user.selectOptions(screen.getByRole('combobox'), 'personal-ps-anthropic:claude-sonnet-4-6');
    expect(onChangeModel).toHaveBeenCalledWith('personal-ps-anthropic:claude-sonnet-4-6');
  });

  it('calls onOpenSettings when "Manage models..." is selected', async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    render(
      <ModelSelector
        model="ds4"
        models={models}
        onChangeModel={vi.fn()}
        onOpenSettings={onOpenSettings}
      />
    );
    await user.selectOptions(screen.getByRole('combobox'), '__manage__');
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});
