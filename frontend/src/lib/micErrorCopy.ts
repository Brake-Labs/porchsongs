/**
 * Shared user-facing copy for microphone failures.
 *
 * The tuner and Follow mode fail for the same reasons and used to explain them
 * in two places (well in the tuner, not at all in Follow, which printed a raw
 * error slug). One table keeps the wording identical wherever a mic is asked
 * for, so a person who has read "Microphone access needed" once recognizes it.
 */

export interface MicErrorCopy {
  heading: string;
  message: string;
}

export type MicErrorKind =
  | 'permission-denied'
  | 'not-found'
  | 'insecure-context'
  | 'unsupported'
  | 'audio-suspended';

export const MIC_ERROR_COPY: Record<MicErrorKind, MicErrorCopy> = {
  'permission-denied': {
    heading: 'Microphone access needed',
    message: 'Allow microphone access in your browser settings, then try again.',
  },
  'not-found': {
    heading: 'No microphone detected',
    message: 'Connect a microphone and try again.',
  },
  'insecure-context': {
    heading: 'Secure connection required',
    message:
      'Microphone access requires HTTPS or localhost. Try accessing this page via localhost instead.',
  },
  'audio-suspended': {
    heading: 'Audio is paused',
    message:
      'Your browser paused audio, which can happen after voice follow or after the app was in the background. Tap to start listening again.',
  },
  unsupported: {
    heading: 'Browser not supported',
    message: "Your browser doesn't support audio input. Try Chrome or Firefox.",
  },
};

export const UNKNOWN_MIC_ERROR_COPY: MicErrorCopy = {
  heading: 'Something went wrong',
  message: 'An unexpected error occurred.',
};

/** Copy for an error slug, falling back to the generic message. */
export function micErrorCopy(kind: string | null | undefined): MicErrorCopy {
  return MIC_ERROR_COPY[kind as MicErrorKind] ?? UNKNOWN_MIC_ERROR_COPY;
}
