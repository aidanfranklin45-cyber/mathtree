// calculate-deal-projections/index.ts
// The ONLY server-side entry point for financial projection math in MathTree.
// Accepts DealInputs, runs the full engine in memory, returns DealMetrics + TaxMetrics + SensitivityMatrix.

import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import {
  calculateProjections,
  calculateTaxMetrics,
  calculateSensitivityMatrix,
} from "../_shared/math-engine.ts";
import type {
  AssetClass,
  CalculateProjectionsRequest,
  DealInputs,
} from "../_shared/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

const VALID_ASSET_CLASSES: AssetClass[] = [
  "commercial",
  "multi_family",
  "residential",
  "storage",
];

function normalizeAssetClass(raw: unknown): AssetClass {
  const s = String(raw ?? "commercial").toLowerCase().replace(/-/g, "_");
  if ((VALID_ASSET_CLASSES as string[]).includes(s)) return s as AssetClass;
  if (s === "multi_unit" || s === "multifamily") return "multi_family";
  if (s === "single_family") return "residential";
  return "commercial";
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
  }

  // ── Auth (optional — unauthenticated requests get read-only calculation) ──
  const supabaseUrl = getEnv("SUPABASE_URL");
  const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");
  const supabaseServiceKey =
    getEnv("SUPABASE_SERVICE_ROLE_KEY") || supabaseAnonKey;
  const authHeader = req.headers.get("Authorization");

  let dbClient: ReturnType<typeof createClient> | null = null;
  let userId: string | null = null;

  if (supabaseUrl && supabaseServiceKey) {
    dbClient = createClient(supabaseUrl, supabaseServiceKey);
  }

  if (supabaseUrl && supabaseAnonKey && authHeader) {
    try {
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data, error } = await userClient.auth.getUser();
      if (!error && data?.user) {
        userId = data.user.id;
      }
    } catch (authErr) {
      console.warn("[calculate-deal-projections] Auth check warning:", authErr);
    }
  }

  // ── Parse request body ──
  let body: CalculateProjectionsRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!body || typeof body !== "object") {
    return jsonResponse({ error: "Request body must be a JSON object" }, 400);
  }

  // ── Resolve asset class ──
  let assetClass = normalizeAssetClass(body.assetClass);

  // ── Resolve inputs: if dealId provided, fetch from DB and merge ──
  let baseInputs: DealInputs = {};
  const dealId = String(body.dealId ?? "").trim();
  const isRealUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      dealId,
    );

  if (isRealUuid && dbClient) {
    try {
      const { data: dealRow, error: fetchErr } = await dbClient
        .from("deals")
        .select("inputs, asset_type, purchase_price")
        .eq("id", dealId)
        .maybeSingle();

      if (!fetchErr && dealRow) {
        if (dealRow.inputs && typeof dealRow.inputs === "object") {
          baseInputs = dealRow.inputs as DealInputs;
        }
        if (!baseInputs.purchasePrice && dealRow.purchase_price) {
          baseInputs.purchasePrice = Number(dealRow.purchase_price);
        }
        if (!body.assetClass && dealRow.asset_type) {
          assetClass = normalizeAssetClass(dealRow.asset_type);
        }
      }
    } catch (dbErr) {
      console.warn(
        "[calculate-deal-projections] Could not fetch deal from DB:",
        dbErr,
      );
    }
  }

  // Merge: DB inputs are the base, request body overrides on top
  const mergedInputs: DealInputs = {
    ...baseInputs,
    ...(body.inputs && typeof body.inputs === "object" ? body.inputs : {}),
  };

  if (!mergedInputs.purchasePrice) {
    return jsonResponse(
      { error: "inputs.purchasePrice is required" },
      400,
    );
  }

  const assessedBasis = Number(mergedInputs.totalAssessedValue || mergedInputs.combinedAssessedValue || 0);
  if (mergedInputs.arv && Number(mergedInputs.arv) === assessedBasis) {
    delete (mergedInputs as Record<string, unknown>).arv;
  }

  // Prepopulate investor hurdle rate (discountRate) and holdYears from profiles table if missing
  if (mergedInputs.discountRate === undefined || mergedInputs.discountRate === null) {
    if (userId && dbClient) {
      try {
        const { data: profRow } = await dbClient
          .from("profiles")
          .select("preferences")
          .eq("id", userId)
          .maybeSingle();
        if (profRow?.preferences?.discountRate) {
          mergedInputs.discountRate = Number(profRow.preferences.discountRate);
        }
        if (!mergedInputs.holdYears && profRow?.preferences?.exitYear) {
          mergedInputs.holdYears = Number(profRow.preferences.exitYear);
        }
      } catch (profErr) {
        console.warn("[calculate-deal-projections] Profile prefill warning:", profErr);
      }
    }
    if (mergedInputs.discountRate === undefined || mergedInputs.discountRate === null) {
      mergedInputs.discountRate = 8.0;
    }
  }

  // ── Run the math engine ──
  try {
    const metrics = calculateProjections(assetClass, mergedInputs);
    const tax = calculateTaxMetrics(assetClass, mergedInputs);
    const sensitivity = body.computeSensitivity
      ? calculateSensitivityMatrix(assetClass, mergedInputs)
      : undefined;

    // ── Optionally persist computed metrics back to the deal row ──
    if (isRealUuid && dbClient) {
      try {
        await dbClient
          .from("deals")
          .update({
            purchase_price: metrics.purchasePrice,
            irr: metrics.irr,
            cash_on_cash: metrics.cashOnCash,
            equity_multiple: metrics.equityMultiplier,
            year1_cashflow: metrics.year1Cashflow,
            total_equity: metrics.initialCashInvested,
            npv: metrics.npv,
            inputs: mergedInputs,
            metrics: metrics as unknown as Record<string, unknown>,
            updated_at: new Date().toISOString(),
          })
          .eq("id", dealId);
      } catch (persistErr) {
        // Non-fatal — calculation still succeeds even if persist fails
        console.warn(
          "[calculate-deal-projections] Could not persist metrics:",
          persistErr,
        );
      }
    }

    return jsonResponse({
      success: true,
      metrics,
      tax,
      ...(sensitivity !== undefined ? { sensitivity } : {}),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[calculate-deal-projections] Engine error:", message);
    return jsonResponse({ error: message }, 500);
  }
}

if (import.meta.main) {
  serve(handleRequest);
}
