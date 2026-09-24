// manage-profile/index.ts
// Edge function to securely load and update investor profiles & hurdle rate preferences
// directly in the PostgreSQL database with zero dependency on client-side caching.

import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
};

function getEnv(key: string): string {
  try {
    return Deno.env.get(key) || "";
  } catch {
    return "";
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export const DEFAULT_PROFILE = {
  fullName: "Investor",
  companyName: "MathTree Capital",
  discountRate: 8.0,          // Target Hurdle Rate (%/yr)
  exitYear: 10,               // Default Hold Period (Years)
  exitCapTiming: "amortized", // 'amortized' | 'day1'
  marketTier: "Tier 2",       // 'Tier 1' | 'Tier 2' | 'Tier 3'
  propertyClass: "Class B",   // 'Class A' | 'Class B' | 'Class C'
};

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = getEnv("SUPABASE_URL");
  const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");
  const supabaseServiceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY") || supabaseAnonKey;
  const authHeader = req.headers.get("Authorization");

  let userId: string | null = null;
  let userEmail: string | null = null;
  let dbClient: ReturnType<typeof createClient> | null = null;

  if (supabaseUrl && supabaseServiceKey) {
    dbClient = createClient(supabaseUrl, supabaseServiceKey);
  }

  if (supabaseUrl && supabaseAnonKey && authHeader) {
    try {
      const authClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data, error } = await authClient.auth.getUser();
      if (!error && data?.user) {
        userId = data.user.id;
        userEmail = data.user.email ?? null;
      }
    } catch (authErr) {
      console.warn("[manage-profile] Auth token check warning:", authErr);
    }
  }

  // ── GET: Return Profile from DB or defaults ───────────────────────
  if (req.method === "GET") {
    if (!userId || !dbClient) {
      // Unauthenticated / demo investor session
      return jsonResponse({
        authenticated: false,
        profile: {
          id: null,
          email: null,
          ...DEFAULT_PROFILE,
        },
      });
    }

    try {
      const { data: row, error } = await dbClient
        .from("profiles")
        .select("id, email, full_name, company_name, preferences, notification_email, alert_preferences")
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        console.warn("[manage-profile] DB error fetching profile:", error);
      }

      const prefs = (row?.preferences && typeof row.preferences === "object") ? row.preferences : {};

      const profile = {
        id: userId,
        email: row?.email || userEmail,
        fullName: row?.full_name || DEFAULT_PROFILE.fullName,
        companyName: row?.company_name || DEFAULT_PROFILE.companyName,
        discountRate: isNaN(parseFloat(prefs.discountRate)) ? DEFAULT_PROFILE.discountRate : parseFloat(prefs.discountRate),
        exitYear: isNaN(parseInt(prefs.exitYear, 10)) ? DEFAULT_PROFILE.exitYear : Math.max(1, Math.min(50, parseInt(prefs.exitYear, 10))),
        exitCapTiming: (prefs.exitCapTiming === "day1" || prefs.exitCapTiming === "immediate") ? "day1" : "amortized",
        marketTier: prefs.marketTier || DEFAULT_PROFILE.marketTier,
        propertyClass: prefs.propertyClass || DEFAULT_PROFILE.propertyClass,
        notification_email: row?.notification_email || null,
        alert_preferences: row?.alert_preferences || null,
      };

      return jsonResponse({
        authenticated: true,
        profile,
      });
    } catch (err) {
      console.error("[manage-profile] Failed to query profile:", err);
      return jsonResponse({ error: "Failed to load profile" }, 500);
    }
  }

  // ── POST / PUT / PATCH: Update Profile in DB ───────────────────────
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    if (!userId || !dbClient) {
      return jsonResponse({ error: "Authentication required to update investor profile" }, 401);
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON request body" }, 400);
    }

    // Sanitize values
    const discountRateRaw = parseFloat(String(payload.discountRate ?? ""));
    const discountRate = isNaN(discountRateRaw) ? DEFAULT_PROFILE.discountRate : Math.max(0, Math.min(100, discountRateRaw));

    const exitYearRaw = parseInt(String(payload.exitYear ?? ""), 10);
    const exitYear = isNaN(exitYearRaw) ? DEFAULT_PROFILE.exitYear : Math.max(1, Math.min(50, exitYearRaw));

    const exitCapTiming = (payload.exitCapTiming === "day1" || payload.exitCapTiming === "immediate") ? "day1" : "amortized";
    const marketTier = String(payload.marketTier || DEFAULT_PROFILE.marketTier).trim();
    const propertyClass = String(payload.propertyClass || DEFAULT_PROFILE.propertyClass).trim();

    const fullName = payload.fullName !== undefined ? String(payload.fullName).trim() : (payload.full_name !== undefined ? String(payload.full_name).trim() : undefined);
    const companyName = payload.companyName !== undefined ? String(payload.companyName).trim() : (payload.company_name !== undefined ? String(payload.company_name).trim() : undefined);

    const preferencesUpdate = {
      discountRate,
      exitYear,
      exitCapTiming,
      marketTier,
      propertyClass,
    };

    const updateRecord: Record<string, unknown> = {
      id: userId,
      preferences: preferencesUpdate,
      updated_at: new Date().toISOString(),
    };

    if (fullName !== undefined) updateRecord.full_name = fullName;
    if (companyName !== undefined) updateRecord.company_name = companyName;
    if (userEmail) updateRecord.email = userEmail;
    if (payload.notification_email !== undefined) updateRecord.notification_email = payload.notification_email;
    if (payload.alert_preferences !== undefined) updateRecord.alert_preferences = payload.alert_preferences;

    try {
      const { error: upsertErr } = await dbClient
        .from("profiles")
        .upsert(updateRecord);

      if (upsertErr) {
        console.error("[manage-profile] Upsert failed:", upsertErr);
        return jsonResponse({ error: "Could not update profile in database", details: upsertErr.message }, 500);
      }

      // Sync user metadata via admin client
      try {
        await dbClient.auth.admin.updateUserById(userId, {
          user_metadata: {
            full_name: fullName,
            company_name: companyName,
            investor_profile: preferencesUpdate,
          },
        });
      } catch (metaErr) {
        console.warn("[manage-profile] Non-critical metadata sync warning:", metaErr);
      }

      return jsonResponse({
        success: true,
        profile: {
          id: userId,
          email: userEmail,
          fullName: fullName ?? DEFAULT_PROFILE.fullName,
          companyName: companyName ?? DEFAULT_PROFILE.companyName,
          ...preferencesUpdate,
        },
      });
    } catch (err) {
      console.error("[manage-profile] Profile save exception:", err);
      return jsonResponse({ error: "Server error updating profile" }, 500);
    }
  }

  return jsonResponse({ error: "Method not allowed. Use GET, POST, or PATCH." }, 405);
}

serve(handleRequest);
