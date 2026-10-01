// Caller checks shared by the edge functions.
//
// These functions run with `verify_jwt = false` and use the service-role client (which bypasses row-level security),
// so every function must decide for itself who is calling and what they may touch. This file holds the two primitives:
//   * getCaller(req)         the signed-in user behind the request's Bearer token, or null (the public anon key is null)
//   * isCronAuthorized(req)  the scheduled jobs present a shared secret in the x-cron-secret header
// Only web APIs are used (no library imports) so any function can import this without touching its import map.

function env(key: string): string {
  try {
    return Deno.env.get(key) || "";
  } catch {
    return "";
  }
}

/** Constant-time string comparison (avoids leaking how many leading characters matched). */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * True only when the request carries the shared cron secret. Fails CLOSED: if CRON_SECRET is not configured in the
 * function's environment nothing is authorized, so a missing secret can never open the function up.
 */
export function isCronAuthorized(req: Request): boolean {
  const secret = env("CRON_SECRET");
  if (!secret) return false;
  const presented = req.headers.get("x-cron-secret") || "";
  return presented.length > 0 && timingSafeEqual(presented, secret);
}

export interface Caller {
  id: string;
  email: string | null;
}

/** Verifies the Bearer token with the auth server. The public anon key is not a user, so it returns null. */
export async function getCaller(req: Request): Promise<Caller | null> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const url = env("SUPABASE_URL");
  const anon = env("SUPABASE_ANON_KEY");
  if (!token || !url || !anon) return null;
  try {
    const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const user = await res.json();
    if (!user?.id) return null;
    return { id: String(user.id), email: user.email ? String(user.email) : null };
  } catch {
    return null;
  }
}

/** Minimal shape of the supabase client we need (keeps this file free of library imports). */
interface DbLike {
  from: (table: string) => any;
}

/**
 * Can this user act on the deal? Owner always; a shared collaborator when their share allows it
 * (`needEdit` = editor permission, otherwise any share grants view access).
 */
export async function canAccessDeal(db: DbLike, dealId: string, userId: string, needEdit: boolean): Promise<boolean> {
  const { data: deal } = await db.from("deals").select("id, user_id").eq("id", dealId).maybeSingle();
  if (!deal) return false;
  if (deal.user_id === userId) return true;
  let q = db.from("deal_shares").select("id, permission").eq("deal_id", dealId).eq("shared_with_user_id", userId);
  if (needEdit) q = q.eq("permission", "editor");
  const { data: shares } = await q.limit(1);
  return Array.isArray(shares) && shares.length > 0;
}
