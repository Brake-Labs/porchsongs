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
    <div className="fixed bottom-2 right-2 z-50 w-72 max-w-[90vw]">
      <FollowDebugOverlay
        estimate={follow.estimate}
        lyricStates={song.lyricStates}
        recentWords={follow.recentWords}
        running={follow.running}
        recording={follow.recording}
        error={follow.error}
      />
      <div className="mt-1 flex flex-wrap gap-1">
        {follow.running ? (
          <Button size="sm" variant="ghost" onClick={follow.stop}>
            Stop
          </Button>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={playDemo} disabled={!song.hasLyrics}>
              Play demo
            </Button>
            <Button size="sm" variant="ghost" onClick={listen} disabled={!song.hasLyrics}>
              Listen (mic)
            </Button>
          </>
        )}
        {follow.recording ? (
          <Button size="sm" variant="ghost" onClick={downloadJson}>
            Save JSON
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={follow.startRecording}>
            Record
          </Button>
        )}
      </div>
    </div>
  );
}
