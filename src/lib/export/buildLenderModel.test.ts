import { describe, it, expect } from 'vitest';
import { buildBriefModel } from './buildBriefModel';
import { buildLenderModel, lenderProfileFrom, type LenderProfile } from './buildLenderModel';
import { withLegacyDefaults } from '../engine/testInputs';

const baseInputs = {
  purchasePrice: 1_000_000, downPaymentPercent: 30, interestRate: 6.5, loanTerm: 25,
  vacancyRate: 5, expenseRatio: 20, rentGrowth: 3, closingCosts: 20000, rehabCosts: 80000, exitYear: 10,
  monthlyRent: 9000,
};
const mkDeal = (inputs: Record<string, any>, status = 'owned'): any => ({
  id: 'fixture', title: 'Fixture Deal', asset_class: 'commercial', status,
  purchase_price: 1_000_000, inputs: withLegacyDefaults('commercial', inputs),
});
const blank: LenderProfile = { entityName: null, fullName: null, minDscr: 1.25, sponsorExperience: '', sponsorLiquidity: null, sponsorNetWorth: null };

describe('buildLenderModel', () => {
  it.each(['out_of_pocket', 'roll_into_loan'] as const)('sources tie to uses to the dollar (%s)', (mode) => {
    const lm = buildLenderModel(buildBriefModel(mkDeal({ ...baseInputs, rehabFinancingMode: mode }), [], []), blank);
    expect(lm.totalUses).toBe(1_100_000);
    expect(lm.unreconciled).toBeCloseTo(0, 2);
    expect(lm.sources.map((s) => s.label)).toEqual(['Senior loan', 'Borrower equity']);
    expect(lm.uses.map((u) => u.label)).toEqual(['Purchase price', 'Renovation', 'Buyer closing costs']);
  });

  it('reads coverage, yield and break-even from the engine and judges coverage against the profile minimum', () => {
    const brief = buildBriefModel(mkDeal(baseInputs), [], []);
    const lm = buildLenderModel(brief, blank);
    expect(lm.metrics.loanAmount).toBe(brief.loanAmt);
    expect(lm.metrics.dscr).not.toBeNull();
    const strict = buildLenderModel(brief, { ...blank, minDscr: 3 });
    expect(strict.coverage.status).toBe('below');
    const easy = buildLenderModel(brief, { ...blank, minDscr: 1 });
    expect(easy.coverage.status).toBe('meets');
  });

  it('says there is no coverage test when there is no debt', () => {
    const lm = buildLenderModel(buildBriefModel(mkDeal({ ...baseInputs, downPaymentPercent: 100 }), [], []), blank);
    expect(lm.coverage.status).toBe('none');
    expect(lm.metrics.debtYield).toBeNull();
  });

  it('never invents the sponsor: blanks stay blank and placeholder profile names do not print as the borrower', () => {
    const lm = buildLenderModel(buildBriefModel(mkDeal(baseInputs), [], []), lenderProfileFrom({
      fullName: 'Investor', companyName: 'MathTree Capital', associatedCompanies: [],
      minDscr: 1.25, sponsorExperience: '  ', sponsorLiquidity: null, sponsorNetWorth: null,
    }));
    expect(lm.borrower).toEqual({ entity: null, principal: null, experience: null, liquidity: null, netWorth: null });
    const named = lenderProfileFrom({
      fullName: 'Pat Doe', associatedCompanies: [{ id: 'e1', name: 'Doe Holdings LLC', is_primary: true }], primaryEntityId: 'e1',
      minDscr: 1.3, sponsorExperience: '12 years, 40 doors', sponsorLiquidity: 250000, sponsorNetWorth: 1_200_000,
    });
    expect(named).toMatchObject({ entityName: 'Doe Holdings LLC', fullName: 'Pat Doe', minDscr: 1.3, sponsorLiquidity: 250000 });
  });

  it('flags a single tenant and a lease that ends inside the hold', () => {
    const deal = mkDeal({
      ...baseInputs, closingDate: '2026-01-01',
      leases: [{ tenantName: 'Solo', monthlyRent: 9000, leaseType: 'NNN', leaseStartDate: '2026-01-01', leaseEndDate: '2031-12-31', escalationRate: 3 }],
    });
    const lm = buildLenderModel(buildBriefModel(deal, [], []), blank);
    expect(lm.tenancy.singleTenant).toBe(true);
    expect(lm.tenancy.endingBeforeHold).toBe(1);
    const titles = lm.flags.map((f) => f.title);
    expect(titles).toContain('Single-Tenant Income');
    expect(titles).toContain('Lease Expiry Inside The Hold');
  });

  it('flags an exit cap rate below the going-in cap rate in the shared brief', () => {
    const brief = buildBriefModel(mkDeal({ ...baseInputs, targetCapRate: 3 }), [], []);
    expect(brief.warnings.map((w) => w.title)).toContain('Exit Cap Rate Below Going-In Cap Rate');
    expect(buildLenderModel(brief, blank).flags.map((f) => f.title)).toContain('Exit Cap Rate Below Going-In Cap Rate');
  });
});

describe('LenderBrief render', () => {
  it('prints the verdict, sources and uses, stress and "Not provided" for an unstated sponsor', async () => {
    const React = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { LenderBrief } = await import('../../components/brief/LenderBrief');
    const lm = buildLenderModel(buildBriefModel(mkDeal(baseInputs), [], []), blank);
    const html = renderToStaticMarkup(React.createElement(LenderBrief, { model: lm }));
    expect(html).toContain('Lender Summary');
    expect(html).toContain('Sources &amp; uses at closing');
    expect(html).toContain('Total uses');
    expect(html).toContain('DSCR stress');
    expect(html).toContain('Both: NOI down 10% and rate up 100 bps');
    expect(html).toContain('Not provided');
    expect(html).toContain('not a lender quote');
    expect(html).not.toContain('opportunity cost');
  });
});
