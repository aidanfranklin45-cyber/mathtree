// The one place the app talks to a language model: through Cloudflare AI Gateway, which holds the provider key and gives logging,
// caching and spend limits. Two edge secrets are used (never read by the browser, never logged):
//   AI_GATEWAY_URL  the gateway's REST URL (the gateway root, or already the Google AI Studio endpoint)
//   CF_AIG_TOKEN    the gateway's authorization token
// Optional: AI_MODEL (default below). GEMINI_API_KEY is only sent if set, for a gateway not storing the provider key itself.

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

/** The generateContent endpoint for the configured gateway URL. Accepts the gateway root or a URL already pointing at Google AI Studio. */
export function gatewayEndpoint(baseUrl: string, model: string): string {
  let url = baseUrl.trim().replace(/\/+$/, '');
  if (/:generateContent$/.test(url)) return url;
  if (!/google-ai-studio/.test(url)) url += '/google-ai-studio';
  if (!/\/v1beta\/models\//.test(url)) url += `/v1beta/models/${model}:generateContent`;
  return url;
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

/** One JSON-answer call. Returns the model's reply text. Document text is in `user`, the rules in `system`. */
export async function generateJson(args: { system: string; user: string; timeoutMs?: number }): Promise<string> {
  // Secrets pasted into a dashboard often carry quotes, spaces or a "Bearer " prefix; none of those belong in the value
  const clean = (v: string) => v.trim().replace(/^["']|["']$/g, '').replace(/^Bearer\s+/i, '').trim();
  const base = clean(env('AI_GATEWAY_URL'));
  const token = clean(env('CF_AIG_TOKEN'));
  if (!base || !token) throw new GatewayError('The AI gateway is not configured.', 503);
  const model = modelName();

  const headers: Record<string, string> = { 'content-type': 'application/json', 'cf-aig-authorization': `Bearer ${token}` };
  const providerKey = clean(env('GEMINI_API_KEY'));
  if (providerKey) headers['x-goog-api-key'] = providerKey;

  let res: Response;
  try {
    res = await fetch(gatewayEndpoint(base, model), {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(args.timeoutMs ?? 55_000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: args.system }] },
        contents: [{ role: 'user', parts: [{ text: args.user }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
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
        reason = String(j?.error?.message ?? j?.error?.[0]?.message ?? j?.message ?? '');
      } catch {
        reason = '';
      }
      // Not JSON in the shape expected (or empty): show what came back, as plain text
      if (!reason) reason = body.replace(/<[^>]*>/g, ' ');
      reason = reason.replace(/\s+/g, ' ').trim().slice(0, 160) || 'no explanation in the reply';
    }
    // The shape of the address called, with the account and gateway names hidden, so a wrong gateway URL can be spotted
    let shape = '';
    try {
      const u = new URL(gatewayEndpoint(base, model));
      shape = `${u.host}${u.pathname.replace(/\/v1\/[^/]+\/[^/]+/, '/v1/{account}/{gateway}')}`;
    } catch {
      shape = 'the gateway address is not a valid URL';
    }
    const via = res.headers.get('cf-ray') ? 'Cloudflare' : res.headers.get('server') || 'unknown server';
    console.error(`[ai-gateway] ${res.status} via=${via} endpoint=${shape}${reason ? ` reason=${reason}` : ''}`);
    throw new GatewayError(`The AI gateway returned ${res.status}${reason ? `: ${reason}` : ''} [${via}; ${shape}]`, res.status === 429 ? 429 : 502);
  }
  const data = await res.json().catch(() => null);
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
  if (!text) throw new GatewayError('The model returned no answer.', 502);
  return text;
}
