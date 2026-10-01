import { describe, it, expect } from 'vitest';
import { parseDate, parseMoney, parsePasted, validateGrid, planWrites, summarizeGrid, nextAnniversary, emptyRow, type GridRow } from './rentRollGrid';

const row = (over: Partial<GridRow> = {}): GridRow => emptyRow({ unit: '1A', tenant: 'Jane Doe', rent: '1450', start: '2024-03-01', end: '2025-02-28', term: 'fixed', ...over });

describe('reading spreadsheet cells', () => {
  it('reads money however a spreadsheet writes it', () => {
    expect(parseMoney('$1,450.00')).toBe(1450);
    expect(parseMoney(' 1450 ')).toBe(1450);
    expect(parseMoney('(200)')).toBe(-200);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('n/a')).toBeNull();
  });

  it('reads dates written the common ways, and rejects impossible ones', () => {
    expect(parseDate('2024-03-01')).toBe('2024-03-01');
    expect(parseDate('3/1/2024')).toBe('2024-03-01');
    expect(parseDate('3/1/24')).toBe('2024-03-01');
    expect(parseDate('Mar 1, 2024')).toBe('2024-03-01');
    expect(parseDate('March 1st, 2024')).toBe('2024-03-01');
    expect(parseDate('1 March 2024')).toBe('2024-03-01');
    expect(parseDate('Sept 9, 2023')).toBe('2023-09-09');
    expect(parseDate('2/30/2024')).toBeNull();
    expect(parseDate('soon')).toBeNull();
    expect(parseDate('')).toBeNull();
  });
});

describe('pasting from a spreadsheet', () => {
  it('reads a pasted block with a header row, in any column order', () => {
    const text = ['Tenant\tUnit\tRent\tMove-in\tLease End', 'Jane Doe\t1A\t$1,450\t3/1/2024\t2/28/2025', 'Sam Lee\t1B\t$1,395\t9/15/2023\tMTM'].join('\n');
    const { rows, notes } = parsePasted(text);
    expect(notes).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ unit: '1A', tenant: 'Jane Doe', rent: '1450', start: '2024-03-01', end: '2025-02-28', term: 'fixed' });
    expect(rows[1]).toMatchObject({ unit: '1B', tenant: 'Sam Lee', rent: '1395', start: '2023-09-15', end: '', term: 'month_to_month' });
  });

  it('uses the default column order when there is no header', () => {
    const { rows } = parsePasted('2A\tAda Park\t1500\t2022-06-01\t2026-05-31\t5\t1500');
    expect(rows[0]).toMatchObject({ unit: '2A', tenant: 'Ada Park', rent: '1500', start: '2022-06-01', end: '2026-05-31', dueDay: '5', deposit: '1500' });
  });

  it('also reads comma-separated text with quotes', () => {
    const { rows } = parsePasted('Unit,Tenant,Rent\n3C,"Smith, Pat",$1,200'.replace('$1,200', '"$1,200"'));
    expect(rows[0]).toMatchObject({ unit: '3C', tenant: 'Smith, Pat', rent: '1200' });
  });

  it('a unit with no tenant is a vacant unit with an asking rent', () => {
    const { rows } = parsePasted('Unit\tTenant\tRent\n4D\t\t1600');
    expect(rows[0]).toMatchObject({ unit: '4D', tenant: '', rent: '1600' });
  });

  it('reports what it could not read instead of dropping it silently', () => {
    const { rows, notes } = parsePasted('1A\tJane\tabc\tnot a date\t2025-01-01');
    expect(rows).toHaveLength(1);
    expect(notes.join(' ')).toContain('start date');
    expect(notes.join(' ')).toContain('rent');
  });

  it('skips empty lines and an empty paste', () => {
    expect(parsePasted('').rows).toEqual([]);
    expect(parsePasted('\n\n').rows).toEqual([]);
    expect(parsePasted('1A\tJane\t1000\t2024-01-01\t2025-01-01\n\t\t\n').rows).toHaveLength(1);
  });

  it('month to month can come from a Term column', () => {
    const { rows } = parsePasted('Unit\tTenant\tRent\tStart\tTerm\n5E\tZed\t1000\t2023-01-01\tMonth-to-month');
    expect(rows[0].term).toBe('month_to_month');
    expect(rows[0].end).toBe('');
  });
});

