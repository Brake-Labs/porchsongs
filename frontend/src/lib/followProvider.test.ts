import { describe, it, expect } from 'vitest';
import { detectCapabilities, pickProvider, isChromiumUA, chooseProvider } from './followProvider';

const UA = {
  chrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  edge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  safariIOS:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',
};

function win(over: Record<string, unknown>): Parameters<typeof detectCapabilities>[0] {
  return {
    isSecureContext: true,
    crossOriginIsolated: false,
    navigator: { userAgent: '' },
    ...over,
  };
}

describe('isChromiumUA', () => {
  it('matches Chrome and Edge, not Safari or Firefox', () => {
    expect(isChromiumUA(UA.chrome)).toBe(true);
    expect(isChromiumUA(UA.edge)).toBe(true);
    expect(isChromiumUA(UA.safariMac)).toBe(false);
    expect(isChromiumUA(UA.safariIOS)).toBe(false);
    expect(isChromiumUA(UA.firefox)).toBe(false);
  });
});

describe('pickProvider — policy, not just capability', () => {
  it('Chrome with Web Speech -> web-speech, no download', () => {
    const caps = detectCapabilities(win({ webkitSpeechRecognition: class {}, navigator: { userAgent: UA.chrome } }));
    expect(pickProvider(caps)).toEqual({ provider: 'web-speech', needsModelDownload: false, reason: 'chromium-web-speech' });
  });

  it('Safari has webkitSpeechRecognition but is NOT chromium -> on-device whisper (never Apple cloud)', () => {
    // The core bug the review caught: "else whisper" must fire on Safari.
    const caps = detectCapabilities(
      win({ webkitSpeechRecognition: class {}, navigator: { userAgent: UA.safariIOS, gpu: {} } }),
    );
    const choice = pickProvider(caps);
    expect(choice.provider).toBe('whisper');
    expect(choice.needsModelDownload).toBe(true);
  });

  it('Firefox with WebGPU -> whisper', () => {
    const caps = detectCapabilities(win({ navigator: { userAgent: UA.firefox, gpu: {} } }));
    expect(pickProvider(caps).provider).toBe('whisper');
  });

  it('Safari without WebGPU (older iOS) -> none', () => {
    const caps = detectCapabilities(win({ webkitSpeechRecognition: class {}, navigator: { userAgent: UA.safariMac } }));
    expect(pickProvider(caps)).toMatchObject({ provider: 'none', reason: 'no-recognizer' });
  });

  it('insecure context -> none', () => {
    const caps = detectCapabilities(win({ isSecureContext: false, navigator: { userAgent: UA.chrome } }));
    expect(pickProvider(caps)).toMatchObject({ provider: 'none', reason: 'insecure-context' });
  });
});

describe('chooseProvider', () => {
  it('detects + picks in one call', () => {
    const choice = chooseProvider(win({ navigator: { userAgent: UA.firefox, gpu: {} } }));
    expect(choice.provider).toBe('whisper');
  });
});
