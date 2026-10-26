import { missingInputsFor } from '../engine/compute';
import { KEYS, stated, type MissingInput } from '@engine/inputRequirements';

type Deal = { asset_class?: string | null; purchase_price?: number | null; inputs?: Record<string, any> | null };

/**
 * A property rented by the unit must say how many units it has: the rent per unit, the unit mix and the check on the rent all rest on it, and
 * nothing is assumed. Apartments and storage only; a single-family home is one unit and a commercial property is rented by the lease.
 */
function unitCountQuestion(deal: Deal): MissingInput[] {
  if (!/storage|multi|apartment/i.test(String(deal.asset_class ?? ''))) return [];
  const units = stated((deal.inputs ?? {}) as Record<string, unknown>, 'unitCount', 'numUnits', 'storageUnitCount');
  if (units !== undefined && units > 0) return [];
  return [{ key: 'unitCount', label: 'Number of units', kind: 'fact', why: 'The rent per unit and the unit mix rest on it. It is on the rent roll or in the offering memorandum, or you know it.' }];
}

/**
 * What the property still needs from the owner, all at once. The engine asks a question only when the answers before it make it relevant:
 * it does not need a rate until the down payment says money is borrowed. But when the down payment is itself unanswered, the rate and the
 * amortization are empty too, and the owner should see the whole loan as one set of blanks, not three questions that appear one by one.
 */
export function openQuestions(deal: Deal): MissingInput[] {
  const base = [...unitCountQuestion(deal), ...missingInputsFor({ asset_class: deal.asset_class ?? undefined, purchase_price: deal.purchase_price ?? undefined, inputs: deal.inputs ?? {} } as any)];
  const downAt = base.findIndex((m) => m.key === 'downPaymentPercent');
  if (downAt < 0) return base;

  const inputs = (deal.inputs ?? {}) as Record<string, unknown>;
  const asked = (key: string) => base.some((m) => m.key === key);
  const loan: MissingInput[] = [];
  if (stated(inputs, 'interestRate') === undefined && !asked('interestRate')) {
    loan.push({ key: 'interestRate', label: 'Interest rate (%)', kind: 'fact', why: 'Set by the loan. It is needed as soon as the down payment says money is borrowed.' });
  }
  if (stated(inputs, ...KEYS.amortization) === undefined && !asked('amortizationYears')) {
    loan.push({ key: 'amortizationYears', label: 'Amortization period (years)', kind: 'fact', why: "The payment is calculated over the loan's own amortization, which varies loan to loan." });
  }
  // The loan questions sit together, straight after the down payment
  return [...base.slice(0, downAt + 1), ...loan, ...base.slice(downAt + 1)];
}
