/**
 * What an expense ratio from a document is made of, in groups an owner can take in at a glance: the costs that count, the tenant reimbursements
 * netted off them, the costs left out because they are charged separately, and the rent it all is a share of. It reads the lines the reader took
 * from the document (with their pages), sorted by the same rules the ratio itself is built with (`expenseKeys` in lineage.ts), so what is counted
 * here is what the ratio counted.
 *
 * Pure. It presents the document's own figures; it does not compute a new metric. The engine's ratio is the one that is used.
 */

import type { TraceRow } from './lineage';

export interface BreakdownLine { label: string; amount: number; page: number | null }

export interface BreakdownGroup {
  name: string;
  amount: number;
  /** The share of the rent, in percent; null while the rent is still undecided. */
  percentOfRent: number | null;
  lines: BreakdownLine[];
}

export interface RatioBreakdown {
  /** The costs the ratio counts, largest first. */
  counted: BreakdownGroup[];
  grossCosts: number;
  /** Tenant reimbursements (utility billing, recoveries), taken off the costs. */
  reimbursements: BreakdownGroup | null;
  netCosts: number;
  /** Charged separately, so not in the ratio: the seller's management, the replacement reserve. */
  leftOut: BreakdownGroup[];
  rentAnnual: number | null;
  /** 1 for a year; more for a statement of part of a year, whose amounts were made a year the way the ratio does. */
  annualFactor: number;
  /** Net costs over the rent, in percent; null while the rent is undecided. */
  ratioPercent: number | null;
}

const COUNTED_NAME: Record<string, string> = {
  property_tax: 'Property taxes', insurance: 'Insurance', utilities: 'Utilities', repairs_maintenance: 'Repairs and upkeep', payroll: 'Payroll',
  marketing: 'Marketing', professional_fees: 'Professional fees', other: 'Other costs',
};
const LEFT_OUT_NAME: Record<string, string> = {
  management: "Management (the seller's)", reserves_capex: 'Replacement reserve', debt_service: 'Debt service', depreciation_amortization: 'Depreciation',
};

const share = (amount: number, rent: number | null): number | null => (rent !== null && rent > 0 ? Math.round((amount / rent) * 1000) / 10 : null);

function group(name: string, rows: TraceRow[], rent: number | null): BreakdownGroup {
  const lines = rows.map((r) => ({ label: r.label, amount: Math.abs(r.amount ?? 0) * (r.annualFactor ?? 1), page: r.page }));
  const amount = lines.reduce((s, l) => s + l.amount, 0);
  return { name, amount, percentOfRent: share(amount, rent), lines };
}

function bucket(rows: TraceRow[], names: Record<string, string>): Map<string, TraceRow[]> {
  const out = new Map<string, TraceRow[]>();
  for (const r of rows) {
    const name = names[r.category ?? ''] ?? 'Other costs';
    out.set(name, [...(out.get(name) ?? []), r]);
  }
  return out;
}

/** Null when the document gave no costs that count. `rentAnnual` is the rent the ratio is measured against, once it is decided. */
export function ratioBreakdown(rows: TraceRow[], rentAnnual: number | null): RatioBreakdown | null {
  const withAmount = rows.filter((r) => r.amount !== null && r.amount !== undefined);
  const costRows = withAmount.filter((r) => r.section === 'Expense');
  const counted = costRows.filter((r) => (r.keys ?? []).includes('expenseRatio'));
  if (counted.length === 0) return null;
  const rent = rentAnnual !== null && rentAnnual > 0 ? rentAnnual : null;

  const countedGroups = [...bucket(counted, COUNTED_NAME)].map(([name, rs]) => group(name, rs, rent)).sort((a, b) => b.amount - a.amount);
  const grossCosts = countedGroups.reduce((s, g) => s + g.amount, 0);
  const back = withAmount.filter((r) => r.section === 'Income' && r.category === 'recoveries');
  const reimbursements = back.length ? group('Tenant reimbursements', back, rent) : null;
  const netCosts = grossCosts - (reimbursements?.amount ?? 0);
  const leftOutRows = costRows.filter((r) => !(r.keys ?? []).includes('expenseRatio') && r.category !== null);
  const leftOut = [...bucket(leftOutRows, LEFT_OUT_NAME)].map(([name, rs]) => group(name, rs, rent)).sort((a, b) => b.amount - a.amount);

  const annualFactor = counted.find((r) => r.annualFactor)?.annualFactor ?? 1;
  return { counted: countedGroups, grossCosts, reimbursements, netCosts, leftOut, rentAnnual: rent, annualFactor, ratioPercent: share(netCosts, rent) === null ? null : Math.round((netCosts / (rent as number)) * 10000) / 100 };
}

// ---------------------------------------------------------------------------
// Checks on the lines: where they came from, whether any is counted twice, whether the document is missing one
// ---------------------------------------------------------------------------

export interface RatioCheck {
  id: string;
  /** True when the lines pass this check; false when the owner should look. */
  ok: boolean;
  /** One short sentence. */
  text: string;
}

