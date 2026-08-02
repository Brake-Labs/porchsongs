import { useState, useRef, useCallback, useEffect } from 'react';
import { PitchDetector } from 'pitchy';

type TunerStatus = 'idle' | 'listening' | 'error';
type ErrorType =
  | 'permission-denied'
  | 'not-found'
  | 'unsupported'
  | 'insecure-context'
  /** The AudioContext would not start, so the analyser would only read silence. */
  | 'audio-suspended'
  | null;
type TuningStatus = 'intune' | 'close' | 'off' | 'idle';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const A4_FREQ = 440;
const CLARITY_THRESHOLD = 0.95;
const SMOOTHING_SIZE = 3;
const INTUNE_HOLD_MS = 500;
const NOTE_HOLD_MS = 600;

function frequencyToNote(freq: number): { note: string; octave: number; cents: number } {
  const semitones = 12 * Math.log2(freq / A4_FREQ);
  const roundedSemitones = Math.round(semitones);
  const cents = Math.round((semitones - roundedSemitones) * 100);
  const noteIndex = ((roundedSemitones % 12) + 12 + 9) % 12; // A4 = index 9
  const octave = Math.floor((roundedSemitones + 9) / 12) + 4;
  return { note: NOTE_NAMES[noteIndex]!, octave, cents: Math.max(-50, Math.min(50, cents)) };
}

function getTuningStatus(cents: number): TuningStatus {
  const absCents = Math.abs(cents);
  if (absCents < 5) return 'intune';
  if (absCents < 25) return 'close';
  return 'off';
}

interface TunerState {
  status: TunerStatus;
  note: string | null;
  octave: number | null;
  cents: number;
  frequency: number | null;
  tuningStatus: TuningStatus;
  errorType: ErrorType;
}

