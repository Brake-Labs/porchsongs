import { useState, useEffect, useCallback, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import api, { STORAGE_KEYS } from '@/api';
import ComparisonView from '@/components/ComparisonView';
import ChatPanel from '@/components/ChatPanel';
import ModelSelector from '@/components/ModelSelector';
import ResizableColumns from '@/components/ui/resizable-columns';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import Spinner from '@/components/ui/spinner';
import StreamingPre from '@/components/ui/streaming-pre';
import { Alert } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { QuotaBanner, OnboardingBanner, isQuotaError, QuotaUpgradeLink } from '@/extensions/quota';
import { SAMPLE_SONGS, sampleToParseResult } from '@/data/sample-songs';
import type { AppShellContext } from '@/layouts/AppShell';
import type { Profile, Song, RewriteResult, RewriteMeta, ChatMessage, LlmSettings, SavedModel, ParseResult } from '@/types';
import type { SampleSong } from '@/data/sample-songs';

interface RewriteTabProps {
  profile: Profile | null;
  llmSettings: LlmSettings;
  rewriteResult: RewriteResult | null;
  rewriteMeta: RewriteMeta | null;
  currentSongId: number | null;
  currentSongUuid: string | null;
  chatMessages: ChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onNewRewrite: (result: RewriteResult | null, meta: RewriteMeta | null) => void;
  onSongSaved: (song: Song) => void;
  onContentUpdated: (content: string) => void;
  onChangeProvider: (provider: string) => void;
  onChangeModel: (model: string) => void;
  reasoningEffort: string;
  onChangeReasoningEffort: (value: string) => void;
  savedModels: SavedModel[];
  onOpenSettings: () => void;
  /** When true, provider/model selection is managed by the platform. */
  isPremium?: boolean;
}

export default function RewriteTab(directProps?: Partial<RewriteTabProps>) {
  const ctx = useOutletContext<AppShellContext>();
  const {
    profile,
    llmSettings,
    rewriteResult,
    rewriteMeta,
    currentSongId,
    currentSongUuid,
    chatMessages,
    setChatMessages,
    onNewRewrite,
    onSongSaved,
    onContentUpdated,
    onChangeProvider,
    onChangeModel,
    reasoningEffort,
    onChangeReasoningEffort,
    savedModels,
    onOpenSettings,
    isPremium,
  } = { ...ctx, ...directProps } as RewriteTabProps;
  const [input, setInputRaw] = useState(
    () => sessionStorage.getItem(STORAGE_KEYS.DRAFT_INPUT) || ''
  );

  const setInput = useCallback((val: string) => {
    setInputRaw(val);
    sessionStorage.setItem(STORAGE_KEYS.DRAFT_INPUT, val);
  }, []);

  const [instruction, setInstructionRaw] = useState(
    () => sessionStorage.getItem(STORAGE_KEYS.DRAFT_INSTRUCTION) || ''
  );
  const setInstruction = useCallback((val: string) => {
    setInstructionRaw(val);
    sessionStorage.setItem(STORAGE_KEYS.DRAFT_INSTRUCTION, val);
  }, []);
  const [loading, setLoading] = useState(false);
  const parseAbortRef = useRef<AbortController | null>(null);
  const [mobilePane, setMobilePane] = useState<'chat' | 'content'>('chat');
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | null>(null);
  const [songTitle, setSongTitle] = useState('');
  const [songArtist, setSongArtist] = useState('');
  const [scrapDialogOpen, setScrapDialogOpen] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [hasSongs, setHasSongs] = useState(
    () => !!localStorage.getItem(STORAGE_KEYS.HAS_REWRITTEN),
  );

  // Check server for existing songs when localStorage has no record.
  // This handles the cross-browser case: user created songs on another device.
  useEffect(() => {
    if (hasSongs || !profile?.id) return;
    api.listSongs(profile.id).then(songs => {
      if (songs.length > 0) {
        localStorage.setItem(STORAGE_KEYS.HAS_REWRITTEN, '1');
        setHasSongs(true);
      }
    }).catch(() => {});
  }, [hasSongs, profile?.id]);

  const isFirstTime = !hasSongs;

  // Parse state
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [parsedContent, setParsedContent] = useState('');
  const [parseStreamText, setParseStreamText] = useState('');
  const [parseReasoningText, setParseReasoningText] = useState('');
  const [parseReasoningExpanded, setParseReasoningExpanded] = useState(false);

  // Abort in-flight parse when component unmounts (e.g. tab navigation)
  // to avoid wasted LLM tokens/quota and lost results.
  useEffect(() => {
    return () => { parseAbortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (rewriteMeta) {
      setSongTitle(rewriteMeta.title || '');
      setSongArtist(rewriteMeta.artist || '');
    }
  }, [rewriteMeta]);

  useEffect(() => {
    setSaveStatus(null);
  }, [currentSongUuid]);

  const hasProfile = !!profile?.id;
  const hasModel = isPremium || (llmSettings.provider && llmSettings.model);
  const canParse = hasProfile && hasModel && !loading && input.trim().length > 0;

  const parseBlocker = !hasModel
      ? 'Select a model'
      : input.trim().length === 0
        ? 'Paste some content above'
        : null;

  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
  const shortcutHint = `${isMac ? '\u2318' : 'Ctrl'}+Enter to parse`;

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setInput(text);
    } catch {
      // Clipboard access denied: user can still tap the textarea to paste manually
    }
  };

  // State derivation
  const isInput = !loading && !parseResult && !rewriteResult;
  const isParsed = !!parseResult && !rewriteResult;
  const isWorkshopping = !!rewriteResult;

  const handleParse = async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput) return;

    const controller = new AbortController();
    parseAbortRef.current = controller;
    setLoading(true);
    setError(null);
    setParseStreamText('');
    setParseReasoningText('');
    onNewRewrite(null, null);
    setParseResult(null);

    let reasoningAccumulated = '';
    try {
      const result = await api.parseStream(
        {
          profile_id: profile!.id,
          content: trimmedInput,
          ...llmSettings,
          ...(instruction.trim() && { instruction: instruction.trim() }),
        },
        (token: string) => {
          setParseStreamText(prev => prev + token);
        },
        controller.signal,
        (reasoningToken: string) => {
          reasoningAccumulated += reasoningToken;
          setParseReasoningText(reasoningAccumulated);
        },
      );

      setParseResult(result);
      setParsedContent(result.original_content);
      setSongTitle(result.title || '');
      setSongArtist(result.artist || '');
      setInstruction('');
      setMobilePane('content');
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message);
      }
    } finally {
      parseAbortRef.current = null;
      setLoading(false);
      setParseStreamText('');
    }
  };

  const handleCancelParse = () => {
    parseAbortRef.current?.abort();
  };

  const handleLoadSample = (sample: SampleSong) => {
    const result = sampleToParseResult(sample);
    setParseResult(result);
    setParsedContent(result.original_content);
    setSongTitle(result.title ?? '');
    setSongArtist(result.artist ?? '');
    setInput('');
    setInstruction('');
    setError(null);
    onNewRewrite(null, null);
    setMobilePane('content');
  };

  const handleBeforeSend = useCallback(async (): Promise<number> => {
    const song = await api.saveSong({
      profile_id: profile!.id,
      title: songTitle || null,
      artist: songArtist || null,
      original_content: parsedContent,
      rewritten_content: parsedContent,
      llm_provider: llmSettings.provider,
      llm_model: llmSettings.model,
    });
    localStorage.setItem(STORAGE_KEYS.HAS_REWRITTEN, '1');
    setHasSongs(true);
    onSongSaved(song);
    return song.id;
  }, [profile, songTitle, songArtist, parsedContent, llmSettings, onSongSaved]);

  const handleChatUpdate = useCallback((newContent: string) => {
    if (!rewriteResult && parseResult) {
      // First chat edit: transition to WORKSHOPPING
      onNewRewrite(
        {
          original_content: parsedContent,
          rewritten_content: newContent,
          changes_summary: 'Chat edit applied.',
        },
        {
          profile_id: profile?.id,
          title: songTitle || undefined,
          artist: songArtist || undefined,
          llm_provider: llmSettings.provider,
          llm_model: llmSettings.model,
        },
      );
    } else {
      onContentUpdated(newContent);
    }
  }, [rewriteResult, parseResult, parsedContent, profile, songTitle, songArtist, llmSettings, onNewRewrite, onContentUpdated]);

  const handleNewSong = () => {
    onNewRewrite(null, null);
    setInput('');
    setParseResult(null);
    setParsedContent('');
    setParseStreamText('');
    setParseReasoningText('');
    setParseReasoningExpanded(false);
    setSaveStatus(null);
    setError(null);
    setSongTitle('');
    setSongArtist('');
    setChatMessages([]);
  };

  const handleScrap = async () => {
    if (!currentSongUuid) return;
    try {
      await api.deleteSong(currentSongUuid);
    } catch {
      // Song may already be gone
    }
    handleNewSong();
  };

  const handleSave = async () => {
    if (!currentSongUuid || !rewriteResult) return;
    setSaveStatus('saving');
    try {
      await api.updateSong(currentSongUuid, {
        title: songTitle || null,
        artist: songArtist || null,
        rewritten_content: rewriteResult.rewritten_content,
        original_content: rewriteResult.original_content,
      } as Partial<Song>);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(null), 2000);
    } catch (err) {
      setError('Failed to save: ' + (err as Error).message);
      setSaveStatus(null);
    }
  };

  const handleTitleChange = useCallback((val: string) => {
    setSongTitle(val);
  }, []);

  const handleArtistChange = useCallback((val: string) => {
    setSongArtist(val);
  }, []);

  const handleMetaBlur = useCallback(() => {
    if (currentSongUuid) {
      api.updateSong(currentSongUuid, { title: songTitle || null, artist: songArtist || null } as Partial<Song>).catch(() => {});
    }
  }, [currentSongUuid, songTitle, songArtist]);

  const handleOriginalContentUpdated = useCallback((newOriginal: string) => {
    if (!rewriteResult && parseResult) {
      // PARSED state: update the editable parsed content
      setParsedContent(newOriginal);
    } else if (rewriteResult) {
      // WORKSHOPPING state: update the original in the rewrite result
      onNewRewrite(
        { ...rewriteResult, original_content: newOriginal },
        rewriteMeta,
      );
    }
    // Persist to DB
    if (currentSongUuid) {
      api.updateSong(currentSongUuid, { original_content: newOriginal } as Partial<Song>).catch(() => {});
    }
  }, [rewriteResult, parseResult, rewriteMeta, currentSongUuid, onNewRewrite]);

  const handleRewrittenChange = useCallback((newText: string) => {
    onContentUpdated(newText);
  }, [onContentUpdated]);

  const handleRewrittenBlur = useCallback(() => {
    if (currentSongUuid && rewriteResult) {
      api.updateSong(currentSongUuid, { rewritten_content: rewriteResult.rewritten_content } as Partial<Song>).catch(() => {});
    }
  }, [currentSongUuid, rewriteResult]);

  const editableInputClass = 'bg-transparent border-0 border-b border-transparent can-hover:hover:border-dashed can-hover:hover:border-border focus:border-solid focus:border-primary p-0 pb-px min-w-0 w-full focus:outline-none cursor-text transition-colors';

  const compactTitleArtist = (withBlur?: boolean) => (
    <div className="flex flex-col gap-0.5 flex-1 min-w-0 max-w-sm">
      <input
        className={cn(editableInputClass, 'text-sm font-semibold text-foreground placeholder:text-muted-foreground placeholder:font-normal')}
        type="text"
        value={songTitle || ''}
        onChange={e => handleTitleChange(e.target.value)}
        onBlur={withBlur ? handleMetaBlur : undefined}
        placeholder="Untitled song"
        aria-label="Song title"
      />
      <input
        className={cn(editableInputClass, 'text-xs text-muted-foreground placeholder:text-muted-foreground')}
        type="text"
        value={songArtist || ''}
        onChange={e => handleArtistChange(e.target.value)}
        onBlur={withBlur ? handleMetaBlur : undefined}
        placeholder="Artist"
        aria-label="Artist"
      />
    </div>
  );

  // Shared model selector + effort controls
  const modelControls = (disabled?: boolean) => (
    <div className={cn('flex items-end gap-3 flex-wrap', disabled && 'opacity-50 pointer-events-none')}>
      <ModelSelector
        provider={llmSettings.provider}
        model={llmSettings.model}
        savedModels={savedModels}
        onChangeProvider={onChangeProvider}
        onChangeModel={onChangeModel}
        onOpenSettings={onOpenSettings}
      />
      <div className="flex flex-col gap-1 mb-2">
        <label className="text-xs text-muted-foreground" htmlFor="reasoning-effort">Effort</label>
        <Select
          id="reasoning-effort"
          className="w-auto py-1.5 px-2 text-sm"
          value={reasoningEffort}
          disabled={disabled}
          onChange={e => onChangeReasoningEffort(e.target.value)}
        >
          <option value="none">Off</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </Select>
      </div>
    </div>
  );

  // Compact model + effort selects for ChatPanel header
  const compactModelControls = () => {
    const activeModel = savedModels.find(m => m.provider === llmSettings.provider && m.model === llmSettings.model);
    const hasUnsaved = llmSettings.provider && llmSettings.model && !activeModel;

    const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      if (val === '__manage__') {
        onOpenSettings();
        return;
      }
      if (!val) return;
      const sm = savedModels.find(m => m.id === Number(val));
      if (sm) {
        onChangeProvider(sm.provider);
        onChangeModel(sm.model);
      }
    };

    return (
      <>
        <Select
          className="hidden sm:inline w-auto py-1 px-2 text-xs"
          value={activeModel ? String(activeModel.id) : (hasUnsaved ? '__unsaved__' : '')}
          onChange={handleModelChange}
          aria-label="Model"
        >
          {hasUnsaved && (
            <option value="__unsaved__">{llmSettings.provider} / {llmSettings.model}</option>
          )}
          {!hasUnsaved && !activeModel && (
            <option value="">Model...</option>
          )}
          {savedModels.map(sm => (
            <option key={sm.id} value={String(sm.id)}>
              {sm.provider} / {sm.model}
            </option>
          ))}
          <option value="__manage__">Manage models...</option>
        </Select>
        <Select
          className="hidden sm:inline w-auto py-1 px-1.5 text-xs"
          value={reasoningEffort}
          onChange={e => onChangeReasoningEffort(e.target.value)}
          aria-label="Reasoning effort"
        >
          <option value="none">Effort: Off</option>
          <option value="low">Effort: Low</option>
          <option value="medium">Effort: Med</option>
          <option value="high">Effort: High</option>
        </Select>
      </>
    );
  };

  // Mobile pane toggle + toolbar
  const mobilePaneToggle = (
    <div className="flex flex-col md:hidden gap-2 mb-2">
      <div className="flex rounded-md border border-border overflow-hidden">
        <button
          className={cn('flex-1 py-2 text-sm font-semibold text-center transition-colors', mobilePane === 'chat' ? 'bg-primary text-white' : 'bg-card text-muted-foreground')}
          onClick={() => setMobilePane('chat')}
        >
          Chat
        </button>
        <button
          className={cn('flex-1 py-2 text-sm font-semibold text-center transition-colors', mobilePane === 'content' ? 'bg-primary text-white' : 'bg-card text-muted-foreground')}
          onClick={() => setMobilePane('content')}
        >
          Song
        </button>
      </div>
      <div className="flex items-center gap-2 px-1">
        {compactTitleArtist(isWorkshopping)}
        <div className="flex items-center gap-1.5 shrink-0">
          {isWorkshopping && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setShowOriginal(true)}>
                Original
              </Button>
              <Button
                variant="secondary"
                className="h-7 px-2.5 text-xs"
                onClick={handleSave}
                disabled={saveStatus === 'saving' || !currentSongUuid}
              >
                {saveStatus === 'saved' ? 'Saved!' :
                 saveStatus === 'saving' ? 'Saving...' : 'Save'}
              </Button>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" aria-label="More actions">
                &hellip;
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isParsed && parseResult?.reasoning && (
                <DropdownMenuItem onClick={() => setParseReasoningExpanded(prev => !prev)}>
                  {parseReasoningExpanded ? 'Hide thinking' : 'Show thinking'}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={handleNewSong}>New Song</DropdownMenuItem>
              {isWorkshopping && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-danger can-hover:hover:!bg-danger-light"
                    disabled={!currentSongUuid}
                    onClick={() => setScrapDialogOpen(true)}
                  >
                    Scrap This
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {isPremium && <QuotaBanner />}

      {error && (
        <Alert variant="error" className="mt-4 mb-4">
          <div className="flex-1">
            <span>{error}</span>
            {isQuotaError(error) && (
              <QuotaUpgradeLink className="ml-2 font-semibold text-primary underline" />
            )}
          </div>
          <Button variant="ghost" size="sm" className="text-error-text p-1 leading-none" onClick={() => setError(null)}>
            &times;
          </Button>
        </Alert>
      )}

      {/* INPUT state */}
      {isInput && !loading && (
        <OnboardingBanner>
          {!isPremium && modelControls()}

          <Card className="flex-1 min-h-0 flex flex-col">
            <CardContent className="pt-6 flex-1 flex flex-col min-h-0">
              {hasProfile && hasModel && isFirstTime && (
                <p className="mb-3 text-sm text-muted-foreground">
                  Start with a sample:{' '}
                  {SAMPLE_SONGS.map((s, i) => (
                    <span key={s.title}>
                      {i > 0 && ' · '}
                      <button
                        type="button"
                        className="text-primary font-medium underline can-hover:hover:opacity-80 cursor-pointer"
                        onClick={() => handleLoadSample(s)}
                      >
                        {s.title}
                      </button>
                    </span>
                  ))}
                </p>
              )}

              {!input && (
                <Button
                  variant="secondary"
                  className="mb-3 md:hidden"
                  onClick={handlePasteFromClipboard}
                >
                  Paste from clipboard
                </Button>
              )}

              <Textarea
                className="flex-1 min-h-0 resize-none"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Paste your lyrics and chords here. Any format works."
                onKeyDown={e => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canParse) {
                    e.preventDefault();
                    handleParse();
                  }
                }}
              />

              <Textarea
                rows={2}
                value={instruction}
                onChange={e => setInstruction(e.target.value)}
                placeholder="Optional instructions, e.g. &quot;only grab the first song&quot; or &quot;skip the intro&quot;"
                className="mt-3 font-ui"
                onKeyDown={e => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canParse) {
                    e.preventDefault();
                    handleParse();
                  }
                }}
              />

              <div className="flex items-center gap-3 mt-3">
                <Button onClick={handleParse} disabled={!canParse}>
                  Parse
                </Button>
                <span className="text-xs text-muted-foreground">
                  {parseBlocker ?? shortcutHint}
                </span>
              </div>

              {hasProfile && hasModel && !isFirstTime && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Or try a sample:{' '}
                  {SAMPLE_SONGS.map((s, i) => (
                    <span key={s.title}>
                      {i > 0 && ' · '}
                      <button
                        type="button"
                        className="text-primary underline can-hover:hover:opacity-80 cursor-pointer"
                        onClick={() => handleLoadSample(s)}
                      >
                        {s.title}
                      </button>
                    </span>
                  ))}
                </p>
              )}
            </CardContent>
          </Card>
        </OnboardingBanner>
      )}

      {/* PARSING state (loading, no parse result yet) */}
      {loading && !parseResult && (
        <Card className="flex flex-col text-muted-foreground">
          <div className="flex items-center justify-center gap-3 py-4">
            <Spinner size="sm" />
            <span className="text-sm">{parseReasoningText ? 'Thinking...' : 'Parsing song...'}</span>
            <Button variant="danger-outline" size="sm" onClick={handleCancelParse}>Cancel</Button>
          </div>
          {parseReasoningText && !parseStreamText && (
            <StreamingPre className="px-4 pb-4 text-xs font-mono text-foreground max-h-[40vh] overflow-y-auto opacity-70">{parseReasoningText}</StreamingPre>
          )}
          {parseStreamText && (
            <pre className="px-4 pb-4 whitespace-pre-wrap break-words text-xs font-mono text-foreground max-h-[60vh] overflow-y-auto">{parseStreamText}</pre>
          )}
        </Card>
      )}

      {/* PARSED + WORKSHOPPING states */}
      {(isParsed || isWorkshopping) && (
        <div className="flex flex-col flex-1 min-h-0 mt-2 md:mt-0">
          {mobilePaneToggle}

          {/* Unified toolbar (desktop only) */}
          <div data-testid="song-toolbar" className="hidden md:flex items-center gap-4 px-4 py-2.5 border-b border-border">
            {compactTitleArtist(isWorkshopping)}
            <div className="flex items-center gap-1.5 ml-auto shrink-0">
              {!isPremium && compactModelControls()}
              {isWorkshopping && (
                <>
                  <div className="w-px h-5 bg-border mx-0.5" />
                  <Button variant="secondary" size="sm" onClick={() => setShowOriginal(true)}>
                    Original
                  </Button>
                  <Button
                    variant="secondary"
                    className="h-7 px-2.5 text-xs"
                    onClick={handleSave}
                    disabled={saveStatus === 'saving' || !currentSongUuid}
                  >
                    {saveStatus === 'saved' ? 'Saved!' :
                     saveStatus === 'saving' ? 'Saving...' : 'Save'}
                  </Button>
                </>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" aria-label="More actions">
                    &hellip;
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isParsed && parseResult?.reasoning && (
                    <DropdownMenuItem onClick={() => setParseReasoningExpanded(prev => !prev)}>
                      {parseReasoningExpanded ? 'Hide thinking' : 'Show thinking'}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={handleNewSong}>New Song</DropdownMenuItem>
                  {isWorkshopping && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-danger can-hover:hover:!bg-danger-light"
                        disabled={!currentSongUuid}
                        onClick={() => setScrapDialogOpen(true)}
                      >
                        Scrap This
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <ResizableColumns
            className="flex-1 min-h-0"
            columnClassName="flex-col min-h-0"
            mobilePane={mobilePane === 'chat' ? 'left' : 'right'}
            left={
              <ChatPanel
                songId={currentSongId}
                messages={chatMessages}
                setMessages={setChatMessages}
                llmSettings={llmSettings}
                onContentUpdated={handleChatUpdate}
                initialLoading={false}
                {...(isParsed ? { onBeforeSend: handleBeforeSend } : { onContentStreaming: handleChatUpdate })}
                onOriginalContentUpdated={handleOriginalContentUpdated}
                flat
                headerRight={
                  <>
                    {!isPremium && compactModelControls()}
                    {isWorkshopping && (
                      <Button
                        variant="secondary"
                        className="h-7 px-2.5 text-xs"
                        onClick={handleSave}
                        disabled={saveStatus === 'saving' || !currentSongUuid}
                      >
                        {saveStatus === 'saved' ? 'Saved!' :
                         saveStatus === 'saving' ? 'Saving...' : 'Save'}
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" aria-label="More actions">
                          &hellip;
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={handleNewSong}>New Song</DropdownMenuItem>
                        {isWorkshopping && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-danger can-hover:hover:!bg-danger-light"
                              disabled={!currentSongUuid}
                              onClick={() => setScrapDialogOpen(true)}
                            >
                              Scrap This
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                }
              />
            }
            right={
              isParsed ? (
                <div className="flex flex-col flex-1 overflow-hidden">
                  {parseReasoningExpanded && parseResult?.reasoning && (
                    <pre className="whitespace-pre-wrap break-words text-xs px-4 py-2 font-mono max-h-[30vh] overflow-y-auto opacity-70 border-b border-border">{parseResult.reasoning}</pre>
                  )}
                  <div className="flex-1 min-h-[200px] bg-card shadow-[inset_0_1px_4px_rgba(0,0,0,0.04)] rounded-sm">
                    <Textarea
                      className="h-full min-h-[50vh] md:min-h-0 border-0 bg-transparent p-3 sm:p-4 font-mono text-xs sm:text-code leading-relaxed resize-none focus-visible:ring-0"
                      value={parsedContent}
                      onChange={e => setParsedContent(e.target.value)}
                    />
                  </div>
                </div>
              ) : (
                <ComparisonView
                  rewritten={rewriteResult!.rewritten_content}
                  onRewrittenChange={handleRewrittenChange}
                  onRewrittenBlur={handleRewrittenBlur}
                  headerLeft={compactTitleArtist(true)}
                  flat
                  onShowOriginal={() => setShowOriginal(true)}
                />
              )
            }
          />
        </div>
      )}

      {/* Show Original dialog */}
      {isWorkshopping && rewriteResult && (
        <Dialog open={showOriginal} onOpenChange={setShowOriginal}>
          <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Original</DialogTitle>
            </DialogHeader>
            <pre className="p-3 sm:p-4 font-mono text-xs sm:text-code leading-relaxed whitespace-pre-wrap break-words overflow-y-auto flex-1 min-h-0">{rewriteResult.original_content}</pre>
          </DialogContent>
        </Dialog>
      )}

      <ConfirmDialog
        open={scrapDialogOpen}
        onOpenChange={setScrapDialogOpen}
        title="Scrap This Song"
        description="Are you sure you want to scrap this song? The draft will be permanently deleted."
        confirmLabel="Scrap"
        variant="destructive"
        onConfirm={handleScrap}
      />
    </div>
  );
}
