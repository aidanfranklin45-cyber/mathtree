/**
 * The check before confirming. The worksheet says, row by row, whether each assumption stands; this reads them together and asks the question
 * the rows cannot: is this an underwriting the system is confident in? It finds two kinds of thing.
 *
 *   blockers  something is owed: a figure the engine cannot run without, a question not answered, a figure that needs evidence and has none.
 *             The project is not confirmed until each is settled.
 *   warnings  the figures are all there but do not sit together well (the seller's NOI is far from ours, the exit cap is lower than the cap paid,
 *             the debt barely covers). The owner reads each and says they have, so the judgment is theirs and on the record.
 *
 * The thresholds here only decide when to ask. They never fill, change or limit a figure, and they are not market data: a number the owner
 * disagrees with is answered with "I have read this", not with a different number.
 *
 * Pure.
 */

import type { MissingInput } from '@engine/inputRequirements';
import type { RecordedCheck } from './intakeRecord';
import { NOI_TIE_TOLERANCE } from './reviewSummary';
import type { WorksheetRow } from './worksheet';

export type Verdict = 'ready' | 'review' | 'not_ready';

export interface Finding {
  /** Stable, so an acknowledgment survives a re-render. */
  id: string;
  severity: 'blocker' | 'warning';
  title: string;
  detail: string;
  /** The worksheet row it is about, when it is about one. */
  rowKey?: string;
}

export interface Readiness {
  verdict: Verdict;
  blockers: Finding[];
  warnings: Finding[];
  /** Warnings the owner has not yet said they have read. */
  unacknowledged: Finding[];
  /** A sentence for the top of the confirmation. */
  summary: string;
}

