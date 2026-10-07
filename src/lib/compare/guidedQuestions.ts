import type { DealRecord } from '../math/types';

export type QuestionFamilyId = 'financing' | 'pricing' | 'stress' | 'allocation';

export interface QuestionFamily {
  id: QuestionFamilyId;
  title: string;
  shortDesc: string;
  iconName: string;
}

export const QUESTION_FAMILIES: QuestionFamily[] = [
  {
    id: 'financing',
    title: 'Financing & Bankability',
    shortDesc: 'Debt sizing, lender DSCR covenants, and financial leverage',
    iconName: 'ShieldCheck',
  },
  {
    id: 'pricing',
    title: 'Acquisition Basis & Strike Price',
    shortDesc: 'Maximum allowable offer to hit target DSCR or hurdle IRR',
    iconName: 'Tag',
  },
  {
    id: 'stress',
    title: 'Stress & Downside Defense',
    shortDesc: 'Resilience against rate hikes, vacancy shocks, and break-even cushions',
    iconName: 'Activity',
  },
  {
    id: 'allocation',
    title: 'Cross-Deal Capital Allocation',
    shortDesc: 'Ranking candidate deals by equity efficiency and downside cushion',
    iconName: 'Layers',
  },
];

export type GuidedQuestionId =
  | 'bankability_down_payment'
  | 'expense_ratio_bankability'
  | 'financial_leverage'
  | 'max_offer_dscr'
  | 'max_offer_irr'
  | 'rate_and_vacancy_stress'
  | 'pipeline_allocation';

export interface GuidedQuestionDef {
  id: GuidedQuestionId;
  familyId: QuestionFamilyId;
  question: string;
  shortPrompt: string;
  explanation: string;
  targetScope: 'single_deal' | 'multi_deal';
  defaultParameters?: Record<string, any>;
}

export const GUIDED_QUESTIONS: GuidedQuestionDef[] = [
  {
    id: 'bankability_down_payment',
    familyId: 'financing',
    question: 'What down payment makes this deal bankable with lenders?',
    shortPrompt: 'Down payment needed for 1.25x DSCR',
    explanation: 'Sizes mortgage debt against Year-1 stabilized NOI to identify the exact equity check needed to clear commercial bank covenants.',
    targetScope: 'single_deal',
    defaultParameters: { targetDscr: 1.25 },
  },
  {
    id: 'expense_ratio_bankability',
    familyId: 'financing',
    question: 'How does the bankability of this deal differ if the expense ratio is higher?',
    shortPrompt: 'Expense ratio impact on bankability',
    explanation: 'Stress-tests debt service coverage (DSCR) against operational cost inflation (+3%, +6%, +10%) to pinpoint where lender covenants break.',
    targetScope: 'single_deal',
    defaultParameters: { targetDscr: 1.25, variableKey: 'expenseRatio' },
  },
  {
    id: 'financial_leverage',
    familyId: 'financing',
    question: 'Is borrowing helping or hurting my returns? (Positive vs Negative Leverage)',
    shortPrompt: 'Debt accretive vs dilutive spread',
    explanation: 'Compares going-in cap rate against your loan constant to determine if higher leverage expands or suppresses cash-on-cash yield.',
    targetScope: 'single_deal',
  },
  {
    id: 'max_offer_dscr',
    familyId: 'pricing',
    question: 'What is the maximum purchase price I can offer to keep this deal bankable?',
    shortPrompt: 'Maximum bid for 1.25x DSCR',
    explanation: 'Back-solves the maximum acquisition basis so that annual debt service satisfies lender coverage without ongoing cash subsidies.',
    targetScope: 'single_deal',
    defaultParameters: { targetDscr: 1.25 },
  },
  {
    id: 'max_offer_irr',
    familyId: 'pricing',
    question: 'What price can I pay to achieve our 15% hurdle IRR?',
    shortPrompt: 'Maximum bid for 15% IRR hurdle',
    explanation: 'Executes goal-seek solving for the exact purchase basis required to deliver your target return over the projected hold.',
    targetScope: 'single_deal',
    defaultParameters: { targetIrr: 15 },
  },
  {
    id: 'rate_and_vacancy_stress',
    familyId: 'stress',
    question: 'How much cushion exists before interest rate hikes or vacancy cause a cash deficit?',
    shortPrompt: 'Rate & vacancy stress resilience',
    explanation: 'Stress-tests debt service coverage against sudden interest rate expansions (+100 bps) and tenant vacancies to compute break-even occupancy.',
    targetScope: 'single_deal',
    defaultParameters: { rateShockBps: 100, vacancyShockPct: 5 },
  },
  {
    id: 'pipeline_allocation',
    familyId: 'allocation',
    question: 'Across candidate pipeline deals, where does our equity generate the best risk-adjusted yield?',
    shortPrompt: 'Rank pipeline by equity efficiency',
    explanation: 'Evaluates candidate acquisitions side-by-side normalized by initial equity invested, DSCR margin, and break-even occupancy.',
    targetScope: 'multi_deal',
  },
];

export function getGuidedQuestion(id: string): GuidedQuestionDef | undefined {
  return GUIDED_QUESTIONS.find((q) => q.id === id);
}

export function questionsForFamily(familyId: QuestionFamilyId): GuidedQuestionDef[] {
  return GUIDED_QUESTIONS.filter((q) => q.familyId === familyId);
}

export function questionsForScope(scope: 'single_deal' | 'multi_deal'): GuidedQuestionDef[] {
  return GUIDED_QUESTIONS.filter((q) => q.targetScope === scope);
}
