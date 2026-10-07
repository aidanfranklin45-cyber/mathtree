import { describe, it, expect } from 'vitest';
import { BENCHMARK_DEAL } from '../supabase/client';
import { mapSupabaseDeal } from '../../stores/useDealStore';
import {
  executeBankabilityInquiry,
  executeExpenseRatioInquiry,
  executeLeverageInquiry,
  executeStrikePriceInquiry,
  executeStressInquiry,
  executeAllocationInquiry,
} from './inquiries';
import { GUIDED_QUESTIONS } from './guidedQuestions';

describe('Guided Underwriting Inquiries & Comparative Stories', () => {
  const benchmarkDeal = mapSupabaseDeal(BENCHMARK_DEAL);

  it('contains registered guided questions across four core families', () => {
    expect(GUIDED_QUESTIONS.length).toBeGreaterThanOrEqual(5);
    const families = new Set(GUIDED_QUESTIONS.map((q) => q.familyId));
    expect(families.has('financing')).toBe(true);
    expect(families.has('pricing')).toBe(true);
    expect(families.has('stress')).toBe(true);
    expect(families.has('allocation')).toBe(true);
  });

  it('executes Bankability Inquiry: generates down payment matrix, covenant badge, and story', () => {
    const res = executeBankabilityInquiry(benchmarkDeal, 1.25);

    expect(res.questionId).toBe('bankability_down_payment');
    expect(res.story).toBeDefined();
    expect(res.story.headline).toBeTruthy();
    expect(res.story.verdictBadge).toBeDefined();
    expect(res.story.keyTakeaways.length).toBeGreaterThan(0);
    expect(res.story.narrativeParagraphs.length).toBeGreaterThan(0);
    expect(res.story.actionRecommendation).toBeTruthy();
    expect(res.columns.length).toBeGreaterThanOrEqual(4);

    // Verify first column has valid summary numbers
    expect(res.columns[0].summary.purchasePrice).toBeGreaterThan(0);
    expect(res.columns[0].summary.dscr).not.toBeNull();

    // Verify Assumption Audit Trail
    expect(res.story.assumptionAuditTrail).toBeDefined();
    expect(res.story.assumptionAuditTrail!.length).toBeGreaterThan(0);
    const priceEntry = res.story.assumptionAuditTrail!.find((a) => a.key === 'purchasePrice');
    expect(priceEntry).toBeDefined();
    expect(priceEntry?.sourceBadge).toBeTruthy();
    expect(priceEntry?.rationale).toBeTruthy();
  });

  it('executes Financial Leverage Inquiry: evaluates loan constant spread', () => {
    const res = executeLeverageInquiry(benchmarkDeal);

    expect(res.questionId).toBe('financial_leverage');
    expect(res.story.verdictBadge.status).toMatch(/accretive|dilutive/);
    expect(res.columns.length).toBe(3); // Unlevered, Baseline, Conservative
    expect(res.columns[0].scenarioKey).toBe('lev:all_cash');
  });

  it('executes Strike Price Solver for DSCR: solves maximum purchase price and generates story', () => {
    const res = executeStrikePriceInquiry(benchmarkDeal, 'dscr', 1.25);

    expect(res.questionId).toBe('max_offer_dscr');
    expect(res.story).toBeDefined();
    expect(res.rawResult.solvedPrice).toBeGreaterThan(0);
    expect(res.columns.length).toBe(2);
    expect(res.columns[1].summary.dscr).toBeGreaterThanOrEqual(1.24); // within tolerance
  });

  it('executes Strike Price Solver for IRR: solves purchase price for target IRR', () => {
    const res = executeStrikePriceInquiry(benchmarkDeal, 'irr', 15);

    expect(res.questionId).toBe('max_offer_irr');
    expect(res.story).toBeDefined();
    expect(res.rawResult.solvedPrice).toBeGreaterThan(0);
    expect(res.columns.length).toBe(2);
  });

  it('executes Stress Resilience Inquiry: evaluates rate and vacancy shocks and break-even occupancy', () => {
    const res = executeStressInquiry(benchmarkDeal, 100, 5);

    expect(res.questionId).toBe('rate_and_vacancy_stress');
    expect(res.story).toBeDefined();
    expect(res.rawResult.breakEvenOcc).toBeGreaterThan(0);
    expect(res.rawResult.breakEvenOcc).toBeLessThanOrEqual(100);
    expect(res.columns.length).toBe(3);
  });

  it('executes Expense Ratio on Bankability Inquiry: evaluates opex inflation on DSCR covenants', () => {
    const res = executeExpenseRatioInquiry(benchmarkDeal, 1.25);

    expect(res.questionId).toBe('expense_ratio_bankability');
    expect(res.story).toBeDefined();
    expect(res.story.headline).toContain('expense ratio');
    expect(res.story.keyTakeaways.length).toBeGreaterThan(0);
    expect(res.columns.length).toBeGreaterThanOrEqual(4);
    expect(res.rawResult.points.length).toBeGreaterThanOrEqual(4);

    // Verify first column has valid summary numbers
    expect(res.columns[0].summary.operatingExpenses).toBeGreaterThan(0);
    expect(res.columns[0].summary.noi).toBeGreaterThan(0);

    // Verify Assumption Audit Trail
    expect(res.story.assumptionAuditTrail).toBeDefined();
    expect(res.story.assumptionAuditTrail!.length).toBeGreaterThan(0);
    const expEntry = res.story.assumptionAuditTrail!.find((a) => a.key === 'expenseRatio');
    expect(expEntry).toBeDefined();
  });

  it('executes Pipeline Capital Allocation Inquiry across multiple candidate deals', () => {
    const dealB = { ...benchmarkDeal, id: 'benchmark-deal-2', title: 'Candidate Property 2' };
    const res = executeAllocationInquiry([benchmarkDeal, dealB]);

    expect(res.questionId).toBe('pipeline_allocation');
    expect(res.story.headline).toContain('Comparing 2 candidate properties');
    expect(res.columns.length).toBe(2);
  });

  it('parameterizes questions dynamically based on investor profile assumptions', async () => {
    const { getGuidedQuestionsWithProfile } = await import('./guidedQuestions');
    const customAssumptions = {
      targetDscr: 1.35,
      hurdleIrr: 18.0,
      stressRateShockBps: 150,
      stressVacancyShockPct: 8.0,
    };
    const questions = getGuidedQuestionsWithProfile(customAssumptions);

    const bankabilityQ = questions.find((q) => q.id === 'bankability_down_payment');
    expect(bankabilityQ?.shortPrompt).toContain('1.35x DSCR');
    expect(bankabilityQ?.defaultParameters?.targetDscr).toBe(1.35);

    const irrQ = questions.find((q) => q.id === 'max_offer_irr');
    expect(irrQ?.shortPrompt).toContain('18% IRR hurdle');
    expect(irrQ?.defaultParameters?.targetIrr).toBe(18);

    const stressQ = questions.find((q) => q.id === 'rate_and_vacancy_stress');
    expect(stressQ?.shortPrompt).toContain('+150 bps / +8%');
  });
});

