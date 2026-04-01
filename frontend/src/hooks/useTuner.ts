import { useState, useRef, useCallback, useEffect } from 'react';
import { PitchDetector } from 'pitchy';

type TunerStatus = 'idle' | 'listening' | 'error';
type ErrorType = 'permission-denied' | 'not-found' | 'unsupported' | 'insecure-context' | null;
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

    // Clean up any existing session
    cleanup();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

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
