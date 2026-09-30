// What happens to a lease's income after its end date, when nobody has said.
//
// Three investor-level styles (a profile setting), each overridable per property in Edit Inputs:
//   renew   the lease continues on its current terms for the whole hold (same rent, annual increases keep running)
//   relet   a short vacancy, then the rent picks up where it left off and keeps rising annually
//   vacant  pessimistic: the space stays empty after the lease ends
// Kept pure (no Deno / database access) so the browser, the edge functions and the tests all share it.

export type ExpiryMode = "renew" | "relet" | "vacant";

export interface ExpiryDefaults {
  mode: ExpiryMode;
  vacancyMonths: number; // used by "relet"
}

export const DEFAULT_EXPIRY: ExpiryDefaults = { mode: "renew", vacancyMonths: 6 };

export function normalizeExpiryDefaults(p: Record<string, unknown> | null | undefined): ExpiryDefaults {
  const src = p && typeof p === "object" ? p : {};
  const m = String(src.leaseExpiryMode ?? "");
  const mode: ExpiryMode = m === "relet" || m === "vacant" || m === "renew" ? m : DEFAULT_EXPIRY.mode;
  const v = parseInt(String(src.leaseExpiryVacancyMonths ?? ""), 10);
  const vacancyMonths = isNaN(v) ? DEFAULT_EXPIRY.vacancyMonths : Math.min(60, Math.max(0, v));
  return { mode, vacancyMonths };
}

/**
 * Fills in the assumption for every lease that has none of its own. A lease's own choice always wins.
 * Marks filled leases with `expirySource: "default"` so the UI can say the assumption came from the investor default.
 * Returns a new inputs object; the original is not modified.
 */
export function applyLeaseExpiryDefaults<T extends Record<string, any>>(inputs: T, defaults: ExpiryDefaults = DEFAULT_EXPIRY): T {
  const leases = Array.isArray(inputs?.leases) ? inputs.leases : null;
  if (!leases || leases.length === 0) return inputs;
  return {
    ...inputs,
    leases: leases.map((l: any) => {
      if (!l || (l.expiryAssumption !== undefined && l.expiryAssumption !== null && l.expiryAssumption !== "")) return l;
      return {
        ...l,
        expiryAssumption: defaults.mode,
        expirySource: "default",
        ...(defaults.mode === "relet" && l.reletVacancyMonths === undefined ? { reletVacancyMonths: defaults.vacancyMonths } : {}),
      };
    }),
  };
}

export interface ExpiryNotice {
  tenant: string;
  leaseEnd: string;
  mode: string;
  fromDefault: boolean;
}

/** Leases that end before the hold does, so the screen can say what the analysis assumes about them. */
export function leaseExpiryNotices(inputs: Record<string, any>, holdEndYear: number): ExpiryNotice[] {
  const leases = Array.isArray(inputs?.leases) ? inputs.leases : [];
  const out: ExpiryNotice[] = [];
  for (const l of leases) {
    const m = String(l?.leaseEndDate || "").match(/(\d{4})[-/](\d{1,2})/);
    if (!m || !holdEndYear) continue;
    if (parseInt(m[1], 10) >= holdEndYear) continue; // lease still running when the hold ends
    out.push({
      tenant: String(l?.tenantName || "The in-place lease"),
      leaseEnd: String(l.leaseEndDate),
      mode: String(l?.expiryAssumption || DEFAULT_EXPIRY.mode),
      fromDefault: l?.expirySource === "default" || !l?.expiryAssumption,
    });
  }
  return out;
}
