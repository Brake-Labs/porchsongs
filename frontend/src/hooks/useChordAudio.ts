import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Strum a chord through Web Audio.
 *
 * Synthesised rather than sampled: a set of samples good enough to be worth
 * hearing is megabytes per instrument, and this page already ships four of them.
 * A plucked-string envelope over a few harmonics is not a real guitar, but it
 * answers the question the button is actually asking, which is "did I read that
 * shape right?".
 *
 * Notes are staggered rather than struck together. A block chord sounds like an
 * organ and hides wrong notes in the middle of the voicing; a strum lets you
 * hear each string arrive, which is the point.
 */

/** Gap between successive strings, in seconds. Roughly a medium downstroke. */
const STRUM_GAP = 0.035;
/** How long a string rings. */
const DECAY = 1.9;
/** Master level. Low: several harmonics across six strings add up fast. */
const MASTER_GAIN = 0.14;

/**
 * Relative level of each harmonic above the fundamental.
 *
 * A plain sine sounds like a test tone and a sawtooth sounds like a buzzer.
 * A fundamental plus a quiet second and third partial is enough to read as a
 * plucked string without needing a filter chain.
 */
const PARTIALS = [
  { ratio: 1, gain: 1 },
  { ratio: 2, gain: 0.35 },
  { ratio: 3, gain: 0.12 },
];

function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

type AudioContextConstructor = typeof AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export interface ChordAudio {
  /** Strum the given MIDI notes, low to high. No-op where audio is unavailable. */
  play: (notes: number[]) => void;
  /** Cut anything currently ringing. */
  stop: () => void;
  /** False in jsdom, in old browsers, and anywhere Web Audio is blocked. */
  supported: boolean;
  /** True while a strum is still ringing, for the button's pressed state. */
  playing: boolean;
}

export default function useChordAudio(): ChordAudio {
  const contextRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [supported] = useState(() => getAudioContextConstructor() !== null);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const context = contextRef.current;
    const master = masterRef.current;
    if (context && master) {
      // Ramp rather than disconnect: cutting a ringing oscillator dead produces
      // a click loud enough to be worse than the note.
      const now = context.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + 0.03);
      masterRef.current = null;
    }
    setPlaying(false);
  }, []);

  const play = useCallback(
    (notes: number[]) => {
      const Ctor = getAudioContextConstructor();
      if (!Ctor || notes.length === 0) return;

      stop();

      // Created on the first strum, not on mount: browsers start a context made
      // outside a user gesture in "suspended", and Safari keeps it that way.
      if (!contextRef.current) contextRef.current = new Ctor();
      const context = contextRef.current;
      void context.resume();

      const master = context.createGain();
      master.gain.setValueAtTime(MASTER_GAIN, context.currentTime);
      master.connect(context.destination);
      masterRef.current = master;

      const start = context.currentTime + 0.02;
      notes.forEach((midi, index) => {
        const at = start + index * STRUM_GAP;
        const frequency = midiToFrequency(midi);

        for (const partial of PARTIALS) {
          const oscillator = context.createOscillator();
          const envelope = context.createGain();
          oscillator.type = 'triangle';
          oscillator.frequency.setValueAtTime(frequency * partial.ratio, at);

          // Fast attack, exponential decay: a pluck. The floor is not zero
          // because exponentialRampToValueAtTime refuses to reach it.
          envelope.gain.setValueAtTime(0, at);
          envelope.gain.linearRampToValueAtTime(partial.gain, at + 0.008);
          envelope.gain.exponentialRampToValueAtTime(0.0001, at + DECAY);

          oscillator.connect(envelope);
          envelope.connect(master);
          oscillator.start(at);
          oscillator.stop(at + DECAY);
        }
      });

      setPlaying(true);
      const total = (notes.length - 1) * STRUM_GAP + DECAY;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setPlaying(false);
      }, total * 1000);
    },
    [stop],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      void contextRef.current?.close();
      contextRef.current = null;
    };
  }, []);

  return { play, stop, supported, playing };
}
