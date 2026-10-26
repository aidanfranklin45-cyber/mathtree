import { describe, it, expect } from 'vitest';
import { buildAssumptionLedger } from './ledger';

const stored = {
  purchasePrice: 3_100_000, downPaymentPercent: 30, interestRate: 7, amortizationYears: 30, grossRentPerMonth: 28_153, grossRentAnnual: 337_836, expenseRatio: 34.38,
  propertyAddress: '1403-1407 S 18th Ave, Yakima, WA 98902',
  intakeRecord: {
    documents: [{ name: 'Quail Ridge OM.pdf', type: 'offering_memorandum' }],
    figures: [
      { key: 'purchasePrice', label: 'Purchase price', value: 3_100_000, source: 'document', how: 'The asking price' },
      { key: 'grossRentPerMonth', label: 'Rent', value: 28_153, source: 'document', how: 'Rent table' },
      { key: 'interestRate', label: 'Interest rate', value: 6.5, source: 'owner', how: 'You changed 6.5% to 7%' },
      { key: 'address', label: 'Address', value: '1403-1407 S 18th Ave', source: 'document', how: 'Cover page' },
    ],
  },
};
const rows = (over: Record<string, any> = {}) => buildAssumptionLedger({ stored: { ...stored, ...over }, prepared: { ...stored, ...over }, filled: {}, filledBasis: {}, assetClass: 'multi-unit', metrics: {} });
const row = (id: string, over?: Record<string, any>) => rows(over).find((r) => r.id === id)!;

describe('rent entered as units and an average', () => {
  const plain = { purchasePrice: 200_000, downPaymentPercent: 10, interestRate: 6.53, amortizationYears: 30, unitCount: 12, monthlyRentPerUnit: 150, grossRentAnnual: 21_600 };
  const one = (over: Record<string, any> = {}) => buildAssumptionLedger({ stored: { ...plain, ...over }, prepared: { ...plain, ...over }, filled: {}, filledBasis: {}, assetClass: 'storage', metrics: {} }).find((r) => r.id === 'rent')!;
  it('says the rent is units times an average, since that is what the owner entered', () => {
    expect(one().value).toBe('12 units × $150/mo average = $21,600 a year');
    expect(one().source).toBe('Your entry: number of units and average rent');
  });
  it('does not claim a unit build-up that does not add up', () => {
    expect(one({ grossRentAnnual: 25_000 }).value).toBe('$25,000 a year');
  });
});

describe('where each figure came from', () => {
  it('attributes a figure that is still the document\'s to the document, with its file name', () => {
    expect(row('price')).toMatchObject({ mode: 'document', source: 'From Quail Ridge OM.pdf' });
    expect(row('rent')).toMatchObject({ mode: 'document' });
    expect(row('address')).toMatchObject({ mode: 'document' });
  });
  it('names the file when it is the only one of its kind, and the kind when there are several (never a guess)', () => {
    const two = {
      documents: [{ name: 'OM.pdf', type: 'offering_memorandum' }, { name: 'T12 2025.csv', type: 'operating_statement' }, { name: 'T12 2024.csv', type: 'operating_statement' }],
      figures: [
        { key: 'purchasePrice', label: 'Purchase price', value: 3_100_000, source: 'document', how: 'x', documentType: 'offering_memorandum' },
        { key: 'expenseRatio', label: 'Expense ratio', value: 34.38, source: 'document', how: 'x', documentType: 'operating_statement' },
      ],
    };
    expect(row('price', { intakeRecord: two })).toMatchObject({ source: 'From OM.pdf' });
    expect(row('expenses', { intakeRecord: two })).toMatchObject({ source: 'From your operating statements (2 files)' });
  });
  it('attributes a figure the owner replaced to the owner', () => {
    expect(row('rate')).toMatchObject({ mode: 'entered', source: 'Your entry (it replaced what the document said)' });
  });
  it('attributes a figure the owner changed after creating the project to the owner', () => {
    expect(row('price', { purchasePrice: 3_000_000 })).toMatchObject({ mode: 'entered', source: 'Your entry (you changed what the document said)' });
  });
  it('says "your entry" only when nothing was recorded from a document', () => {
    const r = buildAssumptionLedger({ stored: { purchasePrice: 1_000_000 }, prepared: { purchasePrice: 1_000_000 }, filled: {}, filledBasis: {}, assetClass: 'multi-unit', metrics: {} });
    expect(r.find((x) => x.id === 'price')).toMatchObject({ mode: 'entered', source: 'Your entry for this property' });
  });
});
