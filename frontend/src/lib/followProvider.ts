/**
 * Provider selection for Follow mode's recognizer.
 *
 * This is a capability + POLICY decision, deliberately not "is the API present."
 * Safari exposes `webkitSpeechRecognition`, but Apple's Web Speech routes audio
 * to Apple's servers, and Safari is a primary target for the on-device path.
 * Selecting Web Speech merely because the symbol exists would (a) silently send
 * the singer's mic to a third party and (b) mean Safari never gets the private
 * on-device recognizer. So Web Speech is chosen only for Chromium (Chrome/Edge),
 * where it is the fast default; everyone else gets the on-device whisper signal
 * when the hardware can run it, else a clear unsupported state.
 *
 * Pure and DOM-free: `detectCapabilities` reads the environment, `pickProvider`
 * decides. Both are trivially unit-testable with a fake window.
 */

export type FollowProvider = 'web-speech' | 'whisper' | 'none';

export interface RecognizerCapabilities {
  secureContext: boolean;
  /** SpeechRecognition / webkitSpeechRecognition present. */
  webSpeech: boolean;
  /** Chromium-family UA (Chrome or Edge), where Web Speech is the fast path. */
  chromium: boolean;
  /** navigator.gpu present (WebGPU) — the viable on-device inference path. */
  webgpu: boolean;
  /** Cross-origin isolated (SharedArrayBuffer / WASM threads available). */
  crossOriginIsolated: boolean;
}

export interface ProviderChoice {
  provider: FollowProvider;
  /** True when the chosen provider must download a model before first use. */
  needsModelDownload: boolean;
  /** Machine-readable reason, useful for the unsupported message + debugging. */
  reason:
    | 'chromium-web-speech'
    | 'on-device-webgpu'
    | 'insecure-context'
    | 'no-recognizer';
}

type WindowLike = {
  isSecureContext?: boolean;
  crossOriginIsolated?: boolean;
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
  navigator?: { gpu?: unknown; userAgent?: string };
};

/** Heuristic Chromium (Chrome/Edge) detection from the UA string. */
export function isChromiumUA(ua: string): boolean {
  // Edge (Edg/), Chrome (Chrome/). Exclude nothing else here; Safari's UA
  // contains "Safari" but not "Chrome"/"Edg", so it correctly returns false.
  return /\bEdg\//.test(ua) || (/\bChrome\//.test(ua) && !/\bOPR\//.test(ua));
}

export function detectCapabilities(win: WindowLike = window): RecognizerCapabilities {
  const nav = win.navigator ?? {};
  const ua = nav.userAgent ?? '';
  return {
    secureContext: win.isSecureContext !== false,
    webSpeech: 'SpeechRecognition' in win || 'webkitSpeechRecognition' in win,
    chromium: isChromiumUA(ua),
    webgpu: !!nav.gpu,
    crossOriginIsolated: win.crossOriginIsolated === true,
  };
}

export function pickProvider(caps: RecognizerCapabilities): ProviderChoice {
  if (!caps.secureContext) {
    return { provider: 'none', needsModelDownload: false, reason: 'insecure-context' };
  }
  // Chrome/Edge: Web Speech is instant and needs no download. Keep it the
  // default there (its third-party routing is the pre-existing status quo).
  if (caps.chromium && caps.webSpeech) {
    return { provider: 'web-speech', needsModelDownload: false, reason: 'chromium-web-speech' };
  }
  // Everyone else (Safari, Firefox): run the model on-device if the hardware
  // can. WebGPU is the viable path; it needs no cross-origin isolation.
  if (caps.webgpu) {
    return { provider: 'whisper', needsModelDownload: true, reason: 'on-device-webgpu' };
  }
  return { provider: 'none', needsModelDownload: false, reason: 'no-recognizer' };
}

/** Convenience: detect + pick in one call against the live environment. */
export function chooseProvider(win: WindowLike = window): ProviderChoice {
  return pickProvider(detectCapabilities(win));
}
