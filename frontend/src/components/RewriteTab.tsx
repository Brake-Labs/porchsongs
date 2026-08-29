import { useState, useEffect, useCallback, useRef } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
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
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { QuotaBanner, OnboardingBanner, isQuotaError, QuotaUpgradeLink } from '@/extensions/quota';
import { SAMPLE_SONGS, sampleToParseResult } from '@/data/sample-songs';
import { guessSongMeta } from '@/lib/songMeta';
import type { AppShellContext } from '@/layouts/AppShell';
import type { Profile, Song, RewriteResult, RewriteMeta, ChatMessage, LlmSettings, ParseResult } from '@/types';
import type { SampleSong } from '@/data/sample-songs';

/** The four ways to get a chart in. Also the tab values on the import screen. */
type ImportSource = 'paste' | 'photo' | 'file' | 'link';

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
  onChangeModel: (model: string) => void;
  reasoningEffort: string;
  onChangeReasoningEffort: (value: string) => void;
  models: string[];
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
  parseErrorType: string | undefined;
  setParseError: React.Dispatch<React.SetStateAction<string | null>>;
  onParse: (params: { content: string; instruction?: string }) => Promise<ParseResult | null>;
  onCancelParse: () => void;
  onClearParse: () => void;
  onChatStreamingChange?: (streaming: boolean) => void;
  // Bumped by the global "New Song" button; resets this tab's local state.
  newSongNonce?: number;
}

