/**
 * Client for the Follow-mode LLM arbiter (POST /api/follow/disambiguate).
 *
 * The local position tracker calls this only at genuinely ambiguous moments
 * (e.g. a chorus line identical across verses). It is best-effort and
 * non-blocking: any failure, timeout, or "unsure" answer resolves to null and
 * the caller simply stays on its local best guess. Text only; no audio.
 */

export interface ArbiterCandidate {
  /** The tracker state index this candidate refers to (round-trips as the id). */
  stateIndex: number;
  /** A few lines of lyric context around the candidate for the model to judge. */
  context: string;
}

export interface ArbiterRequest {
  recentWords: string;
  candidates: ArbiterCandidate[];
  currentStateIndex: number | null;
  model: string;
}

export interface ArbiterOptions {
  timeoutMs?: number;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Ask the backend which candidate state the singer is on. Returns the chosen
 * `stateIndex`, or null when the model is unsure / the call fails / times out.
 */
export async function requestDisambiguation(
  req: ArbiterRequest,
  opts: ArbiterOptions = {},
): Promise<number | null> {
  const timeoutMs = opts.timeoutMs ?? 2500;
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch('/api/follow/disambiguate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      signal: controller.signal,
      body: JSON.stringify({
        recent_words: req.recentWords,
        candidates: req.candidates.map((c) => ({ index: c.stateIndex, context: c.context })),
        current_index: req.currentStateIndex,
        model: req.model,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choice?: number | null };
    return typeof data.choice === 'number' ? data.choice : null;
  } catch {
    // Abort/timeout/network/parse error: fall back to the local estimate.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
