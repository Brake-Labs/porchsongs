import { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import api, { STORAGE_KEYS } from '@/api';
import { chatHistoryToMessages } from '@/lib/chat-utils';
import useLocalStorage from '@/hooks/useLocalStorage';
import useProviderConnections from '@/hooks/useProviderConnections';
import useSavedModels from '@/hooks/useSavedModels';
import useVisibilityRecovery from '@/hooks/useVisibilityRecovery';
import Header from '@/components/Header';
import Tabs from '@/components/Tabs';
import MobileNav from '@/components/MobileNav';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { getFeatureRequestUrl, getReportIssueUrl } from '@/extensions';
import type { Profile, RewriteResult, RewriteMeta, ChatMessage, Song, ParseResult } from '@/types';

/** Context value provided to child routes via useOutletContext(). */
export interface AppShellContext {
  profile: Profile | null;
  llmSettings: { provider: string; model: string; reasoning_effort: string };
  rewriteResult: RewriteResult | null;
  rewriteMeta: RewriteMeta | null;
  currentSongId: number | null;
  currentSongUuid: string | null;
  chatMessages: ChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onNewRewrite: (result: RewriteResult | null, meta: RewriteMeta | null) => void;
  onSongSaved: (song: Song) => void;
  onContentUpdated: (content: string) => void;
  onOriginalContentUpdated: (content: string) => void;
  onChangeProvider: (provider: string) => void;
  onChangeModel: (model: string) => void;
  reasoningEffort: string;
  onChangeReasoningEffort: (value: string) => void;
  savedModels: ReturnType<typeof useSavedModels>['savedModels'];
  onOpenSettings: () => void;
  isPremium: boolean;
  isAdmin: boolean;
  // Settings-specific props
  provider: string;
  model: string;
  onSave: (provider: string, model: string) => void;
  onAddModel: ReturnType<typeof useSavedModels>['addModel'];
  onRemoveModel: ReturnType<typeof useSavedModels>['removeModel'];
  connections: ReturnType<typeof useProviderConnections>['connections'];
  onAddConnection: ReturnType<typeof useProviderConnections>['addConnection'];
  onRemoveConnection: (connId: number) => void;
  onSaveProfile: (data: Partial<Profile>) => Promise<Profile>;
  // Library-specific props
  onLoadSong: (song: Song) => Promise<void>;
  // Parse state (survives tab navigation)
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
  onChatStreamingChange: (streaming: boolean) => void;
}

export default function AppShell() {
  const { authState, currentAuthUser, authConfig, isPremium, handleLogout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Profile state
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState(false);

  // LLM settings (persisted in localStorage)
  const [provider, setProvider] = useLocalStorage(STORAGE_KEYS.PROVIDER, '');
  const [model, setModel] = useLocalStorage(STORAGE_KEYS.MODEL, '');
  const [reasoningEffort, setReasoningEffort] = useLocalStorage(STORAGE_KEYS.REASONING_EFFORT, 'high');

  // Provider connections and saved models
  const { connections, addConnection, removeConnection } = useProviderConnections(profile?.id, isPremium);
  const { savedModels, addModel, removeModel, refresh: refreshModels } = useSavedModels(profile?.id, isPremium);

  // Rewrite state (shared between RewriteTab, comparison, chat)
  const [rewriteResult, setRewriteResult] = useState<RewriteResult | null>(null);
  const [rewriteMeta, setRewriteMeta] = useState<RewriteMeta | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  // Parse state (lives here so it survives tab navigation)
  const [parseLoading, setParseLoading] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [parsedContent, setParsedContent] = useState('');
  const [parseStreamText, setParseStreamText] = useState('');
  const [parseReasoningText, setParseReasoningText] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseErrorType, setParseErrorType] = useState<string | undefined>();
  const parseAbortRef = useRef<AbortController | null>(null);

  // Chat streaming state (reported by ChatPanel for visibility recovery)
  const [chatStreaming, setChatStreaming] = useState(false);

  // Track current song: integer ID for chat requests, UUID for URL routing
  const [currentSongId, setCurrentSongIdRaw] = useState<number | null>(null);
  const [currentSongUuid, setCurrentSongUuidRaw] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEYS.CURRENT_SONG_ID) || null;
  });

  const setCurrentSong = useCallback((song: Song | null) => {
    if (song) {
      setCurrentSongIdRaw(song.id);
      setCurrentSongUuidRaw(song.uuid);
      localStorage.setItem(STORAGE_KEYS.CURRENT_SONG_ID, song.uuid);
    } else {
      setCurrentSongIdRaw(null);
      setCurrentSongUuidRaw(null);
      localStorage.removeItem(STORAGE_KEYS.CURRENT_SONG_ID);
    }
  }, []);

  const llmSettings = { provider, model, reasoning_effort: reasoningEffort };

  // Re-sync song state from DB when the tab becomes visible after a stream
  // was active (handles mobile browser suspending the tab mid-generation).
  const isStreaming = chatStreaming || parseLoading;
  useVisibilityRecovery({ songUuid: currentSongUuid, isStreaming, setRewriteResult, setChatMessages });

  // Prevent iOS Safari auto-zoom on input focus.
  // Since iOS 10, maximum-scale=1 only blocks automatic zoom (not user pinch-zoom).
  useEffect(() => {
    if (!/iPhone|iPad|iPod/.test(navigator.userAgent)) return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (meta && !meta.content.includes('maximum-scale')) {
      meta.setAttribute('content', meta.content + ', maximum-scale=1');
    }
  }, []);

  // Load profile on mount; auto-create if none exist
  const loadProfile = useCallback(() => {
    setProfileError(false);
    api.listProfiles().then(async profiles => {
      const def = profiles.find(p => p.is_default) || profiles[0];
      if (def) {
        setProfile(def);
      } else {
        const created = await api.createProfile({ is_default: true });
        setProfile(created);
      }
    }).catch((err: unknown) => {
      console.error('[AppShell] Failed to load profile:', err);
      setProfileError(true);
    });
  }, []);

  useEffect(() => {
    if (authState !== 'ready') return;
    loadProfile();
  }, [authState, loadProfile]);

  // Auto-restore active song on mount (page refresh / PWA relaunch recovery).
  // If the user had a song open and the app relaunched at /app, navigate
  // back to /app/rewrite so they land where they left off.
  useEffect(() => {
    if (authState !== 'ready' || rewriteResult || !currentSongUuid) return;
    api.getSong(currentSongUuid).then(async (song: Song) => {
      setCurrentSongIdRaw(song.id);
      setRewriteResult({
        original_content: song.original_content,
        rewritten_content: song.rewritten_content,
        changes_summary: song.changes_summary || '',
      });
      setRewriteMeta({
        title: song.title ?? undefined,
        artist: song.artist ?? undefined,
        source_url: song.source_url ?? undefined,
        profile_id: song.profile_id,
        llm_provider: song.llm_provider ?? undefined,
        llm_model: song.llm_model ?? undefined,
      });
      try {
        const history = await api.getChatHistory(song.uuid);
        setChatMessages(chatHistoryToMessages(history));
      } catch {
        setChatMessages([]);
      }
      // Restore route for PWA relaunch: if we're at the generic /app root,
      // navigate to the rewrite tab where the user's song is.
      if (location.pathname === '/app' || location.pathname === '/app/') {
        navigate('/app/rewrite', { replace: true });
      }
    }).catch(() => {
      setCurrentSong(null);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState]);

  const handleSaveProfile = useCallback(async (data: Partial<Profile>) => {
    let saved: Profile;
    if (profile?.id) {
      saved = await api.updateProfile(profile.id, data);
    } else {
      saved = await api.createProfile(data);
    }
    setProfile(saved);
    return saved;
  }, [profile]);

  const handleNewRewrite = useCallback((result: RewriteResult | null, meta: RewriteMeta | null) => {
    setRewriteResult(result);
    setRewriteMeta(meta);
    if (!result) {
      setChatMessages([]);
      setCurrentSong(null);
    }
  }, [setCurrentSong]);

  const handleParse = useCallback(async (params: { content: string; instruction?: string }): Promise<ParseResult | null> => {
    if (!profile?.id) return null;
    const controller = new AbortController();
    parseAbortRef.current = controller;
    setParseLoading(true);
    setParseError(null);
    setParseErrorType(undefined);
    setParseStreamText('');
    setParseReasoningText('');
    handleNewRewrite(null, null);
    setParseResult(null);

    let reasoningAccumulated = '';
    try {
      const result = await api.parseStream(
        {
          profile_id: profile.id,
          content: params.content,
          provider,
          model,
          reasoning_effort: reasoningEffort,
          ...(params.instruction && { instruction: params.instruction }),
        },
        (token: string) => { setParseStreamText(prev => prev + token); },
        controller.signal,
        (reasoningToken: string) => {
          reasoningAccumulated += reasoningToken;
          setParseReasoningText(reasoningAccumulated);
        },
      );
      setParseResult(result);
      setParsedContent(result.original_content);
      return result;
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setParseError((err as Error).message);
        setParseErrorType((err as Error & { errorType?: string }).errorType);
      }
      return null;
    } finally {
      parseAbortRef.current = null;
      setParseLoading(false);
      setParseStreamText('');
    }
  }, [profile, provider, model, reasoningEffort, handleNewRewrite]);

  const handleCancelParse = useCallback(() => {
    parseAbortRef.current?.abort();
  }, []);

  const handleClearParse = useCallback(() => {
    parseAbortRef.current?.abort();
    setParseResult(null);
    setParsedContent('');
    setParseStreamText('');
    setParseReasoningText('');
    setParseLoading(false);
    setParseError(null);
    setParseErrorType(undefined);
  }, []);

  const handleSongSaved = useCallback((song: Song) => {
    setCurrentSong(song);
  }, [setCurrentSong]);

  const handleContentUpdated = useCallback((newContent: string) => {
    setRewriteResult(prev => prev ? { ...prev, rewritten_content: newContent } : prev);
  }, []);

  const handleOriginalUpdated = useCallback((newOriginal: string) => {
    setRewriteResult(prev => prev ? { ...prev, original_content: newOriginal } : prev);
  }, []);

  const handleLoadSong = useCallback(async (song: Song) => {
    setRewriteResult({
      original_content: song.original_content,
      rewritten_content: song.rewritten_content,
      changes_summary: song.changes_summary || '',
    });
    setRewriteMeta({
      title: song.title ?? undefined,
      artist: song.artist ?? undefined,
      source_url: song.source_url ?? undefined,
      profile_id: song.profile_id,
      llm_provider: song.llm_provider ?? undefined,
      llm_model: song.llm_model ?? undefined,
    });
    setCurrentSong(song);
    navigate('/app/rewrite');

    try {
      const history = await api.getChatHistory(song.uuid);
      setChatMessages(chatHistoryToMessages(history));
    } catch {
      setChatMessages([]);
    }
  }, [navigate, setCurrentSong]);

  const handleRemoveConnection = useCallback(async (connId: number) => {
    const conn = connections.find(c => c.id === connId);
    await removeConnection(connId);
    if (conn && conn.provider === provider) {
      const remaining = savedModels.filter(m => m.provider !== conn.provider);
      if (remaining.length > 0) {
        setProvider(remaining[0]!.provider);
        setModel(remaining[0]!.model);
      } else {
        setProvider('');
        setModel('');
      }
    }
    refreshModels();
  }, [connections, removeConnection, provider, savedModels, setProvider, setModel, refreshModels]);

  // Redirect to login if not authenticated
  if (authState === 'login') {
    return <Navigate to="/app/login" replace />;
  }

  // Show error banner if profile loading failed
  if (profileError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3 text-muted-foreground">
        <p className="text-sm">Unable to load your profile. The server may be unavailable.</p>
        <Button onClick={loadProfile}>Retry</Button>
      </div>
    );
  }

  const ctx: AppShellContext = {
    profile,
    llmSettings,
    rewriteResult,
    rewriteMeta,
    currentSongId,
    currentSongUuid,
    chatMessages,
    setChatMessages,
    onNewRewrite: handleNewRewrite,
    onSongSaved: handleSongSaved,
    onContentUpdated: handleContentUpdated,
    onOriginalContentUpdated: handleOriginalUpdated,
    onChangeProvider: setProvider,
    onChangeModel: setModel,
    reasoningEffort,
    onChangeReasoningEffort: setReasoningEffort,
    savedModels,
    onOpenSettings: () => navigate('/app/settings/models'),
    isPremium,
    isAdmin: currentAuthUser?.role === 'admin',
    provider,
    model,
    onSave: (p, m) => { setProvider(p); setModel(m); },
    onAddModel: addModel,
    onRemoveModel: removeModel,
    connections,
    onAddConnection: addConnection,
    onRemoveConnection: handleRemoveConnection,
    onSaveProfile: handleSaveProfile,
    onLoadSong: handleLoadSong,
    parseLoading,
    parseResult,
    parsedContent,
    setParsedContent,
    setParseResult,
    parseStreamText,
    parseReasoningText,
    parseError,
    parseErrorType,
    setParseError,
    onParse: handleParse,
    onCancelParse: handleCancelParse,
    onClearParse: handleClearParse,
    onChatStreamingChange: setChatStreaming,
  };

  return (
    <div className="flex flex-col h-dvh">
      <div className="sticky top-0 z-50 shrink-0">
        <Header
          user={currentAuthUser}
          authRequired={authConfig?.required ?? false}
          onLogout={handleLogout}
          isPremium={isPremium}
          leftSlot={<MobileNav />}
        />
        <div className="hidden md:block bg-card border-b border-border">
          <Tabs />
        </div>
      </div>
      <main className="flex-1 min-h-0 flex flex-col overflow-y-auto max-w-[1800px] w-full mx-auto px-2 sm:px-4 py-4">
        <Outlet context={ctx} />
      </main>
      <footer className="shrink-0 border-t border-border py-2 sm:py-3 px-4 text-xs text-muted-foreground">
        <div className="flex items-center justify-center sm:justify-between max-w-[1800px] w-full mx-auto">
          <span className="hidden sm:inline">Made with ❤️ from open source</span>
          <div className="flex items-center gap-3">
            <a
              href={getReportIssueUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Report issue
            </a>
            <a
              href={getFeatureRequestUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Feature request
            </a>
            <a
              href="https://github.com/Brake-Labs/porchsongs"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
              </svg>
            </a>
            <a
              href="https://x.com/natebrake"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="X (Twitter)"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
          </div>
        </div>
      </footer>
      <Toaster position="bottom-right" richColors />
    </div>
  );
}
