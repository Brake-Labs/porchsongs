import { useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { useFollow } from '@/hooks/useFollow';
import { normalizeSong } from '@/lib/followAlign';
import { createCannedSignal, scriptFromSong } from '@/lib/followSignal';
import { createSpeechSignal } from '@/lib/followSpeech';
import FollowDebugOverlay from '@/components/FollowDebugOverlay';

/** Trigger a browser download of a recorded Follow session as JSON. */
function downloadRecording(data: unknown, name: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Development harness for Follow mode (gated by ?followdebug). Runs the tracker
 * against the current song with no microphone by replaying a scripted "sing this
 * song" stream, shows the live diagnostics overlay, and can record the session
 * to JSON for offline threshold tuning / test fixtures.
 */
export default function FollowDebugPanel({ songText }: { songText: string }) {
  const follow = useFollow(songText);
  const song = useMemo(() => normalizeSong(songText), [songText]);

  const playDemo = useCallback(() => {
    follow.start(() => createCannedSignal(scriptFromSong(songText)));
  }, [follow, songText]);

  const listen = useCallback(() => {
    follow.start(() => createSpeechSignal());
  }, [follow]);

  const downloadJson = useCallback(() => {
    const recording = follow.stopRecording();
    downloadRecording(recording, `follow-recording-${Date.now()}.json`);
  }, [follow]);

  return (
    <div className="fixed bottom-3 right-3 z-50 w-80 max-w-[calc(100vw-1.5rem)] max-h-[70vh] overflow-auto rounded-lg border border-border bg-card text-foreground shadow-2xl ring-1 ring-black/10">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Follow · debug
        </span>
      </div>

      <div className="p-3">
        <FollowDebugOverlay
          estimate={follow.estimate}
          lyricStates={song.lyricStates}
          recentWords={follow.recentWords}
          running={follow.running}
          recording={follow.recording}
          error={follow.error}
        />
      </div>

      <div className="flex flex-wrap gap-1.5 border-t border-border bg-panel px-3 py-2">
        {follow.running ? (
          <Button size="sm" variant="danger-outline" onClick={follow.stop}>
            Stop
          </Button>
        ) : (
          <>
            <Button size="sm" variant="secondary" onClick={playDemo} disabled={!song.hasLyrics}>
              Play demo
            </Button>
            <Button size="sm" variant="secondary" onClick={listen} disabled={!song.hasLyrics}>
              Listen (mic)
            </Button>
          </>
        )}
        {follow.recording ? (
          <Button size="sm" variant="secondary" onClick={downloadJson}>
            Save JSON
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={follow.startRecording}>
            Record
          </Button>
        )}
      </div>
    </div>
  );
}
