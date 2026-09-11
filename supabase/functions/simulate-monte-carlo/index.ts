// simulate-monte-carlo/index.ts
// Institutional Monte Carlo Simulation Engine for MathTree (10,000 runs)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function randomGaussian(mean: number, stdDev: number): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * stdDev;
}

function calculateQuickIRR(cashFlows: number[]): number {
  let low = -0.99;
  let high = 5.0;
  let guess = 0.1;

  for (let iter = 0; iter < 30; iter++) {
    guess = (low + high) / 2.0;
    let npv = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      npv += cashFlows[t] / Math.pow(1.0 + guess, t);
    }
    if (Math.abs(npv) < 1.0) break;
    if (npv > 0) {
      low = guess;
    } else {
      high = guess;
    }
  }
  return Math.round(guess * 10000) / 100;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const inputs = payload.inputs || {};
    const runs = Math.min(Math.max(parseInt(payload.runs || '10000', 10), 100), 20000);

    const price = parseFloat(inputs.purchasePrice || inputs.price || 500000);
    const downPct = parseFloat(inputs.downPaymentPercent || 25) / 100;
    const initialEquity = price * downPct + parseFloat(inputs.rehabCosts || 0) + (price * 0.02);
    const loanAmt = Math.max(0, price * (1 - downPct));
    const intRate = parseFloat(inputs.interestRate || 6.5) / 100;
    const loanTerm = parseInt(inputs.loanTerm || 30, 10);

    const monthlyRate = intRate / 12;
    const numMonths = loanTerm * 12;
    const monthlyDebt = loanAmt > 0 && intRate > 0
      ? loanAmt * (monthlyRate * Math.pow(1 + monthlyRate, numMonths)) / (Math.pow(1 + monthlyRate, numMonths) - 1)
      : 0;
    const annualDebtService = monthlyDebt * 12;

    const baseRentMonthly = parseFloat(inputs.monthlyRent || inputs.rent || (price * 0.008));
    const baseRentAnnual = baseRentMonthly * 12;
    const baseVacancy = parseFloat(inputs.vacancyRate || 5) / 100;
    const baseOpex = parseFloat(inputs.operatingExpenseRatio || inputs.expenseRatio || 40) / 100;
    const baseGrowth = parseFloat(inputs.rentGrowth || inputs.appreciationRate || 2.5) / 100;
    const baseExitCap = parseFloat(inputs.targetExitCapRate || inputs.exitCapRate || 6.5) / 100;

    const exitCapStdDev = (parseFloat(payload.exitCapSpreadBps || 100) / 10000);
    const growthStdDev = (parseFloat(payload.rentGrowthVolPct || 2.0) / 100);
    const vacancyStdDev = (parseFloat(payload.vacancyVolPct || 2.5) / 100);

    const irrResults: number[] = new Array(runs);
    let totalIrr = 0;
    let negativeRuns = 0;
    let negativeCashFlowRuns = 0;

    for (let r = 0; r < runs; r++) {
      const simGrowth = Math.max(-0.05, randomGaussian(baseGrowth, growthStdDev));
      const simVacancy = Math.min(0.40, Math.max(0.01, randomGaussian(baseVacancy, vacancyStdDev)));
      const simExitCap = Math.max(0.035, randomGaussian(baseExitCap, exitCapStdDev));

      const cfs: number[] = [-initialEquity];
      let curRent = baseRentAnnual;

      for (let y = 1; y <= 10; y++) {
        if (y > 1) curRent *= (1 + simGrowth);
        const egi = curRent * (1 - simVacancy);
        const noi = egi * (1 - baseOpex);
        let cf = noi - annualDebtService;

        if (y === 10) {
          const exitNoi = noi * (1 + simGrowth);
          const exitVal = exitNoi / simExitCap;
          const netProceeds = exitVal * 0.95 - (loanAmt * 0.75);
          cf += Math.max(0, netProceeds);
        }
        cfs.push(cf);
      }

      if (cfs[1] < 0) negativeCashFlowRuns++;

      const runIrr = calculateQuickIRR(cfs);
      irrResults[r] = runIrr;
      totalIrr += runIrr;
      if (runIrr <= 0) negativeRuns++;
    }

    irrResults.sort((a, b) => a - b);

    const p5 = irrResults[Math.floor(runs * 0.05)];
    const p10 = irrResults[Math.floor(runs * 0.10)];
    const p25 = irrResults[Math.floor(runs * 0.25)];
    const p50 = irrResults[Math.floor(runs * 0.50)];
    const p75 = irrResults[Math.floor(runs * 0.75)];
    const p90 = irrResults[Math.floor(runs * 0.90)];
    const p95 = irrResults[Math.floor(runs * 0.95)];
    const minIrr = irrResults[0];
    const maxIrr = irrResults[runs - 1];
    const meanIrr = Math.round((totalIrr / runs) * 100) / 100;

    let sumSquares = 0;
    for (let i = 0; i < runs; i++) {
      sumSquares += Math.pow(irrResults[i] - meanIrr, 2);
    }
    const stdDev = Math.round(Math.sqrt(sumSquares / runs) * 100) / 100;
    const probOfLoss = Math.round((negativeRuns / runs) * 1000) / 10;
    const probNegativeCashFlow = Math.round((negativeCashFlowRuns / runs) * 1000) / 10;

    // 10-bin histogram for standard chart presentation
    const bin10Count = 10;
    const bin10Width = Math.max(0.1, (maxIrr - minIrr) / bin10Count);
    const histogramBins: { label: string; binStart: number; binEnd: number; count: number }[] = [];

    for (let b = 0; b < bin10Count; b++) {
      const bStart = Math.round((minIrr + b * bin10Width) * 10) / 10;
      const bEnd = Math.round((minIrr + (b + 1) * bin10Width) * 10) / 10;
      histogramBins.push({
        label: `${bStart}% - ${bEnd}%`,
        binStart: bStart,
        binEnd: bEnd,
        count: 0
      });
    }

    for (let i = 0; i < runs; i++) {
      const val = irrResults[i];
      let idx = Math.floor((val - minIrr) / bin10Width);
      if (idx >= bin10Count) idx = bin10Count - 1;
      if (idx < 0) idx = 0;
      histogramBins[idx].count++;
    }

    // 20-bin histogram for granular distribution analysis
    const binCount = 20;
    const binWidth = Math.max(0.1, (maxIrr - minIrr) / binCount);
    const histogram: { min: number; max: number; count: number; pct: number }[] = [];

    for (let b = 0; b < binCount; b++) {
      const bMin = Math.round((minIrr + b * binWidth) * 10) / 10;
      const bMax = Math.round((minIrr + (b + 1) * binWidth) * 10) / 10;
      histogram.push({ min: bMin, max: bMax, count: 0, pct: 0 });
    }

    for (let i = 0; i < runs; i++) {
      const val = irrResults[i];
      let binIdx = Math.floor((val - minIrr) / binWidth);
      if (binIdx >= binCount) binIdx = binCount - 1;
      if (binIdx < 0) binIdx = 0;
      histogram[binIdx].count++;
    }

    for (let b = 0; b < binCount; b++) {
      histogram[b].pct = Math.round((histogram[b].count / runs) * 1000) / 10;
    }

    return new Response(JSON.stringify({
      success: true,
      runs,
      engine: 'supabase-deno-edge',
      meanIrr,
      medianIrr: p50,
      p5Irr: p5,
      p95Irr: p95,
      probNegativeCashFlow,
      probNegativeIrr: probOfLoss,
      histogramBins,
      summary: {
        p5,
        p10,
        p25,
        p50,
        p75,
        p90,
        p95,
        mean: meanIrr,
        stdDev,
        min: minIrr,
        max: maxIrr,
        probOfLossPct: probOfLoss,
        probNegativeCashFlowPct: probNegativeCashFlow
      },
      histogram
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
