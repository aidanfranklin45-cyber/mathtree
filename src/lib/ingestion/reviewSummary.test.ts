import { describe, it, expect } from 'vitest';
import { NOI_TIE_TOLERANCE, reviewSummary } from './reviewSummary';

const record = (over: Record<string, unknown> = {}) => ({
  claims: [{ label: 'NOI claimed in the offering memorandum', value: 1_000_000 }],
  figures: [],
  checks: [],
  ...over,
}) as never;

describe('checks and balances for a property built from documents', () => {
  it('says nothing when there is no record from documents', () => {
    expect(reviewSummary({ record: undefined, ourNoi: 1_000_000, selfManaged: true }).items).toHaveLength(0);
  });

  it('passes when this underwriting is close to the seller\'s NOI', () => {
    const s = reviewSummary({ record: record(), ourNoi: 1_050_000, selfManaged: false });
    expect(s.items).toHaveLength(1);
    expect(s.items[0].ok).toBe(true);
    expect(s.toReview).toBe(0);
  });

  it('flags a large gap, and names what the owner changed from the document', () => {
    const rec = record({ figures: [{ key: 'expenseRatio', label: 'Expense ratio', value: 21, source: 'owner', how: 'Changed by you.' }, { key: 'purchasePrice', label: 'Purchase price', value: 1, source: 'document', how: 'x' }] });
    const s = reviewSummary({ record: rec, ourNoi: 700_000, selfManaged: false });
    expect(s.items[0].ok).toBe(false);
    expect(s.toReview).toBe(1);
    expect(s.items[0].detail).toContain('large gap');
    expect(s.items[0].detail).toContain('Expense ratio');
    expect(s.items[0].detail).not.toContain('Purchase price'); // only what the owner changed
  });

  it('says so when nothing was changed, so the reading itself is what to look at', () => {
    const s = reviewSummary({ record: record(), ourNoi: 700_000, selfManaged: false });
    expect(s.items[0].detail).toContain('how the documents were read');
  });

  it('compares like with like: an owner who manages does not pay the seller\'s management cost', () => {
    const rec = record({ claims: [{ label: 'NOI claimed in the offering memorandum', value: 1_000_000 }, { label: "The seller's management cost", value: 100_000 }] });
    expect(reviewSummary({ record: rec, ourNoi: 1_115_000, selfManaged: true }).items[0].ok).toBe(true); // 1,100,000 before management
    expect(reviewSummary({ record: rec, ourNoi: 1_115_000, selfManaged: false }).items[0].ok).toBe(false); // a manager is paid, so the seller's NOI is the comparison
  });

  it('puts the documents\' own arithmetic beside it, and counts what is consistent', () => {
    const rec = record({ checks: [{ label: 'NOI over the price equals the cap rate', ok: true, detail: 'ties' }, { label: 'Income less costs equals the NOI', ok: false, detail: 'does not tie' }] });
    const s = reviewSummary({ record: rec, ourNoi: 1_000_000, selfManaged: false });
    expect(s.items.map((i) => i.ok)).toEqual([true, false, true]);
    expect(s.consistent).toBe(2);
    expect(s.toReview).toBe(1);
  });

  it('states its tolerance', () => {
    expect(NOI_TIE_TOLERANCE).toBe(0.1);
  });
});
