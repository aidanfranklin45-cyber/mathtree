import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateJsonDetailed, modelPool, orderModels, resetCooldowns } from '@engine/aiGateway';

const ENV: Record<string, string> = {
  AI_GATEWAY_URL: 'https://gateway.ai.cloudflare.com/v1/acct',
  AI_GATEWAY_ID: 'gw',
  CF_AIG_TOKEN: 'tok',
  AI_MODELS: 'm-one, m-two ,m-three,m-four,m-five',
  AI_MODEL_ORDER: 'listed',
};

const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
const fail = (status: number, message = 'busy') => new Response(JSON.stringify({ error: { message } }), { status });

describe('the model pool', () => {
  let calls: string[];
  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    resetCooldowns();
    (globalThis as any).Deno = { env: { get: (k: string) => ENV[k] } };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (globalThis as any).Deno;
    ENV.AI_MODELS = 'm-one, m-two ,m-three,m-four,m-five';
    ENV.AI_MODEL_ORDER = 'listed';
  });

  const script = (...replies: Array<() => Response>) => {
    let i = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); return replies[Math.min(i++, replies.length - 1)](); }));
  };
  const run = async () => {
    const settled = generateJsonDetailed({ system: 's', user: 'u' }).then((v) => ({ v }), (e) => ({ e }));
    await vi.advanceTimersByTimeAsync(30_000);
    return settled;
  };
  const model = (url: string) => /models\/([^:]+):/.exec(url)?.[1];

  it('reads the allowed models from AI_MODELS, trimmed and without repeats', () => {
    ENV.AI_MODELS = ' a, b ,a,,c ';
    expect(modelPool()).toEqual(['a', 'b', 'c']);
  });

  it('shuffles the pool so one model does not carry the load', () => {
    ENV.AI_MODEL_ORDER = 'random';
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(orderModels(['a', 'b', 'c'], { random: Math.random })[0]);
    expect(seen.size).toBe(3);
  });

  it('moves on at once when a model is out of quota: one request per model, no waiting, no repeats', async () => {
    script(() => fail(429, 'quota exceeded'), () => fail(429, 'quota exceeded'), () => ok('{"a":1}'));
    expect(await run()).toEqual({ v: { text: '{"a":1}', model: 'm-three' } });
    expect(calls.map(model)).toEqual(['m-one', 'm-two', 'm-three']);
  });

  it('leaves a model that just ran out alone on the next call', async () => {
    script(() => fail(429, 'quota exceeded'), () => ok('{"a":1}'), () => ok('{"b":2}'));
    await run();
    calls.length = 0;
    await run();
    expect(model(calls[0])).not.toBe('m-one');
  });

  it('stops after four models and says why', async () => {
    script(() => fail(503));
    const r: any = await run();
    expect(r.e.message).toContain('503'); // the detail stays in the error, for the logs
    expect(r.e.busy).toBe(true); // and the owner is told it is demand, in one calm sentence
    expect(calls).toHaveLength(4); // never the whole pool: a free tier counts every request
  });

  it('calls a service that cannot be reached busy as well, and a setup problem not', async () => {
    script(() => { throw new TypeError('network down'); });
    const down: any = await run();
    expect(down.e.busy).toBe(true);
    script(() => fail(401, 'bad token'));
    const setup: any = await run();
    expect(setup.e.busy).toBe(false);
  });

  it('words the busy message for the owner, with no gateway, model or status in it', async () => {
    const { BUSY_MESSAGE } = await import('@engine/aiGateway');
    expect(BUSY_MESSAGE).toBe('Due to high demand the parser is currently unavailable. Please try again later.');
    expect(BUSY_MESSAGE).not.toMatch(/gateway|gemini|\d{3}/i);
  });

  it('does not try other models for a setup problem (billing, credentials)', async () => {
    script(() => fail(402, 'credits depleted'));
    const r: any = await run();
    expect(r.e.message).toContain('credits depleted');
    expect(calls).toHaveLength(1);
  });

  it('skips a model name the service does not know', async () => {
    script(() => fail(404, 'model not found'), () => ok('{"c":3}'));
    expect((await run() as any).v.model).toBe('m-two');
  });

  it('with a single model, retries once after a pause and no more', async () => {
    ENV.AI_MODELS = 'only-model';
    script(() => fail(503), () => fail(503), () => ok('x'));
    const r: any = await run();
    expect(r.e.message).toContain('503');
    expect(calls).toHaveLength(2);
  });
});

describe('a document is read by the same model every time', () => {
  const pool = ['m-one', 'm-two', 'm-three', 'm-four', 'm-five'];
  it('gives the same order for the same text, and spreads different texts over the pool', async () => {
    const { seededRandom } = await import('@engine/aiGateway');
    const orderFor = (text: string) => orderModels(pool, { random: seededRandom(text), listed: false });
    expect(orderFor('Cowiche Creek offering memorandum')).toEqual(orderFor('Cowiche Creek offering memorandum'));
    const firsts = new Set(Array.from({ length: 40 }, (_, i) => orderFor(`document number ${i}`)[0]));
    expect(firsts.size).toBeGreaterThan(1);
  });
});

describe('what each request asks of the model', () => {
  const base = { base: 'https://gateway.ai.cloudflare.com/v1/acct/gw', token: 't', model: 'm', system: 's', user: 'u' };

  it('caps the length of the answer', async () => {
    const { buildRequest, MAX_OUTPUT_TOKENS } = await import('@engine/aiGateway');
    expect(JSON.parse(buildRequest(base).body).generationConfig.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
    expect(JSON.parse(buildRequest({ ...base, base: 'https://api.cloudflare.com/client/v4/accounts/a/ai/run' }).body).max_tokens).toBe(MAX_OUTPUT_TOKENS);
  });

  it('sets a thinking budget only when the owner has set one', async () => {
    const { buildRequest } = await import('@engine/aiGateway');
    expect(JSON.parse(buildRequest(base).body).generationConfig.thinkingConfig).toBeUndefined();
    expect(JSON.parse(buildRequest({ ...base, thinkingBudget: 0 }).body).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });
});

describe('a model the service does not know', () => {
  beforeEach(() => { vi.useFakeTimers(); resetCooldowns(); (globalThis as any).Deno = { env: { get: (k: string) => ENV[k] } }; });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete (globalThis as any).Deno; });

  it('is not asked again on the next call, so a name that does not exist costs one request, not one per call', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(/models\/([^:]+):/.exec(url)?.[1] ?? ''); return /m-one/.test(url) ? fail(404, 'model not found') : ok('{"a":1}'); }));
    const go = async () => { const p = generateJsonDetailed({ system: 's', user: 'u' }); await vi.advanceTimersByTimeAsync(30_000); return p; };
    await go();
    calls.length = 0;
    await go();
    expect(calls).not.toContain('m-one');
  });
});

describe('how long a model is waited on', () => {
  it('is 30 seconds at most, so an overloaded model that holds a request is not waited on for a minute', async () => {
    const { ATTEMPT_TIMEOUT_MS } = await import('@engine/aiGateway');
    expect(ATTEMPT_TIMEOUT_MS).toBe(30_000);
  });
});
