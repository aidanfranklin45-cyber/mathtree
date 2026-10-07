/**
 * The asset-class bench: invented documents for a single-family house, a net-leased retail center, a self-storage facility and a 24-unit apartment
 * building (three documents), each run through the wizard's own steps and then through the engine. The answer key for each says what must be
 * applied without a question, what must be asked, what the documents' own arithmetic says, and that the engine can underwrite the result.
 * The reader's answers are simulated. To try a real document, add it to `documents.ts` the same way and write its key here.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setAssumptionDefaults } from '../../../engine/assumptionDefaults';
import { computeDealMetrics, missingInputsFor } from '../../../engine/compute';
import { withChosenValue } from '../../apply';
import { LINE_CONTRACTS } from '../../contracts';
import { assess, issueFindings } from '../../readiness';
import { MAPLE_OCCUPIED_RENT, MAPLE_OM, MAPLE_ROLL, MAPLE_T10, NNN_RETAIL, SFR_HOUSE, STORAGE_FACILITY } from './documents';
import { BENCH_LOAN, benchProfile, runBench } from './run';

// The investor profile the engine fills what a document leaves unstated from: set for each test, since a test that runs the engine needs it
beforeEach(() => setAssumptionDefaults({ assumptions: benchProfile(), discountRate: 8, exitYear: 10 }));
afterEach(() => setAssumptionDefaults({ assumptions: { assets: {} }, discountRate: undefined, exitYear: undefined } as never));

const LINE_KEYS = new Set(LINE_CONTRACTS.map((c) => c.key));
const lineAsks = (r: ReturnType<typeof runBench>) => r.contracts.filter((c) => c.outcome === 'ask' && LINE_KEYS.has(c.key)).map((c) => c.key).sort();
const applied = (r: ReturnType<typeof runBench>, key: string) => r.proposal.patch.patch[key];

/** What must hold for every property, whatever its class. */
function invariants(r: ReturnType<typeof runBench>) {
  it('finds every number the reader returned in the document', () => {
    expect(r.lineage.filter((l) => !l.found).map((l) => l.label)).toEqual([]);
  });
  it('lets the engine underwrite what the documents gave, with a loan entered: nothing is missing, and the answer is a number', () => {
    expect(r.missing).toEqual([]);
    expect(r.engineError).toBeNull();
    expect(Number.isFinite(r.metrics!.noi) && r.metrics!.noi > 0).toBe(true);
    expect(typeof r.metrics!.dscr).toBe('number');
  });
  it('divides the costs of the expense ratio by the rent the engine will charge it against: the lines shown add back to the ratio applied', () => {
    const ratio = Number(applied(r, 'expenseRatio'));
    if (r.breakdown && Number.isFinite(ratio)) expect(r.breakdown.ratioPercent).toBeCloseTo(ratio, 1);
  });
}

describe('a single-family rental house', () => {
  const r = runBench([SFR_HOUSE]);
  invariants(r);

  it('is a single-family property', () => expect(r.asset).toBe('single-family'));

  it('applies the facts the document states plainly', () => {
    expect(applied(r, 'purchasePrice')).toBe(415_000);
    expect(applied(r, 'squareFeet')).toBe(1860);
    expect(applied(r, 'yearBuilt')).toBe(1998);
    expect(applied(r, 'acres')).toBeCloseTo(0.21, 2);
    expect(applied(r, 'grossRentPerMonth')).toBe(2650);
  });

  it('does not ask how many units a house has', () => {
    expect(r.proposal.changes.find((c) => c.key === 'unitCount')?.unsure).toBeFalsy();
  });

  it("asks about the ratio because the maintenance line is an estimate, and about the seller's management fee", () => {
    expect(r.asks).toEqual(['expenseRatio']);
    expect(lineAsks(r)).toEqual(['managementFee']);
  });

  it('builds the ratio from taxes, insurance and the estimated upkeep: 22.64% of the rent', () => {
    expect(Number(applied(r, 'expenseRatio'))).toBeCloseTo(22.64, 2);
    expect(r.breakdown!.counted.map((g) => g.name).sort()).toEqual(['Insurance', 'Property taxes', 'Repairs and upkeep']);
    expect(r.breakdown!.leftOut.map((g) => g.name)).toEqual(["Management (the seller's)", 'Replacement reserve']);
  });

  it("ties to the document's own NOI and expects no utilities line, since a tenant pays them", () => {
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect(r.lineChecks.filter((c) => !c.ok)).toEqual([]);
  });
});

describe('a net-leased retail center', () => {
  const r = runBench([NNN_RETAIL]);
  invariants(r);

  it('is a commercial property, and takes the lease structure the memorandum states', () => {
    expect(r.asset).toBe('commercial');
    expect(applied(r, 'leaseType')).toBe('NNN');
  });

  it('applies the in-place figures, not the pro forma column', () => {
    expect(applied(r, 'grossRentPerMonth')).toBeCloseTo(412_600 / 12, 1);
    expect(applied(r, 'purchasePrice')).toBe(6_850_000);
    expect(applied(r, 'otherIncomeAnnual')).toBe(6_200);
    expect(applied(r, 'vacancyRate')).toBeCloseTo(5.99, 2);
  });

  it('asks about the management charge, the reimbursements it nets off, and the 88% occupancy that does not match its 6% vacancy line', () => {
    expect(lineAsks(r)).toEqual(['managementFee', 'utilityReimbursements', 'vacancyAgreesWithOccupancy']);
  });

  it("nets the tenants' reimbursements off the costs: a ratio of 3.13%, which is normal for a net lease", () => {
    expect(Number(applied(r, 'expenseRatio'))).toBeCloseTo(3.13, 2);
    expect(r.breakdown!.grossCosts).toBe(121_800);
    expect(r.breakdown!.reimbursements!.amount).toBe(108_900);
    const row = { key: 'expenseRatio', state: 'ready', value: 3.13, label: 'Expense ratio', field: 'opexRatio', group: 'Expenses', source: 'document', basis: '', reasons: [], decisions: [] } as never;
    expect(assess({ rows: [row], netLease: true }).warnings.map((w) => w.id)).not.toContain('expense-ratio-range');
    expect(assess({ rows: [row] }).warnings.map((w) => w.id)).toContain('expense-ratio-range');
  });
});

