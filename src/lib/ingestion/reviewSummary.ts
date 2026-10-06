/**
 * The checks and balances for a property built from documents, in one place: the checks on the documents' own arithmetic, and whether the net
 * operating income this underwriting arrives at is close to the one the seller states. The first rule of this engine is to keep mistakes out of an
 * underwriting, so a large gap between the two is not left for the owner to notice: it is named, with what the owner changed from the document.
 *
 * Pure. It reads the record saved with the project and the engine's own result.
 */

import type { IntakeRecord } from './intakeRecord';

/** The two NOIs are of the same property on nearly the same facts, so a gap beyond this is a flag. Legitimate differences (your own vacancy, costs, a manager) are listed beside it. */
export const NOI_TIE_TOLERANCE = 0.10;

export interface ReviewItem {
  label: string;
  ok: boolean;
  detail: string;
}

export interface ReviewSummary {
  items: ReviewItem[];
  consistent: number;
  toReview: number;
}

const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;
const claimed = (record: Pick<IntakeRecord, 'claims'>, test: RegExp): number | null => {
  const c = (record.claims ?? []).find((x) => test.test(x.label));
  return c && Number.isFinite(c.value) ? c.value : null;
};

export function reviewSummary(args: { record: Partial<IntakeRecord> | null | undefined; ourNoi: number | null; selfManaged: boolean }): ReviewSummary {
  const { record, ourNoi, selfManaged } = args;
  const items: ReviewItem[] = [];
  if (!record) return { items, consistent: 0, toReview: 0 };

  for (const c of record.checks ?? []) items.push({ label: c.label, ok: c.ok, detail: c.detail });

  const sellerNoi = claimed({ claims: record.claims ?? [] }, /NOI claimed/i);
  const sellerManagement = claimed({ claims: record.claims ?? [] }, /management cost/i);
  if (sellerNoi !== null && sellerNoi > 0 && ourNoi !== null && ourNoi > 0) {
    // The seller's NOI is after the seller's own management cost. An owner who manages the property does not pay it, so it is added back to compare like with like.
    const addBack = selfManaged && sellerManagement !== null ? sellerManagement : 0;
    const comparable = sellerNoi + addBack;
    const gap = Math.abs(ourNoi - comparable) / comparable;
    const ok = gap <= NOI_TIE_TOLERANCE;
    const changes = (record.figures ?? []).filter((f) => f.source === 'owner').map((f) => f.label);
    items.push({
      label: 'Your net operating income against the seller\'s',
      ok,
      detail: `This underwriting arrives at ${money(ourNoi)} before loan payments. The seller states ${money(sellerNoi)}${addBack > 0 ? `, which is ${money(comparable)} before the seller's own management cost of ${money(addBack)} (you do not charge it)` : ''}. They are ${(gap * 100).toFixed(1)}% apart. ${ok
        ? 'That is close.'
        : `That is a large gap, and the reason is not always visible here. Review it before you take this to anyone.${changes.length > 0 ? ` What you changed from the document: ${changes.join(', ')}.` : ' You have not changed any figure from the document, so look at how the documents were read.'}`}`,
    });
  }

  const consistent = items.filter((i) => i.ok).length;
  return { items, consistent, toReview: items.length - consistent };
}
