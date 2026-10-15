import type { Dispatch, SetStateAction } from 'react';
import api, { ConnectionLostError } from '@/api';
import { stripXmlTags } from '@/lib/utils';
import { StreamParser } from '@/lib/streamParser';
import type { ChatMessage, LlmSettings, TokenUsage } from '@/types';

export type ChatApiContent = string | Array<Record<string, unknown>>;

/** What the chat panel renders for one song's session. Replaced, never mutated. */
export interface ChatSessionSnapshot {
  sending: boolean;
  streaming: boolean;
  reasoningText: string;
  lastFailedInput: string | null;
}

/**
 * Where a session's results go: the panel currently showing the chat.
 *
 * Writes only reach it while the session's song is the active one, so a
 * stream that finishes after the user has moved to another song is dropped
 * instead of landing in that song. The backend persists the result either way.
 */
export interface ChatSink {
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  onContentUpdated: (content: string) => void;
  onContentStreaming?: (partialContent: string) => void;
  onOriginalContentUpdated?: (content: string) => void;
  onUsage?: (usage: TokenUsage) => void;
  llmSettings: LlmSettings;
  rewrittenContent?: string;
}

/** Song key. `null` is a parsed chart that has not been saved yet. */
type SongKey = number | null;

interface QueuedMessage {
  apiContent: ChatApiContent;
  text: string;
  // Used only if the session's song is no longer on screen when this goes out,
  // since the sink then belongs to another song.
  llmSettings: LlmSettings;
  rewrittenContent?: string;
}

interface Session {
  snapshot: ChatSessionSnapshot;
  abort: AbortController | null;
  queue: QueuedMessage[];
  // The chart as the last reply in this run of the queue left it. The sink
  // cannot say: the next queued request goes out before React re-renders.
  latestContent?: string;
}

const IDLE: ChatSessionSnapshot = Object.freeze({
  sending: false,
  streaming: false,
  reasoningText: '',
  lastFailedInput: null,
});

/**
 * Chat sessions keyed by song, owned by whoever must outlive the chat panel.
 *
 * The panel unmounts on every trip out of the workshop, but a stream keeps
 * going. Keeping the in-flight state here means returning to the song shows
 * the live stream and queues a new message behind it, rather than starting an
 * overlapping request.
 */
export class ChatSessionStore {
  private sessions = new Map<SongKey, Session>();
  private listeners = new Set<() => void>();
  private activeSongId: SongKey = null;
  private sink: ChatSink | null = null;
  private nextStreamId = 1;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  get(songId: SongKey): ChatSessionSnapshot {
    return this.sessions.get(songId)?.snapshot ?? IDLE;
  }

  /** Must be called synchronously whenever the song on screen changes. */
  setActiveSong(songId: SongKey): void {
    this.activeSongId = songId;
  }

  setSink(sink: ChatSink): void {
    this.sink = sink;
  }

  clearFailedInput(songId: SongKey): void {
    this.update(songId, { lastFailedInput: null });
  }

  cancel(songId: SongKey): void {
    const session = this.sessions.get(songId);
    if (!session) return;
    session.queue = [];
    session.abort?.abort();
  }

  /**
   * Send a message, or queue it behind the one in flight.
   *
   * `onBeforeSend` creates the song for a first message on an unsaved chart;
   * if the draft was the active song, the created song becomes active.
   */
  async send(
    songId: SongKey,
    message: { apiContent: ChatApiContent; text: string; display: ChatMessage },
    onBeforeSend?: () => Promise<number>,
  ): Promise<void> {
    const session = this.session(songId);
    if (session.snapshot.sending) {
      session.queue.push({
        apiContent: message.apiContent,
        text: message.text,
        llmSettings: this.sink?.llmSettings ?? { model: '', reasoning_effort: '' },
        rewrittenContent: this.sink?.rewrittenContent,
      });
      this.write(songId, sink => sink.setMessages(prev => [...prev, { ...message.display, pending: true }]));
      return;
    }

    this.write(songId, sink => sink.setMessages(prev => [...prev, message.display]));

    let effectiveSongId = songId;
    if (effectiveSongId === null && onBeforeSend) {
      this.update(songId, { sending: true });
      try {
        effectiveSongId = await onBeforeSend();
      } catch (err) {
        session.queue = [];
        const errorMsg: ChatMessage = { role: 'assistant', content: 'Error: ' + (err as Error).message };
        this.write(songId, sink => sink.setMessages(prev => [...prev.filter(m => !m.pending), errorMsg]));
        this.update(songId, { sending: false });
        return;
      }
      // Anything queued while the song was being created belongs to it.
      const draft = this.sessions.get(null);
      this.sessions.delete(null);
      // The draft was on screen, so the song it became is now.
      if (this.activeSongId === null) this.activeSongId = effectiveSongId;
      const created = this.session(effectiveSongId);
      if (draft) created.queue.push(...draft.queue);
      this.notify();
    }
    if (effectiveSongId === null) return;

    await this.request(effectiveSongId, message.apiContent, message.text);
  }

