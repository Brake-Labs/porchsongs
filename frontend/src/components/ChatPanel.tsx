import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import { toast } from 'sonner';
import { cn, stripXmlTags } from '@/lib/utils';
import api, { isProviderError } from '@/api';
import { isQuotaError, QuotaUpgradeLink, UsageFooter } from '@/extensions/quota';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Spinner from '@/components/ui/spinner';
import StreamingPre from '@/components/ui/streaming-pre';
import { StreamParser } from '@/lib/streamParser';
import type { AttachedFile, ChatMessage, LlmSettings, TokenUsage } from '@/types';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function ChatMessageBubble({ msg, isStreaming }: { msg: ChatMessage; isStreaming?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const hasRaw = msg.role === 'assistant' && !msg.isNote && msg.rawContent && msg.rawContent !== msg.content;
  const hasReasoning = msg.role === 'assistant' && !msg.isNote && !!msg.reasoning;

  const bubbleClass = msg.isNote
    ? 'bg-warning-bg text-warning-text self-center text-xs italic'
    : msg.role === 'user'
      ? 'bg-primary text-white self-end rounded-br-sm'
      : 'bg-card text-foreground self-start rounded-bl-sm border border-border';

  return (
    <div className={cn('px-3 py-2 rounded-md text-sm leading-normal max-w-[95%] sm:max-w-[85%] break-words', bubbleClass, msg.pending && 'opacity-60')}>
      {hasReasoning && (
        <>
          <Button
            variant="link-inline"
            className="block mb-1.5 text-xs opacity-80 can-hover:hover:opacity-100"
            onClick={() => setThinkingExpanded(prev => !prev)}
          >
            {thinkingExpanded ? 'Hide thinking' : 'Show thinking'}
          </Button>
          {thinkingExpanded && (
            <pre className="whitespace-pre-wrap break-words text-xs m-0 mb-2 font-mono max-h-80 overflow-y-auto opacity-70">{msg.reasoning}</pre>
          )}
        </>
      )}
      {msg.images && msg.images.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {msg.images.map((src, idx) => (
            <img key={idx} src={src} alt="Attached" className="h-12 w-12 rounded object-cover" />
          ))}
        </div>
      )}
      {isStreaming ? (
        <pre className="whitespace-pre-wrap break-words text-xs m-0 font-mono">{msg.content}</pre>
      ) : expanded ? (
        <pre className="whitespace-pre-wrap break-words text-xs m-0 font-mono max-h-80 overflow-y-auto">{msg.rawContent}</pre>
      ) : msg.role === 'assistant' && !msg.isNote ? (
        <div className="chat-markdown"><Markdown>{msg.content}</Markdown></div>
      ) : (
        msg.content
      )}
      {hasRaw && !isStreaming && (
        <Button
          variant="link-inline"
          className="block mt-1.5 text-xs opacity-80 can-hover:hover:opacity-100"
          onClick={() => setExpanded(prev => !prev)}
        >
          {expanded ? 'Show summary' : 'Show full response'}
        </Button>
      )}
      {msg.model && !isStreaming && (
        <div className="mt-1.5 text-[10px] text-muted-foreground opacity-70 text-right">{msg.model}</div>
      )}
      {msg.pending && (
        <div className="mt-1 text-[10px] opacity-70 italic">Queued</div>
      )}
    </div>
  );
}

interface ChatPanelProps {
  songId: number | null;
  profileId?: number;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  llmSettings: LlmSettings;
  onContentUpdated: (content: string) => void;
  initialLoading: boolean;
  onBeforeSend?: () => Promise<number>;
  onContentStreaming?: (partialContent: string) => void;
  onOriginalContentUpdated?: (content: string) => void;
  headerRight?: ReactNode;
  flat?: boolean;
  onStreamingChange?: (streaming: boolean) => void;
  rewrittenContent?: string;
}

