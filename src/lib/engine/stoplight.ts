/**
 * The executive-summary stoplights: how the deal compares with the owner's target rate (the rate in the investor profile, which is also the
 * rate the Monte Carlo measures runs against).
 *
 * Yellow is the common answer and red is reserved for deals that are clearly short. Three owner-facing thresholds shape it:
 *   - green:  at least BAND points above the target rate (a profile field, starts at 1)
 *   - red:    more than RED points below the target rate (a profile field, starts at 3)
 *   - yellow: everything between
 * and one coverage floor: income that pays under SEVERE_COVERAGE_FLOOR of the loan payment is red whatever the yield.
 *
 * There is no default for the target rate itself; a missing rate is the caller's IncompleteInputsError, never a guess.
 */
export const STOPLIGHT_BAND_POINTS = 1;
export const STOPLIGHT_RED_POINTS = 3;
/** Debt service coverage below this (income pays under 80 cents of each loan-payment dollar) is red regardless of yield. */
export const SEVERE_COVERAGE_FLOOR = 0.8;

export type Light = 'green' | 'yellow' | 'red';

export interface StoplightResult {
  light: Light;
  /** The deal's annualized IRR, in percent. */
  irr: number;
  /** The owner's target rate, in percent a year. */
  targetRate: number;
  /** IRR minus target rate, in percentage points. */
  spreadPoints: number;
  bandPoints: number;
  redPoints: number;
  /** One plain sentence the reader can act on. */
  headline: string;
  /** What the light means, in a few words. */
  verdict: string;
}

const pts = (n: number): string => `${Math.abs(n).toFixed(2)} point${Math.abs(n).toFixed(2) === '1.00' ? '' : 's'}`;
const lightFor = (spread: number, band: number, red: number): Light => (spread >= band ? 'green' : spread < -red ? 'red' : 'yellow');

/** The 10-year view: annualized IRR against the target rate. */
export function classifyAgainstTargetRate(irr: number, targetRate: number, bandPoints: number = STOPLIGHT_BAND_POINTS, redPoints: number = STOPLIGHT_RED_POINTS): StoplightResult {
  if (!Number.isFinite(irr) || !Number.isFinite(targetRate)) {
    throw new Error('The stoplight needs the deal IRR and the target rate.');
  }
  // Compare at the precision that is printed, so a deal printed as exactly 1.00 points above is not shown as inside the band
  const spread = Math.round((irr - targetRate) * 100) / 100;
  const light = lightFor(spread, bandPoints, redPoints);
  const rate = `${targetRate.toFixed(1)}%`;
  const own = `${irr.toFixed(2)}% annualized IRR`;
  const verdict = light === 'green' ? 'Projected to beat your target rate' : light === 'yellow' ? 'Projected close to your target rate' : 'Projected below your target rate';
  const headline = light === 'green'
    ? `The ${own} is ${pts(spread)} above your ${rate} target rate: projected to out-earn your money elsewhere.`
    : light === 'yellow'
      ? `The ${own} is ${pts(spread)} ${spread >= 0 ? 'above' : 'below'} your ${rate} target rate: projected to be in the range of what your money earns elsewhere.`
      : `The ${own} is ${pts(spread)} below your ${rate} target rate: projected to earn less than your money does elsewhere.`;
  return { light, irr, targetRate, spreadPoints: spread, bandPoints, redPoints, headline, verdict };
}

export interface NapkinVerdict {
  light: Light;
  yieldOnCostPct: number;
  targetRate: number;
  spreadPoints: number;
  bandPoints: number;
  redPoints: number;
  /** The coverage below which the light is red whatever the yield. */
  coverageFloor: number;
  /**
   * What the loan did to the light:
   *   'severe-shortfall'      income pays under the coverage floor of the loan payment: red.
   *   'does-not-cover-loan'   income is under 1.00x the loan payment: it cannot be green (and the owner would fund the gap).
   *   'below-minimum'         income covers the loan, but under the lender's minimum: it cannot be green.
   */
  cap: 'none' | 'below-minimum' | 'does-not-cover-loan' | 'severe-shortfall';
  headline: string;
  verdict: string;
}