  private async request(songId: number, apiContent: ChatApiContent, text: string, queued?: QueuedMessage): Promise<void> {
    const session = this.session(songId);
    const controller = new AbortController();
    session.abort = controller;
    this.update(songId, { sending: true, reasoningText: '' });

    // Prefer the settings on screen now; for content, prefer what the previous
    // reply in the queue produced, which the sink has not caught up with yet.
    const live = this.isActive(songId) ? this.sink : null;
    const llmSettings = live?.llmSettings ?? queued?.llmSettings ?? { model: '', reasoning_effort: '' };
    const rewrittenContent = session.latestContent ?? (live ? live.rewrittenContent : queued?.rewrittenContent);

    const streamId = this.nextStreamId++;
    const parser = new StreamParser();
    let reasoningAccumulated = '';
    let streamStarted = false;

    const putBubble = (msg: ChatMessage) => (prev: ChatMessage[]) => {
      // Find the bubble by id, not position: if the history was reloaded while
      // away, the last message is no longer this stream's.
      const idx = prev.findIndex(m => m.streamId === streamId);
      if (idx < 0) return [...prev, msg];
      const updated = [...prev];
      updated[idx] = msg;
      return updated;
    };

    try {
      const result = await api.chatStream(
        {
          song_id: songId,
          messages: [{ role: 'user' as const, content: apiContent }],
          ...llmSettings,
          ...(rewrittenContent ? { rewritten_content: rewrittenContent } : {}),
        },
        (token: string) => {
          const { contentDelta, originalSongDelta } = parser.processToken(token);
          this.write(songId, sink => {
            if (contentDelta) sink.onContentStreaming?.(parser.contentText);
            if (originalSongDelta) sink.onOriginalContentUpdated?.(parser.originalSongText);
          });

          const isInTag = (parser.phase === 'content' || parser.phase === 'original_song') && !parser.chatText;
          const bubbleContent = isInTag ? 'Updating song...' : parser.chatText || 'Updating song...';
          if (!streamStarted) {
            streamStarted = true;
            this.update(songId, { streaming: true });
          }
          this.write(songId, sink => sink.setMessages(putBubble({ role: 'assistant', content: bubbleContent, streamId })));
        },
        controller.signal,
        (reasoningToken: string) => {
          reasoningAccumulated += reasoningToken;
          this.update(songId, { reasoningText: reasoningAccumulated });
        },
      );

      const reasoning = (result.reasoning ?? reasoningAccumulated) || undefined;
      const hasContent = result.rewritten_content !== null;
      const finalMsg: ChatMessage = hasContent
        ? { role: 'assistant', content: stripXmlTags(result.changes_summary), rawContent: result.assistant_message, reasoning, model: llmSettings.model }
        : { role: 'assistant', content: stripXmlTags(result.assistant_message), reasoning, model: llmSettings.model };
      if (result.rewritten_content != null) session.latestContent = result.rewritten_content;
      this.write(songId, sink => {
        sink.setMessages(putBubble(finalMsg));
        if (result.rewritten_content != null) sink.onContentUpdated(result.rewritten_content);
        if (result.original_content) sink.onOriginalContentUpdated?.(result.original_content);
        if (result.usage) sink.onUsage?.(result.usage);
      });
      this.update(songId, { lastFailedInput: null });
    } catch (err) {
      session.queue = [];
      let note: ChatMessage;
      if ((err as Error).name === 'AbortError') {
        note = { role: 'assistant', content: 'Cancelled.' };
      } else if (err instanceof ConnectionLostError) {
        // Mobile tab suspended or connection dropped mid-stream. The backend
        // finishes and persists the result; visibility recovery re-fetches it.
        this.update(songId, { lastFailedInput: null });
        note = { role: 'assistant', content: 'Processing in background...', isNote: true };
      } else {
        this.update(songId, { lastFailedInput: text });
        const errorType = (err as Error & { errorType?: string }).errorType;
        note = { role: 'assistant', content: 'Error: ' + (err as Error).message, errorType };
      }
      // A cancelled reply keeps what it streamed so far. A failed one loses its
      // partial bubble, so Retry (which pops the error and the user message)
      // does not leave the user message behind to be sent twice.
      const keepPartial = (err as Error).name === 'AbortError';
      this.write(songId, sink => sink.setMessages(prev => [
        ...prev.filter(m => !m.pending && (keepPartial || m.streamId !== streamId)),
        note,
      ]));
    } finally {
      session.abort = null;
      this.update(songId, { streaming: false, reasoningText: '' });

      const next = session.queue.shift();
      if (next) {
        this.write(songId, sink => sink.setMessages(prev => {
          const idx = prev.findIndex(m => m.pending);
          if (idx < 0) return prev;
          const updated = [...prev];
          updated[idx] = { ...updated[idx]!, pending: false };
          return updated;
        }));
        void this.request(songId, next.apiContent, next.text, next);
      } else {
        session.latestContent = undefined;
        this.update(songId, { sending: false });
      }
    }
  }

  private isActive(songId: SongKey): boolean {
    return this.activeSongId === songId;
  }

  private write(songId: SongKey, fn: (sink: ChatSink) => void): void {
    if (this.sink && this.isActive(songId)) fn(this.sink);
  }

  private session(songId: SongKey): Session {
    let session = this.sessions.get(songId);
    if (!session) {
      session = { snapshot: IDLE, abort: null, queue: [] };
      this.sessions.set(songId, session);
    }
    return session;
  }

  private update(songId: SongKey, patch: Partial<ChatSessionSnapshot>): void {
    const session = this.session(songId);
    session.snapshot = { ...session.snapshot, ...patch };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