describe('checking the rent roll before saving', () => {
  it('a complete tenant row is valid', () => {
    expect(validateGrid([row()])).toEqual([]);
  });

  it('flags missing or wrong values on the right field', () => {
    const issues = validateGrid([row({ unit: '', rent: '', start: 'x', dueDay: '40', annualPct: '90', email: 'nope' })]);
    const fields = issues.map((i) => i.field).sort();
    expect(fields).toEqual(['annualPct', 'dueDay', 'email', 'rent', 'start', 'unit'].sort());
  });

  it('a fixed lease needs an end date after its start; month to month does not', () => {
    expect(validateGrid([row({ end: '' })]).map((i) => i.field)).toEqual(['end']);
    expect(validateGrid([row({ end: '2023-01-01' })])[0].message).toContain('ends before it starts');
    expect(validateGrid([row({ end: '', term: 'month_to_month' })])).toEqual([]);
  });

  it('two tenants cannot share a unit (case and spacing ignored)', () => {
    const issues = validateGrid([row({ unit: 'Suite 100' }), row({ unit: ' suite 100 ', tenant: 'Other' })]);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('twice');
  });

  it('a vacant unit needs only its unit name', () => {
    expect(validateGrid([emptyRow({ unit: '4D' })])).toEqual([]);
    expect(validateGrid([emptyRow({ unit: '4D', rent: 'abc' })]).map((i) => i.field)).toEqual(['rent']);
  });

  it('removed rows are not checked', () => {
    expect(validateGrid([row({ unit: '', remove: true })])).toEqual([]);
  });
});

describe('planning the database writes', () => {
  const opts = { today: '2026-10-01', defaultLeaseType: 'Gross' };

  it('each tenant becomes its own lease with its own rent and move-in date', () => {
    const plan = planWrites([
      row({ unit: '1A', tenant: 'Jane', rent: '1450', start: '2024-03-01', end: '2025-02-28' }),
      row({ unit: '1B', tenant: 'Sam', rent: '1395', start: '2023-09-15', end: '', term: 'month_to_month' }),
    ], opts);
    expect(plan.leases.map((l) => [l.tenant_name, l.monthly_rent, l.lease_start_date, l.lease_end_date, l.term_type])).toEqual([
      ['Jane', 1450, '2024-03-01', '2025-02-28', 'fixed'],
      ['Sam', 1395, '2023-09-15', null, 'month_to_month'],
    ]);
    expect(plan.units.map((u) => [u.unit_number, u.status])).toEqual([['1A', 'occupied'], ['1B', 'occupied']]);
    expect(plan.leases[0].lease_type).toBe('Gross');
  });

  it('a vacant row creates a vacant unit with its asking rent and no lease', () => {
    const plan = planWrites([emptyRow({ unit: '4D', rent: '1600' })], opts);
    expect(plan.leases).toEqual([]);
    expect(plan.units[0]).toMatchObject({ unit_number: '4D', status: 'vacant', market_rent: 1600 });
  });

  it('clearing the tenant on an existing row, or removing it, closes the lease instead of deleting it', () => {
    const plan = planWrites([
      row({ leaseId: 'L1', unitId: 'U1', tenant: '' }),
      row({ unit: '2B', leaseId: 'L2', unitId: 'U2', remove: true }),
    ], opts);
    expect(plan.deactivate.sort()).toEqual(['L1', 'L2']);
    expect(plan.leases).toEqual([]);
    expect(plan.units).toHaveLength(1);
  });

  it('keeps existing ids so an edit updates the lease and unit rather than duplicating them', () => {
    const plan = planWrites([row({ leaseId: 'L9', unitId: 'U9' })], opts);
    expect(plan.leases[0].leaseId).toBe('L9');
    expect(plan.units[0].unitId).toBe('U9');
  });

  it('a yearly increase schedules the next anniversary, but only for fixed terms and never when increases are not automatic', () => {
    expect(planWrites([row({ annualPct: '3' })], opts).leases[0]).toMatchObject({ escalation_rate: 3, escalation_type: 'Percentage Bump (%)', next_escalation_date: '2027-03-01' });
    expect(planWrites([row({ annualPct: '3', term: 'month_to_month', end: '' })], opts).leases[0]).toMatchObject({ escalation_rate: 0, escalation_type: null, next_escalation_date: null });
    expect(planWrites([row({ annualPct: '3' })], { ...opts, noAutoIncrease: true }).leases[0].escalation_rate).toBe(0);
  });

  it('finds the next anniversary after today, clamping month ends', () => {
    expect(nextAnniversary('2024-03-01', '2026-10-01')).toBe('2027-03-01');
    expect(nextAnniversary('2024-10-01', '2026-10-01')).toBe('2027-10-01');
    expect(nextAnniversary('2024-02-29', '2026-10-01')).toBe('2027-02-28');
  });
});

describe('totals above the grid', () => {
  it('counts units, occupancy and rent, ignoring removed and blank rows', () => {
    const s = summarizeGrid([row({ rent: '1000' }), row({ unit: '1B', tenant: 'Sam', rent: '1500' }), emptyRow({ unit: '1C' }), row({ unit: '1D', remove: true }), emptyRow()]);
    expect(s).toEqual({ units: 3, occupied: 2, vacant: 1, monthlyRent: 2500, annualRent: 30000, occupancyPct: 66.7 });
  });
});
