import {
  assessFollowHealth,
  isCommittableEstimate,
  isMatchedEstimate,
  nextHealthDeadline,
  COMMIT_CONFIDENCE,
  DEFAULT_FOLLOW_HEALTH,
  MATCH_SUPPORT,
  type FollowHealthSnapshot,
} from './followHealth';
import { createFollowTracker } from './followAlign';
import { MIC_ERROR_COPY } from './micErrorCopy';
import type { FollowEstimate } from './followAlign';

const { audioMs, wordsMs, matchMs } = DEFAULT_FOLLOW_HEALTH;

function snapshot(over: Partial<FollowHealthSnapshot> = {}): FollowHealthSnapshot {
  return {
    startedAt: 0,
    error: null,
    stage: null,
    audioAt: null,
    firstWordsAt: null,
    matched: false,
    now: 0,
    ...over,
  };
}

function estimate(over: Partial<FollowEstimate> = {}): FollowEstimate {
  return {
    status: 'locked',
    renderIndex: 3,
    stateIndex: 1,
    confidence: 0.8,
    regionConfidence: 0.85,
    ambiguous: false,
    support: 0.6,
    origin: 'audio',
    top: [],
    ...over,
  };
}

describe('assessFollowHealth', () => {
  it('says nothing while Follow is off', () => {
    expect(assessFollowHealth(snapshot({ startedAt: null, now: 999999 }))).toBeNull();
  });

  it('stays quiet during the grace period before any milestone', () => {
    expect(assessFollowHealth(snapshot({ now: audioMs - 1 }))).toBeNull();
  });

  it('warns that capture never began when no audio milestone arrives', () => {
    const w = assessFollowHealth(snapshot({ now: audioMs }));
    expect(w?.kind).toBe('no-audio');
    expect(w?.heading).toBe('Not getting any audio');
  });

  it('clears the no-audio warning once capture is reported', () => {
    const s = snapshot({ stage: 'audio', audioAt: audioMs, now: audioMs + 10 });
    expect(assessFollowHealth(s)).toBeNull();
  });

  it('stays quiet when capture is running but no words have arrived', () => {
    // Silence is not a symptom. An intro, a solo, a count-in and a device that
    // cannot recognize speech all look identical from here, so warning means
    // telling performers Follow is broken every time they play an intro.
    const quiet = snapshot({ stage: 'audio', audioAt: 0, now: wordsMs });
    expect(assessFollowHealth(quiet)).toBeNull();
    // Still quiet much later: this is not a threshold that was merely raised.
    expect(assessFollowHealth(snapshot({ stage: 'audio', audioAt: 0, now: wordsMs * 20 }))).toBeNull();
  });

  it('warns only when the engine confirmed sound arrived and produced no words', () => {
    // The one case where silence IS evidence of a fault rather than of an
    // instrumental passage, because the recognizer said it heard something.
    const noisy = snapshot({ stage: 'sound', audioAt: 0, now: wordsMs });
    expect(assessFollowHealth(noisy)?.kind).toBe('no-transcript');
    expect(assessFollowHealth(snapshot({ stage: 'speech', audioAt: 0, now: wordsMs }))?.kind).toBe(
      'no-transcript',
    );
  });

  it('never claims silence once words have arrived, even with no audio milestone', () => {
    // An engine that skips the capture ladder but produces words is healthy.
    const s = snapshot({ audioAt: null, firstWordsAt: 100, now: 100 + wordsMs });
    expect(assessFollowHealth(s)).toBeNull();
  });

  it('warns that words do not match the chart, and only after a long look', () => {
    expect(assessFollowHealth(snapshot({ firstWordsAt: 0, now: matchMs - 1 }))).toBeNull();
    const w = assessFollowHealth(snapshot({ firstWordsAt: 0, now: matchMs }));
    expect(w?.kind).toBe('no-match');
    expect(w?.fatal).toBe(false);
  });

  it('stays quiet forever once something has matched, so a solo is not a fault', () => {
    const s = snapshot({ firstWordsAt: 0, matched: true, now: matchMs * 10 });
    expect(assessFollowHealth(s)).toBeNull();
  });

  it('reuses the tuner wording for shared microphone failures', () => {
    for (const kind of ['permission-denied', 'not-found', 'insecure-context'] as const) {
      const w = assessFollowHealth(snapshot({ error: { type: kind } }));
      expect(w?.kind).toBe(kind);
      expect(w?.heading).toBe(MIC_ERROR_COPY[kind].heading);
      expect(w?.message).toBe(MIC_ERROR_COPY[kind].message);
      expect(w?.fatal).toBe(true);
    }
  });

  it('describes an unsupported browser in terms of speech, not audio input', () => {
    const w = assessFollowHealth(snapshot({ error: { type: 'unsupported' } }));
    expect(w?.kind).toBe('unsupported');
    // The tuner's "doesn't support audio input" would send people hunting for
    // the wrong thing: Follow needs speech recognition, not just a microphone.
    expect(w?.message).not.toBe(MIC_ERROR_COPY.unsupported.message);
    expect(w?.message).toContain('recognize speech');
  });

  it('maps the remaining signal errors', () => {
    expect(assessFollowHealth(snapshot({ error: { type: 'network' } }))?.kind).toBe('network');
    expect(assessFollowHealth(snapshot({ error: { type: 'aborted' } }))?.kind).toBe('aborted');
  });

  it('lets a reported error outrank a pending timeout', () => {
    const s = snapshot({ error: { type: 'permission-denied' }, now: audioMs * 10 });
    expect(assessFollowHealth(s)?.kind).toBe('permission-denied');
  });
});

