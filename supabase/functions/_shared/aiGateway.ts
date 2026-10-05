// The one place the app talks to a language model: through Cloudflare, which holds the provider key and gives logging, caching and spend
// limits. Two edge secrets are used (never read by the browser, never logged):
//   AI_GATEWAY_URL  where to call. Two forms are understood:
//                     https://api.cloudflare.com/client/v4/accounts/{account}/ai/run   (Cloudflare's account REST API; the app calls its
//                                                                                       OpenAI-compatible chat endpoint beside it)
//                     https://gateway.ai.cloudflare.com/v1/{account}/{gateway}[/google-ai-studio]   (an AI Gateway address)
//   CF_AIG_TOKEN    the Cloudflare token. Sent as `Authorization: Bearer` to the account API, and as `cf-aig-authorization` to a gateway.
// Optional: AI_MODELS, the model names allowed (comma separated), tried in random order, each at most once per call (AI_MODEL_ORDER=listed keeps
// the listed order). AI_MODEL and AI_MODEL_FALLBACK are still read when AI_MODELS is not set. AI_BYOK_ALIAS, the name the Google key is stored under in the gateway when it is not "default". AI_GATEWAY_ID, the gateway's name (sent as `cf-aig-gateway-id` so the account API routes the call through that gateway for its
// logging, caching and limits). AI_MODEL (default below). GEMINI_API_KEY is only sent to a gateway, if set, when the gateway does not store the provider key.

// Deno's global, declared so the browser-side type-check (which imports this from tests) compiles
declare const Deno: { env: { get(key: string): string | undefined } };

export const DEFAULT_MODEL = 'gemini-3.8-flash';

function env(key: string): string {
  try {
    return Deno.env.get(key) || '';
  } catch {
    return '';
  }
}

export type GatewayMode = 'account-api' | 'gateway';

export function gatewayMode(baseUrl: string): GatewayMode {
  try {
    return new URL(baseUrl.trim()).host === 'api.cloudflare.com' ? 'account-api' : 'gateway';
  } catch {
    return 'gateway';
  }
}

/**
 * The generateContent endpoint for an AI Gateway address. The address may stop at the account (`.../v1/{account}`), in which case the gateway
 * name comes from AI_GATEWAY_ID; may contain `{gateway}` where the name goes; or may already name the gateway and point at Google AI Studio.
 */
export function gatewayEndpoint(baseUrl: string, model: string, gatewayId?: string): string {
  let url = baseUrl.trim().replace(/\/+$/, '');
  if (gatewayId) {
    url = url.replace('{gateway}', gatewayId);
    if (/^https:\/\/gateway\.ai\.cloudflare\.com\/v1\/[^/]+$/.test(url)) url += `/${gatewayId}`;
  }
  if (/:generateContent$/.test(url)) return url;
  if (!/google-ai-studio/.test(url)) url += '/google-ai-studio';
  if (!/\/v1beta\/models\//.test(url)) url += `/v1beta/models/${model.replace(/^(google-ai-studio|google)\//, '')}:generateContent`;
  return url;
}

/** The account API's OpenAI-compatible chat endpoint, from any address under the same account. */
export function accountApiEndpoint(baseUrl: string): string {
  const m = /^(https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/[^/?#]+)/.exec(baseUrl.trim());
  return m ? `${m[1]}/ai/v1/chat/completions` : baseUrl.trim();
}

/** Third-party models on the account API are named author/model. */
export function accountApiModel(model: string): string {
  return model.includes('/') ? model : `google/${model}`;
}

export class GatewayError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'GatewayError';
  }
}

export function gatewayConfigured(): boolean {
  return !!env('AI_GATEWAY_URL') && !!env('CF_AIG_TOKEN');
}

/** The first model of the pool: a stand-in name where no particular call is involved. */
export function modelName(): string {
  return modelPool()[0];
}

export interface ModelRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  mode: GatewayMode;
}

