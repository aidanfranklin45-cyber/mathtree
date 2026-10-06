import { describe, it, expect } from 'vitest';
import { sanitizeAssumptions, seedFromAssumptions, reconcileBasis, type UnderwritingAssumptions } from '../../../supabase/functions/_shared/underwritingAssumptions';
import { calculateProjections, checkEngineInputs } from './index';

const mine: UnderwritingAssumptions = {
  taxRate: 32,
  taxRateRationale: 'My CPA\'s estimate of my marginal rate',
  assets: {
    'multi-unit': {
      vacancyRate: 6, expenseRatio: 40, rentGrowth: 3, holdingPeriod: 10, appreciationRate: 2.5, exitCapRate: 6, sellingCostPercent: 4, closingCostPercent: 2,
      managementFeePercent: 7, capexBasis: 'perUnit', capexValue: 300,
      rationale: { vacancyRate: 'Spokane multifamily vacancy 5-7% over my last three years', capexValue: 'Roof and appliances, per my 2025 capital plan' },
    },
    commercial: { vacancyRate: 5, expenseRatio: 30, expenseRatioNNN: 8, exitCapRate: 7, sellingCostPercent: 3, capexBasis: 'perSqFt', capexValue: 0.15, closingCostPercent: 1.5, holdingPeriod: 10, rentGrowth: 2.5 },
  },
};

describe('sanitizeAssumptions', () => {
  it('keeps only numbers in range for fields that apply to the asset class, and never fills a gap', () => {
    const s = sanitizeAssumptions({
      assets: {
        'multi-unit': { vacancyRate: '6', expenseRatio: 140, rentGrowth: 'abc', exitCapRate: 7, capexValue: 300, rationale: { vacancyRate: ' reason ', expenseRatio: 'dropped with its value' } },
      },
    });
    const a = s.assets['multi-unit']!;
    expect(a.vacancyRate).toBe(6);
    expect(a.expenseRatio).toBeUndefined(); // out of range
    expect(a.rentGrowth).toBeUndefined(); // not a number
    expect(a.exitCapRate).toBe(7); // an apartment building is valued on its income too
    expect(a.capexValue).toBeUndefined(); // an amount with no basis means nothing
    expect(a.rationale).toEqual({ vacancyRate: 'reason' });
  });

  it('an empty or junk input gives empty assumptions', () => {
    expect(sanitizeAssumptions(null)).toEqual({ assets: {} });
    expect(sanitizeAssumptions('x')).toEqual({ assets: {} });
  });

  it('survives a round trip', () => {
    expect(sanitizeAssumptions(JSON.parse(JSON.stringify(mine)))).toEqual(mine);
  });
});