describe('a self-storage facility', () => {
  const r = runBench([STORAGE_FACILITY]);

  it('is a storage property', () => expect(r.asset).toBe('storage'));

  it('asks which rent: the unit mix (308 units) gives 38,016 a month, the income table 36,817', () => {
    expect(r.asks).toEqual(['grossRentPerMonth']);
    const rent = r.proposal.changes.find((c) => c.key === 'grossRentPerMonth')!;
    expect(rent.alternatives!.map((a) => Math.round(a.value))).toEqual([36_817]);
  });

  it('holds the expense ratio and the payroll and marketing share until the rent is decided', () => {
    for (const key of ['expenseRatio', 'payrollMarketingPercent']) expect(r.proposal.changes.find((c) => c.key === key)!.waitingOn, key).toBe('grossRentPerMonth');
  });

  it('takes the payroll and marketing from the document, not the profile: $70,000 over the rent chosen', () => {
    const chosen = withChosenValue(r.proposal, 'grossRentPerMonth', 36_816.67);
    expect(Number(chosen.patch.patch.payrollMarketingPercent)).toBeCloseTo(15.84, 1);
    expect(Number(chosen.patch.patch.expenseRatio)).toBeCloseTo(16.66, 1);
  });

  it('leaves payroll and marketing out of the ratio: only taxes, insurance, utilities, upkeep and software count', () => {
    expect(r.breakdown!.counted.map((g) => g.name).sort()).toEqual(['Insurance', 'Other costs', 'Property taxes', 'Repairs and upkeep', 'Utilities']);
    expect(r.breakdown!.grossCosts).toBe(73_600);
  });

  it('warns that the unit mix adds up to 308 units, not the 312 stated, and puts the warning to the owner', () => {
    expect(r.issues.map((i) => i.field)).toContain('unitMix');
    expect(issueFindings(r.issues).map((f) => f.title)).toContain("Unit mix doesn't match the unit count");
  });

  it('asks about the off-site management, and not about occupancy, which agrees with the 12% vacancy line', () => {
    expect(lineAsks(r)).toEqual(['managementFee', 'rentAgreesWithStatedAverage']);
  });

  it("underwrites once the owner has chosen the rent: close to the seller's NOI with its management cost added back", () => {
    const chosen = withChosenValue(r.proposal, 'grossRentPerMonth', 36_816.67);
    const inputs = { ...chosen.patch.patch, ...BENCH_LOAN, closingDate: '2026-12-01' };
    const deal = { asset_class: 'storage', purchase_price: 3_900_000, inputs };
    expect(missingInputsFor(deal as never)).toEqual([]);
    const noi = computeDealMetrics(deal as never).noi;
    expect(Math.abs(noi - (255_300 + 21_300)) / (255_300 + 21_300)).toBeLessThan(0.1);
  });
});

describe('a 24-unit apartment building with a memorandum, an operating statement and a rent roll', () => {
  const r = runBench([MAPLE_OM, MAPLE_T10, MAPLE_ROLL]);
  invariants(r);

  it('is a multi-unit property, rented as the rent roll says: 21 of 24 units occupied', () => {
    expect(r.asset).toBe('multi-unit');
    const leases = applied(r, 'leases') as Array<{ monthlyRent: number }>;
    expect(leases).toHaveLength(21);
    expect(leases.reduce((s, l) => s + l.monthlyRent, 0)).toBe(MAPLE_OCCUPIED_RENT);
  });

  it('builds the expense ratio from the operating statement, not the memorandum, annualised from ten months', () => {
    expect(r.breakdown!.annualFactor).toBeCloseTo(1.2, 5);
    expect(r.breakdown!.netCosts).toBeCloseTo(113_400 * 1.2, 0);
    expect(Number(applied(r, 'expenseRatio'))).toBeCloseTo(((113_400 * 1.2) / (MAPLE_OCCUPIED_RENT * 12)) * 100, 1);
  });

  it("divides the statement's costs by what the leases pay, since that is the rent the engine charges the ratio against", () => {
    expect(r.breakdown!.rentAnnual).toBe(MAPLE_OCCUPIED_RENT * 12);
  });

  it("does not add the memorandum's costs a second time, and says they differ from the statement's by 9%", () => {
    const other = r.lineChecks.find((c) => c.id.startsWith('other:'))!;
    expect(other.ok).toBe(false);
    expect(other.text).toMatch(/9%/);
    expect(r.breakdown!.grossCosts).toBeCloseTo(113_400 * 1.2, 0);
  });

  it('ties the statement to its own NOI, leaving the debt service and depreciation below it out of the ratio', () => {
    expect(r.checks.filter((c) => /statement/i.test(c.label)).every((c) => c.ok)).toBe(true);
    expect(r.breakdown!.counted.flatMap((g) => g.lines.map((l) => l.label))).not.toContain('Mortgage interest');
    expect(r.proposal.patch.notes.join(' ')).toMatch(/debt service or depreciation/);
  });

  it('warns once, truthfully: the statement covers ten months. It does not say its expense lines fail to add up.', () => {
    expect(r.issues.map((i) => i.field)).toEqual(['periodEnd']);
  });
});
