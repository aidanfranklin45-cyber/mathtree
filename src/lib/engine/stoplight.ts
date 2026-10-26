/**
 * The executive-summary stoplight: how the deal's annualized IRR compares with the owner's opportunity cost
 * (the discount rate in the investor profile, the same figure the Monte Carlo uses as its hurdle).
 *
 * The band is the owner's decision (plus or minus one percentage point): inside it the deal roughly matches what
 * the money earns elsewhere. There is no default for the opportunity cost itself; a missing rate is the caller's
 * IncompleteInputsError, never a guess.
 */
export const STOPLIGHT_BAND_POINTS = 1;

export type Light = 'green' | 'yellow' | 'red';

export interface StoplightResult {
  light: Light;
  /** The deal's annualized IRR, in percent. */
  irr: number;
  /** The owner's opportunity cost, in percent a year. */
  opportunityCost: number;
  /** IRR minus opportunity cost, in percentage points. */
  spreadPoints: number;
  bandPoints: number;
  /** One plain sentence the reader can act on. */
  headline: string;
  /** What the light means, in a few words. */
  verdict: string;
}

const pts = (n: number): string => `${Math.abs(n).toFixed(2)} point${Math.abs(n).toFixed(2) === '1.00' ? '' : 's'}`;

export function classifyAgainstOpportunityCost(irr: number, opportunityCost: number, bandPoints: number = STOPLIGHT_BAND_POINTS): StoplightResult {
  if (!Number.isFinite(irr) || !Number.isFinite(opportunityCost)) {
    throw new Error('The stoplight needs the deal IRR and the opportunity cost (discount rate).');
  }
  // Compare at the precision that is printed, so a deal printed as exactly 1.00 points above is not shown as inside the band
  const spread = Math.round((irr - opportunityCost) * 100) / 100;
  const light: Light = spread >= bandPoints ? 'green' : spread < -bandPoints ? 'red' : 'yellow';
  const rate = `${opportunityCost.toFixed(1)}%`;
  const own = `${irr.toFixed(2)}% annualized IRR`;
  const verdict = light === 'green' ? 'Projected to beat your opportunity cost' : light === 'yellow' ? 'Projected close to your opportunity cost' : 'Projected below your opportunity cost';
  const headline = light === 'green'
    ? `The ${own} is ${pts(spread)} above your ${rate} opportunity cost: projected to out-earn your money elsewhere.`
    : light === 'yellow'
      ? `The ${own} is ${spread >= 0 ? `${pts(spread)} above` : `${pts(spread)} below`} your ${rate} opportunity cost, within the ${bandPoints}-point band: projected to be about what your money earns elsewhere.`
      : `The ${own} is ${pts(spread)} below your ${rate} opportunity cost: projected to earn less than your money does elsewhere.`;
  return { light, irr, opportunityCost, spreadPoints: spread, bandPoints, headline, verdict };
}

export interface NapkinVerdict {
  light: Light;
  yieldOnCostPct: number;
  opportunityCost: number;
  spreadPoints: number;
  bandPoints: number;
  /** Why the light is not what the yield alone would give: the income does not cover the loan (red), or covers it below the lender's minimum (capped at yellow). */
  cap: 'none' | 'does-not-cover-loan' | 'below-minimum';
  headline: string;
  verdict: string;
}

/**
 * "Is it projected to be profitable?": the first full year's yield on the whole cost of acquisition against the owner's opportunity cost, with the same
 * band as the IRR light. The loan can only make it worse: income that does not cover the loan payment (DSCR under 1.00x) is red whatever
 * the yield, and income that covers it but below the lender's minimum cannot be green.
 */
export function classifyNapkin(a: {
  yieldOnCostPct: number | null; opportunityCost: number; dscr: number | null; minDscr: number; bandPoints?: number;
}): NapkinVerdict {
  const band = a.bandPoints ?? STOPLIGHT_BAND_POINTS;
  if (a.yieldOnCostPct === null || !Number.isFinite(a.yieldOnCostPct) || !Number.isFinite(a.opportunityCost)) {
    throw new Error('The verdict needs the yield on cost and the opportunity cost (discount rate).');
  }
  const spread = Math.round((a.yieldOnCostPct - a.opportunityCost) * 100) / 100;
  let light: Light = spread >= band ? 'green' : spread < -band ? 'red' : 'yellow';
  const d = a.dscr === null ? null : Math.round(a.dscr * 100) / 100;
  let cap: NapkinVerdict['cap'] = 'none';
  if (d !== null && d < 1) { light = 'red'; cap = 'does-not-cover-loan'; }
  else if (d !== null && d < a.minDscr && light === 'green') { light = 'yellow'; cap = 'below-minimum'; }

  const y = `${a.yieldOnCostPct.toFixed(2)}%`;
  const rate = `${a.opportunityCost.toFixed(1)}%`;
  const lead = `Earns a ${y} yield on its total cost, `;
  const rel = spread >= 0 ? `${pts(spread)} above` : `${pts(spread)} below`;
  const verdict = light === 'green' ? 'Projected to be profitable' : light === 'yellow' ? 'Projected to be marginal' : 'Not projected to be profitable';
  let headline: string;
  if (cap === 'does-not-cover-loan') headline = `${lead}${spread === 0 ? 'level with' : rel} your ${rate} opportunity cost, but its income covers only ${d!.toFixed(2)}x of the loan payment, so it is not projected to pay for itself.`;
  else if (cap === 'below-minimum') headline = `${lead}${rel} your ${rate} opportunity cost, but its income covers the loan at only ${d!.toFixed(2)}x, below the ${a.minDscr.toFixed(2)}x a lender asks.`;
  else if (light === 'green') headline = `${lead}${rel} your ${rate} opportunity cost${d !== null ? ` and covers the loan at ${d.toFixed(2)}x` : ''}.`;
  else if (light === 'yellow') headline = `${lead}within ${band} point${band === 1 ? '' : 's'} of your ${rate} opportunity cost (${spread >= 0 ? '+' : '-'}${Math.abs(spread).toFixed(2)} pts).`;
  else headline = `${lead}${rel} your ${rate} opportunity cost.`;
  return { light, yieldOnCostPct: a.yieldOnCostPct, opportunityCost: a.opportunityCost, spreadPoints: spread, bandPoints: band, cap, headline, verdict };
}
