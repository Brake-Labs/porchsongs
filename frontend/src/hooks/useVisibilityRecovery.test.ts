import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest';
import useVisibilityRecovery from './useVisibilityRecovery';

// Mock the API module
vi.mock('@/api', () => ({
  default: {
    getSong: vi.fn(),
    getChatHistory: vi.fn(),
  },
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: { info: vi.fn() },
}));

// Mock chat-utils
vi.mock('@/lib/chat-utils', () => ({
  chatHistoryToMessages: vi.fn((rows: unknown[]) => rows),
}));

import api from '@/api';
import { toast } from 'sonner';
import type { SetStateAction } from 'react';
import type { RewriteResult, ChatMessage } from '@/types';

type MockDispatch<T> = Mock<(value: SetStateAction<T>) => void>;

describe('useVisibilityRecovery', () => {
  let setRewriteResult: MockDispatch<RewriteResult | null>;
  let setChatMessages: MockDispatch<ChatMessage[]>;

  beforeEach(() => {
    vi.useFakeTimers();
    setRewriteResult = vi.fn();
    setChatMessages = vi.fn();
    vi.mocked(api.getSong).mockReset();
    vi.mocked(api.getChatHistory).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function simulateVisibilityChange(state: 'hidden' | 'visible') {
    Object.defineProperty(document, 'visibilityState', {
      value: state,
      writable: true,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it('does not fetch when no stream was active on hide', () => {
    renderHook(() =>
      useVisibilityRecovery({
        songUuid: 'test-uuid',
        isStreaming: false,
        setRewriteResult,
        setChatMessages,
      }),
    );

    simulateVisibilityChange('hidden');
    simulateVisibilityChange('visible');

    vi.advanceTimersByTime(5000);
    expect(api.getSong).not.toHaveBeenCalled();
  });

  it('fetches song and chat history when tab resumes after streaming', async () => {
    const mockSong = {
      id: 1,
      uuid: 'test-uuid',
      original_content: 'original',
      rewritten_content: 'new content from backend',
      changes_summary: 'updated',
    };
    const mockHistory = [
      { role: 'user', content: 'make it better', is_note: false },
      { role: 'assistant', content: 'I improved it', is_note: false, reasoning: null, model: 'gpt-4' },
    ];

    vi.mocked(api.getSong).mockResolvedValue(mockSong as never);
    vi.mocked(api.getChatHistory).mockResolvedValue(mockHistory as never);

    // Make setRewriteResult invoke the updater so `changed` gets set
    setRewriteResult.mockImplementation((updater: SetStateAction<RewriteResult | null>) => {
      if (typeof updater === 'function') updater(null);
    });

    // Start with streaming active
    const { rerender } = renderHook(
      ({ isStreaming }) =>
        useVisibilityRecovery({
          songUuid: 'test-uuid',
          isStreaming,
          setRewriteResult,
          setChatMessages,
        }),
      { initialProps: { isStreaming: true } },
    );

    // Tab goes hidden while streaming
    simulateVisibilityChange('hidden');

    // Stream finishes (or errors) while hidden
    rerender({ isStreaming: false });

    // Tab becomes visible again
    simulateVisibilityChange('visible');

    // Advance past the recovery delay
    await act(async () => {
      vi.advanceTimersByTime(3000);
      // Flush microtasks for the async fetch
      await vi.runAllTimersAsync();
    });

    expect(api.getSong).toHaveBeenCalledWith('test-uuid');
    expect(api.getChatHistory).toHaveBeenCalledWith('test-uuid');
    expect(setRewriteResult).toHaveBeenCalled();
    expect(setChatMessages).toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith('Restored latest changes');
  });

  it('does not fetch when no song is loaded', () => {
    renderHook(() =>
      useVisibilityRecovery({
        songUuid: null,
        isStreaming: true,
        setRewriteResult,
        setChatMessages,
      }),
    );

    simulateVisibilityChange('hidden');
    simulateVisibilityChange('visible');

    vi.advanceTimersByTime(5000);
    expect(api.getSong).not.toHaveBeenCalled();
  });

  it('skips update when song content has not changed', async () => {
    const mockSong = {
      id: 1,
      uuid: 'test-uuid',
      original_content: 'original',
      rewritten_content: 'same content',
      changes_summary: 'no change',
    };

    vi.mocked(api.getSong).mockResolvedValue(mockSong as never);
    vi.mocked(api.getChatHistory).mockResolvedValue([] as never);

    // Simulate setRewriteResult to test the identity check
    setRewriteResult.mockImplementation((updater: SetStateAction<RewriteResult | null>) => {
      if (typeof updater !== 'function') return;
      const prev: RewriteResult = {
        original_content: 'original',
        rewritten_content: 'same content',
        changes_summary: 'no change',
      };
      const result = updater(prev);
      // Should return prev (same reference) since nothing changed
      expect(result).toBe(prev);
    });

    renderHook(
      ({ isStreaming }) =>
        useVisibilityRecovery({
          songUuid: 'test-uuid',
          isStreaming,
          setRewriteResult,
          setChatMessages,
        }),
      { initialProps: { isStreaming: true } },
    );

    simulateVisibilityChange('hidden');
    simulateVisibilityChange('visible');

    await act(async () => {
      vi.advanceTimersByTime(3000);
      await vi.runAllTimersAsync();
    });

    expect(api.getSong).toHaveBeenCalled();
  });
});
