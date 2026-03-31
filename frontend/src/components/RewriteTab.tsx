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
  onOriginalContentUpdated: (content: string) => void;
  onChangeProvider: (provider: string) => void;
  onChangeModel: (model: string) => void;
  reasoningEffort: string;
  onChangeReasoningEffort: (value: string) => void;
  savedModels: SavedModel[];
  onOpenSettings: () => void;
  isPremium?: boolean;
  // Parse state (lifted to AppShell so it survives tab navigation)
  parseLoading: boolean;
  parseResult: ParseResult | null;
  parsedContent: string;
  setParsedContent: React.Dispatch<React.SetStateAction<string>>;
  setParseResult: React.Dispatch<React.SetStateAction<ParseResult | null>>;
  parseStreamText: string;
  parseReasoningText: string;
  parseError: string | null;
  setParseError: React.Dispatch<React.SetStateAction<string | null>>;
  onParse: (params: { content: string; instruction?: string }) => Promise<ParseResult | null>;
  onCancelParse: () => void;
  onClearParse: () => void;
  onChatStreamingChange?: (streaming: boolean) => void;
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
    onOriginalContentUpdated: onOriginalContentUpdatedCtx,
    onChangeProvider,
    onChangeModel,
    reasoningEffort,
    onChangeReasoningEffort,
    savedModels,
    onOpenSettings,
    isPremium,
    // Parse state from AppShell
    parseLoading,
    parseResult,
    parsedContent,
    setParsedContent,
    setParseResult,
    parseStreamText,
    parseReasoningText,
    parseError,
    setParseError,
    onParse,
    onCancelParse,
    onClearParse,
    onChatStreamingChange,
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
  const handleSaveRef = useRef<() => Promise<void>>(async () => {});
  const [mobilePane, setMobilePane] = useState<'chat' | 'content'>('chat');
  const [saveStatus, setSaveStatus] = useState<'saving' | 'saved' | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [songTitle, setSongTitle] = useState('');
  const [songArtist, setSongArtist] = useState('');
  const [scrapDialogOpen, setScrapDialogOpen] = useState(false);
  const [newSongDialogOpen, setNewSongDialogOpen] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [showHints, setShowHints] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docFileInputRef = useRef<HTMLInputElement>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [inputDragging, setInputDragging] = useState(false);
  const inputDragCounterRef = useRef(0);
  const [parseReasoningExpanded, setParseReasoningExpanded] = useState(false);
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

  // Sync title/artist from parse result when it arrives (including after
  // navigating away and returning while a parse was in progress).
  const prevParseRef = useRef<ParseResult | null>(null);
  useEffect(() => {
    const wasNull = prevParseRef.current === null;
    if (wasNull && parseResult && !rewriteResult) {
      setSongTitle(parseResult.title || '');
      setSongArtist(parseResult.artist || '');
      setMobilePane('content');
    }
    prevParseRef.current = parseResult;
  }, [parseResult, rewriteResult]);

  useEffect(() => {
    if (rewriteMeta) {
      setSongTitle(rewriteMeta.title || '');
      setSongArtist(rewriteMeta.artist || '');
    }
  }, [rewriteMeta]);

  useEffect(() => {
    setSaveStatus(null);
    setIsDirty(false);
  }, [currentSongUuid]);

  // Warn before navigating away with unsaved changes
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  // Autosave: debounce manual edits by 1.5s
  useEffect(() => {
    if (!isDirty) return;
    const timer = setTimeout(() => {
      handleSaveRef.current();
    }, 1500);
    return () => clearTimeout(timer);
  }, [isDirty, songTitle, songArtist, rewriteResult?.rewritten_content, rewriteResult?.original_content]);

  // Auto-clear "Saved" indicator after 2s
  useEffect(() => {
    if (saveStatus !== 'saved') return;
    const timer = setTimeout(() => setSaveStatus(null), 2000);
    return () => clearTimeout(timer);
  }, [saveStatus]);

  const hasProfile = !!profile?.id;
  const hasModel = isPremium || (llmSettings.provider && llmSettings.model);
  const canParse = hasProfile && hasModel && !parseLoading && input.trim().length > 0;

  const parseBlocker = !hasModel
      ? 'Select a model'
      : input.trim().length === 0
        ? 'Paste your song above'
        : null;

  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
  const shortcutHint = `${isMac ? '\u2318' : 'Ctrl'}+Enter to import`;

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setInput(text);
    } catch {
      // Clipboard access denied: user can still tap the textarea to paste manually
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile?.id) return;
    // Reset so the same file can be re-selected
    e.target.value = '';

    if (!file.type.startsWith('image/')) {
      setParseError('Please select an image file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setParseError('Image must be under 5 MB.');
      return;
    }

    setImageLoading(true);
    setParseError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      const result = await api.parseImage({
        profile_id: profile.id,
        image: dataUrl,
        provider: llmSettings.provider,
        model: llmSettings.model,
      });
      setInput(result.text);
    } catch (err) {
      setParseError('Image extraction failed: ' + (err as Error).message);
    } finally {
      setImageLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile?.id) return;
    e.target.value = '';

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isText = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');

    if (!isPdf && !isText) {
      setParseError('Please select a PDF or text file.');
      return;
    }
    if (isPdf && file.size > 10 * 1024 * 1024) {
      setParseError('PDF must be under 10 MB.');
      return;
    }
    if (isText && file.size > 1 * 1024 * 1024) {
      setParseError('Text file must be under 1 MB.');
      return;
    }

    setFileLoading(true);
    setParseError(null);
    try {
      if (isText) {
        const text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsText(file);
        });
        setInput(text);
      } else {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsDataURL(file);
        });
        const result = await api.extractFile({
          profile_id: profile.id,
          file_data: dataUrl,
          filename: file.name,
        });
        setInput(result.text);
      }
    } catch (err) {
      setParseError('File extraction failed: ' + (err as Error).message);
    } finally {
      setFileLoading(false);
    }
  };

  const handleInputDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    inputDragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setInputDragging(true);
    }
  }, []);

  const handleInputDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    inputDragCounterRef.current--;
    if (inputDragCounterRef.current === 0) {
      setInputDragging(false);
    }
  }, []);

  const handleInputDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleInputDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    inputDragCounterRef.current = 0;
    setInputDragging(false);
    if (e.dataTransfer.files.length === 0) return;

    const file = e.dataTransfer.files[0]!;
    if (file.type.startsWith('image/')) {
      // Trigger the existing image upload path
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = fileInputRef.current;
      if (input) {
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf') ||
               file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt')) {
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = docFileInputRef.current;
      if (input) {
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else {
      setParseError('Unsupported file type. Try images, PDFs, or text files.');
    }
  }, [setParseError]);

  // State derivation
  const isInput = !parseLoading && !parseResult && !rewriteResult;
  const isParsed = !!parseResult && !rewriteResult;
  const isWorkshopping = !!rewriteResult;

  const handleParse = async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput) return;

    const result = await onParse({
      content: trimmedInput,
      ...(instruction.trim() && { instruction: instruction.trim() }),
    });

    // These only run if the component is still mounted (user stayed on tab)
    if (result) {
      setSongTitle(result.title || '');
      setSongArtist(result.artist || '');
      setInstruction('');
      setMobilePane('content');
    }
  };

  const handleCancelParse = () => {
    onCancelParse();
  };

  const handleLoadSample = (sample: SampleSong) => {
    const result = sampleToParseResult(sample);
    setParseResult(result);
    setParsedContent(result.original_content);
    setSongTitle(result.title ?? '');
    setSongArtist(result.artist ?? '');
    setInput('');
    setInstruction('');
    setParseError(null);
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
    setIsDirty(true);
  }, [rewriteResult, parseResult, parsedContent, profile, songTitle, songArtist, llmSettings, onNewRewrite, onContentUpdated]);

  const handleNewSong = () => {
    onClearParse();
    onNewRewrite(null, null);
    setInput('');
    setParseReasoningExpanded(false);
    setSaveStatus(null);
    setIsDirty(false);
    setSongTitle('');
    setSongArtist('');
    setChatMessages([]);
  };

  const handleNewSongClick = () => {
    if (isWorkshopping || (isParsed && chatMessages.length > 0)) {
      setNewSongDialogOpen(true);
    } else {
      handleNewSong();
    }
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
    if (!currentSongUuid || !rewriteResult || !isDirty) return;
    setSaveStatus('saving');
    try {
      await api.updateSong(currentSongUuid, {
        title: songTitle || null,
        artist: songArtist || null,
        rewritten_content: rewriteResult.rewritten_content,
        original_content: rewriteResult.original_content,
      } as Partial<Song>);
      setSaveStatus('saved');
      setIsDirty(false);
    } catch (err) {
      setParseError('Failed to save: ' + (err as Error).message);
      setSaveStatus(null);
    }
  };
  handleSaveRef.current = handleSave;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSaveRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleTitleChange = useCallback((val: string) => {
    setSongTitle(val);
    setIsDirty(true);
  }, []);

  const handleArtistChange = useCallback((val: string) => {
    setSongArtist(val);
    setIsDirty(true);
  }, []);

  const handleOriginalContentUpdated = useCallback((newOriginal: string) => {
    if (!rewriteResult && parseResult) {
      // PARSED state: update the editable parsed content
      setParsedContent(newOriginal);
    } else {
      // WORKSHOPPING state: use functional updater to avoid stale closure.
      // Spreading rewriteResult here would clobber concurrent rewritten_content
      // updates from onContentUpdated (issue #165).
      onOriginalContentUpdatedCtx(newOriginal);
      setIsDirty(true);
    }
  }, [rewriteResult, parseResult, setParsedContent, onOriginalContentUpdatedCtx]);

  const handleRewrittenChange = useCallback((newText: string) => {
    onContentUpdated(newText);
    setIsDirty(true);
  }, [onContentUpdated]);

  const editableInputClass = 'bg-transparent border-0 border-b border-transparent can-hover:hover:border-dashed can-hover:hover:border-border focus:border-solid focus:border-primary p-0 pb-px min-w-0 w-full focus:outline-none cursor-text transition-colors';

  const compactTitleArtist = () => (
    <div className="flex flex-col gap-0.5 flex-1 min-w-0 max-w-sm">
      <input
        className={cn(editableInputClass, 'text-sm font-semibold text-foreground placeholder:text-muted-foreground placeholder:font-normal')}
        type="text"
        value={songTitle || ''}
        onChange={e => handleTitleChange(e.target.value)}
        placeholder="Untitled song"
        aria-label="Song title"
      />
      <input
        className={cn(editableInputClass, 'text-xs text-muted-foreground placeholder:text-muted-foreground')}
        type="text"
        value={songArtist || ''}
        onChange={e => handleArtistChange(e.target.value)}
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
        {compactTitleArtist()}
        <div className="flex items-center gap-1.5 shrink-0">
          {isWorkshopping && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setShowOriginal(true)}>
                Original
              </Button>
              {saveStatus && (
                <span className="text-xs text-muted-foreground" data-testid="save-status">
                  {saveStatus === 'saving' ? 'Saving...' : 'Saved'}
                </span>
              )}
            </>
          )}
          <Button
            variant="secondary"
            className="h-7 px-2.5 text-xs"
            onClick={handleNewSongClick}
          >
            + New
          </Button>
          {((isParsed && parseResult?.reasoning) || isWorkshopping) && (
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
                {isWorkshopping && (
                  <>
                    {isParsed && parseResult?.reasoning && <DropdownMenuSeparator />}
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
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {isPremium && <QuotaBanner />}

      {parseError && (
        <Alert variant="error" className="mt-4 mb-4">
          <div className="flex-1">
            <span>{parseError}</span>
            {isQuotaError(parseError) && (
              <QuotaUpgradeLink className="ml-2 font-semibold text-primary underline" />
            )}
          </div>
          <Button variant="ghost" size="sm" className="text-error-text p-1 leading-none" onClick={() => setParseError(null)}>
            &times;
          </Button>
        </Alert>
      )}

      {/* INPUT state */}
      {isInput && !parseLoading && (
        <OnboardingBanner>
          {!isPremium && modelControls()}

          <Card
            className={cn('flex-1 min-h-0 flex flex-col', inputDragging && 'ring-2 ring-primary/30 border-primary')}
            onDragEnter={handleInputDragEnter}
            onDragLeave={handleInputDragLeave}
            onDragOver={handleInputDragOver}
            onDrop={handleInputDrop}
          >
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

              <div className="mb-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Step 1: Import your song</p>
                <p className="text-sm text-muted-foreground mt-1">Drop your lyrics and chords in here, any format. We&apos;ll tidy up the formatting so you can start workshopping.</p>
              </div>

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
                placeholder="Paste lyrics, or drop a file here..."
                onKeyDown={e => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canParse) {
                    e.preventDefault();
                    handleParse();
                  }
                }}
              />

              <div className="mt-3">
                <button
                  type="button"
                  className="text-xs text-muted-foreground cursor-pointer hover:text-foreground"
                  onClick={() => setShowHints(prev => !prev)}
                >
                  {showHints ? '− Import options' : '+ Import options'}
                </button>
                {showHints && (
                  <Textarea
                    rows={2}
                    value={instruction}
                    onChange={e => setInstruction(e.target.value)}
                    placeholder='Cleanup hints, e.g. "only grab the first song" or "ignore the intro"'
                    className="mt-2 font-ui"
                    onKeyDown={e => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canParse) {
                        e.preventDefault();
                        handleParse();
                      }
                    }}
                  />
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
              />
              <input
                ref={docFileInputRef}
                type="file"
                accept=".pdf,.txt,text/plain,application/pdf"
                className="hidden"
                onChange={handleFileUpload}
              />
              <div className="flex items-center gap-3 mt-3">
                <Button onClick={handleParse} disabled={!canParse}>
                  Import Song
                </Button>
                <Button
                  variant="secondary"
                  disabled={!hasProfile || !hasModel || imageLoading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {imageLoading ? <><Spinner size="sm" className="mr-1.5" /> Extracting...</> : 'Import from Photo'}
                </Button>
                <Button
                  variant="secondary"
                  disabled={!hasProfile || fileLoading}
                  onClick={() => docFileInputRef.current?.click()}
                >
                  {fileLoading ? <><Spinner size="sm" className="mr-1.5" /> Extracting...</> : 'Import from File'}
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
      {parseLoading && !parseResult && (
        <Card className="flex flex-col text-muted-foreground">
          <div className="flex items-center justify-center gap-3 py-4">
            <Spinner size="sm" />
            <span className="text-sm">{parseReasoningText ? 'Thinking...' : 'Importing song...'}</span>
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
          {isParsed && !isWorkshopping && (
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2 px-4 md:px-0">Step 2: Edit your song</p>
          )}
          {mobilePaneToggle}

          {/* Unified toolbar (desktop only) */}
          <div data-testid="song-toolbar" className="hidden md:flex items-center gap-4 px-4 py-2.5 border-b border-border">
            {compactTitleArtist()}
            <div className="flex items-center gap-1.5 ml-auto shrink-0">
              {!isPremium && compactModelControls()}
              {isWorkshopping && (
                <>
                  <div className="w-px h-5 bg-border mx-0.5" />
                  <Button variant="secondary" size="sm" onClick={() => setShowOriginal(true)}>
                    Original
                  </Button>
                  {saveStatus && (
                    <span className="text-xs text-muted-foreground" data-testid="save-status">
                      {saveStatus === 'saving' ? 'Saving...' : 'Saved'}
                    </span>
                  )}
                </>
              )}
              <Button
                variant="secondary"
                className="h-7 px-2.5 text-xs"
                onClick={handleNewSongClick}
              >
                + New Song
              </Button>
              {((isParsed && parseResult?.reasoning) || isWorkshopping) && (
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
                    {isWorkshopping && (
                      <>
                        {isParsed && parseResult?.reasoning && <DropdownMenuSeparator />}
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
              )}
            </div>
          </div>

          <ResizableColumns
            className="flex-1 min-h-0"
            columnClassName="flex-col min-h-0"
            mobilePane={mobilePane === 'chat' ? 'left' : 'right'}
            left={
              <ChatPanel
                songId={currentSongId}
                profileId={profile?.id}
                messages={chatMessages}
                setMessages={setChatMessages}
                llmSettings={llmSettings}
                onContentUpdated={handleChatUpdate}
                initialLoading={false}
                {...(isParsed ? { onBeforeSend: handleBeforeSend } : { onContentStreaming: handleChatUpdate })}
                onOriginalContentUpdated={handleOriginalContentUpdated}
                onStreamingChange={onChatStreamingChange}
                flat
                headerRight={
                  <>
                    {!isPremium && compactModelControls()}
                    {isWorkshopping && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" aria-label="More actions">
                            &hellip;
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-danger can-hover:hover:!bg-danger-light"
                            disabled={!currentSongUuid}
                            onClick={() => setScrapDialogOpen(true)}
                          >
                            Scrap This
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
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
                      className="h-full min-h-[50vh] md:min-h-0 border-0 bg-transparent p-3 sm:p-4 font-mono text-xs sm:text-code leading-relaxed resize-none overflow-y-auto overscroll-y-contain focus-visible:ring-0"
                      value={parsedContent}
                      onChange={e => setParsedContent(e.target.value)}
                    />
                  </div>
                </div>
              ) : (
                <ComparisonView
                  rewritten={rewriteResult!.rewritten_content}
                  onRewrittenChange={handleRewrittenChange}
                  headerLeft={compactTitleArtist()}
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

      <ConfirmDialog
        open={newSongDialogOpen}
        onOpenChange={setNewSongDialogOpen}
        title="Start New Song"
        description="Starting a new song will discard your current work. Any unsaved changes will be lost."
        confirmLabel="New Song"
        onConfirm={handleNewSong}
      />
    </div>
  );
}
