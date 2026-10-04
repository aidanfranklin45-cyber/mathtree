import type { DealRecord } from '../math/types';

/**
 * Stage lenses: which deal-screen tabs belong to which stage of a property's life.
 *
 * A prospect has no tenants, rent collection or performance history, so it only shows the underwriting tabs. An owned
 * property leads with Performance and Operate and keeps the analysis tabs (hold, refinance, remodel, sell). Pure (no UI,
 * no database) so it can be tested. The stage itself is read from the existing `status` and `inputs.dealStage`.
 */
export type DealStage = 'screening' | 'loi' | 'due_diligence' | 'closing' | 'owned' | 'disposition';
export type StudioTabKey = 'performance' | 'operate' | 'overview' | 'diligence' | 'proforma' | 'property' | 'debt' | 'sensitivity' | 'tax';
export type StageLensKind = 'underwriting' | 'owned';

export const STAGE_LABEL: Record<DealStage, string> = {
  screening: 'Underwriting',
  loi: 'LOI Submitted',
  due_diligence: 'Due Diligence',
  closing: 'Closing',
  owned: 'Owned',
  disposition: 'Exited',
};

const PROSPECT_STAGES: DealStage[] = ['screening', 'loi', 'due_diligence', 'closing', 'disposition'];

/** An owned deal is always `owned`; otherwise the saved `dealStage`, or `screening` when it is missing or unknown. */
export function getDealStage(deal: Pick<DealRecord, 'status' | 'inputs'>): DealStage {
  if (deal.status === 'owned') return 'owned';
  const saved = String(deal.inputs?.dealStage ?? '');
  return (PROSPECT_STAGES as string[]).includes(saved) ? (saved as DealStage) : 'screening';
}

const UNDERWRITING_TABS: StudioTabKey[] = ['overview', 'proforma', 'property', 'debt', 'diligence', 'sensitivity', 'tax'];
const OWNED_TABS: StudioTabKey[] = ['performance', 'operate', 'overview', 'proforma', 'property', 'debt', 'sensitivity', 'tax'];

export interface StageLens {
  stage: DealStage;
  kind: StageLensKind;
  /** Tabs shown, in display order. */
  tabs: StudioTabKey[];
  defaultTab: StudioTabKey;
  /** Operations, payments and performance only make sense once the property is owned. */
  showOperations: boolean;
}

export function getStageLens(deal: Pick<DealRecord, 'status' | 'inputs'>): StageLens {
  const stage = getDealStage(deal);
  if (stage === 'owned') return { stage, kind: 'owned', tabs: OWNED_TABS, defaultTab: 'performance', showOperations: true };
  return { stage, kind: 'underwriting', tabs: UNDERWRITING_TABS, defaultTab: 'overview', showOperations: false };
}

/** The tab to render: the requested one if this stage shows it, otherwise the stage's default (for example an old `?tab=diligence` link on an owned deal). */
export function resolveTab(lens: Pick<StageLens, 'tabs' | 'defaultTab'>, requested: string | null | undefined): StudioTabKey {
  return (lens.tabs as string[]).includes(requested ?? '') ? (requested as StudioTabKey) : lens.defaultTab;
}

export interface OperateSummary {
  activeLeases: number;
  monthlyContractRent: number;
  /** Most recent months that have payment records (newest first, at most `months`). */
  recent: Array<{ month: string; due: number; paid: number }>;
}

/** A short rent summary for one property from the lease and payment facts, for the Operate tab. */
export function summarizeOperate(
  leases: Array<{ monthly_rent: number | null; is_active: boolean | null }>,
  payments: Array<{ period_month: string; amount_due: number | null; amount_paid: number | null }>,
  months = 3,
): OperateSummary {
  const active = leases.filter((l) => l.is_active !== false);
  const byMonth = new Map<string, { due: number; paid: number }>();
  for (const p of payments) {
    const key = String(p.period_month).slice(0, 7);
    const cur = byMonth.get(key) ?? { due: 0, paid: 0 };
    cur.due += Number(p.amount_due) || 0;
    cur.paid += Number(p.amount_paid) || 0;
    byMonth.set(key, cur);
  }
  const recent = [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, months)
    .map(([month, v]) => ({ month, ...v }));
  return {
    activeLeases: active.length,
    monthlyContractRent: active.reduce((s, l) => s + (Number(l.monthly_rent) || 0), 0),
    recent,
  };
}