/** What the engine arrives at with these figures. */
export interface Outcome {
  noi: number;
  /** The going-in cap rate, in percent. */
  capRate: number;
  dscr: number | string | null;
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** An expense ratio outside this range is not impossible, but is far enough from most properties that the owner should see it said. */
export const EXPENSE_RATIO_RANGE = { low: 20, high: 60 };
/** Debt service coverage under which the owner is told. Lenders commonly ask for about this much. */
export const THIN_DSCR = 1.25;
/** Vacancy under which the owner is told: a figure that low assumes the property is never empty. */
export const LOW_VACANCY = 3;
/** An exit cap this many points under the cap paid assumes the property sells for more on the same income. */
export const CAP_COMPRESSION = 0.5;

export function assess(args: {
  rows: WorksheetRow[];
  /** Inputs the engine still cannot run without, beyond what the rows already show. */
  engineMissing?: MissingInput[];
  outcome?: Outcome | null;
  /** The seller's own figures, for comparison. They are claims: they are never used, only compared. */
  claims?: { noi?: number | null; managementCost?: number | null };
  selfManaged?: boolean;
  /** The documents' own arithmetic, and how each check came out. */
  checks?: RecordedCheck[];
  /** The exit cap rate the deal is underwritten with, in percent. */
  exitCap?: number | null;
  /** The ids of the warnings the owner has said they have read. */
  acknowledged?: Set<string>;
  /** Warnings from checks made elsewhere (the lines an expense ratio is built from), read and acknowledged like the others. */
  extraWarnings?: Finding[];
}): Readiness {
  const blockers: Finding[] = [];
  const warnings: Finding[] = [];
  const rowKeys = new Set(args.rows.map((r) => r.key));

  for (const r of args.rows) {
    if (r.state === 'needed') blockers.push({ id: `needed:${r.key}`, severity: 'blocker', title: `${r.label} is needed`, detail: 'The engine cannot run without it and nothing in your documents or investor profile supplies it.', rowKey: r.key });
    else if (r.state === 'decide') blockers.push({ id: `decide:${r.key}`, severity: 'blocker', title: `${r.label}: a decision is waiting`, detail: [...r.reasons, ...r.decisions.flatMap((d) => d.reasons)].map((x) => x.detail).join(' '), rowKey: r.key });
    else if (r.state === 'unsupported') blockers.push({ id: `unsupported:${r.key}`, severity: 'blocker', title: `${r.label} has no evidence behind it`, detail: r.reasons.map((x) => x.detail).join(' '), rowKey: r.key });
  }
  for (const m of args.engineMissing ?? []) {
    if (!rowKeys.has(m.key)) blockers.push({ id: `needed:${m.key}`, severity: 'blocker', title: `${m.label} is needed`, detail: m.why, rowKey: m.key });
  }

  for (const c of args.checks ?? []) {
    if (!c.ok) warnings.push({ id: `check:${c.label}`, severity: 'warning', title: c.label, detail: c.detail.split('. ')[0] });
  }

  const o = args.outcome;
  if (o) {
    const sellerNoi = args.claims?.noi ?? null;
    if (sellerNoi && sellerNoi > 0 && o.noi > 0) {
      // The seller's NOI is after the seller's own management cost; an owner who manages the property does not pay it
      const addBack = args.selfManaged && args.claims?.managementCost ? args.claims.managementCost : 0;
      const comparable = sellerNoi + addBack;
      const gap = Math.abs(o.noi - comparable) / comparable;
      if (gap > NOI_TIE_TOLERANCE) {
        warnings.push({ id: 'noi-gap', severity: 'warning', title: "Your NOI is far from the seller's", detail: `You ${money(o.noi)}, seller ${money(comparable)}${addBack ? ' (before their management cost)' : ''}: ${(gap * 100).toFixed(0)}% apart.` });
      }
    }
    const dscr = typeof o.dscr === 'number' ? o.dscr : null;
    if (dscr !== null && dscr > 0 && dscr < THIN_DSCR) {
      warnings.push({ id: 'dscr-thin', severity: 'warning', title: 'Debt is thinly covered', detail: `Income covers the payments ${dscr.toFixed(2)} times; lenders commonly want about ${THIN_DSCR}.` });
    }
    const exit = args.exitCap;
    if (exit !== null && exit !== undefined && o.capRate > 0 && exit < o.capRate - CAP_COMPRESSION) {
      warnings.push({ id: 'cap-compression', severity: 'warning', title: 'Exit cap is below the cap paid', detail: `You buy at a ${o.capRate.toFixed(2)}% cap and sell at ${exit}%.` });
    }
  }

  const ratio = args.rows.find((r) => r.key === 'expenseRatio');
  if (ratio && typeof ratio.value === 'number' && ratio.state !== 'unsupported' && (ratio.value < EXPENSE_RATIO_RANGE.low || ratio.value > EXPENSE_RATIO_RANGE.high)) {
    warnings.push({ id: 'expense-ratio-range', severity: 'warning', rowKey: 'expenseRatio', title: `Expense ratio of ${ratio.value}% is unusual`, detail: `Most properties run ${EXPENSE_RATIO_RANGE.low}% to ${EXPENSE_RATIO_RANGE.high}%.` });
  }
  const vacancy = args.rows.find((r) => r.key === 'vacancyRate');
  if (vacancy && typeof vacancy.value === 'number' && vacancy.value < LOW_VACANCY) {
    warnings.push({ id: 'vacancy-low', severity: 'warning', rowKey: 'vacancyRate', title: `Vacancy of ${vacancy.value}% is very low`, detail: 'Check it against how the property has leased.' });
  }

  warnings.push(...(args.extraWarnings ?? []));

  const acknowledged = args.acknowledged ?? new Set<string>();
  const unacknowledged = warnings.filter((w) => !acknowledged.has(w.id));
  const verdict: Verdict = blockers.length > 0 ? 'not_ready' : unacknowledged.length > 0 ? 'review' : 'ready';
  const summary = verdict === 'ready'
    ? 'Every assumption has a source, every question is answered, and the figures sit together.'
    : verdict === 'review'
      ? `${unacknowledged.length} thing${unacknowledged.length === 1 ? '' : 's'} to read before you confirm. Nothing is missing.`
      : `${blockers.length} thing${blockers.length === 1 ? ' is' : 's are'} still owed before this can be confirmed.`;
  return { verdict, blockers, warnings, unacknowledged, summary };
}