/** The request for either form of address. Pure, so it can be tested without a network. */
export function buildRequest(args: { base: string; token: string; model: string; system: string; user: string; providerKey?: string; gatewayId?: string; byokAlias?: string }): ModelRequest {
  const mode = gatewayMode(args.base);
  if (mode === 'account-api') {
    return {
      mode,
      url: accountApiEndpoint(args.base),
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${args.token}`, ...(args.gatewayId ? { 'cf-aig-gateway-id': args.gatewayId } : {}) },
      body: JSON.stringify({
        model: accountApiModel(args.model),
        messages: [{ role: 'system', content: args.system }, { role: 'user', content: args.user }],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    };
  }
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cf-aig-authorization': `Bearer ${args.token}` };
  if (args.providerKey) headers['x-goog-api-key'] = args.providerKey;
  // A provider key stored in the gateway under a name other than "default" is chosen by that name
  if (args.byokAlias) headers['cf-aig-byok-alias'] = args.byokAlias;
  return {
    mode,
    url: gatewayEndpoint(args.base, args.model, args.gatewayId),
    headers,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: args.system }] },
      contents: [{ role: 'user', parts: [{ text: args.user }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  };
}

/** The model's reply text from either response shape. */
export function replyText(data: any): string {
  const d = data?.result ?? data;
  const chat = d?.choices?.[0]?.message?.content;
  if (typeof chat === 'string' && chat) return chat;
  if (Array.isArray(chat)) return chat.map((p: { text?: string }) => p?.text ?? '').join('');
  return d?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
}

/** The address called, with account and gateway names hidden, so a wrong address can be spotted without exposing anything. */
function shapeOf(url: string): string {
  try {
    const u = new URL(url);
    const path = u.host === 'gateway.ai.cloudflare.com'
      ? u.pathname.replace(/^\/v1\/[^/]+\/[^/]+/, '/v1/{account}/{gateway}')
      : u.pathname.replace(/\/accounts\/[^/]+/, '/accounts/{account}');
    return `${u.host}${path}`;
  } catch {
    return 'the address is not a valid URL';
  }
}

/** Statuses that name their reason in the message: setup problems the owner can fix, and busy/limit notices. */
const EXPLAINED = new Set([400, 401, 402, 403, 404, 405, 409, 413, 422, 429, 500, 503]);
/** Another model may succeed where this one did not: busy, over its quota, a hiccup, or a name the service does not know. */
const TRY_NEXT = new Set([400, 404, 429, 500, 502, 503, 504]);
/** Models tried in one call. A free tier counts every request, so a failing call does not keep knocking. */
export const MAX_MODELS_PER_CALL = 4;
/** The whole call must finish inside the platform's request limit (150 seconds on the free plan). */
export const CALL_DEADLINE_MS = 100_000;

/**
 * Models that just ran out of quota, and until when (this process only). Free-tier limits are per model, per minute and per day, so a
 * model that answered 429 is left alone for a minute, or for half an hour when the reply says its daily allowance is gone.
 */
const coolingUntil = new Map<string, number>();

export function resetCooldowns(): void {
  coolingUntil.clear();
}

/** The models allowed for this app, from AI_MODELS (comma separated); AI_MODEL and AI_MODEL_FALLBACK are still read; else the default. */
export function modelPool(): string[] {
  const raw = env('AI_MODELS') || [env('AI_MODEL'), env('AI_MODEL_FALLBACK')].filter(Boolean).join(',');
  const names = raw.split(',').map((m) => m.trim()).filter(Boolean);
  return [...new Set(names.length > 0 ? names : [DEFAULT_MODEL])];
}

/**
 * The order to try the pool in: shuffled, so no single model's quota carries the load (AI_MODEL_ORDER=listed keeps the listed order),
 * with models that are cooling down put last.
 */
export function orderModels(pool: string[], opts: { random?: () => number; now?: number; listed?: boolean } = {}): string[] {
  const random = opts.random ?? Math.random;
  const now = opts.now ?? Date.now();
  const listed = opts.listed ?? env('AI_MODEL_ORDER').trim().toLowerCase() === 'listed';
  const order = [...pool];
  if (!listed) for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const ready = order.filter((m) => (coolingUntil.get(m) ?? 0) <= now);
  const resting = order.filter((m) => (coolingUntil.get(m) ?? 0) > now);
  return [...ready, ...resting];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function failure(res: Response, req: ModelRequest, model: string): Promise<{ error: GatewayError; reason: string }> {
  // For setup problems the reason is passed on, cut short: it is what lets the owner fix the configuration. Other failures report the
  // status only, since a body could echo document text.
  let reason = '';
  if (EXPLAINED.has(res.status)) {
    const body = await res.text().catch(() => '');
    try {
      const j = JSON.parse(body);
      reason = String(j?.error?.message ?? j?.error?.[0]?.message ?? j?.errors?.[0]?.message ?? j?.message ?? '');
    } catch {
      reason = '';
    }
    // Not JSON in the shape expected (or empty): show what came back, as plain text
    if (!reason) reason = body.replace(/<[^>]*>/g, ' ');
    reason = reason.replace(/\s+/g, ' ').trim().slice(0, 160) || 'no explanation in the reply';
  }
  const shape = shapeOf(req.url);
  const via = res.headers.get('cf-ray') ? 'Cloudflare' : res.headers.get('server') || 'unknown server';
  console.error(`[ai-gateway] ${res.status} via=${via} mode=${req.mode} model=${model} endpoint=${shape}${reason ? ` reason=${reason}` : ''}`);
  return { error: new GatewayError(`The AI gateway returned ${res.status}${reason ? `: ${reason}` : ''} [${via}; ${req.mode}; ${model}; ${shape}]`, res.status === 429 ? 429 : 502), reason };
}

export interface ModelReply {
  text: string;
  /** The model that actually answered. */
  model: string;
}

/**
 * One JSON-answer call. Document text is in `user`, the rules in `system`.
 * Each model in the pool is asked at most once: a model that is busy, out of quota or unknown is skipped for the next one straight away,
 * with no waiting and no repeat requests (every request counts against a free tier). With a single model in the pool one retry is made
 * after a short pause. A setup problem (credentials, billing, a bad request) fails at once.
 */
export async function generateJsonDetailed(args: { system: string; user: string; timeoutMs?: number }): Promise<ModelReply> {
  // Secrets pasted into a dashboard often carry quotes, spaces or a "Bearer " prefix; none of those belong in the value
  const clean = (v: string) => v.trim().replace(/^["']|["']$/g, '').replace(/^Bearer\s+/i, '').trim();
  const base = clean(env('AI_GATEWAY_URL'));
  const token = clean(env('CF_AIG_TOKEN'));
  if (!base || !token) throw new GatewayError('The AI gateway is not configured.', 503);
  const providerKey = clean(env('GEMINI_API_KEY')) || undefined;
  const gatewayId = clean(env('AI_GATEWAY_ID')) || undefined;
  const byokAlias = clean(env('AI_BYOK_ALIAS')) || undefined;

  const pool = modelPool();
  const queue = orderModels(pool);
  // A single-model pool gets one more go at the same model, since there is no other to turn to
  const attempts = pool.length === 1 ? [pool[0], pool[0]] : queue.slice(0, MAX_MODELS_PER_CALL);
  const started = Date.now();
  const left = () => CALL_DEADLINE_MS - (Date.now() - started);
  let last: GatewayError = new GatewayError('Could not reach the AI gateway.', 504);

  for (let i = 0; i < attempts.length; i++) {
    const model = attempts[i];
    if (left() < 5_000) break;
    const req = buildRequest({ base, token, model, system: args.system, user: args.user, providerKey, gatewayId, byokAlias });
    let res: Response;
    try {
      res = await fetch(req.url, { method: 'POST', headers: req.headers, signal: AbortSignal.timeout(Math.min(args.timeoutMs ?? 55_000, left())), body: req.body });
    } catch (e) {
      last = new GatewayError(e instanceof Error && e.name === 'TimeoutError' ? 'The model took too long to answer.' : 'Could not reach the AI gateway.', 504);
      if (pool.length === 1 && i === 0 && left() > 8_000) await sleep(2_500);
      continue;
    }
    if (res.ok) {
      const text = replyText(await res.json().catch(() => null));
      if (text) return { text, model };
      last = new GatewayError('The model returned no answer.', 502);
      continue;
    }
    const { error, reason } = await failure(res, req, model);
    last = error;
    if (res.status === 429) coolingUntil.set(model, Date.now() + (/day/i.test(reason) ? 30 * 60_000 : 60_000));
    if (!TRY_NEXT.has(res.status)) throw error; // credentials, billing, size: another model will not help
    if (pool.length === 1 && i === 0 && left() > 8_000) await sleep(2_500);
  }
  throw last;
}

/** The model's reply text for one JSON-answer call (see `generateJsonDetailed`). */
export async function generateJson(args: { system: string; user: string; timeoutMs?: number }): Promise<string> {
  return (await generateJsonDetailed(args)).text;
}
