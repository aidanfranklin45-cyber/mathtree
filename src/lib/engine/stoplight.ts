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
  const verdict = light === 'green' ? 'Beats your opportunity cost' : light === 'yellow' ? 'Close to your opportunity cost' : 'Below your opportunity cost';
  const headline = light === 'green'
    ? `The ${own} is ${pts(spread)} above your ${rate} opportunity cost: it should out-earn your money elsewhere.`
    : light === 'yellow'
      ? `The ${own} is ${spread >= 0 ? `${pts(spread)} above` : `${pts(spread)} below`} your ${rate} opportunity cost, within the ${bandPoints}-point band: about what your money earns elsewhere.`
      : `The ${own} is ${pts(spread)} below your ${rate} opportunity cost: it should earn less than your money does elsewhere.`;
  return { light, irr, opportunityCost, spreadPoints: spread, bandPoints, headline, verdict };
}
