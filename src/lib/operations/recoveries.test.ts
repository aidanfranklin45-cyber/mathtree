import { describe, it, expect } from 'vitest';
import {
  defaultTrackRecoveries, proRataSharePct, expectedDueDates, itemStatus, missingItems, backfillSinceIso, summarizeLeaseRecoveries,
  type RecoveryTerm, type RecoveryItem,
} from '../../../supabase/functions/_shared/recoveries';
import { planRecoveryAlerts } from '../../../supabase/functions/_shared/recoveryAlerts';

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

describe('backfillSinceIso', () => {
  it.each([
    ['2026-10-04', '2026-01-01'], // late in the year: the start of the year is the earlier floor
    ['2026-03-01', '2025-12-31'], // 60 days back is already last year
    ['2026-02-10', '2025-12-12'],
    ['2026-01-01', '2025-11-02'],
    ['2028-12-31', '2028-01-01'], // leap year
  ])('today %s -> since %s', (today, since) => {
    expect(backfillSinceIso(today)).toBe(since);
  });
});

describe('overdue detection through the real scheduling path', () => {
  const TODAY = '2026-10-04';
  const HORIZON = '2026-10-18';
  const run = (terms: RecoveryTerm[], items: RecoveryItem[], today = TODAY, horizon = HORIZON) => {
    const created = missingItems(terms, items, horizon, backfillSinceIso(today));
    const all = [...items, ...created];
    return { created, all, summary: summarizeLeaseRecoveries({ track_recoveries: true }, terms, all, today) };
  };

  it.each([
    ['annual', '2026-03-15', ['2026-03-15']],
    ['semiannual', '2026-04-30', ['2026-04-30']],
    ['quarterly', '2026-01-10', ['2026-01-10', '2026-04-10', '2026-07-10']],
    ['monthly', '2026-06-01', ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01']],
  ] as const)('%s term starting %s: every unpaid due date this year is overdue', (frequency, first, overdueDates) => {
    const t = term({ id: 'x', frequency, first_due_date: first });
    const { all, summary } = run([t], []);
    const overdue = all.filter((i) => itemStatus(i, t.mode, TODAY) === 'overdue').map((i) => i.due_date);
    expect(overdue).toEqual(overdueDates);
    expect(summary.overdue).toBe(overdueDates.length);
    expect(summary.complete).toBe(0);
  });

  it('does not report overdue for a payment that was marked done', () => {
    const t = term({ id: 'ins', category: 'insurance', frequency: 'annual', first_due_date: '2026-03-15' });
    const { summary, created } = run([t], [{ term_id: 'ins', due_date: '2026-03-15', verified: true }]);
    expect(created).toEqual([]);
    expect(summary).toMatchObject({ overdue: 0, complete: 1 });
  });

  it('handles reimbursement terms by paid date, not verification', () => {
    const t = term({ id: 'cam', category: 'cam', mode: 'reimburse', frequency: 'annual', first_due_date: '2026-02-01' });
    expect(run([t], []).summary.overdue).toBe(1);
    expect(run([t], [{ term_id: 'cam', due_date: '2026-02-01', paid_date: '2026-02-20' }]).summary.overdue).toBe(0);
  });

  it('is idempotent: items already created are not created again', () => {
    const t = term({ id: 'ins', category: 'insurance', frequency: 'annual', first_due_date: '2026-03-15' });
    const first = run([t], []);
    expect(first.created).toHaveLength(1);
    expect(run([t], first.all).created).toEqual([]);
  });

  it('never backfills earlier years, even for a very old start date', () => {
    const t = term({ id: 'x', frequency: 'annual', first_due_date: '2019-03-15' });
    const { created } = run([t], []);
    expect(created.map((c) => c.due_date)).toEqual(['2026-03-15']);
  });

  it('ignores inactive terms', () => {
    const t = term({ id: 'x', frequency: 'annual', first_due_date: '2026-03-15', is_active: false });
    expect(run([t], []).created).toEqual([]);
  });

  it('keeps future and not-yet-late items out of overdue', () => {
    const t = term({ id: 'ins', category: 'insurance', frequency: 'annual', first_due_date: '2026-11-15' });
    const { summary } = run([t], []);
    expect(summary.overdue).toBe(0);
  });

  it('treats the due date itself as not yet overdue and the next day as overdue', () => {
    const t = term({ id: 'ins', category: 'insurance', frequency: 'annual', first_due_date: '2026-10-04' });
    expect(run([t], [], '2026-10-04').summary.overdue).toBe(0);
    expect(run([t], [], '2026-10-05', '2026-10-19').summary.overdue).toBe(1);
  });

  it('works early in the year, when last year\'s late items are still inside the 60 day window', () => {
    const t = term({ id: 'x', frequency: 'semiannual', first_due_date: '2025-06-01' });
    const { created, summary } = run([t], [], '2026-01-20', '2026-02-03');
    expect(created.map((c) => c.due_date)).toEqual(['2025-12-01']);
    expect(summary.overdue).toBe(1);
  });

  it('the screenshot case: twice-a-year tax with one entry done, yearly insurance and yearly other untouched', () => {
    const terms = [
      term({ id: 'tax', frequency: 'semiannual', first_due_date: '2026-04-30' }),
      term({ id: 'ins', category: 'insurance', frequency: 'annual', first_due_date: '2026-03-15' }),
      term({ id: 'oth', category: 'other', frequency: 'annual', first_due_date: '2026-05-01' }),
    ];
    const { all, summary } = run(terms, [{ term_id: 'tax', due_date: '2026-10-30', verified: true }]);
    expect(all.map((i) => `${i.term_id}|${i.due_date}`).sort()).toEqual(['ins|2026-03-15', 'oth|2026-05-01', 'tax|2026-04-30', 'tax|2026-10-30']);
    expect(summary).toMatchObject({ overdue: 3, complete: 1 });
    expect(summary.next).toMatchObject({ term_id: 'ins', due_date: '2026-03-15', status: 'overdue' });
  });

  it('feeds the daily alert: the lease gets an overdue notification listing the categories', () => {
    const terms = [
      term({ id: 'ins', category: 'insurance', frequency: 'annual', first_due_date: '2026-03-15' }),
      term({ id: 'oth', category: 'other', frequency: 'annual', first_due_date: '2026-05-01' }),
    ];
    const { all } = run(terms, []);
    const plan = planRecoveryAlerts({
      leases: [{ id: 'l1', deal_id: 'd1', user_id: 'u1', tenant_name: 'Acme', track_recoveries: true }],
      deals: [{ id: 'd1', title: 'Warehouse' }], terms, items: all, reconciliations: [], existing: [], today: TODAY,
    });
    const overdue = plan.insert.find((a) => a.type === 'recovery_overdue');
    expect(overdue?.message).toContain('2 items past due');
    expect(overdue?.message).toContain('Insurance');
    expect(overdue?.message).toContain('Other');
  });
});
