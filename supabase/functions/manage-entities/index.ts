// manage-entities/index.ts
// Supabase Edge Function to securely manage Legal Entities (LLCs, Corps, Trusts)
// Handles retrieval, creation, updating, deletion, and property attachment in PostgreSQL.

import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
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

const DEMO_ENTITIES = [
  {
    id: "demo-ent-cascade",
    name: "Cascade Holdings LLC",
    entity_type: "llc",
    formation_state: "WA",
    bank_name: "Chase Commercial (*4892)",
    ein: "88-1234567",
    notes: "Primary Washington holding company",
    created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    deals_count: 2,
  },
  {
    id: "demo-ent-apex",
    name: "Pacific Apex Assets LLC",
    entity_type: "llc",
    formation_state: "DE",
    bank_name: "Wells Fargo (*9102)",
    ein: "88-7654321",
    notes: "Delaware commercial acquisition vehicle",
    created_at: new Date(Date.now() - 15 * 86400000).toISOString(),
    deals_count: 1,
  },
];

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = getEnv("SUPABASE_URL");
  const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");
  const supabaseServiceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY") || supabaseAnonKey;
  const authHeader = req.headers.get("Authorization");

  let userId: string | null = null;
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
      }
    } catch (authErr) {
      console.warn("[manage-entities] Auth token verification warning:", authErr);
    }
  }

  const url = new URL(req.url);
  const isDemo = url.searchParams.get("demo") === "true";

  // ─────────────────────────────────────────────────────────────
  // 1. GET: Fetch all entities for the current user
  // ─────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    if ((!userId || isDemo) && (!userId || !dbClient)) {
      return jsonResponse({
        authenticated: false,
        entities: DEMO_ENTITIES,
      });
    }

    if (!dbClient) {
      return jsonResponse({ error: "Database client unavailable" }, 500);
    }

    try {
      const { data: entities, error: entErr } = await dbClient
        .from("entities")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (entErr) {
        console.error("[manage-entities] Error querying entities:", entErr);
        return jsonResponse({ error: entErr.message }, 500);
      }

      // Query deals to calculate property counts per entity
      const { data: deals } = await dbClient
        .from("deals")
        .select("id, title, entity_id")
        .eq("user_id", userId);

      const dealMap: Record<string, { count: number; deals: Array<{ id: string; title: string }> }> = {};
      if (Array.isArray(deals)) {
        deals.forEach((d) => {
          if (d.entity_id) {
            if (!dealMap[d.entity_id]) dealMap[d.entity_id] = { count: 0, deals: [] };
            dealMap[d.entity_id].count++;
            dealMap[d.entity_id].deals.push({ id: d.id, title: d.title });
          }
        });
      }

      const enrichedEntities = (entities || []).map((e) => ({
        ...e,
        deals_count: dealMap[e.id]?.count || 0,
        deals: dealMap[e.id]?.deals || [],
      }));

      return jsonResponse({
        authenticated: true,
        entities: enrichedEntities,
      });
    } catch (err) {
      console.error("[manage-entities] Exception in GET:", err);
      return jsonResponse({ error: "Failed to fetch entities" }, 500);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 2. POST: Register new entity (and optionally attach to deal)
  // ─────────────────────────────────────────────────────────────
  if (req.method === "POST") {
    if (!userId || !dbClient) {
      return jsonResponse({ error: "Authentication required to create entities" }, 401);
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON request body" }, 400);
    }

    const name = String(payload.name || "").trim();
    if (!name) {
      return jsonResponse({ error: "Entity legal name is required" }, 400);
    }

    const entityType = String(payload.entity_type || payload.type || "llc").toLowerCase();
    const formationState = payload.formation_state ? String(payload.formation_state).trim() : null;
    const formationDate = payload.formation_date ? String(payload.formation_date).trim() : null;
    const bankName = payload.bank_name ? String(payload.bank_name).trim() : null;
    const ein = payload.ein ? String(payload.ein).trim() : null;
    const notes = payload.notes ? String(payload.notes).trim() : null;
    const dealId = payload.deal_id || payload.dealId ? String(payload.deal_id || payload.dealId) : null;

    try {
      const { data: newEntity, error: insertErr } = await dbClient
        .from("entities")
        .insert({
          user_id: userId,
          name,
          entity_type: entityType,
          formation_state: formationState,
          formation_date: formationDate,
          bank_name: bankName,
          ein,
          notes,
        })
        .select()
        .single();

      if (insertErr) {
        console.error("[manage-entities] Insert failed:", insertErr);
        return jsonResponse({ error: insertErr.message }, 500);
      }

      // If a target deal was provided, attach this newly created entity
      if (dealId && newEntity?.id) {
        await dbClient
          .from("deals")
          .update({ entity_id: newEntity.id })
          .eq("id", dealId)
          .eq("user_id", userId);
      }

      return jsonResponse({
        success: true,
        entity: newEntity,
      });
    } catch (err) {
      console.error("[manage-entities] Exception in POST:", err);
      return jsonResponse({ error: "Failed to create entity" }, 500);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 3. PUT / PATCH: Update entity or assign/detach from deal
  // ─────────────────────────────────────────────────────────────
  if (req.method === "PUT" || req.method === "PATCH") {
    if (!userId || !dbClient) {
      return jsonResponse({ error: "Authentication required" }, 401);
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON request body" }, 400);
    }

    const action = String(payload.action || "");

    // Action: Attach existing entity to a deal
    if (action === "attach_to_deal") {
      const dealId = String(payload.deal_id || payload.dealId || "");
      const entityId = payload.entity_id || payload.entityId ? String(payload.entity_id || payload.entityId) : null;

      if (!dealId) {
        return jsonResponse({ error: "deal_id is required" }, 400);
      }

      try {
        const { error: updateErr } = await dbClient
          .from("deals")
          .update({ entity_id: entityId })
          .eq("id", dealId)
          .eq("user_id", userId);

        if (updateErr) {
          return jsonResponse({ error: updateErr.message }, 500);
        }

        return jsonResponse({ success: true, deal_id: dealId, entity_id: entityId });
      } catch (err) {
        return jsonResponse({ error: "Failed to attach entity to deal" }, 500);
      }
    }

    // Action: Update entity fields
    const entityId = String(payload.id || payload.entity_id || "");
    if (!entityId) {
      return jsonResponse({ error: "Entity ID is required" }, 400);
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (payload.name !== undefined) updates.name = String(payload.name).trim();
    if (payload.entity_type !== undefined) updates.entity_type = String(payload.entity_type).toLowerCase();
    if (payload.formation_state !== undefined) updates.formation_state = String(payload.formation_state).trim() || null;
    if (payload.bank_name !== undefined) updates.bank_name = String(payload.bank_name).trim() || null;
    if (payload.ein !== undefined) updates.ein = String(payload.ein).trim() || null;
    if (payload.notes !== undefined) updates.notes = String(payload.notes).trim() || null;

    try {
      const { data: updatedEntity, error: updateErr } = await dbClient
        .from("entities")
        .update(updates)
        .eq("id", entityId)
        .eq("user_id", userId)
        .select()
        .single();

      if (updateErr) {
        return jsonResponse({ error: updateErr.message }, 500);
      }

      return jsonResponse({ success: true, entity: updatedEntity });
    } catch (err) {
      return jsonResponse({ error: "Failed to update entity" }, 500);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 4. DELETE: Remove entity (safely unassign from deals)
  // ─────────────────────────────────────────────────────────────
  if (req.method === "DELETE") {
    if (!userId || !dbClient) {
      return jsonResponse({ error: "Authentication required to delete entities" }, 401);
    }

    let entityId = url.searchParams.get("id");
    if (!entityId) {
      try {
        const body = await req.json();
        entityId = body?.id || body?.entity_id;
      } catch {
        // empty body
      }
    }

    if (!entityId) {
      return jsonResponse({ error: "Entity ID is required for deletion" }, 400);
    }

    try {
      // Unlink any deals pointing to this entity first
      await dbClient
        .from("deals")
        .update({ entity_id: null })
        .eq("entity_id", entityId)
        .eq("user_id", userId);

      const { error: delErr } = await dbClient
        .from("entities")
        .delete()
        .eq("id", entityId)
        .eq("user_id", userId);

      if (delErr) {
        return jsonResponse({ error: delErr.message }, 500);
      }

      return jsonResponse({ success: true, deleted_id: entityId });
    } catch (err) {
      console.error("[manage-entities] Exception in DELETE:", err);
      return jsonResponse({ error: "Failed to delete entity" }, 500);
    }
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

serve(handleRequest);
