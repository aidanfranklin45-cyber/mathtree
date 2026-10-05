// The one place the app talks to a language model: through Cloudflare, which holds the provider key and gives logging, caching and spend
// limits. Two edge secrets are used (never read by the browser, never logged):
//   AI_GATEWAY_URL  where to call. Two forms are understood:
//                     https://api.cloudflare.com/client/v4/accounts/{account}/ai/run   (Cloudflare's account REST API; the app calls its
//                                                                                       OpenAI-compatible chat endpoint beside it)
//                     https://gateway.ai.cloudflare.com/v1/{account}/{gateway}[/google-ai-studio]   (an AI Gateway address)
//   CF_AIG_TOKEN    the Cloudflare token. Sent as `Authorization: Bearer` to the account API, and as `cf-aig-authorization` to a gateway.
// Optional: AI_GATEWAY_ID, the gateway's name (sent as `cf-aig-gateway-id` so the account API routes the call through that gateway for its
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

/** The generateContent endpoint for an AI Gateway address. Accepts the gateway root or a URL already pointing at Google AI Studio. */
export function gatewayEndpoint(baseUrl: string, model: string): string {
  let url = baseUrl.trim().replace(/\/+$/, '');
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

export function modelName(): string {
  return env('AI_MODEL') || DEFAULT_MODEL;
}

export interface ModelRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  mode: GatewayMode;
}

/** The request for either form of address. Pure, so it can be tested without a network. */
export function buildRequest(args: { base: string; token: string; model: string; system: string; user: string; providerKey?: string; gatewayId?: string }): ModelRequest {
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
  return {
    mode,
    url: gatewayEndpoint(args.base, args.model),
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
    return `${u.host}${u.pathname.replace(/\/accounts\/[^/]+/, '/accounts/{account}').replace(/\/v1\/[^/]+\/[^/]+/, '/v1/{account}/{gateway}')}`;
  } catch {
    return 'the address is not a valid URL';
  }
}

/** One JSON-answer call. Returns the model's reply text. Document text is in `user`, the rules in `system`. */
export async function generateJson(args: { system: string; user: string; timeoutMs?: number }): Promise<string> {
  // Secrets pasted into a dashboard often carry quotes, spaces or a "Bearer " prefix; none of those belong in the value
  const clean = (v: string) => v.trim().replace(/^["']|["']$/g, '').replace(/^Bearer\s+/i, '').trim();
  const base = clean(env('AI_GATEWAY_URL'));
  const token = clean(env('CF_AIG_TOKEN'));
  if (!base || !token) throw new GatewayError('The AI gateway is not configured.', 503);
  const model = modelName();
  const req = buildRequest({ base, token, model, system: args.system, user: args.user, providerKey: clean(env('GEMINI_API_KEY')) || undefined, gatewayId: clean(env('AI_GATEWAY_ID')) || undefined });

  let res: Response;
  try {
    res = await fetch(req.url, { method: 'POST', headers: req.headers, signal: AbortSignal.timeout(args.timeoutMs ?? 55_000), body: req.body });
  } catch (e) {
    throw new GatewayError(e instanceof Error && e.name === 'TimeoutError' ? 'The model took too long to answer.' : 'Could not reach the AI gateway.', 504);
  }
  if (!res.ok) {
    // For setup problems (bad request, credentials, model name, quota) the reason is passed on, cut short: it is what lets the owner fix
    // the configuration. Other failures report the status only, since a body could echo document text.
    let reason = '';
    if ([400, 401, 403, 404, 429].includes(res.status)) {
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
    throw new GatewayError(`The AI gateway returned ${res.status}${reason ? `: ${reason}` : ''} [${via}; ${req.mode}; ${model}; ${shape}]`, res.status === 429 ? 429 : 502);
  }
  const text = replyText(await res.json().catch(() => null));
  if (!text) throw new GatewayError('The model returned no answer.', 502);
  return text;
}
