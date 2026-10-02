import type { RemodelPlan } from './plan';

/** Pure helpers behind the Remodel modal, kept out of the component so they can be tested without a browser. */

/** What a number box means by its text. Empty, "-" and "." are zero; anything unreadable is zero. */
export function parseNumInput(text: string): number {
  const t = text.trim();
  if (t === '' || t === '-' || t === '.' || t === '-.') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

/** The text a number box should show for a value (zero shows empty, so the box can be cleared and retyped). */
export function numToText(value: number | undefined): string {
  return value === undefined || value === 0 || !Number.isFinite(value) ? '' : String(value);
}

/** First of next month, as 'YYYY-MM'. */
export function nextMonth(from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function blankPlan(id: string, now: Date = new Date()): RemodelPlan {
  return {
    id, name: 'New remodel', startDate: nextMonth(now), durationMonths: 6, cost: 0, financing: 'cash', rentDuringWorksPct: 0,
    rentAfter: { mode: 'monthly', value: 0 }, valueMode: 'cap_rate',
  };
}

/** What is still missing before the plan can be judged or committed (plain words, in the order the form shows them). */
export function missingForPlan(plan: RemodelPlan): string[] {
  const missing: string[] = [];
  if (!plan.name?.trim()) missing.push('a name');
  if (!/^\d{4}-\d{2}/.test(plan.startDate ?? '')) missing.push('a start month');
  if (!(Number(plan.cost) > 0)) missing.push('the cost');
  if (plan.valueMode !== 'manual') {
    const { mode, value, addedSf } = plan.rentAfter ?? { mode: 'monthly', value: 0 };
    if (!(Number(value) > 0)) missing.push(mode === 'pct_increase' ? 'the % increase' : mode === 'per_sf' ? 'the $ per sf' : 'the new rent');
    if (mode === 'per_sf' && !(Number(addedSf) > 0)) missing.push('the added sq ft');
  } else if (!(Number(plan.manualValue) > 0)) {
    missing.push('the value after');
  }
  if (plan.financing === 'new_loan' && plan.ltcPct !== undefined && (plan.ltcPct < 0 || plan.ltcPct > 100)) missing.push('a borrowed share between 0 and 100');
  return missing;
}

/** The plan list after saving `draft` (replaces the plan with the same id, otherwise adds it). */
export function plansAfterSave(plans: RemodelPlan[], draft: RemodelPlan): RemodelPlan[] {
  return plans.some((p) => p.id === draft.id) ? plans.map((p) => (p.id === draft.id ? draft : p)) : [...plans, draft];
}

/** The plan list after deleting `id`, and which plan to show next. */
export function plansAfterDelete(plans: RemodelPlan[], id: string): { plans: RemodelPlan[]; next: RemodelPlan | null } {
  const rest = plans.filter((p) => p.id !== id);
  return { plans: rest, next: rest[0] ?? null };
}
