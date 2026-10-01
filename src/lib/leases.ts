/**
 * Which of a deal's leases are in force today. A deal can carry several lease periods (for example intercompany rent before a
 * formal lease starts); only the ones running now are tenants. If none is running yet (or any longer), fall back to every
 * lease that has a tenant or rent, so a property that has not started leasing still shows its lease.
 */
const hasContent = (l: any): boolean => !!l && (!!l.tenantName || parseFloat(l.monthlyRent) > 0 || parseFloat(l.annualRent) > 0);

const dayOf = (v: unknown): string | null => {
  const m = String(v ?? '').match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
};

export function currentLeases<T extends Record<string, any>>(inputs: Record<string, any> | null | undefined, now: Date = new Date()): T[] {
  const all = (Array.isArray(inputs?.leases) ? (inputs!.leases as T[]) : []).filter(hasContent);
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const running = all.filter((l) => {
    const start = dayOf(l.leaseStartDate);
    const end = dayOf(l.leaseEndDate);
    return (!start || start <= today) && (!end || end >= today);
  });
  return running.length > 0 ? running : all;
}
