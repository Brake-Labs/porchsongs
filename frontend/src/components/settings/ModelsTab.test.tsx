import { render, screen, fireEvent, within } from '@testing-library/react';
import ModelsTab from '@/components/settings/ModelsTab';

vi.mock('@/api', () => ({
  default: {
    listProviders: vi.fn().mockResolvedValue({ providers: [], platform_enabled: false }),
  },
}));

function renderModelsTab(overrides: Partial<Parameters<typeof ModelsTab>[0]> = {}) {
  const defaults = {
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    savedModels: [],
    onSave: vi.fn(),
    onAddModel: vi.fn().mockResolvedValue(undefined),
    onRemoveModel: vi.fn().mockResolvedValue(undefined),
    connections: [],
    onAddConnection: vi.fn().mockResolvedValue(null),
    onRemoveConnection: vi.fn(),
    reasoningEffort: 'high',
    onChangeReasoningEffort: vi.fn(),
    ...overrides,
  };
  return { ...render(<ModelsTab {...defaults} />), props: defaults };
}

function getReasoningSelect() {
  const section = screen.getByText('Default Reasoning Effort').closest('div')!;
  return within(section).getByRole('combobox');
}

describe('ModelsTab reasoning effort', () => {
  it('renders all reasoning effort options including Max', () => {
    renderModelsTab();
    const select = getReasoningSelect();
    const options = Array.from(select.querySelectorAll('option'));
    const values = options.map(o => o.getAttribute('value'));
    expect(values).toEqual(['none', 'low', 'medium', 'high', 'xhigh']);
  });

  it('shows the selected reasoning effort', () => {
    renderModelsTab({ reasoningEffort: 'xhigh' });
    const select = getReasoningSelect() as HTMLSelectElement;
    expect(select.value).toBe('xhigh');
  });

  it('calls onChangeReasoningEffort when selection changes', () => {
    const { props } = renderModelsTab();
    const select = getReasoningSelect();
    fireEvent.change(select, { target: { value: 'xhigh' } });
    expect(props.onChangeReasoningEffort).toHaveBeenCalledWith('xhigh');
  });

  it('mentions adaptive thinking in the description', () => {
    renderModelsTab();
    expect(screen.getByText(/adaptive thinking/i)).toBeInTheDocument();
  });
});