describe('seedFromAssumptions', () => {
  it('copies only what the owner set, with the reason for each figure', () => {
    const r = seedFromAssumptions(mine, { assetClass: 'multi-unit', purchasePrice: 1000000, unitCount: 10, squareFeet: 9000, discountRate: 8, exitYear: 10 });
    expect(r.inputs).toMatchObject({
      vacancyRate: 6, expenseRatio: 40, operatingExpenseRatio: 40, rentGrowth: 3, exitYear: 10, discountRate: 8,
      appreciationRate: 2.5, sellingCostPercent: 4, closingCosts: 20000, managementFeePercent: 7, capexReserveAnnual: 3000, taxRate: 32,
    });
    expect(r.basis.vacancyRate).toEqual({ source: 'profile', label: 'Vacancy', value: 6, rationale: 'Spokane multifamily vacancy 5-7% over my last three years' });
    expect(r.basis.capexReserveAnnual.rationale).toMatch(/capital plan/);
    expect(r.inputs.expenseGrowth).toBeUndefined(); // not set, so not invented
    expect(r.unfilled).not.toContain('vacancyRate');
  });

  it('commercial NNN uses the NNN expense ratio, and gross leases the other', () => {
    const nnn = seedFromAssumptions(mine, { assetClass: 'commercial', leaseType: 'NNN', purchasePrice: 2000000, squareFeet: 10000 });
    expect(nnn.inputs.expenseRatio).toBe(8);
    expect(nnn.inputs.targetCapRate).toBe(7);
    expect(nnn.inputs.capexReserveAnnual).toBe(1500);
    expect(seedFromAssumptions(mine, { assetClass: 'commercial', leaseType: 'Gross', purchasePrice: 2000000, squareFeet: 10000 }).inputs.expenseRatio).toBe(30);
  });

  it('a per-unit or per-square-foot reserve waits for the count or size rather than guessing it', () => {
    const noUnits = seedFromAssumptions(mine, { assetClass: 'multi-unit', purchasePrice: 1000000 });
    expect(noUnits.inputs.capexReserveAnnual).toBeUndefined();
    expect(noUnits.unfilled).toContain('capexReserveAnnual');
    const noSqft = seedFromAssumptions(mine, { assetClass: 'commercial', leaseType: 'Gross', purchasePrice: 2000000 });
    expect(noSqft.unfilled).toContain('capexReserveAnnual');
  });

  it('closing costs wait for a price', () => {
    const r = seedFromAssumptions(mine, { assetClass: 'multi-unit', unitCount: 4 });
    expect(r.inputs.closingCosts).toBeUndefined();
    expect(r.unfilled).toContain('closingCosts');
  });

  it('with nothing set, nothing is filled and everything is reported', () => {
    const r = seedFromAssumptions({ assets: {} }, { assetClass: 'storage', purchasePrice: 300000, unitCount: 20 });
    expect(Object.keys(r.inputs)).toEqual([]);
    expect(r.unfilled).toEqual(expect.arrayContaining(['vacancyRate', 'expenseRatio', 'sellingCostPercent', 'targetCapRate', 'payrollMarketingPercent']));
  });

  it('a deal seeded from complete assumptions plus its own facts is accepted by the engine', () => {
    const seeded = seedFromAssumptions(mine, { assetClass: 'multi-unit', purchasePrice: 1000000, unitCount: 10, discountRate: 8 });
    const deal = {
      purchasePrice: 1000000, closingDate: '2026-03-01', downPaymentPercent: 25, interestRate: 6.5, amortizationYears: 25, loanMaturityYears: 10,
      grossRentAnnual: 150000, ...seeded.inputs,
    };
    expect(checkEngineInputs('multi-unit', deal)).toEqual([]);
    expect(() => calculateProjections('multi-unit', deal)).not.toThrow();
  });
});

describe('property tax from the county record', () => {
  const withRate: UnderwritingAssumptions = { assets: {}, propertyTaxRatePercent: 1.1, propertyTaxRateRationale: 'Yakima County levy for tax code area 33, 2025' };

  it("is the county's assessed value times the owner's rate, and says so", () => {
    const r = seedFromAssumptions(withRate, { assetClass: 'commercial', assessedValue: 331000 });
    expect(r.inputs.annualTaxes).toBe(3641);
    expect(r.basis.annualTaxes.source).toBe('county_record');
    expect(r.basis.annualTaxes.rationale).toMatch(/levy/);
    expect(r.basis.annualTaxes.label).toMatch(/county assessed value/);
  });

  it('needs both the county value and the owner rate; neither alone is a tax bill', () => {
    expect(seedFromAssumptions(withRate, { assetClass: 'commercial' }).unfilled).toContain('annualTaxes');
    expect(seedFromAssumptions({ assets: {} }, { assetClass: 'commercial', assessedValue: 331000 }).unfilled).toContain('annualTaxes');
  });

  it('is cleaned like every other assumption', () => {
    expect(sanitizeAssumptions({ propertyTaxRatePercent: 14 }).propertyTaxRatePercent).toBeUndefined();
    expect(sanitizeAssumptions({ propertyTaxRatePercent: '1.25', propertyTaxRateRationale: ' levy ' })).toMatchObject({ propertyTaxRatePercent: 1.25, propertyTaxRateRationale: 'levy' });
  });
});

describe('reconcileBasis', () => {
  const seeded = seedFromAssumptions(mine, { assetClass: 'multi-unit', purchasePrice: 1000000, unitCount: 10, discountRate: 8 });

  it('a figure still equal to the seeded value keeps its profile basis and reason', () => {
    const b = reconcileBasis(seeded.basis, seeded.inputs);
    expect(b.vacancyRate.source).toBe('profile');
    expect(b.vacancyRate.rationale).toMatch(/Spokane/);
  });

  it('a figure the owner changed becomes theirs, without borrowing the old reason', () => {
    const b = reconcileBasis(seeded.basis, { ...seeded.inputs, vacancyRate: 9 });
    expect(b.vacancyRate).toEqual({ source: 'owner', label: 'Vacancy', value: 9 });
  });

  it("a figure typed with no prior basis is recorded as the owner's own; an absent figure gets no basis", () => {
    const b = reconcileBasis(null, { sellingCostPercent: 5 });
    expect(b.sellingCostPercent).toEqual({ source: 'owner', label: 'Selling costs', value: 5 });
    expect(b.vacancyRate).toBeUndefined();
  });
});
