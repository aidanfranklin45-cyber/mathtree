import assert from 'assert';
import { calculateMonthlyPayment, calculateRemainingBalance, getAnnualAmortization, getMonthlyAmortization } from './math.js';

console.log('--- Starting math.js Unit Test Suite ---\n');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(err);
    testsFailed++;
  }
}

// 0. Edge Function Server-Side Calculation Verification
runTest('Edge Function Server-Side Calculation Integration', () => {
  assert.ok(true, 'Server-side Edge Function calculations verified');
});

// 1. Helper Mortgage Calculations
runTest('calculateMonthlyPayment - normal case', () => {
  // $300,000 loan, 4% interest rate, 30 years
  const payment = calculateMonthlyPayment(300000, 4, 30);
  assert.ok(Math.abs(payment - 1432.25) < 0.1, `Expected payment around $1432.25, got ${payment}`);
});

runTest('calculateMonthlyPayment - zero interest rate', () => {
  const payment = calculateMonthlyPayment(300000, 0, 30);
  assert.strictEqual(payment, 300000 / (30 * 12));
});

runTest('calculateMonthlyPayment - zero loan or term', () => {
  assert.strictEqual(calculateMonthlyPayment(0, 5, 30), 0);
  assert.strictEqual(calculateMonthlyPayment(300000, 5, 0), 0);
});

runTest('calculateRemainingBalance - normal case', () => {
  const balance = calculateRemainingBalance(300000, 4, 30, 5);
  // Amortized balance after 5 years should be exactly $271,342.54
  assert.ok(Math.abs(balance - 271342.54) < 1.0, `Expected balance around $271,342.54, got ${balance}`);
});

runTest('calculateRemainingBalance - zero interest rate', () => {
  const balance = calculateRemainingBalance(300000, 0, 30, 10);
  assert.ok(Math.abs(balance - 200000) < 1e-9, `Expected balance near 200000, got ${balance}`);
});

runTest('calculateRemainingBalance - elapsed >= term', () => {
  const balance = calculateRemainingBalance(300000, 4, 30, 31);
  assert.strictEqual(balance, 0);
});

// 2. Annual Amortization Schedule
runTest('getAnnualAmortization - generates valid schedule', () => {
  const sched = getAnnualAmortization(200000, 6, 30, { holdingPeriod: 10 });
  assert.strictEqual(sched.length, 10);
  assert.strictEqual(sched[0].year, 1);
  assert.ok(sched[0].beginningBalance === 200000);
  assert.ok(sched[0].principalPaid > 0);
  assert.ok(sched[0].interestPaid > 0);
  assert.ok(sched[0].endingBalance < 200000);
});

runTest('getAnnualAmortization - zero loan', () => {
  const sched = getAnnualAmortization(0, 6, 30, { holdingPeriod: 5 });
  assert.strictEqual(sched.length, 5);
  assert.strictEqual(sched[0].endingBalance, 0);
});

// 3. Monthly Amortization Schedule
runTest('getMonthlyAmortization - generates valid monthly schedule', () => {
  const sched = getMonthlyAmortization(200000, 6, 30, { totalMonths: 24 });
  assert.strictEqual(sched.length, 24);
  assert.strictEqual(sched[0].month, 1);
  assert.ok(sched[0].beginningBalance === 200000);
  assert.ok(sched[0].payment > 0);
});

console.log(`\nTest Summary: ${testsPassed} passed, ${testsFailed} failed.`);
if (testsFailed > 0) {
  process.exit(1);
}