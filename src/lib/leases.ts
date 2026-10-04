import { isLeaseInForce } from '@engine/leaseInForce';

export { isLeaseInForce, leaseMonthlyRent, leaseStatusOn } from '@engine/leaseInForce';

/**
 * Which of a deal's leases are in force today. A deal can carry several lease periods (for example intercompany rent before a
 * formal lease starts); only the ones running now are tenants. If none is running yet (or any longer), fall back to every
 * lease that has a tenant or rent, so a property that has not started leasing still shows its lease.
 */
const hasContent = (l: any): boolean => !!l && (!!l.tenantName || parseFloat(l.monthlyRent) > 0 || parseFloat(l.annualRent) > 0);

export function currentLeases<T extends Record<string, any>>(inputs: Record<string, any> | null | undefined, now: Date = new Date()): T[] {
  const all = (Array.isArray(inputs?.leases) ? (inputs!.leases as T[]) : []).filter(hasContent);
  const running = all.filter((l) => isLeaseInForce(l, now));
  return running.length > 0 ? running : all;
}