export default function ChatPanel({ songId, profileId, messages, setMessages, llmSettings, onContentUpdated, initialLoading, onBeforeSend, onContentStreaming, onOriginalContentUpdated, headerRight, flat, onStreamingChange, rewrittenContent }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [reasoningText, setReasoningText] = useState('');
  const [lastFailedInput, setLastFailedInput] = useState<string | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>({ input_tokens: 0, output_tokens: 0 });
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingQueue = useRef<Array<{ apiContent: string | Array<Record<string, unknown>>; text: string }>>([]);

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
    const newAttachments: AttachedFile[] = [];

    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        if (file.size > MAX_IMAGE_SIZE) {
          toast.error(`Image "${file.name}" is too large (max 5 MB)`);
          continue;
        }
        const dataUrl = await fileToBase64(file);
        newAttachments.push({ type: 'image', name: file.name, content: dataUrl });
      } else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        if (file.size > MAX_FILE_SIZE) {
          toast.error(`File "${file.name}" is too large (max 10 MB)`);
          continue;
        }
        setFileLoading(true);
        try {
          const dataUrl = await fileToBase64(file);
          const result = await api.extractFile({
            profile_id: profileId ?? 0,
            file_data: dataUrl,
            filename: file.name,
          });
          newAttachments.push({ type: 'pdf', name: file.name, content: result.text });
        } catch (err) {
          toast.error(`Failed to extract "${file.name}": ${(err as Error).message}`);
        } finally {
          setFileLoading(false);
        }
      } else if (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt')) {
        if (file.size > 1 * 1024 * 1024) {
          toast.error(`File "${file.name}" is too large (max 1 MB)`);
          continue;
        }
        const text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsText(file);
        });
        newAttachments.push({ type: 'text', name: file.name, content: text });
      } else {
        toast.error('Unsupported file type. Try images, PDFs, or text files.');
      }
    }

    if (newAttachments.length > 0) {
      setAttachments(prev => [...prev, ...newAttachments]);
    }
  }, [profileId]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setDragging(false);
    if (e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  }, [processFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      processFiles(imageFiles);
    }
  }, [processFiles]);

  const removeAttachment = useCallback((index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Use scrollTo instead of scrollIntoView to avoid iOS Safari viewport zoom bug
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, reasoningText]);

  // Auto-resize textarea to fit content (up to ~8 lines / 200px)
  const MAX_INPUT_HEIGHT = 200;
  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const clamped = Math.min(el.scrollHeight, MAX_INPUT_HEIGHT);
    el.style.height = clamped + 'px';
    el.style.overflowY = el.scrollHeight > MAX_INPUT_HEIGHT ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    autoResize();
  }, [input, autoResize]);

  // Don't abort in-flight requests on unmount: if the user navigates
  // away from the rewrite tab, the stream continues in the background
  // and updates messages (which live in AppShell). When the user returns,
  // they see the completed result.

  const handleCancel = () => {
    pendingQueue.current = [];
    abortRef.current?.abort();
  };

  const handleRetry = () => {
    if (!lastFailedInput) return;
    // Remove the error message and the user message that caused it
    setMessages(prev => {
      const updated = [...prev];
      // Remove trailing error bubble
      if (updated.length > 0 && updated[updated.length - 1]?.role === 'assistant') {
        updated.pop();
      }
      // Remove the failed user message
      if (updated.length > 0 && updated[updated.length - 1]?.role === 'user') {
        updated.pop();
      }
      return updated;
    });
    setInput(lastFailedInput);
    setLastFailedInput(null);
    // Trigger send on next tick after state settles
    retryPendingRef.current = true;
  };

  const retryPendingRef = useRef(false);
  useEffect(() => {
    if (retryPendingRef.current && input.trim() && !sending) {
      retryPendingRef.current = false;
      handleSend();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  const sendApiRequest = async (effectiveSongId: number, apiContent: string | Array<Record<string, unknown>>, text: string): Promise<void> => {
    const controller = new AbortController();
    abortRef.current = controller;
    if (!sending) {
      setSending(true);
      onStreamingChange?.(true);
    }
    let streamStarted = false;
    const parser = new StreamParser();
    let reasoningAccumulated = '';
    setReasoningText('');
    const sentModel = llmSettings.model;

    try {
      const apiMessages = [{ role: 'user' as const, content: apiContent }];

      const result = await api.chatStream(
        {
          song_id: effectiveSongId,
          messages: apiMessages,
          ...llmSettings,
          ...(rewrittenContent ? { rewritten_content: rewrittenContent } : {}),
        },
        (token: string) => {
          const { contentDelta, originalSongDelta } = parser.processToken(token);

          if (contentDelta && onContentStreaming) {
            onContentStreaming(parser.contentText);
          }

          if (originalSongDelta && onOriginalContentUpdated) {
            onOriginalContentUpdated(parser.originalSongText);
          }

          // Determine what to show in the chat bubble
          const isInTag = (parser.phase === 'content' || parser.phase === 'original_song') && !parser.chatText;
          const bubbleContent = isInTag
            ? 'Updating song...'
            : parser.chatText || 'Updating song...';

          if (!streamStarted) {
            streamStarted = true;
            setStreaming(true);
            setMessages(prev => [...prev, { role: 'assistant' as const, content: bubbleContent }]);
          } else {
            setMessages(prev => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.role === 'assistant') {
                updated[updated.length - 1] = { ...last, content: bubbleContent };
              }
              return updated;
            });
          }
        },
        controller.signal,
        (reasoningToken: string) => {
          reasoningAccumulated += reasoningToken;
          setReasoningText(reasoningAccumulated);
        },
      );

      // Replace the streaming bubble with the final parsed result
      const reasoning = (result.reasoning ?? reasoningAccumulated) || undefined;
      const hasContent = result.rewritten_content !== null;
      const finalMsg: ChatMessage = hasContent
        ? { role: 'assistant', content: stripXmlTags(result.changes_summary), rawContent: result.assistant_message, reasoning, model: sentModel }
        : { role: 'assistant', content: stripXmlTags(result.assistant_message), reasoning, model: sentModel };
      if (streamStarted) {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = finalMsg;
          return updated;
        });
      } else {
        // No tokens were streamed (unlikely but handle it)
        setMessages(prev => [...prev, finalMsg]);
      }
      if (result.rewritten_content != null) {
        onContentUpdated(result.rewritten_content);
      }
      if (result.original_content && onOriginalContentUpdated) {
        onOriginalContentUpdated(result.original_content);
      }
      if (result.usage) {
        setTokenUsage(prev => ({
          input_tokens: prev.input_tokens + result.usage!.input_tokens,
          output_tokens: prev.output_tokens + result.usage!.output_tokens,
        }));
      }
      setLastFailedInput(null);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        pendingQueue.current = [];
        setMessages(prev => [...prev.filter(m => !m.pending), { role: 'assistant' as const, content: 'Cancelled.' }]);
      } else {
        pendingQueue.current = [];
        setLastFailedInput(text);
        const errorType = (err as Error & { errorType?: string }).errorType;
        setMessages(prev => [...prev.filter(m => !m.pending), { role: 'assistant' as const, content: 'Error: ' + (err as Error).message, errorType }]);
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setReasoningText('');

      // Process next queued message or reset sending state
      if (pendingQueue.current.length > 0) {
        const next = pendingQueue.current.shift()!;
        // Mark first pending message as active
        setMessages(prev => {
          const idx = prev.findIndex(m => m.pending);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx]!, pending: false };
            return updated;
          }
          return prev;
        });
        sendApiRequest(effectiveSongId, next.apiContent, next.text);
      } else {
        setSending(false);
        onStreamingChange?.(false);
      }
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    const hasAttachments = attachments.length > 0;
    if (!text && !hasAttachments) return;

    // Capture and clear attachments
    const currentAttachments = [...attachments];
    const imageDataUrls = currentAttachments.filter(a => a.type === 'image').map(a => a.content);

    // Build display text and the content payload for the API
    const displayText = text || (hasAttachments ? '[File attached]' : '');
    let apiContent: string | Array<Record<string, unknown>>;
    if (currentAttachments.length > 0) {
      const parts: Array<Record<string, unknown>> = [];
      if (text) parts.push({ type: 'text', text });
      for (const attachment of currentAttachments) {
        if (attachment.type === 'image') {
          parts.push({ type: 'image_url', image_url: { url: attachment.content } });
        } else {
          parts.push({ type: 'text', text: `--- Attached file: ${attachment.name} ---\n${attachment.content}` });
        }
      }
      apiContent = parts;
    } else {
      apiContent = text;
    }

    // Clear input and refocus immediately
    setInput('');
    setAttachments([]);
    inputRef.current?.focus();

    if (sending) {
      // Queue the message while LLM is busy
      pendingQueue.current.push({ apiContent, text });
      const userMsg: ChatMessage = { role: 'user', content: displayText, images: imageDataUrls.length > 0 ? imageDataUrls : undefined, pending: true };
      setMessages(prev => [...prev, userMsg]);
      return;
    }

    // Add user message to chat
    const userMsg: ChatMessage = { role: 'user', content: displayText, images: imageDataUrls.length > 0 ? imageDataUrls : undefined };
    setMessages(prev => [...prev, userMsg]);

    // Resolve song ID (first message may need to create the song)
    let effectiveSongId = songId;
    if (!effectiveSongId && onBeforeSend) {
      setSending(true);
      onStreamingChange?.(true);
      try {
        effectiveSongId = await onBeforeSend();
      } catch (err) {
        pendingQueue.current = [];
        const errorMsg: ChatMessage = { role: 'assistant', content: 'Error: ' + (err as Error).message };
        setMessages(prev => [...prev.filter(m => !m.pending), errorMsg]);
        setSending(false);
        onStreamingChange?.(false);
        return;
      }
    }
    if (!effectiveSongId) return;

    await sendApiRequest(effectiveSongId, apiContent, text);
  };

  return (
    <Card className={cn(flat ? 'border-0 shadow-none rounded-none bg-transparent' : 'mt-0', 'flex flex-col flex-1 overflow-hidden')}>
      <CardHeader className={cn('flex items-center justify-between gap-2', flat && 'hidden')}>
        <span>Chat Workshop</span>
        {headerRight && (
          <div className="flex items-center gap-1.5">{headerRight}</div>
        )}
      </CardHeader>
      <div ref={scrollContainerRef} className={cn('flex-1 overflow-y-auto overscroll-y-contain p-4 flex flex-col gap-2', flat && 'md:bg-panel md:shadow-[inset_0_1px_4px_rgba(0,0,0,0.04)] md:rounded-md')}>
        {messages.map((msg, i) => (
          <div key={i} className={cn('flex flex-col', msg.role === 'user' ? 'items-end' : 'items-start')}>
            <ChatMessageBubble msg={msg} isStreaming={streaming && i === messages.length - 1} />
            {lastFailedInput && i === messages.length - 1 && msg.role === 'assistant' && msg.content.startsWith('Error:') && (
              <>
                {isProviderError(msg) && (
                  <span className="text-xs text-muted-foreground mt-0.5">Issue with the AI provider</span>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <Button variant="secondary" size="sm" onClick={handleRetry}>
                    Retry
                  </Button>
                  {isQuotaError(msg.content) && (
                    <QuotaUpgradeLink className="text-sm font-semibold text-primary underline" />
                  )}
                </div>
              </>
            )}
          </div>
        ))}
        {initialLoading && (
          <div className="flex items-center gap-2 py-2 text-muted-foreground text-sm">
            <Spinner size="sm" />
            <span>Importing song...</span>
          </div>
        )}
        {sending && !streaming && (
          <div className="py-2 text-muted-foreground text-sm">
            <div className="flex items-center gap-2">
              <Spinner size="sm" />
              <span>Thinking...</span>
            </div>
            {reasoningText && (
              <StreamingPre className="text-xs mt-2 ml-6 font-mono max-h-40 overflow-y-auto opacity-70">{reasoningText}</StreamingPre>
            )}
          </div>
        )}
      </div>
      <UsageFooter tokenUsage={tokenUsage} />
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 py-2 border-t border-border">
          {attachments.map((attachment, idx) => (
            <div key={idx} className="relative group">
              {attachment.type === 'image' ? (
                <img src={attachment.content} alt={attachment.name} className="h-12 w-12 rounded object-cover border border-border" />
              ) : (
                <div className="h-12 px-3 rounded border border-border bg-card flex items-center gap-1.5 text-xs text-foreground">
                  <span className="opacity-60">{attachment.type === 'pdf' ? '\ud83d\udcc4' : '\ud83d\udcdd'}</span>
                  <span className="max-w-[120px] truncate">{attachment.name}</span>
                </div>
              )}
              <button
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-danger text-white text-[10px] leading-none flex items-center justify-center opacity-0 can-hover:group-hover:opacity-100 transition-opacity"
                onClick={() => removeAttachment(idx)}
                aria-label={`Remove ${attachment.name}`}
              >
                &times;
              </button>
            </div>
          ))}
          {fileLoading && (
            <div className="h-12 px-3 rounded border border-border bg-card flex items-center gap-1.5 text-xs text-muted-foreground">
              <Spinner size="sm" />
              <span>Extracting...</span>
            </div>
          )}
        </div>
      )}
      <div
        className={cn('px-4 py-3 border-t border-border transition-colors', dragging && 'bg-primary/10 border-primary')}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className="relative flex flex-col rounded-lg border border-border bg-card focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30 focus-within:ring-offset-1 ring-offset-card transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={dragging ? 'Drop file here...' : messages.length === 0 ? 'Your song is ready. How would you like to change it?' : 'Tell the AI how to change the song...'}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            onPaste={handlePaste}
            disabled={initialLoading}
            rows={1}
            className="w-full resize-none overflow-hidden bg-transparent px-3 pt-2.5 pb-1 sm:pt-2 text-sm text-foreground font-ui placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 disabled:pointer-events-none"
          />
          <div className="flex justify-between items-center px-2 pb-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-1.5 text-muted-foreground can-hover:hover:text-foreground transition-colors disabled:opacity-50"
              aria-label="Attach file"
              disabled={initialLoading || fileLoading}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            </button>
            <div className="flex gap-1.5 items-center">
              {sending && (
                <Button variant="danger-outline" size="sm" onClick={handleCancel}>
                  Cancel
                </Button>
              )}
              <Button size="sm" onClick={handleSend} disabled={initialLoading || fileLoading || (!input.trim() && attachments.length === 0) || (!songId && !onBeforeSend)}>
                Send
              </Button>
            </div>
          </div>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf,.txt,text/plain,application/pdf"
        className="hidden"
        onChange={e => {
          if (e.target.files) processFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </Card>
  );
}
