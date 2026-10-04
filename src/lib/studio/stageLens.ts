import type { DealRecord } from '../math/types';

/**
 * Stage lenses: which deal-screen tabs belong to which stage of a property's life.
 *
 * A prospect has no tenants, rent collection or performance history, so it only shows the underwriting tabs. An owned
 * property opens on the Overview, adds Operate, keeps the analysis tabs (hold, refinance, remodel, sell) and ends with Performance. Pure (no UI,
 * no database) so it can be tested. The stage itself is read from the existing `status` and `inputs.dealStage`.
 */
export type DealStage = 'screening' | 'loi' | 'due_diligence' | 'closing' | 'owned' | 'disposition';
export type StudioTabKey = 'performance' | 'operate' | 'overview' | 'diligence' | 'proforma' | 'property' | 'debt' | 'sensitivity';
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

const UNDERWRITING_TABS: StudioTabKey[] = ['overview', 'proforma', 'property', 'debt', 'diligence', 'sensitivity'];
const OWNED_TABS: StudioTabKey[] = ['overview', 'operate', 'proforma', 'property', 'debt', 'sensitivity', 'performance'];

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
  if (stage === 'owned') return { stage, kind: 'owned', tabs: OWNED_TABS, defaultTab: 'overview', showOperations: true };
  return { stage, kind: 'underwriting', tabs: UNDERWRITING_TABS, defaultTab: 'overview', showOperations: false };
}

/** The tab to render: the requested one if this stage shows it, otherwise the stage's default (for example an old `?tab=diligence` link on an owned deal). */
export function resolveTab(lens: Pick<StageLens, 'tabs' | 'defaultTab'>, requested: string | null | undefined): StudioTabKey {
  return (lens.tabs as string[]).includes(requested ?? '') ? (requested as StudioTabKey) : lens.defaultTab;
}
