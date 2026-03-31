import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import api from '@/api';
import { chatHistoryToMessages } from '@/lib/chat-utils';
import type { ChatMessage, ChatHistoryRow, RewriteResult, Song } from '@/types';

/** Delay (ms) after tab becomes visible before re-fetching, giving the
 *  backend time to finish persisting if the LLM call was still running. */
const RECOVERY_DELAY_MS = 2500;

interface RecoveryDeps {
  songUuid: string | null;
  /** True while the chat or parse SSE stream is actively running. */
  isStreaming: boolean;
  setRewriteResult: React.Dispatch<React.SetStateAction<RewriteResult | null>>;
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

/**
 * Re-syncs song content and chat history from the backend when the browser
 * tab becomes visible again after being hidden during an active stream.
 *
 * This handles mobile browsers suspending tabs mid-generation: the backend
 * continues the LLM call and persists the result, and this hook picks it up
 * when the user returns.
 */
export default function useVisibilityRecovery({
  songUuid,
  isStreaming,
  setRewriteResult,
  setChatMessages,
}: RecoveryDeps): void {
  // Track whether a stream was active when the tab was hidden.
  const wasStreamingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        wasStreamingRef.current = isStreaming;
      } else if (document.visibilityState === 'visible' && wasStreamingRef.current) {
        wasStreamingRef.current = false;

        if (!songUuid) return;
        const uuid = songUuid;

        // Wait for the backend to finish persisting, then re-fetch.
        timerRef.current = setTimeout(async () => {
          timerRef.current = null;
          try {
            const [song, history]: [Song, ChatHistoryRow[]] = await Promise.all([
              api.getSong(uuid),
              api.getChatHistory(uuid),
            ]);
            let changed = false;
            setRewriteResult(prev => {
              // Only update if the song actually changed (backend persisted
              // a new version while we were away).
              if (
                prev &&
                prev.rewritten_content === song.rewritten_content &&
                prev.original_content === song.original_content
              ) {
                return prev;
              }
              changed = true;
              return {
                original_content: song.original_content,
                rewritten_content: song.rewritten_content,
                changes_summary: song.changes_summary || '',
              };
            });
            setChatMessages(chatHistoryToMessages(history));
            if (changed) {
              toast.info('Restored latest changes');
            }
          } catch {
            // Silently ignore — the user can manually refresh.
          }
        }, RECOVERY_DELAY_MS);
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [songUuid, isStreaming, setRewriteResult, setChatMessages]);
}
