import { requestDisambiguation } from './followArbiter';

function okResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

describe('requestDisambiguation', () => {
  it('posts snake_case payload and returns the chosen stateIndex', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ choice: 20 }));
    const choice = await requestDisambiguation(
      {
        recentWords: 'saints go marching in',
        candidates: [
          { stateIndex: 20, context: 'a' },
          { stateIndex: 60, context: 'b' },
        ],
        currentStateIndex: 18,
        model: 'fast-model',
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(choice).toBe(20);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('/api/follow/disambiguate');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      recent_words: 'saints go marching in',
      candidates: [
        { index: 20, context: 'a' },
        { index: 60, context: 'b' },
      ],
      current_index: 18,
      model: 'fast-model',
    });
  });

  it('returns null on a non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as Response);
    const choice = await requestDisambiguation(
      { recentWords: '', candidates: [], currentStateIndex: null, model: 'm' },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(choice).toBeNull();
  });

  it('returns null when the request throws (timeout/network)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('aborted'));
    const choice = await requestDisambiguation(
      { recentWords: '', candidates: [], currentStateIndex: null, model: 'm' },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(choice).toBeNull();
  });

  it('returns null when the model is unsure (choice null)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ choice: null }));
    const choice = await requestDisambiguation(
      { recentWords: '', candidates: [], currentStateIndex: null, model: 'm' },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(choice).toBeNull();
  });
});
