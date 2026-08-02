/**
 * "Is Follow mode actually working?" (pure, no DOM, no timers).
 *
 * Follow can fail in ways that look identical from the outside: the toggle goes
 * green, the dot pulses, and the chart never moves. That was the whole of issue
 * #273, reported from an older iPad. The failures have genuinely different
 * causes and genuinely different fixes, so they get genuinely different
 * messages:
 *
 *   unsupported / insecure-context   this browser cannot do it at all
 *   permission-denied / not-found    the recognizer told us why it stopped
 *   no-audio                         we started, but capture never began
 *   no-transcript                    sound is reaching it, no words come out
 *   no-words                         listening, nothing recognized, cause unknown
 *   no-match                         words arrive, none of them fit this chart
 *
 * Two deliberate biases, because a warning that fires wrongly is worse than no
 * warning at all:
 *
 * 1. We only claim a cause we have positive evidence for. Distinguishing "no
 *    audio reached the recognizer" from "audio reached it but produced no
 *    words" needs the capture ladder (see SignalStage). When an engine reports
 *    'sound' we say so; when it reports nothing we fall back to 'no-words',
 *    which describes the symptom and does not guess between the two. We do NOT
 *    open a second getUserMedia stream to measure input level: on the very iOS
 *    devices this targets, a competing capture is as likely to cause the
 *    silence as to explain it.
 * 2. Every warning clears the moment its condition resolves, so a performer who
 *    is simply quiet for a while sees a message disappear rather than an error
 *    they have to dismiss.
 */

import type { FollowEstimate } from './followAlign';
import type { SignalError, SignalStage } from './followSignal';
import { micErrorCopy } from './micErrorCopy';

export type FollowWarningKind =
  | 'unsupported'
  | 'insecure-context'
  | 'permission-denied'
  | 'not-found'
  | 'network'
  | 'aborted'
  | 'no-audio'
  | 'no-transcript'
  | 'no-words'
  | 'no-match';

export interface FollowWarning {
  kind: FollowWarningKind;
  heading: string;
  message: string;
  /** True when Follow cannot work until the person changes something. */
  fatal: boolean;
}

export interface FollowHealthThresholds {
  /** No capture reported this long after start: the mic never opened. */
  audioMs: number;
  /** Capturing this long with nothing recognized: it is not producing words. */
  wordsMs: number;
  /** Words for this long without ever fitting the chart: wrong chart or noise. */
  matchMs: number;
}

/**
 * Generous by design. Capture normally starts within a few hundred ms, so 5s of
 * nothing is a real failure rather than a slow device. The word and match
 * windows are long enough to sit through an intro riff or a count-in.
 */
export const DEFAULT_FOLLOW_HEALTH: FollowHealthThresholds = {
  audioMs: 5000,
  wordsMs: 12000,
  matchMs: 15000,
};

/**
 * Minimum confidence in an unambiguous estimate before the play view commits to
 * highlighting and scrolling it. Shared with the health check so "we warned that
 * nothing matches" can never contradict a chart that is visibly following along.
 */
export const COMMIT_CONFIDENCE = 0.3;

/** Whether an estimate is solid enough for the play view to move the highlight. */
export function isCommittableEstimate(est: FollowEstimate | null): boolean {
  return (
    !!est &&
    est.renderIndex != null &&
    est.status !== 'disabled' &&
    !est.ambiguous &&
    est.confidence >= COMMIT_CONFIDENCE
  );
}

/**
 * Minimum share of the claimed line's words that must actually have been heard
 * before we count it as Follow working. Measured against the tracker: unrelated
 * speech scores 0.00, badly misheard singing still scores about 0.30, and clean
 * recognition scores 0.55 and up. Sitting near the bottom of that gap keeps the
 * "not matching" warning off the backs of people whose recognizer is merely
 * sloppy, while still catching a recognizer emitting nothing relevant.
 */
export const MATCH_SUPPORT = 0.15;

/**
 * Whether an estimate reflects words we genuinely heard in that line.
 *
 * Confidence alone is not enough and this is the subtle part: given a stream of
 * words that match nothing, the transition prior alone drifts belief to the end
 * of the song and reports `locked` at 0.59 confidence. Judging "Follow works"
 * by confidence would therefore call the exact failure in issue #273 a success.
 */
export function isMatchedEstimate(est: FollowEstimate | null): boolean {
  return isCommittableEstimate(est) && (est?.support ?? 0) >= MATCH_SUPPORT;
}

export interface FollowHealthSnapshot {
  /** When the signal was started, or null when Follow is off. */
  startedAt: number | null;
  /** A terminal error the signal reported, if any. */
  error: SignalError | null;
  /** Highest capture milestone the signal reported this session. */
  stage: SignalStage | null;
  /** When capture was first reported, or null if it never was. */
  audioAt: number | null;
  /** When the first words arrived, or null if none have. */
  firstWordsAt: number | null;
  /** Whether the tracker has ever committed to a position this session. */
  matched: boolean;
  now: number;
}

