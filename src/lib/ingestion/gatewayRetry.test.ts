import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateJson } from '@engine/aiGateway';

const ENV: Record<string, string> = {
  AI_GATEWAY_URL: 'https://gateway.ai.cloudflare.com/v1/acct',
  AI_GATEWAY_ID: 'gw',
  CF_AIG_TOKEN: 'tok',
  AI_MODEL: 'main-model',
  AI_MODEL_FALLBACK: 'backup-model',
};

const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
const fail = (status: number, message = 'busy') => new Response(JSON.stringify({ error: { message } }), { status });

describe('generateJson resilience', () => {
  let calls: string[];
  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    (globalThis as any).Deno = { env: { get: (k: string) => ENV[k] } };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (globalThis as any).Deno;
  });

  const script = (...replies: Array<() => Response>) => {
    let i = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); return replies[Math.min(i++, replies.length - 1)](); }));
  };
  const run = async () => {
    const p = generateJson({ system: 's', user: 'u' });
    const settled = p.then((v) => ({ v }), (e) => ({ e }));
    await vi.advanceTimersByTimeAsync(30_000);
    return settled;
  };

  it('rides out a busy model: two 503s, then an answer', async () => {
    script(() => fail(503), () => fail(503), () => ok('{"a":1}'));
    expect(await run()).toEqual({ v: '{"a":1}' });
    expect(calls).toHaveLength(3);
    expect(calls.every((u) => u.includes('main-model'))).toBe(true);
  });

  it('does not retry a setup problem (billing, credentials)', async () => {
    script(() => fail(402, 'credits depleted'));
    const r: any = await run();
    expect(r.e.message).toContain('402');
    expect(r.e.message).toContain('credits depleted');
    expect(calls).toHaveLength(1);
  });

  it('moves to the backup model when the main one stays busy', async () => {
    script(() => fail(503), () => fail(503), () => fail(503), () => ok('{"b":2}'));
    expect(await run()).toEqual({ v: '{"b":2}' });
    expect(calls.slice(0, 3).every((u) => u.includes('main-model'))).toBe(true);
    expect(calls[3]).toContain('backup-model');
  });

  it('tries the backup when the main model name is not found', async () => {
    script(() => fail(404, 'model not found'), () => ok('{"c":3}'));
    expect(await run()).toEqual({ v: '{"c":3}' });
    expect(calls[1]).toContain('backup-model');
  });
});
