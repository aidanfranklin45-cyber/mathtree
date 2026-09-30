/**
 * Version stamp of the financial engine's math. Baselines (frozen pro-formas) record it so you can tell which model
 * produced an expectation. Bump it whenever a change alters computed results (fixes included), and add a line here.
 *
 *  2026-09-30.1  partial-first-year fixed-rate payment no longer drifts; headline DSCR = first full year
 *  2026-09-30.2  lease expiry assumptions (extension option, vacancy then re-let)
 *  2026-09-30.3  a lease with no stated expiry assumption renews on current terms (was: income stops); investor default in Profile
 *  2026-09-30.4  going-in cap rate uses the first full year when year 1 is a partial lease year (was partial NOI / price, ~4%)
 */
export const ENGINE_VERSION = '2026-09-30.4';
