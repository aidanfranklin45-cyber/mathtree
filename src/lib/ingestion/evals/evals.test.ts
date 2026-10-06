import { describe, it, expect } from 'vitest';
import { coerceIntake } from '@engine/intakeParse';
import { proposeChanges } from '../apply';
import { groundIntake, traceDocument } from '../lineage';
import { documentChecks } from '../validate';
import { EVAL_CASES } from './cases';

const deal = { asset_class: 'multi-unit', purchase_price: null, inputs: {} };

describe.each(EVAL_CASES)('reading: $name', (c) => {
  const read = coerceIntake('offering_memorandum', c.modelAnswer);
  const intake = groundIntake(read, c.documentText);
  const proposal = proposeChanges([intake], deal);

  it('ends with the figures the answer key expects', () => {
    for (const [key, expected] of Object.entries(c.answerKey.inputs)) {
      const change = proposal.changes.find((x) => x.key === key);
      expect(change, `${key} should be proposed`).toBeDefined();
      expect(Number(change!.value)).toBeCloseTo(expected, 2);
    }
  });

  it('sends exactly the expected figures to the owner as a question', () => {
    expect(proposal.changes.filter((x) => x.unsure).map((x) => x.key).sort()).toEqual([...c.answerKey.flagged].sort());
  });

  it('marks exactly the numbers that are not in the document', () => {
    const rows = traceDocument(intake, c.documentText, 'case');
    expect(rows.filter((r) => !r.found).map((r) => r.label).sort()).toEqual([...c.answerKey.notInDocument].sort());
  });

  it("runs the document's own arithmetic and gets the expected result", () => {
    const checks = documentChecks(intake);
    for (const want of c.answerKey.checks) {
      const got = checks.find((x) => x.label.startsWith(want.startsWith));
      expect(got, `${want.startsWith} should run`).toBeDefined();
      expect(got!.ok).toBe(want.ties);
    }
  });
});