const money = (n: number): string => '$' + Math.round(n).toLocaleString('en-US');

/** The costs a property of this kind would be expected to show, so a missing one is asked about (it may be charged to tenants). */
export function expectedCosts(assetClass: string | null | undefined, leaseType?: string | null): string[] {
  const cls = String(assetClass ?? '');
  if (cls === 'commercial') return leaseType === 'NNN' ? [] : ['property_tax', 'insurance', 'repairs_maintenance'];
  // A house's tenant pays the utilities, and a storage facility's are small and sometimes not separate
  if (cls === 'storage' || cls === 'single-family') return ['property_tax', 'insurance', 'repairs_maintenance'];
  return ['property_tax', 'insurance', 'utilities', 'repairs_maintenance'];
}

const yearly = (r: TraceRow): number => Math.abs(r.amount ?? 0) * (r.annualFactor ?? 1);
const counted = (rows: TraceRow[]): TraceRow[] => rows.filter((r) => r.section === 'Expense' && (r.keys ?? []).includes('expenseRatio') && r.amount !== null && r.amount !== undefined);

/**
 * The questions to ask of the lines an expense ratio is built from, in the order an underwriter would: do they add up to what the document says
 * (nothing missing, nothing counted twice), is a usual cost absent, does any line appear twice, and does another document say something different.
 * `usedDocuments` are the documents the ratio was built from (all of them when empty); `checks` are the document's own arithmetic.
 */
export function ratioChecks(args: { rows: TraceRow[]; usedDocuments: string[]; checks: Array<{ label: string; ok: boolean; detail: string }>; expected: string[]; /** The kind of document the ratio was built from, so the arithmetic checked is that document's own. */ usedType?: string }): RatioCheck[] {
  const out: RatioCheck[] = [];
  const used = args.usedDocuments.length ? args.rows.filter((r) => args.usedDocuments.includes(r.document)) : args.rows;
  const lines = counted(used);

  // Do the lines add up to the document's own NOI?
  const own = args.usedType === 'operating_statement' ? /statement/i : args.usedType === 'offering_memorandum' ? /memorandum/i : /./;
  const tie = args.checks.find((c) => /^Income less costs/i.test(c.label) && own.test(c.label));
  if (tie) {
    const gap = /\(([\d.]+)% apart\)/.exec(tie.detail)?.[1];
    out.push(tie.ok
      ? { id: 'ties', ok: true, text: `The lines add up to the document's own NOI${gap ? ` (${gap}% apart)` : ''}.` }
      : { id: 'ties', ok: false, text: `The lines do not add up to the document's own NOI${gap ? ` (${gap}% apart)` : ''}: one may be missing or counted twice.` });
  }

  // A usual cost with no line
  for (const cat of args.expected) {
    if (!lines.some((r) => r.category === cat)) {
      const name = (COUNTED_NAME[cat] ?? cat).toLowerCase();
      out.push({ id: `missing:${cat}`, ok: false, text: `No ${name} line found. Is it missing, or charged to tenants?` });
    }
  }

  // The same line and amount twice
  const seen = new Map<string, TraceRow[]>();
  for (const r of lines) {
    const key = `${r.label.trim().toLowerCase()}|${Math.abs(r.amount ?? 0)}`;
    seen.set(key, [...(seen.get(key) ?? []), r]);
  }
  for (const [, rs] of seen) {
    if (rs.length > 1) out.push({ id: `twice:${rs[0].label}`, ok: false, text: `"${rs[0].label}" ${money(Math.abs(rs[0].amount ?? 0))} appears ${rs.length} times; one may be a repeat.` });
  }

  // Another document with costs of its own: which is used, and whether it agrees
  const usedTotal = lines.reduce((s, r) => s + yearly(r), 0);
  const others = [...new Set(args.rows.map((r) => r.document))].filter((d) => args.usedDocuments.length > 0 && !args.usedDocuments.includes(d));
  for (const doc of others) {
    const total = counted(args.rows.filter((r) => r.document === doc)).reduce((s, r) => s + yearly(r), 0);
    if (total <= 0) continue;
    const off = usedTotal > 0 ? Math.abs(total - usedTotal) / usedTotal : 0;
    out.push(off > 0.05
      ? { id: `other:${doc}`, ok: false, text: `${doc} shows costs of ${money(total)}, ${(off * 100).toFixed(0)}% from ${money(usedTotal)}. Only the first is used; check which is right.` }
      : { id: `other:${doc}`, ok: true, text: `${doc} shows costs of ${money(total)} too. It is not added again.` });
  }
  return out;
}

/** A few words for a check that failed, as the title of its warning. */
export function checkTitle(c: RatioCheck): string {
  if (c.id === 'ties') return "Expense lines don't add up";
  if (c.id.startsWith('missing:')) return 'A usual cost has no line';
  if (c.id.startsWith('twice:')) return 'A cost line may be repeated';
  return 'Two documents disagree on costs';
}
