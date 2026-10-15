import { createContext, useContext, type ReactNode } from 'react';
import type { ChatSessionStore } from '@/lib/chatSessions';
import type { WorkshopState } from '@/lib/workshopState';
import type { ChatMessage, LlmSettings, ParseResult, Profile, RewriteMeta, RewriteResult, Song } from '@/types';

/**
 * State AppShell shares with the routes under /app, split by how often it
 * changes so a keystroke in the workshop does not re-render the library.
 * Each value is memoized by AppShell; read them through the hooks below.
 */

/** Profile, model and account flags. Changes rarely. */
export interface SettingsContextValue {
  profile: Profile | null;
  llmSettings: LlmSettings;
  model: string;
  models: string[];
  reasoningEffort: string;
  onChangeModel: (model: string) => void;
  onChangeReasoningEffort: (value: string) => void;
  onOpenSettings: () => void;
  onSaveProfile: (data: Partial<Profile>) => Promise<Profile>;
  isPremium: boolean;
  isAdmin: boolean;
}

/** An import parse, which survives leaving the workshop mid-stream. */
export interface ParseContextValue {
  parseLoading: boolean;
  parseResult: ParseResult | null;
  parsedContent: string;
  setParsedContent: React.Dispatch<React.SetStateAction<string>>;
  setParseResult: React.Dispatch<React.SetStateAction<ParseResult | null>>;
  parseStreamText: string;
  parseReasoningText: string;
  parseError: string | null;
  parseErrorType: string | undefined;
  setParseError: React.Dispatch<React.SetStateAction<string | null>>;
  onParse: (params: { content: string; instruction?: string }) => Promise<ParseResult | null>;
  onCancelParse: () => void;
  onClearParse: () => void;
}

/** Ways to change the workshop. Never changes with workshop state. */
export interface WorkshopActionsValue {
  /** Open a saved song in the workshop. */
  onLoadSong: (song: Song) => Promise<void>;
  onNewRewrite: (result: RewriteResult | null, meta: RewriteMeta | null) => void;
  onSongSaved: (song: Song) => void;
  onContentUpdated: (content: string) => void;
  onOriginalContentUpdated: (content: string) => void;
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setSongTitle: React.Dispatch<React.SetStateAction<string>>;
  setSongArtist: React.Dispatch<React.SetStateAction<string>>;
  setIsDirty: React.Dispatch<React.SetStateAction<boolean>>;
  // Chat requests in flight, per song. Outlives ChatPanel so leaving the
  // workshop neither loses a running stream nor lets it land on another song.
  chatSessions: ChatSessionStore;
}

/** The song open in the workshop. Changes on every edit. */
export interface WorkshopStateValue extends WorkshopState {
  // Bumped whenever a new song is started from the global "New Song" button, so
  // RewriteTab can reset its local (input/instruction) state even while mounted.
  newSongNonce: number;
}

export type WorkshopContextValue = WorkshopStateValue & WorkshopActionsValue;

const SettingsContext = createContext<SettingsContextValue | null>(null);
const ParseContext = createContext<ParseContextValue | null>(null);
const WorkshopStateContext = createContext<WorkshopStateValue | null>(null);
const WorkshopActionsContext = createContext<WorkshopActionsValue | null>(null);

function required<T>(value: T | null, hook: string): T {
  if (value === null) throw new Error(`${hook} must be used inside AppShell`);
  return value;
}

export function useSettings(): SettingsContextValue {
  return required(useContext(SettingsContext), 'useSettings');
}

export function useParse(): ParseContextValue {
  return required(useContext(ParseContext), 'useParse');
}

/** Workshop actions only: for routes that open songs but never show one. */
export function useWorkshopActions(): WorkshopActionsValue {
  return required(useContext(WorkshopActionsContext), 'useWorkshopActions');
}

export function useWorkshop(): WorkshopContextValue {
  const state = required(useContext(WorkshopStateContext), 'useWorkshop');
  return { ...state, ...useWorkshopActions() };
}

export function AppShellProviders({
  settings,
  parse,
  workshop,
  workshopActions,
  children,
}: {
  settings: SettingsContextValue;
  parse: ParseContextValue;
  workshop: WorkshopStateValue;
  workshopActions: WorkshopActionsValue;
  children: ReactNode;
}) {
  return (
    <SettingsContext.Provider value={settings}>
      <ParseContext.Provider value={parse}>
        <WorkshopActionsContext.Provider value={workshopActions}>
          <WorkshopStateContext.Provider value={workshop}>{children}</WorkshopStateContext.Provider>
        </WorkshopActionsContext.Provider>
      </ParseContext.Provider>
    </SettingsContext.Provider>
  );
}
