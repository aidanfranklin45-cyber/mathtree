// The lease escalation resolver lives in the shared engine; re-exported here for existing imports.
export { resolveLeaseMonthlyRent } from '../engine';
export type LeaseRentResult = ReturnType<typeof import('../engine').resolveLeaseMonthlyRent>;
