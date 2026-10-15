import type {
  ParseContextValue,
  SettingsContextValue,
  WorkshopActionsValue,
  WorkshopStateValue,
} from '@/contexts/AppShellContext';
import { ChatSessionStore } from '@/lib/chatSessions';

// Kept free of runtime imports from '@/contexts/AppShellContext', so a suite
// can mock that module with `mockAppShellHooks` from inside its factory.

/** Everything AppShell provides, flattened, for tests that set a few fields. */
export type AppShellTestValue = SettingsContextValue & ParseContextValue & WorkshopStateValue & WorkshopActionsValue;

export function defaults() {
  const settings: SettingsContextValue = {
    profile: null,
    llmSettings: { model: '', reasoning_effort: 'high' },
    model: '',
    models: [],
    reasoningEffort: 'high',
    onChangeModel: vi.fn(),
    onChangeReasoningEffort: vi.fn(),
    onOpenSettings: vi.fn(),
    onSaveProfile: vi.fn(),
    isPremium: false,
    isAdmin: false,
  };
  const parse: ParseContextValue = {
    parseLoading: false,
    parseResult: null,
    parsedContent: '',
    setParsedContent: vi.fn(),
    setParseResult: vi.fn(),
    parseStreamText: '',
    parseReasoningText: '',
    parseError: null,
    parseErrorType: undefined,
    setParseError: vi.fn(),
    onParse: vi.fn().mockResolvedValue(null),
    onCancelParse: vi.fn(),
    onClearParse: vi.fn(),
  };
  const workshop: WorkshopStateValue = {
    rewriteResult: null,
    rewriteMeta: null,
    currentSongId: null,
    currentSongUuid: null,
    chatMessages: [],
    songTitle: '',
    songArtist: '',
    isDirty: false,
    newSongNonce: 0,
  };
  const workshopActions: WorkshopActionsValue = {
    onLoadSong: vi.fn().mockResolvedValue(undefined),
    onNewRewrite: vi.fn(),
    onSongSaved: vi.fn(),
    onContentUpdated: vi.fn(),
    onOriginalContentUpdated: vi.fn(),
    setChatMessages: vi.fn(),
    setSongTitle: vi.fn(),
    setSongArtist: vi.fn(),
    setIsDirty: vi.fn(),
    chatSessions: new ChatSessionStore(),
  };
  return { settings, parse, workshop, workshopActions };
}

export type Split = ReturnType<typeof defaults>;

/** Lay a flat partial over defaults, one context at a time. */
export function split(value: Partial<AppShellTestValue>, base: Split): Split {
  const over = <T extends object>(d: T): T => {
    const out = { ...d };
    for (const key of Object.keys(d) as (keyof T)[]) {
      if (key in value) out[key] = (value as T)[key];
    }
    return out;
  };
  return {
    settings: over(base.settings),
    parse: over(base.parse),
    workshop: over(base.workshop),
    workshopActions: over(base.workshopActions),
  };
}

/**
 * A `vi.mock` factory for `@/contexts/AppShellContext` whose hooks read a
 * mutable object, for suites that set the context per test before rendering.
 * Defaults are created once, so their functions keep a stable identity.
 */
export function mockAppShellHooks(get: () => Partial<AppShellTestValue>) {
  const base = defaults();
  return {
    useSettings: () => split(get(), base).settings,
    useParse: () => split(get(), base).parse,
    useWorkshopActions: () => split(get(), base).workshopActions,
    useWorkshop: () => {
      const v = split(get(), base);
      return { ...v.workshop, ...v.workshopActions };
    },
  };
}
