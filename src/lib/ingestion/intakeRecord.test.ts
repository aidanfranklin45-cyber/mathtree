import { describe, it, expect } from 'vitest';
import { buildIntakeRecord, type DocumentFigure } from './intakeRecord';

const fig = (over: Partial<DocumentFigure>): DocumentFigure => ({
  key: 'purchasePrice', label: 'Purchase price', text: '18,400,000', value: 18400000, how: "The seller's list price in the offering memorandum", reliability: 'projected', current: 18400000, ...over,
});
const base = { documents: [{ name: 'Cowiche Creek OM.pdf', type: 'offering_memorandum' }], profileFigures: [], claims: [], notes: [], choices: [], now: new Date('2026-10-06T12:00:00Z') };

describe('the record of where the figures came from', () => {
  it('keeps each figure with its source, its reasoning and how far it can be trusted', () => {
    const r = buildIntakeRecord({
      ...base,
      documentFigures: [fig({}), fig({ key: 'expenseRatio', label: 'Expense ratio', text: '18.03%', value: 18.03, current: 18.03, how: "Seller's figures: operating costs 365,440 …", reliability: 'projected' })],
      profileFigures: [{ key: 'rentGrowth', label: 'Rent growth', value: 3, why: 'Common underwriting convention' }, { key: 'closingCosts', label: 'Closing costs (2% of price)', value: 368000 }],
      claims: [{ how: 'NOI claimed in the offering memorandum', value: 1093745 }],
      notes: ['Tenant utility reimbursements … without them the expense ratio would be 25.19%.'],
      choices: [{ label: 'Expense ratio', decision: '22% (your own number)' }],
    })!;
    expect(r.recordedAt).toBe('2026-10-06T12:00:00.000Z');
    expect(r.documents).toEqual([{ name: 'Cowiche Creek OM.pdf', type: 'offering_memorandum' }]);
    expect(r.figures.find((f) => f.key === 'purchasePrice')).toMatchObject({ source: 'document', value: 18400000, reliability: 'projected' });
    expect(r.figures.find((f) => f.key === 'purchasePrice')!.how).toContain("seller's list price");
    expect(r.figures.find((f) => f.key === 'rentGrowth')).toMatchObject({ source: 'profile', how: 'Your investor profile: Common underwriting convention' });
    expect(r.figures.find((f) => f.key === 'closingCosts')!.how).toBe('Your investor profile');
    expect(r.claims).toEqual([{ label: 'NOI claimed in the offering memorandum', value: 1093745 }]);
    expect(r.notes[0]).toContain('25.19%');
    expect(r.choices).toEqual([{ label: 'Expense ratio', decision: '22% (your own number)' }]);
  });

  it('records a figure the owner changed as the owner\'s, and says what the document had said', () => {
    const r = buildIntakeRecord({ ...base, documentFigures: [fig({ key: 'expenseRatio', label: 'Expense ratio', text: '18.03%', value: 18.03, current: 22 })] })!;
    expect(r.figures[0]).toMatchObject({ source: 'owner', value: 22 });
    expect(r.figures[0].how).toContain('Changed by you. The document said 18.03%');
  });

  it('treats a figure it cannot compare (a tenant list, a parcel number) as unchanged', () => {
    const r = buildIntakeRecord({ ...base, documentFigures: [fig({ key: 'leases', label: 'Tenants and leases', text: '12 tenants', value: undefined, current: undefined })] })!;
    expect(r.figures[0]).toMatchObject({ source: 'document', value: null });
  });

  it('records who confirmed it, and when, once the owner has reviewed everything', () => {
    const confirmed = buildIntakeRecord({ ...base, documentFigures: [fig({})], verifiedBy: 'user-123' })!;
    expect(confirmed.verification).toEqual({ at: '2026-10-06T12:00:00.000Z', by: 'user-123', statement: 'Reviewed and confirmed by the owner before the project was created.' });
    expect(buildIntakeRecord({ ...base, documentFigures: [fig({})] })!.verification).toBeUndefined(); // not confirmed: nothing claims it was
  });

  it('records nothing when nothing was read and nothing came from the profile', () => {
    expect(buildIntakeRecord({ ...base, documents: [], documentFigures: [] })).toBeNull();
  });

  it('stays small however much was read', () => {
    const many = Array.from({ length: 200 }, (_, i) => fig({ key: `k${i}`, label: `L${i}`, how: 'x'.repeat(2000) }));
    const r = buildIntakeRecord({ ...base, documentFigures: many })!;
    expect(r.figures.length).toBe(80);
    expect(r.figures[0].how.length).toBeLessThanOrEqual(400);
    expect(JSON.stringify(r).length).toBeLessThan(60_000);
  });
});
