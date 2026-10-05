import { describe, it, expect } from 'vitest';
import { coerceIntake, parseModelJson, buildExtractionPrompt } from '@engine/intakeParse';
import { gatewayEndpoint } from '@engine/aiGateway';

describe('coerceIntake', () => {
  it('turns a model answer into the intake schema, nulling anything unreadable and restoring names', () => {
    const raw = parseModelJson('```json\n' + JSON.stringify({
      asOfDate: { value: '3/1/2026', confidence: 0.9, evidence: 'As of 3/1/2026' },
      rentPeriod: { value: 'Monthly', confidence: 1 },
      reportedTotalRent: { value: '$3,900', confidence: 0.8 },
      rows: [
        { unit: { value: '101', confidence: 1 }, tenantName: { value: '[TENANT_1]', confidence: 1 }, monthlyRent: { value: '1,500.00', confidence: 1 }, status: { value: 'Month to month', confidence: 0.7 }, leaseEndDate: { value: 'soon', confidence: 0.5 } },
      ],
    }) + '\n```') as any;
    const doc: any = coerceIntake('rent_roll', raw, (s) => s.replace('[TENANT_1]', 'Jane Doe'));
    expect(doc.asOfDate.value).toBe('2026-03-01');
    expect(doc.rentPeriod.value).toBe('monthly');
    expect(doc.reportedTotalRent.value).toBe(3900);
    expect(doc.reportedUnitCount.value).toBeNull();
    expect(doc.rows[0].tenantName.value).toBe('Jane Doe');
    expect(doc.rows[0].monthlyRent.value).toBe(1500);
    expect(doc.rows[0].status.value).toBe('month_to_month');
    expect(doc.rows[0].leaseEndDate.value).toBeNull(); // not a date: null, never a guess
    expect(doc.rows[0].squareFeet).toMatchObject({ value: null, confidence: 0 });
  });

  it('survives an answer that is not an object', () => {
    expect((coerceIntake('lease', 'nonsense') as any).baseRent.value).toBeNull();
    expect(parseModelJson('not json')).toBeNull();
  });
});

describe('prompt and gateway', () => {
  it('asks only the questions of the document type', () => {
    const p = buildExtractionPrompt('loan_terms', 'LOAN TEXT');
    expect(p).toContain('amortization period');
    expect(p).toContain('"interestRatePercent"');
    expect(p).toContain('<document>\nLOAN TEXT\n</document>');
  });

  it('builds the Google AI Studio endpoint from either form of gateway URL', () => {
    const want = 'https://gateway.ai.cloudflare.com/v1/acct/gw/google-ai-studio/v1beta/models/gemini-3.8-flash:generateContent';
    expect(gatewayEndpoint('https://gateway.ai.cloudflare.com/v1/acct/gw/', 'gemini-3.8-flash')).toBe(want);
    expect(gatewayEndpoint('https://gateway.ai.cloudflare.com/v1/acct/gw/google-ai-studio', 'gemini-3.8-flash')).toBe(want);
    expect(gatewayEndpoint(want, 'other')).toBe(want);
  });
});

describe('both Cloudflare address forms', () => {
  const args = { token: 'TOKEN', model: 'gemini-3.8-flash', system: 'rules', user: 'doc' };

  it('uses the account API chat endpoint with a Bearer token and a google/ model name', async () => {
    const { buildRequest } = await import('@engine/aiGateway');
    const r = buildRequest({ ...args, base: 'https://api.cloudflare.com/client/v4/accounts/abc123/ai/run', gatewayId: 'lease-parser' });
    expect(r.mode).toBe('account-api');
    expect(r.url).toBe('https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1/chat/completions');
    expect(r.headers.Authorization).toBe('Bearer TOKEN');
    expect(r.headers['cf-aig-gateway-id']).toBe('lease-parser');
    expect(JSON.parse(r.body)).toMatchObject({ model: 'google/gemini-3.8-flash', response_format: { type: 'json_object' } });
  });

  it('keeps the AI Gateway form with cf-aig-authorization', async () => {
    const { buildRequest, replyText } = await import('@engine/aiGateway');
    const r = buildRequest({ ...args, base: 'https://gateway.ai.cloudflare.com/v1/a/g' });
    expect(r.mode).toBe('gateway');
    expect(r.headers['cf-aig-authorization']).toBe('Bearer TOKEN');
    expect(r.url).toContain('/google-ai-studio/v1beta/models/gemini-3.8-flash:generateContent');
    // the gateway name can come from AI_GATEWAY_ID instead of being typed into the address
    const byId = buildRequest({ ...args, base: 'https://gateway.ai.cloudflare.com/v1/acct', gatewayId: 'lease-parser' });
    expect(byId.url).toBe('https://gateway.ai.cloudflare.com/v1/acct/lease-parser/google-ai-studio/v1beta/models/gemini-3.8-flash:generateContent');
    expect(buildRequest({ ...args, base: 'https://gateway.ai.cloudflare.com/v1/acct/{gateway}/google-ai-studio', gatewayId: 'lease-parser' }).url).toContain('/acct/lease-parser/google-ai-studio/');
    expect(replyText({ choices: [{ message: { content: '{"a":1}' } }] })).toBe('{"a":1}');
    expect(replyText({ result: { choices: [{ message: { content: 'x' } }] } })).toBe('x');
    expect(replyText({ candidates: [{ content: { parts: [{ text: 'y' }] } }] })).toBe('y');
  });
});
