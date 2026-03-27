import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import { toast } from 'sonner';
import { cn, stripXmlTags } from '@/lib/utils';
import api from '@/api';
import { isQuotaError, QuotaUpgradeLink, UsageFooter } from '@/extensions/quota';
import { Card, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Spinner from '@/components/ui/spinner';
import StreamingPre from '@/components/ui/streaming-pre';
import { StreamParser } from '@/lib/streamParser';
import type { ChatMessage, LlmSettings, TokenUsage } from '@/types';

const MAX_MESSAGES = 20;

interface AttachedImage {
  dataUrl: string;
  name: string;
}

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
    <div className={cn('px-3 py-2 rounded-md text-sm leading-normal max-w-[95%] sm:max-w-[85%] break-words', bubbleClass)}>
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
    </div>
  );
}

interface ChatPanelProps {
  songId: number | null;
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
}

export default function ChatPanel({ songId, messages, setMessages, llmSettings, onContentUpdated, initialLoading, onBeforeSend, onContentStreaming, onOriginalContentUpdated, headerRight, flat }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [reasoningText, setReasoningText] = useState('');
  const [lastFailedInput, setLastFailedInput] = useState<string | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>({ input_tokens: 0, output_tokens: 0 });
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    const newImages: AttachedImage[] = [];
    for (const file of imageFiles) {
      if (file.size > MAX_IMAGE_SIZE) {
        toast.error(`Image "${file.name}" is too large (max 5 MB)`);
        continue;
      }
      const dataUrl = await fileToBase64(file);
      newImages.push({ dataUrl, name: file.name });
    }
    if (newImages.length > 0) {
      setImages(prev => [...prev, ...newImages]);
    }
  }, []);

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

  const removeImage = useCallback((index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Use scrollTo instead of scrollIntoView to avoid iOS Safari viewport zoom bug
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, reasoningText]);

  // Abort any in-flight request on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const handleCancel = () => {
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

  const handleSend = async () => {
    const text = input.trim();
    const hasImages = images.length > 0;
    if ((!text && !hasImages) || sending) return;

    // Capture and clear attached images
    const attachedImages = [...images];
    const attachedDataUrls = attachedImages.map(img => img.dataUrl);

    // Build display text and the content payload for the API
    const displayText = text || (hasImages ? '[Image attached]' : '');
    let apiContent: string | Array<Record<string, unknown>>;
    if (attachedImages.length > 0) {
      const parts: Array<Record<string, unknown>> = [];
      if (text) parts.push({ type: 'text', text });
      for (const img of attachedImages) {
        parts.push({ type: 'image_url', image_url: { url: img.dataUrl } });
      }
      apiContent = parts;
    } else {
      apiContent = text;
    }

    let effectiveSongId = songId;
    if (!effectiveSongId && onBeforeSend) {
      setInput('');
      setImages([]);
      inputRef.current?.focus();
      const userMsg: ChatMessage = { role: 'user', content: displayText, images: attachedDataUrls.length > 0 ? attachedDataUrls : undefined };
      setMessages(prev => [...prev, userMsg].slice(-MAX_MESSAGES));
      setSending(true);
      try {
        effectiveSongId = await onBeforeSend();
      } catch (err) {
        const errorMsg: ChatMessage = { role: 'assistant', content: 'Error: ' + (err as Error).message };
        setMessages(prev => [...prev, errorMsg]);
        setSending(false);
        return;
      }
    } else {
      setInput('');
      setImages([]);
      inputRef.current?.focus();
      const userMsg: ChatMessage = { role: 'user', content: displayText, images: attachedDataUrls.length > 0 ? attachedDataUrls : undefined };
      setMessages(prev => [...prev, userMsg].slice(-MAX_MESSAGES));
    }
    if (!effectiveSongId) return;

    const controller = new AbortController();
    abortRef.current = controller;
    if (!sending) setSending(true);
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
            setMessages(prev => [...prev, { role: 'assistant' as const, content: bubbleContent }].slice(-MAX_MESSAGES));
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
        setMessages(prev => [...prev, finalMsg].slice(-MAX_MESSAGES));
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
        const cancelMsg: ChatMessage = { role: 'assistant', content: 'Cancelled.' };
        setMessages(prev => [...prev, cancelMsg]);
      } else {
        setLastFailedInput(text);
        const errorMsg: ChatMessage = { role: 'assistant', content: 'Error: ' + (err as Error).message };
        setMessages(prev => [...prev, errorMsg]);
      }
    } finally {
      abortRef.current = null;
      setSending(false);
      setStreaming(false);
      setReasoningText('');
    }
  };

  return (
    <Card className={cn(flat ? 'border-0 shadow-none rounded-none bg-transparent' : 'mt-0', 'flex flex-col flex-1 overflow-hidden')}>
      <CardHeader className={cn('flex items-center justify-between gap-2', flat && 'hidden')}>
        <span>Chat Workshop</span>
        {headerRight && (
          <div className="flex items-center gap-1.5">{headerRight}</div>
        )}
      </CardHeader>
      {messages.length >= MAX_MESSAGES && (
        <div className="px-4 py-2 bg-warning-bg border-b border-warning-border text-warning-text text-xs">
          Chat history limit reached ({MAX_MESSAGES} messages). Older messages will be dropped.
        </div>
      )}
      <div ref={scrollContainerRef} className={cn('flex-1 overflow-y-auto p-4 flex flex-col gap-2', flat && 'md:bg-panel md:shadow-[inset_0_1px_4px_rgba(0,0,0,0.04)] md:rounded-md')}>
        {messages.map((msg, i) => (
          <div key={i} className={cn('flex flex-col', msg.role === 'user' ? 'items-end' : 'items-start')}>
            <ChatMessageBubble msg={msg} isStreaming={streaming && i === messages.length - 1} />
            {lastFailedInput && i === messages.length - 1 && msg.role === 'assistant' && msg.content.startsWith('Error:') && (
              <div className="flex items-center gap-2 mt-1">
                <Button variant="secondary" size="sm" onClick={handleRetry}>
                  Retry
                </Button>
                {isQuotaError(msg.content) && (
                  <QuotaUpgradeLink className="text-sm font-semibold text-primary underline" />
                )}
              </div>
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
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 py-2 border-t border-border">
          {images.map((img, idx) => (
            <div key={idx} className="relative group">
              <img src={img.dataUrl} alt={img.name} className="h-12 w-12 rounded object-cover border border-border" />
              <button
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-danger text-white text-[10px] leading-none flex items-center justify-center opacity-0 can-hover:group-hover:opacity-100 transition-opacity"
                onClick={() => removeImage(idx)}
                aria-label={`Remove ${img.name}`}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
      <div
        className={cn('flex gap-3 px-4 py-3 border-t border-border transition-colors', dragging && 'bg-primary/10 border-primary')}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <Input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={dragging ? 'Drop image here...' : messages.length === 0 ? 'Your song is ready. How would you like to change it?' : 'Tell the AI how to change the song...'}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          onPaste={handlePaste}
          disabled={sending || initialLoading}
          className="flex-1"
        />
        {sending ? (
          <Button variant="danger-outline" onClick={handleCancel}>
            Cancel
          </Button>
        ) : (
          <Button onClick={handleSend} disabled={initialLoading || (!input.trim() && images.length === 0) || (!songId && !onBeforeSend)}>
            Send
          </Button>
        )}
      </div>
    </Card>
  );
}
