import { describe, it, expect } from 'vitest';
import {
  defaultTrackRecoveries, proRataSharePct, expectedDueDates, itemStatus, missingItems, backfillSinceIso, summarizeLeaseRecoveries,
  type RecoveryTerm, type RecoveryItem,
} from '../../../supabase/functions/_shared/recoveries';

const term = (over: Partial<RecoveryTerm> = {}): RecoveryTerm => ({
  id: 't1', lease_id: 'l1', category: 'property_tax', mode: 'direct_pay', frequency: 'semiannual', first_due_date: '2026-04-30', ...over,
});

describe('opt-in default', () => {
  it('pre-checks NNN and Modified Gross only', () => {
    expect(defaultTrackRecoveries('NNN')).toBe(true);
    expect(defaultTrackRecoveries('Modified Gross')).toBe(true);
    expect(defaultTrackRecoveries('Gross')).toBe(false);
    expect(defaultTrackRecoveries('Full Service')).toBe(false);
    expect(defaultTrackRecoveries(null)).toBe(false);
  });
});

describe('proRataSharePct', () => {
  it('divides tenant sqft by property sqft', () => {
    expect(proRataSharePct(2500, 10000)).toBe(25);
    expect(proRataSharePct(3333, 10000)).toBe(33.33);
  });
  it('returns null when either side is missing, and caps at 100', () => {
    expect(proRataSharePct(null, 10000)).toBeNull();
    expect(proRataSharePct(2500, 0)).toBeNull();
    expect(proRataSharePct(12000, 10000)).toBe(100);
  });
});

describe('expectedDueDates', () => {
  it('steps by frequency, inclusive of the end date', () => {
    expect(expectedDueDates(term(), '2027-04-30')).toEqual(['2026-04-30', '2026-10-30', '2027-04-30']);
    expect(expectedDueDates(term({ frequency: 'quarterly', first_due_date: '2026-01-01' }), '2026-07-01'))
      .toEqual(['2026-01-01', '2026-04-01', '2026-07-01']);
  });
  it('returns nothing before the first due date', () => {
    expect(expectedDueDates(term(), '2026-04-29')).toEqual([]);
  });
  it('clamps to month end without drifting', () => {
    expect(expectedDueDates(term({ frequency: 'monthly', first_due_date: '2026-01-31' }), '2026-04-30'))
      .toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
});

describe('missingItems backfill limit', () => {  it('skips due dates before `since` so an old start date does not create a wall of overdue items', () => {    const monthly = term({ frequency: 'monthly', first_due_date: '2025-01-01' });    const out = missingItems([monthly], [], '2026-10-15', '2026-08-01').map((m) => m.due_date);    expect(out).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);  });});
describe('itemStatus', () => {
  const item = (over: Partial<RecoveryItem> = {}) => ({ due_date: '2026-10-15', paid_date: null, verified: false, ...over });
  it('direct pay completes on verification, not on a paid date', () => {
    expect(itemStatus(item({ verified: true }), 'direct_pay', '2026-11-01')).toBe('complete');
    expect(itemStatus(item({ paid_date: '2026-10-10' }), 'direct_pay', '2026-11-01')).toBe('overdue');
  });
  it('reimbursement completes when the tenant has repaid', () => {
    expect(itemStatus(item({ paid_date: '2026-10-10' }), 'reimburse', '2026-11-01')).toBe('complete');
    expect(itemStatus(item({ verified: true }), 'reimburse', '2026-11-01')).toBe('overdue');
  });
  it('is overdue only after the grace period', () => {
    expect(itemStatus(item(), 'reimburse', '2026-10-15')).toBe('due_soon');
    expect(itemStatus(item(), 'reimburse', '2026-10-16')).toBe('overdue');
    expect(itemStatus(item(), 'reimburse', '2026-10-20', { graceDays: 5 })).toBe('due_soon');
    expect(itemStatus(item(), 'reimburse', '2026-10-21', { graceDays: 5 })).toBe('overdue');
  });
  it('is due soon inside the window and upcoming outside it', () => {
    expect(itemStatus(item(), 'reimburse', '2026-09-15')).toBe('due_soon'); // 30 days out
    expect(itemStatus(item(), 'reimburse', '2026-09-14')).toBe('upcoming'); // 31 days out
  });
});

describe('missingItems', () => {
  it('lists due dates that have no item yet and skips inactive terms', () => {
    const existing: RecoveryItem[] = [{ term_id: 't1', due_date: '2026-04-30' }];
    const out = missingItems([term({ expected_amount: 4000 }), term({ id: 't2', is_active: false })], existing, '2026-10-30');
    expect(out).toEqual([{ term_id: 't1', due_date: '2026-10-30', amount_expected: 4000 }]);
  });
});

describe('summarizeLeaseRecoveries', () => {
  const terms = [term(), term({ id: 't2', category: 'cam', mode: 'reimburse', frequency: 'monthly' })];
  const items: RecoveryItem[] = [
    { term_id: 't1', due_date: '2026-04-30', verified: true },
    { term_id: 't1', due_date: '2026-10-30', verified: false },
    { term_id: 't2', due_date: '2026-09-01', paid_date: null },
    { term_id: 't2', due_date: '2026-10-01', paid_date: '2026-10-01' },
  ];
  it('does nothing for a lease that has not opted in', () => {
    expect(summarizeLeaseRecoveries({ track_recoveries: false }, terms, items, '2026-10-05').tracked).toBe(false);
  });
  it('counts statuses and surfaces the earliest unfinished item', () => {
    const s = summarizeLeaseRecoveries({ track_recoveries: true }, terms, items, '2026-10-05');
    expect(s).toMatchObject({ tracked: true, overdue: 1, dueSoon: 1, complete: 2 });
    expect(s.next).toMatchObject({ term_id: 't2', due_date: '2026-09-01', category: 'cam', status: 'overdue' });
  });
});

describe('unpaid yearly charges this year (2026-10-04)', () => {
  const today = '2026-10-04';
  const terms = [
    term({ id: 'tax', frequency: 'semiannual', first_due_date: '2026-04-30' }),
    term({ id: 'ins', category: 'insurance', frequency: 'annual', first_due_date: '2026-03-15' }),
    term({ id: 'oth', category: 'other', frequency: 'annual', first_due_date: '2026-05-01' }),
  ];
  const have: RecoveryItem[] = [{ term_id: 'tax', due_date: '2026-10-30', verified: true }];

  it('starts the backfill at the start of the year, or 60 days back if that is earlier', () => {
    expect(backfillSinceIso(today)).toBe('2026-01-01');
    expect(backfillSinceIso('2026-02-10')).toBe('2025-12-12');
  });
  it('creates this year\'s missed items and reports them overdue', () => {
    const created = missingItems(terms, have, '2026-10-18', backfillSinceIso(today));
    expect(created.map((m) => `${m.term_id}|${m.due_date}`).sort()).toEqual(['ins|2026-03-15', 'oth|2026-05-01', 'tax|2026-04-30']);
    const s = summarizeLeaseRecoveries({ track_recoveries: true }, terms, [...have, ...created], today);
    expect(s.overdue).toBe(3);
  });
});
