import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { calculateProjections, auditDealRisks, DealInputs } from "./math-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function getEnv(key: string): string {
  try {
    return Deno.env.get(key) || "";
  } catch {
    return "";
  }
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = getEnv("SUPABASE_URL");
    const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");
    const supabaseServiceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY") || supabaseAnonKey;

    let userId: string | null = null;
    let userEmail: string | null = null;

    // Resolve user identity safely without throwing on anon/expired tokens
    if (authHeader && supabaseUrl && supabaseAnonKey) {
      try {
        const clientWithAuth = createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: authHeader } }
        });
        const { data, error } = await clientWithAuth.auth.getUser();
        if (!error && data?.user) {
          userId = data.user.id;
          userEmail = data.user.email ?? null;
        }
      } catch (authErr) {
        console.warn("Non-fatal authentication token evaluation warning:", authErr);
      }
    }

    // Parse JSON request body safely
    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON request body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (!payload || typeof payload !== "object") {
      return new Response(JSON.stringify({ error: "Request payload must be a JSON object" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Normalize field aliases between Dashboard modeler and Guided Wizard
    const title = String(payload.title ?? payload.name ?? "").trim();
    const rawAsset = String(payload.assetType ?? payload.asset_class ?? "single-family").toLowerCase().replace(/_/g, '-');
    const validAssets = ["single-family", "multi-unit", "commercial", "storage"];
    const assetType = validAssets.includes(rawAsset)
      ? rawAsset
      : (rawAsset === "multifamily" ? "multi-unit" : "single-family");

    const rawInputs = (payload.inputs && typeof payload.inputs === "object" ? payload.inputs : {}) as DealInputs;
    const strategyNotes = String(payload.strategyNotes ?? payload.notes ?? "");
    const location = String(payload.location ?? "United States");

    const purchasePrice = parseFloat(String(rawInputs.purchasePrice ?? rawInputs.price ?? 0));
    if (isNaN(purchasePrice) || purchasePrice <= 0) {
      return new Response(JSON.stringify({ error: "A valid positive purchasePrice is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 1. Calculate institutional projections & risk audit
    const results = calculateProjections(assetType, rawInputs);
    const risks = auditDealRisks(assetType, rawInputs, results);

    const formattedTitle = title || `${assetType.toUpperCase()} Investment Memo`;
    const y1 = results.projections[0];

    // 2. Generate Executive Pitch Deck highlights
    const highlights = [
      `Acquisition of ${formattedTitle} at $${results.purchasePrice.toLocaleString()} with ${results.ltv}% LTV leverage.`,
      `Projected 10-Year Internal Rate of Return (IRR) of ${results.irr.toFixed(1)}% and ${results.equityMultiplier.toFixed(2)}x Equity Multiple.`,
      `Year 1 Net Operating Income of $${(y1?.netOperatingIncome ?? 0).toLocaleString()} delivering ${(y1?.cashOnCash ?? 0).toFixed(1)}% Cash-on-Cash yield.`,
      `Year 1 Debt Service Coverage Ratio (DSCR) of ${y1?.dscr ? y1.dscr.toFixed(2) + "x" : "N/A"}.`
    ];

    const pitchDeck = {
      title: formattedTitle,
      assetType,
      author: userEmail || "MathTree Underwriter",
      createdAt: new Date().toISOString(),
      highlights,
      summary: {
        purchasePrice: results.purchasePrice,
        initialCashInvested: results.initialCashInvested,
        loanAmount: results.loanAmount,
        irr: results.irr,
        npv: results.npv,
        equityMultiplier: results.equityMultiplier,
        year1Noi: y1?.netOperatingIncome ?? 0,
        year1CashFlow: y1?.cashFlow ?? 0,
        year1CoC: y1?.cashOnCash ?? 0,
        year1CapRate: y1?.capRate ?? 0,
        year1Dscr: y1?.dscr ?? null,
        breakEvenYear: results.breakEvenYear,
        ltv: results.ltv
      },
      risks,
      projections: results.projections
    };

    // 3. Persist to deals table if authenticated
    let savedDeal = null;
    if (userId && supabaseUrl && supabaseServiceKey) {
      try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const { data, error } = await supabase
          .from("deals")
          .insert({
            user_id: userId,
            title: formattedTitle,
            asset_type: assetType,
            scenario_tag: "base",
            inputs: rawInputs,
            metrics: pitchDeck.summary,
            notes: strategyNotes
          })
          .select()
          .single();

        if (!error && data) {
          savedDeal = data;
        } else if (error) {
          console.error("Database insert error:", error);
        }
      } catch (dbErr) {
        console.error("Database client execution error:", dbErr);
      }
    }

    const fallbackProject = {
      id: "demo-" + Date.now(),
      title: formattedTitle,
      name: formattedTitle,
      asset_type: assetType,
      asset_class: assetType,
      location: location,
      inputs: rawInputs,
      metrics: pitchDeck.summary,
      created_at: new Date().toISOString()
    };

    const projectRecord = savedDeal || fallbackProject;

    // Dual payload structure ensuring 100% compatibility with both edgeData.deal and edgeData.project
    const responseDeal = {
      id: projectRecord.id,
      name: formattedTitle,
      title: formattedTitle,
      asset_class: assetType,
      asset_type: assetType,
      location: location,
      purchase_price: results.purchasePrice,
      irr: results.irr,
      equity_multiple: results.equityMultiplier,
      cash_on_cash: y1?.cashOnCash ?? 0,
      cap_rate: y1?.capRate ?? 0,
      year1_cashflow: y1?.cashFlow ?? 0,
      total_equity: results.initialCashInvested,
      inputs: rawInputs,
      metrics: pitchDeck.summary,
      results: results,
      risks: risks,
      deck: {
        title: pitchDeck.title,
        highlights: highlights.map(h => ({ metric: "Highlight", detail: h }))
      }
    };

    return new Response(
      JSON.stringify({
        success: true,
        project: projectRecord,
        deal: responseDeal,
        pitchDeck
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}

if (import.meta.main) {
  serve(handleRequest);
}

