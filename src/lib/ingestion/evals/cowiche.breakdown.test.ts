/**
 * The expense ratio's breakdown for the Cowiche Creek memorandum: what is counted, what is netted off, what is left out, and that it adds back to
 * the very ratio the engine was given.
 */
import { describe, expect, it } from 'vitest';
import { checkTitle, expectedCosts, ratioBreakdown, ratioChecks } from '../ratioBreakdown';
import { documentChecks } from '../validate';
import { DOC, underwrite } from './cowicheFlow';

const flow = underwrite();
const rows = flow.record.lineage ?? [];
const docRatio = Number(flow.inputs.expenseRatio);

describe('how the Cowiche ratio is built', () => {
  const b = ratioBreakdown(rows, 1_450_800)!;

  it('adds back to the ratio the engine was given', () => {
    expect(b.ratioPercent).toBeCloseTo(docRatio, 2);
    expect(b.ratioPercent).toBeCloseTo(18.03, 2);
  });

  it('counts the operating costs, grouped, largest first', () => {
    expect(b.counted.map((g) => g.name)).toEqual(['Property taxes', 'Utilities', 'Payroll', 'Other costs', 'Repairs and upkeep', 'Insurance', 'Marketing']);
    expect(b.counted[0]).toMatchObject({ amount: 115_670, percentOfRent: 8 });
    expect(b.grossCosts).toBe(365_440);
  });

  it('keeps the lines of a group with their pages, so it can be opened', () => {
    const upkeep = b.counted.find((g) => g.name === 'Repairs and upkeep')!;
    expect(upkeep.lines.map((l) => l.label).sort()).toEqual(['Maint/Repair', 'Turnover']);
    expect(upkeep.lines.every((l) => l.page === 9)).toBe(true);
  });

  it('nets off the tenant reimbursements', () => {
    expect(b.reimbursements).toMatchObject({ name: 'Tenant reimbursements', amount: 103_932 });
    expect(b.netCosts).toBe(261_508);
  });

  it('leaves out what is charged separately: the seller\'s management and the replacement reserve', () => {
    expect(b.leftOut.map((g) => [g.name, g.amount])).toEqual([["Management (the seller's)", 53_522], ['Replacement reserve', 16_500]]);
    expect(b.counted.some((g) => g.lines.some((l) => l.label === 'Management' || l.label === 'Reserves'))).toBe(false);
  });

  it('states the amounts but no shares while the rent is undecided', () => {
    const open = ratioBreakdown(rows, null)!;
    expect(open.ratioPercent).toBeNull();
    expect(open.counted.every((g) => g.percentOfRent === null)).toBe(true);
    expect(open.netCosts).toBe(261_508);
  });

  it('has nothing to show when the document gave no operating costs', () => {
    expect(ratioBreakdown([], 1_000_000)).toBeNull();
  });
});

describe('the breakdown follows the rent that was elected', () => {
  it('re-divides the same costs by whichever rent was chosen, and matches the engine\'s ratio for each', () => {
    for (const monthly of [120_900, 125_700]) {
      const f = underwrite({}, { rent: monthly });
      const b = ratioBreakdown(f.record.lineage ?? [], monthly * 12)!;
      expect(b.netCosts).toBe(261_508);
      expect(b.ratioPercent, `rent ${monthly}`).toBeCloseTo(Number(f.inputs.expenseRatio), 2);
    }
  });
});

describe('the questions asked of the lines', () => {
  const checks = documentChecks(flow.intake);
  const expected = expectedCosts('multi-unit');
  const run = (r = rows, used = [DOC]) => ratioChecks({ rows: r, usedDocuments: used, checks, expected });
  const find = (cs: ReturnType<typeof run>, id: string) => cs.find((c) => c.id === id);

  it('confirms the lines add up to the document\'s own NOI, and finds nothing missing or repeated', () => {
    const cs = run();
    expect(find(cs, 'ties')).toMatchObject({ ok: true });
    expect(find(cs, 'ties')!.text).toContain('0.7% apart');
    expect(cs.filter((c) => !c.ok)).toEqual([]);
  });

  it('asks about a usual cost the document has no line for', () => {
    const cs = run(rows.filter((r) => r.label !== 'Insurance'));
    expect(find(cs, 'missing:insurance')).toMatchObject({ ok: false });
    expect(find(cs, 'missing:insurance')!.text).toMatch(/No insurance line found/);
  });

  it('says so when the lines do not add up to the document\'s NOI', () => {
    const failing = [{ label: "Income less costs equals the memorandum's NOI", ok: false, detail: 'We read 1,200,000; it prints 1,093,745 (9.7% apart).' }];
    const cs = ratioChecks({ rows, usedDocuments: [DOC], checks: failing, expected });
    expect(find(cs, 'ties')).toMatchObject({ ok: false });
    expect(find(cs, 'ties')!.text).toMatch(/missing or counted twice/);
  });

  it('flags the same line and amount appearing twice', () => {
    const tax = rows.find((r) => r.label === 'RE Taxes')!;
    const cs = run([...rows, { ...tax }]);
    expect(cs.find((c) => c.id.startsWith('twice:'))).toMatchObject({ ok: false });
  });

  it('shows another document\'s costs without adding them, and says whether it agrees', () => {
    const second = (factor: number) => rows.filter((r) => r.section === 'Expense').map((r) => ({ ...r, document: 'T12.pdf', amount: (r.amount ?? 0) * factor }));
    const agrees = run([...rows, ...second(1)]);
    expect(find(agrees, 'other:T12.pdf')).toMatchObject({ ok: true });
    expect(ratioBreakdown([...rows, ...second(1)].filter((r) => r.document === DOC), 1_450_800)!.grossCosts).toBe(365_440);
    const differs = run([...rows, ...second(1.25)]);
    expect(find(differs, 'other:T12.pdf')).toMatchObject({ ok: false });
  });

  it('expects fewer costs of a net-leased commercial property, whose tenants pay them', () => {
    expect(expectedCosts('commercial', 'NNN')).toEqual([]);
    expect(expectedCosts('commercial', 'Gross')).toContain('insurance');
  });

  it('gives each failed check a short title for its warning', () => {
    expect(checkTitle({ id: 'ties', ok: false, text: '' })).toMatch(/don't add up/);
    expect(checkTitle({ id: 'missing:insurance', ok: false, text: '' })).toMatch(/no line/);
  });
});
