import { assertEquals, assert } from "std/testing/asserts.ts";
import { calculateProjections, auditDealRisks, calculateMonthlyPayment, calculateRemainingBalance, calculateIRR } from "./math-engine.ts";

Deno.test("math-engine - calculateMonthlyPayment", () => {
  const p = calculateMonthlyPayment(300000, 6.0, 30);
  assert(Math.abs(p - 1798.65) < 0.5, `Expected payment around $1798.65, got ${p}`);

  assertEquals(calculateMonthlyPayment(0, 6, 30), 0);
  assertEquals(calculateMonthlyPayment(300000, 0, 30), 300000 / (30 * 12));
});

Deno.test("math-engine - calculateRemainingBalance", () => {
  const bal = calculateRemainingBalance(300000, 6.0, 30, 5);
  assert(bal > 270000 && bal < 290000);
  assertEquals(calculateRemainingBalance(300000, 6.0, 30, 30), 0);
});

Deno.test("math-engine - calculateIRR", () => {
  const irr = calculateIRR(100000, [10000, 10000, 10000, 110000]);
  assert(Math.abs(irr - 10) < 0.1, `Expected IRR 10%, got ${irr}`);

  assertEquals(calculateIRR(100000, [0, 0, 0, 0]), -100);
  assertEquals(calculateIRR(100000, [-1000, -1000]), -100);
  assertEquals(calculateIRR(0, [1000]), 0);
});

Deno.test("math-engine - Guided Wizard Payload Support", () => {
  const wizardPayload = {
    purchasePrice: 1200000,
    downPaymentPercent: 25,
    closingCosts: 24000,
    rehabBudget: 50000,
    grossRentPerMonth: 12500,
    otherIncome: 500,
    vacancyRate: 5.0,
    annualRentGrowth: 3.0,
    operatingExpenseRatio: 35.0,
    expenseGrowthRate: 2.5,
    interestRate: 6.5,
    amortizationYears: 30,
    loanTermYears: 30,
    targetExitCapRate: 6.75,
    appreciationRate: 3.5,
    gla: 15000
  };

  const res = calculateProjections("commercial", wizardPayload);
  assertEquals(res.purchasePrice, 1200000);
  assertEquals(res.loanAmount, 900000);
  assertEquals(res.initialCashInvested, 300000 + 50000 + 24000);
  assert(res.projections[0].grossPotentialIncome === 156000);
  assert(res.projections[0].netOperatingIncome > 0);
  assert(res.projections[0].cashFlow > 0);
  assert(res.irr > 0);
  assert(res.equityMultiplier > 1);

  const risks = auditDealRisks("commercial", wizardPayload, res);
  assert(risks.length > 0);
});

Deno.test("math-engine - Negative and Zero Edge Cases", () => {
  const zeroInput = {
    purchasePrice: 0,
    downPaymentPercent: 0,
    interestRate: 0,
    loanTerm: 0
  };
  const zeroRes = calculateProjections("single-family", zeroInput);
  assertEquals(zeroRes.purchasePrice, 0);
  assertEquals(zeroRes.loanAmount, 0);
  assertEquals(zeroRes.irr, 0);
  assertEquals(zeroRes.projections[0].cashOnCash, 0);

  const negInput = {
    purchasePrice: -100000,
    downPaymentPercent: -10,
    interestRate: -5,
    loanTerm: -10
  };
  const negRes = calculateProjections("single-family", negInput);
  assertEquals(negRes.purchasePrice, 0);
  assertEquals(negRes.loanAmount, 0);
});
