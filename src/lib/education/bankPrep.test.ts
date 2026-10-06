import { describe, it, expect } from 'vitest';
import { BANK_PREP_NOTE, CONVERSATION, GLOSSARY, LENDER_NUMBERS, LOAN_OFFICER_QUESTIONS, WHAT_TO_BRING } from './bankPrep';

describe('the "Prepare for the bank" content', () => {
  it('has a plain definition for every term, with no duplicates, in alphabetical order', () => {
    const names = GLOSSARY.map((t) => t.term);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    for (const t of [...GLOSSARY, ...LENDER_NUMBERS]) expect(t.plain.length).toBeGreaterThan(30);
  });

  it('covers the terms the app itself puts in front of a user', () => {
    const all = [...GLOSSARY, ...LENDER_NUMBERS].map((t) => t.term.toLowerCase()).join(' | ');
    for (const needed of ['noi', 'dscr', 'loan-to-value', 'cap rate', 'irr', 'npv', 'equity multiple', 'amortization', 'balloon', 'vacancy', 'operating expense ratio', 'replacement reserve', 't12', 'rent roll', 'exit cap rate', 'other income', 'negative leverage']) {
      expect(all).toContain(needed);
    }
  });

  it('lists what to bring: about the borrower, about the property, and what MathTree prepares', () => {
    expect(WHAT_TO_BRING.map((g) => g.heading)).toEqual(['About you', 'About the property', 'Your underwriting']);
    for (const g of WHAT_TO_BRING) { expect(g.items.length).toBeGreaterThanOrEqual(3); for (const i of g.items) expect(i.length).toBeGreaterThan(20); }
  });

  it('tells each question how to answer it and where the answer is in the app', () => {
    for (const q of LOAN_OFFICER_QUESTIONS) {
      expect(q.question.endsWith('?')).toBe(true);
      expect(q.tip.length).toBeGreaterThan(20);
      expect(q.where.length).toBeGreaterThan(10);
    }
  });

  it('states what the conversation is, and that this is education and not advice', () => {
    expect(CONVERSATION.map((p) => p.heading)).toEqual(['A good loan officer is not an enemy', 'Credibility is the test', 'Underwriting is judgment']);
    expect(BANK_PREP_NOTE.toLowerCase()).toContain('not financial or legal advice');
  });
});
