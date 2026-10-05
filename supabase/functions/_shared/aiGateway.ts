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
  const base = env('AI_GATEWAY_URL');
  const token = env('CF_AIG_TOKEN');
  if (!base || !token) throw new GatewayError('The AI gateway is not configured.', 503);
  const model = modelName();

  const headers: Record<string, string> = { 'content-type': 'application/json', 'cf-aig-authorization': `Bearer ${token}` };
  const providerKey = env('GEMINI_API_KEY');
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
    // Status only: the body could echo document text, so it is not passed on
    throw new GatewayError(`The AI gateway returned ${res.status}.`, res.status === 429 ? 429 : 502);
  }
  const data = await res.json().catch(() => null);
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
  if (!text) throw new GatewayError('The model returned no answer.', 502);
  return text;
}