export default function useTuner() {
  const [state, setState] = useState<TunerState>({
    status: 'idle',
    note: null,
    octave: null,
    cents: 0,
    frequency: null,
    tuningStatus: 'idle',
    errorType: null,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const smoothingBufferRef = useRef<number[]>([]);
  const lastNoteRef = useRef<string | null>(null);
  const lastCentsRef = useRef<number>(0);
  const intuneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockedIntuneRef = useRef(false);
  const noteHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdingNoteRef = useRef(false);
  const cancelledRef = useRef(false);

  const cleanup = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    smoothingBufferRef.current = [];
    lastNoteRef.current = null;
    lastCentsRef.current = 0;
    if (intuneTimerRef.current) {
      clearTimeout(intuneTimerRef.current);
      intuneTimerRef.current = null;
    }
    lockedIntuneRef.current = false;
    if (noteHoldTimerRef.current) {
      clearTimeout(noteHoldTimerRef.current);
      noteHoldTimerRef.current = null;
    }
    holdingNoteRef.current = false;
    cancelledRef.current = true;
  }, []);

  const stop = useCallback(() => {
    cleanup();
    setState({
      status: 'idle',
      note: null,
      octave: null,
      cents: 0,
      frequency: null,
      tuningStatus: 'idle',
      errorType: null,
    });
  }, [cleanup]);

  const start = useCallback(async () => {
    // Microphone requires a secure context (HTTPS or localhost)
    if (!window.isSecureContext) {
      setState(prev => ({ ...prev, status: 'error', errorType: 'insecure-context' }));
      return;
    }

    // Check browser support
    if (!navigator.mediaDevices?.getUserMedia) {
      setState(prev => ({ ...prev, status: 'error', errorType: 'unsupported' }));
      return;
    }

    // Clean up any existing session and reset cancellation flag
    cleanup();
    cancelledRef.current = false;

    // Build and resume the AudioContext BEFORE awaiting getUserMedia.
    //
    // iOS Safari only lets an AudioContext start from inside the user gesture
    // that triggered it, and awaiting the mic leaves that gesture (the await can
    // sit there for as long as the permission sheet is up). A context created on
    // the far side comes back suspended and resume() will not revive it, leaving
    // the analyser reading silence forever: the tuner shows "--" and never
    // moves. That is most visible right after Follow mode has been listening,
    // because the recognizer has just had the audio session and iOS hands back a
    // suspended context rather than a running one.
    //
    // Registering the ref immediately also means a stop() that lands mid-start
    // closes this context instead of orphaning it.
    let audioContext: AudioContext;
    try {
      audioContext = new AudioContext();
    } catch {
      setState(prev => ({ ...prev, status: 'error', errorType: 'unsupported' }));
      return;
    }
    audioContextRef.current = audioContext;
    // Kick the resume off in-gesture; settle it once the mic promise resolves.
    const resuming = audioContext.resume().catch(() => {});

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // If stop() was called while awaiting getUserMedia, discard resources
      if (cancelledRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      mediaStreamRef.current = stream;

      await resuming;
      // stop() can also land while the resume is settling. cleanup() has already
      // closed the context by now, so bail rather than wiring up a dead graph
      // and resurrecting a session the user has closed.
      if (cancelledRef.current) return;

      // A context that never reached 'running' produces an all-zero buffer, so
      // the detect loop would spin and the gauge would sit at "--" forever. Say
      // so instead of pretending to listen; "Try Again" is a genuine user
      // gesture, which is what lets iOS start the context.
      if (audioContext.state !== 'running') {
        cleanup();
        setState(prev => ({ ...prev, status: 'error', errorType: 'audio-suspended' }));
        return;
      }

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      const detector = PitchDetector.forFloat32Array(analyser.fftSize);
      const inputBuffer = new Float32Array(analyser.fftSize);

      setState(prev => ({ ...prev, status: 'listening', errorType: null }));

      const detect = () => {
        if (!analyserRef.current || !audioContextRef.current) return;

        analyserRef.current.getFloatTimeDomainData(inputBuffer);
        const [pitch, clarity] = detector.findPitch(inputBuffer, audioContextRef.current.sampleRate);

        if (clarity >= CLARITY_THRESHOLD && pitch > 20 && pitch < 10000) {
          // Good pitch detected: cancel any pending note-clear
          if (noteHoldTimerRef.current) {
            clearTimeout(noteHoldTimerRef.current);
            noteHoldTimerRef.current = null;
          }
          holdingNoteRef.current = false;

          // Smoothing: average last N readings
          const buffer = smoothingBufferRef.current;
          buffer.push(pitch);
          if (buffer.length > SMOOTHING_SIZE) buffer.shift();
          const avgPitch = buffer.reduce((a, b) => a + b, 0) / buffer.length;

          const { note, octave, cents } = frequencyToNote(avgPitch);

          // State-change guard: skip if note and rounded cents haven't changed
          if (note === lastNoteRef.current && cents === lastCentsRef.current) {
            rafRef.current = requestAnimationFrame(detect);
            return;
          }
          lastNoteRef.current = note;
          lastCentsRef.current = cents;

          // In-tune hold: once in-tune, hold for INTUNE_HOLD_MS
          let tuningStatus = getTuningStatus(cents);
          if (tuningStatus === 'intune') {
            lockedIntuneRef.current = true;
            if (intuneTimerRef.current) clearTimeout(intuneTimerRef.current);
            intuneTimerRef.current = setTimeout(() => {
              lockedIntuneRef.current = false;
            }, INTUNE_HOLD_MS);
          } else if (lockedIntuneRef.current) {
            tuningStatus = 'intune';
          }

          setState(prev => ({
            ...prev,
            note,
            octave,
            cents,
            frequency: Math.round(avgPitch * 10) / 10,
            tuningStatus,
          }));
        } else {
          // Low clarity: hold the last note for NOTE_HOLD_MS before clearing
          smoothingBufferRef.current = [];
          if (lastNoteRef.current !== null && !holdingNoteRef.current) {
            holdingNoteRef.current = true;
            noteHoldTimerRef.current = setTimeout(() => {
              lastNoteRef.current = null;
              lastCentsRef.current = 0;
              lockedIntuneRef.current = false;
              holdingNoteRef.current = false;
              noteHoldTimerRef.current = null;
              setState(prev => ({
                ...prev,
                note: null,
                octave: null,
                cents: 0,
                frequency: null,
                tuningStatus: 'idle',
              }));
            }, NOTE_HOLD_MS);
          }
        }

        rafRef.current = requestAnimationFrame(detect);
      };

      rafRef.current = requestAnimationFrame(detect);
    } catch (err) {
      cleanup();
      let errorType: ErrorType = 'permission-denied';
      if (err instanceof DOMException) {
        if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
          errorType = 'not-found';
        } else if (err.name === 'NotAllowedError') {
          errorType = 'permission-denied';
        }
      }
      setState(prev => ({ ...prev, status: 'error', errorType }));
    }
  }, [cleanup]);

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup]);

  return { ...state, start, stop };
}