describe('nextHealthDeadline', () => {
  it('arms one deadline per stage and stops when nothing can change', () => {
    expect(nextHealthDeadline(snapshot({ startedAt: 500 }))).toBe(500 + audioMs);
    expect(nextHealthDeadline(snapshot({ audioAt: 800 }))).toBe(800 + wordsMs);
    expect(nextHealthDeadline(snapshot({ firstWordsAt: 900 }))).toBe(900 + matchMs);
    expect(nextHealthDeadline(snapshot({ firstWordsAt: 900, matched: true }))).toBeNull();
    expect(nextHealthDeadline(snapshot({ error: { type: 'network' } }))).toBeNull();
    expect(nextHealthDeadline(snapshot({ startedAt: null }))).toBeNull();
  });
});

describe('isCommittableEstimate', () => {
  it('accepts a confident unambiguous estimate', () => {
    expect(isCommittableEstimate(estimate())).toBe(true);
  });

  it('reads the region, not the top line, so a split repeat still commits', () => {
    // Two adjacent lines that both fit share the mass. The place is known; only the
    // exact line is not, and either one puts the right text on screen.
    expect(isCommittableEstimate(estimate({ confidence: 0.28, regionConfidence: 0.55 }))).toBe(
      true,
    );
  });

  it('rejects null, disabled, ambiguous, and low-confidence estimates', () => {
    expect(isCommittableEstimate(null)).toBe(false);
    expect(isCommittableEstimate(estimate({ status: 'disabled', renderIndex: null }))).toBe(false);
    expect(isCommittableEstimate(estimate({ ambiguous: true }))).toBe(false);
    expect(isCommittableEstimate(estimate({ regionConfidence: 0.29 }))).toBe(false);
  });
});

describe('isMatchedEstimate', () => {
  const SONG = [
    '[Verse 1]',
    'C            G',
    'walking down the empty road',
    'Am           F',
    'thinking of the words you said',
    '',
    '[Chorus]',
    'C        G',
    'hold me now under the northern light',
  ].join('\n');

  it('rejects a confident estimate that no heard word supports', () => {
    expect(isMatchedEstimate(estimate({ support: 0 }))).toBe(false);
    expect(isCommittableEstimate(estimate({ support: 0 }))).toBe(true);
  });

  /**
   * The trap this whole check exists for. Feed the tracker words that match
   * nothing and it does not stay unsure: the transition prior drifts belief to
   * the end of the song and reports a confident lock, which would otherwise
   * read as "Follow is working" during precisely the failure we are warning
   * about.
   */
  it('is not fooled by the confident lock the tracker drifts into on nonsense', () => {
    const tracker = createFollowTracker(SONG);
    tracker.collapseTo(0, 0);
    let last = tracker.observe([], 0);
    for (let i = 0; i < 12; i++) {
      last = tracker.observe(['zebra', 'quantum', 'sprocket'], i * 1250);
    }
    expect(last.status).toBe('locked');
    expect(last.confidence).toBeGreaterThan(COMMIT_CONFIDENCE);
    expect(isCommittableEstimate(last)).toBe(true);
    expect(last.support).toBe(0);
    expect(isMatchedEstimate(last)).toBe(false);
  });

  it('accepts real singing, including sloppy recognition', () => {
    const tracker = createFollowTracker(SONG);
    tracker.collapseTo(0, 0);
    // Two words wrong out of five: what a recognizer does to a sung line.
    const est = tracker.observe(['walking', 'down', 'the', 'entry', 'rode'], 0);
    expect(est.support).toBeGreaterThan(MATCH_SUPPORT);
    expect(isMatchedEstimate(est)).toBe(true);
  });
});

describe('support survives sparse recognition on wordy lines', () => {
  it('does not brand a correctly-following chart as "not matching"', () => {
    // The reviewer's reproduction. A degraded recognizer returns a couple of
    // correct words per line; the tracker locks on the RIGHT line and the chart
    // scrolls correctly. A recall-shaped support divided by the line's own
    // length scored ~0.08 here and fired "Not matching this chart" over a chart
    // that was following perfectly, in exactly the degraded regime this feature
    // targets.
    const SONG = [
      'I woke to find the morning cold and grey across the empty water',
      'She packed the letters in a box and left them by the doorway',
      'And nothing that we carried out was heavier than silence',
    ].join('\n');
    const t = createFollowTracker(SONG);

    let now = 0;
    const est = [
      ['cold', 'water'],
      ['packed', 'letters'],
      ['nothing', 'carried'],
    ].map(words => t.observe(words, (now += 1000)))[2]!;

    expect(isCommittableEstimate(est)).toBe(true);
    // The words heard genuinely belong to the claimed line, so support is high.
    expect(est.support).toBeGreaterThan(MATCH_SUPPORT);
    expect(isMatchedEstimate(est)).toBe(true);
  });

  it('still scores unrelated speech at zero', () => {
    // The property the metric exists for must survive the change from recall to
    // precision, or drift on noise stops being detectable.
    const t = createFollowTracker('Amazing grace how sweet the sound\nThat saved a wretch like me');
    let now = 0;
    const est = [
      ['pizza', 'delivery'],
      ['airport', 'concrete'],
      ['satellite', 'umbrella'],
    ].map(w => t.observe(w, (now += 1000)))[2]!;

    expect(est.support).toBe(0);
    expect(isMatchedEstimate(est)).toBe(false);
  });
});