export default function RewriteTab(directProps?: Partial<RewriteTabProps>) {
  const ctx = useOutletContext<AppShellContext>();
  const navigate = useNavigate();
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
    onChangeModel,
    reasoningEffort,
    onChangeReasoningEffort,
    models,
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
    parseErrorType,
    setParseError,
    onParse,
    onCancelParse,
    onClearParse,
    onChatStreamingChange,
    newSongNonce,
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
  const [showOriginal, setShowOriginal] = useState(false);
  const [showHints, setShowHints] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docFileInputRef = useRef<HTMLInputElement>(null);
  const [fileLoading, setFileLoading] = useState(false);
  // Separate from docFileInputRef even though both take a PDF. That one reads a
  // file and throws it away; this one keeps it. Sharing an input would mean
  // storing which of the two the user meant somewhere else and reading it back
  // in the change handler.
  const tabPdfInputRef = useRef<HTMLInputElement>(null);
  const [tabStoring, setTabStoring] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  // Which of the four ways in is showing. Photo, file, and link all end by
  // filling the paste box, so 'paste' doubles as the review step: an extraction
  // switches back to it so you see the text before you save it.
  const [importSource, setImportSource] = useState<ImportSource>('paste');
  // Records where imported text came from so we can store it as the song's
  // source_url on save. Cleared after each save.
  const pendingSourceUrlRef = useRef<string | null>(null);
  const [inputDragging, setInputDragging] = useState(false);
  const inputDragCounterRef = useRef(0);
  const [parseReasoningExpanded, setParseReasoningExpanded] = useState(false);
  // Synchronous ref for the saved song, avoids stale-closure race between
  // onSongSaved (async state update) and callbacks that need the song ID.
  const savedSongRef = useRef<{ id: number; uuid: string } | null>(null);
  const [hasSongs, setHasSongs] = useState(
    () => !!localStorage.getItem(STORAGE_KEYS.HAS_REWRITTEN),
  );
  // Whether we've actually confirmed the user's song count, either via the
  // localStorage shortcut or a completed server check. Until then we don't
  // show first-time-only UI, so the welcome banner can't flash for a returning
  // user signing in on a fresh device (where localStorage starts empty).
  const [songsChecked, setSongsChecked] = useState(
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
      setSongsChecked(true);
    }).catch(() => {});
  }, [hasSongs, profile?.id]);

  const isFirstTime = !hasSongs;
  // Show the welcome banner only for a server-confirmed new user (no songs), so
  // it stops reappearing for long-time users on every new device/browser.
  const isConfirmedNewUser = songsChecked && isFirstTime;

  // Keep the synchronous ref in sync with prop changes (e.g. loading a song from library)
  useEffect(() => {
    if (currentSongId && currentSongUuid) {
      savedSongRef.current = { id: currentSongId, uuid: currentSongUuid };
    } else if (!currentSongId && !currentSongUuid) {
      savedSongRef.current = null;
    }
  }, [currentSongId, currentSongUuid]);

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
  }, [isDirty, songTitle, songArtist, rewriteResult?.rewritten_content, rewriteResult?.original_content, parsedContent]);

  // Auto-clear "Saved" indicator after 2s
  useEffect(() => {
    if (saveStatus !== 'saved') return;
    const timer = setTimeout(() => setSaveStatus(null), 2000);
    return () => clearTimeout(timer);
  }, [saveStatus]);

  const hasProfile = !!profile?.id;
  const hasModel = isPremium || !!llmSettings.model;
  const hasInput = input.trim().length > 0;

  // Saving a chart as-is needs no model. Only the AI actions do. Gating the plain
  // save on `hasModel` is what made porchsongs unusable for a self-hoster with no
  // LLM gateway configured, even though storing and playing charts never needed one.
  const canSave = hasProfile && !parseLoading && hasInput;
  const canParse = canSave && hasModel;

  const saveBlocker = !hasInput ? 'Paste your song above' : null;
  const parseBlocker = !hasModel ? 'Select a model' : saveBlocker;

  // Photo, file, and link all overwrite the paste box. That was easy to miss when
  // they were small buttons off to the side; as equal-weight tabs it is a step a
  // user takes on purpose, so say what it will cost them first. Shown only when
  // there is something to lose.
  const replaceNotice = importSource !== 'paste' && hasInput ? (
    <p className="mt-3 text-xs text-muted-foreground">
      This replaces what&apos;s currently in the Paste tab.
    </p>
  ) : null;

  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
  const shortcutHint = `${isMac ? '\u2318' : 'Ctrl'}+Enter to add to library`;

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
        model: llmSettings.model,
      });
      setInput(result.text);
      setImportSource('paste');
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
        setImportSource('paste');
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
        setImportSource('paste');
      }
    } catch (err) {
      setParseError('File extraction failed: ' + (err as Error).message);
    } finally {
      setFileLoading(false);
    }
  };

  /**
   * Store tab PDFs as they are, then hand the user off to the library.
   *
   * The other three ways in end by filling the paste box, because they produce
   * chart text that wants reading before it is saved. This one produces no text
   * to read: the file is kept byte for byte and the library is where it lands,
   * so going there is both the confirmation and the next thing you would do.
   */
  const handleStoreTabPdfs = async (files: FileList | null) => {
    if (!files?.length || !profile?.id) return;
    setParseError(null);
    setTabStoring(true);
    // Sequential, matching the library's own uploader: these are megabytes each,
    // and firing a folder of them off a disk at once on a phone connection
    // times them all
    // out together.
    let stored = 0;
    const failed: string[] = [];
    for (const file of Array.from(files)) {
      try {
        await api.uploadDocument(profile.id, file);
        stored++;
      } catch (err) {
        failed.push(`${file.name}: ${(err as Error)?.message ?? 'upload failed'}`);
      }
    }
    setTabStoring(false);
    if (failed.length) setParseError(failed.join('; '));
    // Partial success still counts: the ones that worked are in the library, so
    // go there. The failures are named above and the user can retry those.
    if (stored > 0) navigate('/app/library');
  };

  const handleScrapeUrl = async () => {
    const url = linkUrl.trim();
    if (!url || !profile?.id) return;

    setLinkLoading(true);
    setParseError(null);
    try {
      const result = await api.scrapeUrl({ profile_id: profile.id, url });
      setInput(result.text);
      pendingSourceUrlRef.current = result.source_url;
      setImportSource('paste');
      setLinkUrl('');
    } catch (err) {
      setParseError('Couldn\'t import from that link: ' + (err as Error).message);
    } finally {
      setLinkLoading(false);
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

  // Whether the user has worked in here during this run of the app, as opposed to
  // arriving with a song restored underneath them.
  //
  // `isWorkshopping` cannot answer that on its own, which is what made the launch
  // surface latch. AppShell restores the current song's rewrite result into memory
  // on every launch, so `isWorkshopping` is true the moment this tab mounts,
  // whether the user chose to come here or was merely dropped here by the previous
  // relaunch. Recording the surface off that meant the app reopened on the
  // workshop, the workshop recorded itself again, and the only way out was to
  // remember to visit the library before quitting, which nobody does.
  //
  // All three signals below are gone on a cold start: draft text lives in
  // sessionStorage, and a parse result and the dirty flag live in memory. So a
  // true value can only have come from something the user did this time.
  const [workshopTouched, setWorkshopTouched] = useState(
    () => !!sessionStorage.getItem(STORAGE_KEYS.WORKSHOP_TOUCHED),
  );
  useEffect(() => {
    if (workshopTouched) return;
    if (!input.trim() && !isParsed && !isDirty) return;
    sessionStorage.setItem(STORAGE_KEYS.WORKSHOP_TOUCHED, '1');
    setWorkshopTouched(true);
  }, [workshopTouched, input, isParsed, isDirty]);

  // Records which surface a PWA relaunch should return to. Set here rather than on
  // navigation because the workshop is also reachable by restoring state, not only
  // by clicking through to it.
  //
  // The release matters as much as the claim. Landing here passively has to hand
  // the surface back, or a stale 'workshop' written in some earlier session keeps
  // reopening the editor even though this one no longer claims it.
  useEffect(() => {
    if (workshopTouched) {
      localStorage.setItem(STORAGE_KEYS.LAST_SURFACE, 'workshop');
    } else if (localStorage.getItem(STORAGE_KEYS.LAST_SURFACE) === 'workshop') {
      localStorage.removeItem(STORAGE_KEYS.LAST_SURFACE);
    }
  }, [workshopTouched]);

  /**
   * Save the pasted chart exactly as typed, with no LLM call.
   *
   * This is the default import path. Previously every import went through
   * `/parse/stream`, so adding a chart cost 15 to 20 AI credits and a free user's
   * 200 lifetime credits bought roughly 13 imports, ever. Storing a chord chart
   * should not spend an AI budget, and it should not require a model to be
   * configured at all, which matters for self-hosters with no gateway.
   *
   * Title and artist come from `guessSongMeta`, a local heuristic. If it cannot
   * tell, the song is saved untitled and the user renames it on the chart.
   */
  const handleSaveAsIs = async () => {
    const trimmedInput = input.trim();
    if (!trimmedInput || !profile?.id) return;

    setSaveStatus('saving');
    try {
      const meta = guessSongMeta(trimmedInput);
      const song = await api.saveSong({
        profile_id: profile.id,
        title: meta.title || null,
        artist: meta.artist || null,
        source_url: pendingSourceUrlRef.current || null,
        original_content: trimmedInput,
        rewritten_content: trimmedInput,
        // No llm_model: nothing was generated.
      });
      pendingSourceUrlRef.current = null;
      localStorage.setItem(STORAGE_KEYS.HAS_REWRITTEN, '1');
      setHasSongs(true);
      setSongsChecked(true);

      onClearParse();
      onNewRewrite(null, null);
      setInput('');
      setInstruction('');
      setSongTitle('');
      setSongArtist('');
      setIsDirty(false);
      setSaveStatus(null);
      navigate(`/app/play/${song.uuid}`);
    } catch (err) {
      setSaveStatus(null);
      // The paste is still in the box and in DRAFT_INPUT, so nothing is lost.
      setParseError('Could not save this chart: ' + (err as Error).message);
    }
  };

  // AI import: cleans up the pasted song, then saves it. `mode` decides where the
  // user lands afterward:
  //   'library'  -> straight to the play route
  //   'rewrite'  -> stay here in the workshop to rewrite it
  const handleImport = async (mode: 'library' | 'rewrite') => {
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

      // Save song to library immediately after import
      if (profile?.id) {
        try {
          const song = await api.saveSong({
            profile_id: profile.id,
            title: result.title || null,
            artist: result.artist || null,
            source_url: pendingSourceUrlRef.current || null,
            original_content: result.original_content,
            rewritten_content: result.original_content,
            llm_model: llmSettings.model,
          });
          pendingSourceUrlRef.current = null;
          localStorage.setItem(STORAGE_KEYS.HAS_REWRITTEN, '1');
          setHasSongs(true);
          setSongsChecked(true);

          if (mode === 'library') {
            // Play-first: reset this tab and go straight to the song's play view.
            onClearParse();
            onNewRewrite(null, null);
            setInput('');
            setSongTitle('');
            setSongArtist('');
            setIsDirty(false);
            setSaveStatus(null);
            navigate(`/app/play/${song.uuid}`);
          } else {
            savedSongRef.current = { id: song.id, uuid: song.uuid };
            onSongSaved(song);
          }
        } catch (err) {
          setParseError('Failed to save song. Your edits won\'t be saved until you send a chat message. Error: ' + (err as Error).message);
        }
      }
    }
  };

  const handleCancelParse = () => {
    onCancelParse();
  };

  const sampleSavingRef = useRef(false);
  const handleLoadSample = async (sample: SampleSong) => {
    if (sampleSavingRef.current) return;
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

    // Save sample song to library immediately
    if (profile?.id) {
      sampleSavingRef.current = true;
      try {
        const song = await api.saveSong({
          profile_id: profile.id,
          title: result.title || null,
          artist: result.artist || null,
          original_content: result.original_content,
          rewritten_content: result.original_content,
          llm_model: llmSettings.model,
        });
        localStorage.setItem(STORAGE_KEYS.HAS_REWRITTEN, '1');
        setHasSongs(true);
        savedSongRef.current = { id: song.id, uuid: song.uuid };
        onSongSaved(song);
      } catch {
        // Non-critical: sample still works locally, handleBeforeSend provides recovery
      } finally {
        sampleSavingRef.current = false;
      }
    }
  };

  const handleBeforeSend = useCallback(async (): Promise<number> => {
    // Song should already exist after import; check both prop and ref to
    // avoid duplicate creation during the React re-render cycle.
    if (currentSongId) return currentSongId;
    if (savedSongRef.current) return savedSongRef.current.id;
    const song = await api.saveSong({
      profile_id: profile!.id,
      title: songTitle || null,
      artist: songArtist || null,
      original_content: parsedContent,
      rewritten_content: parsedContent,
      llm_model: llmSettings.model,
    });
    localStorage.setItem(STORAGE_KEYS.HAS_REWRITTEN, '1');
    setHasSongs(true);
    onSongSaved(song);
    return song.id;
  }, [currentSongId, profile, songTitle, songArtist, parsedContent, llmSettings, onSongSaved]);

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
    setInstruction('');
    setParseReasoningExpanded(false);
    setSaveStatus(null);
    setIsDirty(false);
    setSongTitle('');
    setSongArtist('');
    setChatMessages([]);
  };

  // The global "New Song" button (tab bar / mobile nav) clears the shared parse
  // and rewrite state in AppShell. When this tab is already mounted, mirror that
  // by resetting the local-only fields so a stale input/title/artist can't leak
  // back into the fresh INPUT view.
  const newSongNonceRef = useRef(newSongNonce);
  useEffect(() => {
    if (newSongNonce === newSongNonceRef.current) return;
    newSongNonceRef.current = newSongNonce;
    setInput('');
    setInstruction('');
    setParseReasoningExpanded(false);
    setSaveStatus(null);
    setIsDirty(false);
    setSongTitle('');
    setSongArtist('');
  }, [newSongNonce, setInput, setInstruction]);

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
    const songUuid = currentSongUuid || savedSongRef.current?.uuid;
    if (!songUuid || !isDirty) return;
    if (!rewriteResult && !parseResult) return;
    const content = rewriteResult?.rewritten_content ?? parsedContent;
    const original = rewriteResult?.original_content ?? parsedContent;
    if (!content && !original) return;
    setSaveStatus('saving');
    try {
      await api.updateSong(songUuid, {
        title: songTitle || null,
        artist: songArtist || null,
        rewritten_content: content,
        original_content: original,
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
      // Use ref to avoid stale-closure race after save completes but before re-render
      if (currentSongUuid || savedSongRef.current) setIsDirty(true);
    } else {
      // WORKSHOPPING state: use functional updater to avoid stale closure.
      // Spreading rewriteResult here would clobber concurrent rewritten_content
      // updates from onContentUpdated (issue #165).
      onOriginalContentUpdatedCtx(newOriginal);
      setIsDirty(true);
    }
  }, [rewriteResult, parseResult, currentSongUuid, setParsedContent, onOriginalContentUpdatedCtx]);

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
        model={llmSettings.model}
        models={models}
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
    const hasCurrent = !!llmSettings.model && models.includes(llmSettings.model);

    const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      if (val === '__manage__') {
        onOpenSettings();
        return;
      }
      if (!val) return;
      onChangeModel(val);
    };

    return (
      <>
        <Select
          className="hidden sm:inline w-auto py-1 px-2 text-xs"
          value={llmSettings.model}
          onChange={handleModelChange}
          aria-label="Model"
        >
          {!llmSettings.model && (
            <option value="">Model...</option>
          )}
          {llmSettings.model && !hasCurrent && (
            <option value={llmSettings.model}>{llmSettings.model}</option>
          )}
          {models.map(m => (
            <option key={m} value={m}>{m}</option>
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
            onClick={handleNewSong}
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
            {isQuotaError(parseError, parseErrorType) && (
              <QuotaUpgradeLink className="ml-2 font-semibold text-primary underline" />
            )}
            {parseErrorType?.startsWith('provider_') && (
              <span className="block text-xs text-muted-foreground mt-1">Issue with the AI provider</span>
            )}
          </div>
          <Button variant="ghost" size="sm" className="text-error-text p-1 leading-none" onClick={() => setParseError(null)}>
            &times;
          </Button>
        </Alert>
      )}

      {/* INPUT state */}
      {isInput && !parseLoading && (
        <OnboardingBanner show={isConfirmedNewUser}>
          {!isPremium && modelControls()}

          <Card
            className={cn('flex-1 min-h-0 flex flex-col', inputDragging && 'ring-2 ring-primary/30 border-primary')}
            onDragEnter={handleInputDragEnter}
            onDragLeave={handleInputDragLeave}
            onDragOver={handleInputDragOver}
            onDrop={handleInputDrop}
          >
            <CardContent className="pt-6 flex-1 flex flex-col min-h-0">
              {/* Server-confirmed empty library, not just `isFirstTime`. On a fresh
                  browser `hasSongs` starts false for everyone, so gating on
                  `isFirstTime` flashed a sample offer at returning users with a
                  full library until the song check came back. Same reason the
                  welcome banner uses this flag. */}
              {hasProfile && isConfirmedNewUser && (
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
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Import a song</p>
                <p className="text-sm text-muted-foreground mt-1">Add a chord chart from any of these four, in any format. We&apos;ll tidy up the formatting.</p>
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
              <input
                ref={tabPdfInputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                className="hidden"
                data-testid="import-tab-pdf-input"
                onChange={e => {
                  void handleStoreTabPdfs(e.target.files);
                  // Cleared so picking the same file twice in a row still fires.
                  e.target.value = '';
                }}
              />

              {/* The four sources are tabs because they are four alternatives, and
                  a tab strip is how you show that. They were previously three
                  small secondary buttons behind an "Or add from:" label, placed
                  *below* the save actions, which read as an afterthought and hid
                  three quarters of the ways in.

                  They are not four parallel destinations though: photo, file, and
                  link each end by filling the paste box, so Paste doubles as the
                  review step and owns the save actions. An extraction switches
                  back to it, which is also what makes the text visible before you
                  commit to saving it. */}
              <Tabs
                value={importSource}
                onValueChange={value => setImportSource(value as ImportSource)}
                className="flex-1 min-h-0 flex flex-col"
              >
                {/* The shared TabsList is styled for the full-width app nav, so the
                    page gutters and centering are dropped here. */}
                {/* Labelled because this is the second tablist on the page: the app
                    nav is the other one. Unlabelled, a screen reader announces two
                    indistinguishable tab lists. */}
                <TabsList
                  aria-label="Import source"
                  className="px-0 sm:px-0 mx-0 max-w-none border-b border-border shrink-0"
                >
                  <TabsTrigger className="px-3 sm:px-4 py-2" value="paste">Paste</TabsTrigger>
                  <TabsTrigger className="px-3 sm:px-4 py-2" value="photo">Photo</TabsTrigger>
                  <TabsTrigger className="px-3 sm:px-4 py-2" value="file">File</TabsTrigger>
                  <TabsTrigger className="px-3 sm:px-4 py-2" value="link">Link</TabsTrigger>
                </TabsList>

                <TabsContent value="paste" className="flex-1 min-h-0 flex flex-col mt-3">
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
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSave) {
                        e.preventDefault();
                        handleSaveAsIs();
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
                          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSave) {
                            e.preventDefault();
                            handleSaveAsIs();
                          }
                        }}
                      />
                    )}
                  </div>

                  <div className="flex flex-col gap-3 mt-3">
                    {/* Primary action is free and instant. The AI options are
                        secondary and labelled as costing credits, because "clean up
                        the formatting" previously looked free, sat above the plain
                        option, and quietly spent 15 to 20 credits. */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <Button onClick={handleSaveAsIs} disabled={!canSave}>
                        Add to library
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => handleImport('library')}
                        disabled={!canParse}
                        title="Reformats the chart with AI before saving. Uses AI credits."
                      >
                        Tidy up with AI
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => handleImport('rewrite')}
                        disabled={!canParse}
                        title="Reformats the chart and opens the rewrite workshop. Uses AI credits."
                      >
                        Import &amp; rewrite
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {saveBlocker ?? shortcutHint}
                      </span>
                    </div>
                    {/* Only surfaced when the AI actions specifically are unavailable.
                        Saving and playing still work, so this is a note rather than a
                        blocker. */}
                    {!hasModel && hasInput && (
                      <p className="text-xs text-muted-foreground">
                        {parseBlocker} to use the AI options. Importing and playing work without one.
                      </p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="photo" className="mt-3">
                  <div className="rounded-md border border-dashed border-border p-6 text-center">
                    <p className="text-sm text-muted-foreground mb-3">
                      A photo of a chart, or a screenshot. The text is read with AI, so this
                      one uses AI credits.
                    </p>
                    <Button
                      variant="secondary"
                      disabled={!hasProfile || !hasModel || imageLoading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {imageLoading ? <><Spinner size="sm" className="mr-1.5" /> Extracting...</> : 'Choose photo'}
                    </Button>
                    {!hasModel && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        {parseBlocker} to read a photo. The other three ways in work without one.
                      </p>
                    )}
                    {replaceNotice}
                  </div>
                </TabsContent>

                {/* Two outcomes, not one, because a PDF arrives here meaning one of
                    two different things. A chord chart that happens to be a PDF
                    wants its text pulled out so it can be played, transposed and
                    scrolled. A mandolin tab or a piece of notation has no text
                    worth pulling: it is a picture of a page, and extracting it
                    would return a scrambled column of nothing. That one wants
                    keeping as it is.

                    Storing used to be reachable only from the "+ Tab" button in
                    the library toolbar, which is where you would look for it
                    second. Import is where you look first. */}
                <TabsContent value="file" className="mt-3">
                  <div className="rounded-md border border-dashed border-border p-6 text-center">
                    <p className="text-sm font-semibold text-foreground mb-1">
                      Pull the chords out as text
                    </p>
                    {/* Capped measure: the card is as wide as the window on a
                        desktop, and a single line of help text running 1400px is
                        a line nobody tracks to the end of. */}
                    <p className="text-sm text-muted-foreground mb-3 max-w-md mx-auto text-balance">
                      A PDF up to 10 MB, or a text file up to 1 MB. The text lands in Paste so you
                      can read it before you save. No AI credits needed.
                    </p>
                    <Button
                      variant="secondary"
                      disabled={!hasProfile || fileLoading || tabStoring}
                      onClick={() => docFileInputRef.current?.click()}
                    >
                      {fileLoading ? <><Spinner size="sm" className="mr-1.5" /> Extracting...</> : 'Choose file'}
                    </Button>
                    <p className="mt-3 text-xs text-muted-foreground">
                      You can also drop a file anywhere on this card.
                    </p>

                    <div className="flex items-center gap-3 my-5 max-w-md mx-auto" aria-hidden="true">
                      <span className="h-px flex-1 bg-border" />
                      <span className="text-xs text-muted-foreground">or</span>
                      <span className="h-px flex-1 bg-border" />
                    </div>

                    <p className="text-sm font-semibold text-foreground mb-1">
                      Keep the PDF as it is
                    </p>
                    <p className="text-sm text-muted-foreground mb-3 max-w-md mx-auto text-balance">
                      For tabs and notation, where the layout is the chart. Stored exactly as you
                      uploaded it, up to 25 MB, and opened page by page for playing from. Nothing
                      is extracted, so nothing is reformatted.
                    </p>
                    <Button
                      variant="secondary"
                      disabled={!hasProfile || fileLoading || tabStoring}
                      onClick={() => tabPdfInputRef.current?.click()}
                    >
                      {tabStoring ? <><Spinner size="sm" className="mr-1.5" /> Storing...</> : 'Store a tab PDF'}
                    </Button>
                    {replaceNotice}
                  </div>
                </TabsContent>

                <TabsContent value="link" className="mt-3">
                  <div className="rounded-md border border-dashed border-border p-6">
                    <p className="text-sm text-muted-foreground mb-3">
                      Paste a link to a page with the chords on it. We&apos;ll fetch the text so you can
                      save it as a chart.
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      {/* Placeholder shows the shape of a URL without naming a site. Naming one
                          reads as a recommendation to import from it, which we do not want to
                          make; pasting a link you already have is a different thing. */}
                      <Input
                        type="url"
                        className="flex-1 min-w-[12rem]"
                        value={linkUrl}
                        // The dialog this replaced autofocused its field, so you could
                        // choose "Link" and start typing. Radix mounts the panel fresh
                        // on activation, so this fires each time the tab is chosen and
                        // keeps that behaviour.
                        autoFocus
                        onChange={e => setLinkUrl(e.target.value)}
                        placeholder="https://..."
                        onKeyDown={e => {
                          if (e.key === 'Enter' && linkUrl.trim() && !linkLoading) {
                            e.preventDefault();
                            handleScrapeUrl();
                          }
                        }}
                      />
                      <Button
                        onClick={handleScrapeUrl}
                        disabled={!hasProfile || !linkUrl.trim() || linkLoading}
                      >
                        {linkLoading ? <><Spinner size="sm" className="mr-1.5" /> Fetching...</> : 'Fetch chords'}
                      </Button>
                    </div>
                    {replaceNotice}
                  </div>
                </TabsContent>
              </Tabs>

              {/* The "Or try a sample" row that used to sit here was gated on
                  `!isFirstTime`, so it appeared only for people who already had
                  charts, which is the one audience with no use for a sample. The
                  sample offer now lives solely above the box, where it is shown
                  to someone confirmed to have an empty library. */}
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
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2 px-4 md:px-0">Rewrite your song</p>
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
                rewrittenContent={rewriteResult?.rewritten_content}
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

      {/* The link dialog that used to live here is now the Link tab on the import
          screen. A modal on top of a tab strip offering the same thing would be
          two doors to one room, and the inline field is one fewer click. */}

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
