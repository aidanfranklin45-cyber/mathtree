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
  primaryEntityId: null as string | null,
  associatedCompanies: [] as Array<Record<string, unknown>>,
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
        .select("id, email, full_name, company_name, primary_entity_id, preferences, notification_email, alert_preferences, discount_rate, exit_year, exit_cap_timing, market_tier, property_class")
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        console.warn("[manage-profile] DB error fetching profile:", error);
      }

      // Query user's associated entities
      const { data: entities } = await dbClient
        .from("entities")
        .select("id, name, entity_type, formation_state, notes, created_at, updated_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      // Query deal counts per entity
      const { data: deals } = await dbClient
        .from("deals")
        .select("id, entity_id")
        .eq("user_id", userId);

      const dealCounts: Record<string, number> = {};
      if (Array.isArray(deals)) {
        deals.forEach((d) => {
          if (d.entity_id) {
            dealCounts[d.entity_id] = (dealCounts[d.entity_id] || 0) + 1;
          }
        });
      }

      let primaryEntityId = row?.primary_entity_id || null;
      if (!primaryEntityId && Array.isArray(entities) && entities.length > 0) {
        primaryEntityId = entities[0].id;
      }

      const associatedCompanies = (entities || []).map((e) => ({
        id: e.id,
        name: e.name,
        entity_type: e.entity_type || "llc",
        formation_state: e.formation_state || null,
        notes: e.notes || null,
        is_primary: e.id === primaryEntityId,
        deals_count: dealCounts[e.id] || 0,
        created_at: e.created_at,
      }));

      const prefs = (row?.preferences && typeof row.preferences === "object") ? row.preferences : {};
      const primaryEntity = associatedCompanies.find((c) => c.is_primary);
      const effectiveCompanyName = primaryEntity?.name || row?.company_name || DEFAULT_PROFILE.companyName;

      const profile = {
        id: userId,
        email: row?.email || userEmail,
        fullName: row?.full_name || DEFAULT_PROFILE.fullName,
        companyName: effectiveCompanyName,
        primaryEntityId: primaryEntityId,
        associatedCompanies: associatedCompanies,
        discountRate: row?.discount_rate !== null && row?.discount_rate !== undefined && !isNaN(parseFloat(String(row.discount_rate)))
          ? parseFloat(String(row.discount_rate))
          : (isNaN(parseFloat(prefs.discountRate)) ? DEFAULT_PROFILE.discountRate : parseFloat(prefs.discountRate)),
        exitYear: row?.exit_year !== null && row?.exit_year !== undefined && !isNaN(parseInt(String(row.exit_year), 10))
          ? parseInt(String(row.exit_year), 10)
          : (isNaN(parseInt(prefs.exitYear, 10)) ? DEFAULT_PROFILE.exitYear : Math.max(1, Math.min(50, parseInt(prefs.exitYear, 10)))),
        exitCapTiming: row?.exit_cap_timing || ((prefs.exitCapTiming === "day1" || prefs.exitCapTiming === "immediate") ? "day1" : "amortized"),
        marketTier: row?.market_tier || prefs.marketTier || DEFAULT_PROFILE.marketTier,
        propertyClass: row?.property_class || prefs.propertyClass || DEFAULT_PROFILE.propertyClass,
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
    let companyName = payload.companyName !== undefined ? String(payload.companyName).trim() : (payload.company_name !== undefined ? String(payload.company_name).trim() : undefined);
    let primaryEntityId = (payload.primaryEntityId || payload.primary_entity_id) ? String(payload.primaryEntityId || payload.primary_entity_id) : null;

    // Handle inline creation of a new company / entity
    const newCompanyName = payload.newCompanyName ? String(payload.newCompanyName).trim() : null;
    const newEntityType = payload.newEntityType ? String(payload.newEntityType).trim().toLowerCase() : "llc";
    const newFormationState = payload.newFormationState ? String(payload.newFormationState).trim().toUpperCase() : null;

    if (newCompanyName) {
      try {
        const { data: createdEntity, error: createEntErr } = await dbClient
          .from("entities")
          .insert({
            user_id: userId,
            name: newCompanyName,
            entity_type: newEntityType,
            formation_state: newFormationState,
            notes: "Created via Profile settings",
          })
          .select("id, name")
          .single();

        if (!createEntErr && createdEntity) {
          primaryEntityId = createdEntity.id;
          companyName = createdEntity.name;
        }
      } catch (newEntErr) {
        console.warn("[manage-profile] Error creating inline entity:", newEntErr);
      }
    } else if (primaryEntityId) {
      // If primaryEntityId was specified, fetch its name
      const { data: ent } = await dbClient
        .from("entities")
        .select("name")
        .eq("id", primaryEntityId)
        .eq("user_id", userId)
        .maybeSingle();

      if (ent?.name) {
        companyName = ent.name;
      }
    } else if (companyName && companyName !== DEFAULT_PROFILE.companyName) {
      // If companyName was provided without primaryEntityId, find or create entity
      const { data: existingEnt } = await dbClient
        .from("entities")
        .select("id, name")
        .eq("user_id", userId)
        .ilike("name", companyName)
        .maybeSingle();

      if (existingEnt) {
        primaryEntityId = existingEnt.id;
        companyName = existingEnt.name;
      } else {
        const { data: newEnt } = await dbClient
          .from("entities")
          .insert({
            user_id: userId,
            name: companyName,
            entity_type: "llc",
            notes: "Auto-created from profile company name",
          })
          .select("id, name")
          .single();

        if (newEnt) {
          primaryEntityId = newEnt.id;
        }
      }
    }

    const preferencesUpdate = {
      discountRate,
      exitYear,
      exitCapTiming,
      marketTier,
      propertyClass,
    };

    const updateRecord: Record<string, unknown> = {
      id: userId,
      discount_rate: discountRate,
      exit_year: exitYear,
      exit_cap_timing: exitCapTiming,
      market_tier: marketTier,
      property_class: propertyClass,
      preferences: preferencesUpdate,
      updated_at: new Date().toISOString(),
    };

    if (fullName !== undefined) updateRecord.full_name = fullName;
    if (companyName !== undefined) updateRecord.company_name = companyName;
    if (primaryEntityId !== null) updateRecord.primary_entity_id = primaryEntityId;
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

      // Fetch refreshed associated companies list
      const { data: refreshedEntities } = await dbClient
        .from("entities")
        .select("id, name, entity_type, formation_state, notes, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      const associatedCompanies = (refreshedEntities || []).map((e) => ({
        id: e.id,
        name: e.name,
        entity_type: e.entity_type || "llc",
        formation_state: e.formation_state || null,
        is_primary: e.id === primaryEntityId,
        created_at: e.created_at,
      }));

      // Sync user metadata via admin client
      try {
        await dbClient.auth.admin.updateUserById(userId, {
          user_metadata: {
            full_name: fullName,
            company_name: companyName,
            primary_entity_id: primaryEntityId,
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
          primaryEntityId: primaryEntityId,
          associatedCompanies: associatedCompanies,
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