/**
 * "Is it projected to be profitable?": the first full year's yield on the whole cost of acquisition against the target rate. The loan can
 * only hold the light back: it cannot be green when income does not cover the loan to the lender's minimum, and it is red only when
 * the yield is far below target or the income pays under the coverage floor.
 */
export function classifyNapkin(a: {
  yieldOnCostPct: number | null; targetRate: number; dscr: number | null; minDscr: number; cashFlow?: number;
  bandPoints?: number; redPoints?: number; coverageFloor?: number;
}): NapkinVerdict {
  const band = a.bandPoints ?? STOPLIGHT_BAND_POINTS;
  const redBand = a.redPoints ?? STOPLIGHT_RED_POINTS;
  const floor = a.coverageFloor ?? SEVERE_COVERAGE_FLOOR;
  if (a.yieldOnCostPct === null || !Number.isFinite(a.yieldOnCostPct) || !Number.isFinite(a.targetRate)) {
    throw new Error('The verdict needs the yield on cost and the target rate.');
  }
  const spread = Math.round((a.yieldOnCostPct - a.targetRate) * 100) / 100;
  let light = lightFor(spread, band, redBand);
  const d = a.dscr === null ? null : Math.round(a.dscr * 100) / 100;
  let cap: NapkinVerdict['cap'] = 'none';
  if (d !== null && d < floor) { light = 'red'; cap = 'severe-shortfall'; }
  else if (d !== null && d < 1) { if (light === 'green') light = 'yellow'; cap = 'does-not-cover-loan'; }
  else if (d !== null && d < a.minDscr && light === 'green') { light = 'yellow'; cap = 'below-minimum'; }

  const y = `${a.yieldOnCostPct.toFixed(2)}%`;
  const rate = `${a.targetRate.toFixed(1)}%`;
  const lead = `Earns a ${y} yield on its total cost, `;
  const rel = spread >= 0 ? `${pts(spread)} above` : `${pts(spread)} below`;
  const gap = a.cashFlow !== undefined && a.cashFlow < 0 ? `; about $${Math.round(Math.abs(a.cashFlow)).toLocaleString('en-US')} a year would have to come from you` : '';
  const verdict = light === 'green' ? 'Projected to be profitable' : light === 'yellow' ? 'Projected to be marginal' : 'Not projected to be profitable';
  let headline: string;
  if (cap === 'severe-shortfall') headline = `${lead}${spread === 0 ? 'level with' : rel} your ${rate} target rate, but its income covers only ${d!.toFixed(2)}x of the loan payment, well short of paying for itself${gap}.`;
  else if (cap === 'does-not-cover-loan') headline = `${lead}${spread === 0 ? 'level with' : rel} your ${rate} target rate, but its income covers only ${d!.toFixed(2)}x of the loan payment${gap}.`;
  else if (cap === 'below-minimum') headline = `${lead}${rel} your ${rate} target rate, but its income covers the loan at only ${d!.toFixed(2)}x, below the ${a.minDscr.toFixed(2)}x a lender asks.`;
  else if (light === 'green') headline = `${lead}${rel} your ${rate} target rate${d !== null ? ` and covers the loan at ${d.toFixed(2)}x` : ''}.`;
  else if (light === 'yellow') headline = `${lead}${rel} your ${rate} target rate, inside the range this rating treats as close.`;
  else headline = `${lead}${rel} your ${rate} target rate.`;
  return { light, yieldOnCostPct: a.yieldOnCostPct, targetRate: a.targetRate, spreadPoints: spread, bandPoints: band, redPoints: redBand, coverageFloor: floor, cap, headline, verdict };
}