const WARNINGS: Record<Exclude<FollowWarningKind, 'permission-denied' | 'not-found' | 'insecure-context'>, Omit<FollowWarning, 'kind'>> = {
  unsupported: {
    // Not the tuner's "doesn't support audio input": the tuner needs a mic,
    // Follow needs speech recognition, and plenty of browsers have one without
    // the other. Naming the wrong capability sends people on a wrong hunt.
    heading: 'Voice follow not supported',
    message:
      'This browser cannot recognize speech, so Follow mode cannot hear you. Try Chrome or Edge, or scroll the chart by hand.',
    fatal: true,
  },
  network: {
    heading: 'Speech service unreachable',
    message:
      'This browser sends audio to an online service to recognize it, and it cannot be reached. Check your connection, then tap Follow again.',
    fatal: true,
  },
  aborted: {
    heading: 'Follow mode stopped',
    message: 'Voice follow stopped unexpectedly. Tap Follow to start it again.',
    fatal: true,
  },
  'no-audio': {
    heading: 'Not getting any audio',
    message:
      'Follow mode started but your browser never opened the microphone. Close anything else that is using it, then tap Follow again.',
    fatal: false,
  },
  'no-transcript': {
    heading: 'Hearing you, not recognizing words',
    message:
      'Sound is reaching the microphone but your browser is not turning it into words. On an iPad or iPhone, check that Dictation is turned on in Settings, under General, then Keyboard.',
    fatal: false,
  },
  'no-words': {
    heading: 'Not picking up any words',
    message:
      'Follow mode is listening but has not recognized anything yet. Try singing closer to the device. If nothing happens, this browser may not support voice follow well.',
    fatal: false,
  },
  'no-match': {
    heading: 'Not matching this chart',
    message:
      'Follow mode can hear you, but the words do not match this chart. Check you opened the right one, or scroll to your place and tap Resume follow.',
    fatal: false,
  },
};

/** Warning for a signal error, reusing the tuner's wording where it applies. */
function warningForError(error: SignalError): FollowWarning {
  switch (error.type) {
    case 'permission-denied':
    case 'not-found':
    case 'insecure-context': {
      const copy = micErrorCopy(error.type);
      return { kind: error.type, heading: copy.heading, message: copy.message, fatal: true };
    }
    case 'unsupported':
      return { kind: 'unsupported', ...WARNINGS.unsupported };
    case 'network':
      return { kind: 'network', ...WARNINGS.network };
    default:
      return { kind: 'aborted', ...WARNINGS.aborted };
  }
}

/**
 * The current reason to warn, or null when Follow looks healthy. Pure: the
 * caller owns the clock and the timers, so every branch here is directly
 * testable without waiting on real time.
 */
export function assessFollowHealth(
  s: FollowHealthSnapshot,
  t: FollowHealthThresholds = DEFAULT_FOLLOW_HEALTH,
): FollowWarning | null {
  // A reported error always wins: it names the cause better than any timeout.
  if (s.error) return warningForError(s.error);
  if (s.startedAt == null) return null;

  if (s.firstWordsAt == null) {
    // Capture never started. Nothing the performer does changes this, so it is
    // safe to call after a short wait.
    if (s.audioAt == null) {
      return s.now - s.startedAt >= t.audioMs ? { kind: 'no-audio', ...WARNINGS['no-audio'] } : null;
    }
    if (s.now - s.audioAt < t.wordsMs) return null;
    // Capture is running. Only claim "we hear you" when the engine said so.
    return s.stage === 'sound' || s.stage === 'speech'
      ? { kind: 'no-transcript', ...WARNINGS['no-transcript'] }
      : { kind: 'no-words', ...WARNINGS['no-words'] };
  }

  // Words are flowing. Once anything has ever matched we stay quiet for the
  // rest of the session: an instrumental break is not a malfunction.
  if (!s.matched && s.now - s.firstWordsAt >= t.matchMs) {
    return { kind: 'no-match', ...WARNINGS['no-match'] };
  }
  return null;
}

/**
 * The next instant at which `assessFollowHealth` could return something new, or
 * null when only an incoming event can change it. Lets the caller arm exactly
 * one timer per stage instead of polling.
 */
export function nextHealthDeadline(
  s: FollowHealthSnapshot,
  t: FollowHealthThresholds = DEFAULT_FOLLOW_HEALTH,
): number | null {
  if (s.error || s.startedAt == null) return null;
  if (s.firstWordsAt == null) {
    return s.audioAt == null ? s.startedAt + t.audioMs : s.audioAt + t.wordsMs;
  }
  return s.matched ? null : s.firstWordsAt + t.matchMs;
}
