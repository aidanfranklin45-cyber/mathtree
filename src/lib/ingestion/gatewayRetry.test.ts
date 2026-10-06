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
    expect(r.e.message).toContain('503');
    expect(calls).toHaveLength(4);
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
