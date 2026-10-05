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
    const want = 'https://gateway.ai.cloudflare.com/v1/acct/gw/google-ai-studio/v1beta/models/gemini-2.5-flash:generateContent';
    expect(gatewayEndpoint('https://gateway.ai.cloudflare.com/v1/acct/gw/', 'gemini-2.5-flash')).toBe(want);
    expect(gatewayEndpoint('https://gateway.ai.cloudflare.com/v1/acct/gw/google-ai-studio', 'gemini-2.5-flash')).toBe(want);
    expect(gatewayEndpoint(want, 'other')).toBe(want);
  });
});
