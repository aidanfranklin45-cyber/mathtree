// manage-scenarios/index.ts
// Supabase Edge Function: Automatic Prospective Scenario History & Metric Impact Diffing
// Automatically records underwriting parameter runs for prospect deals, computes input
// and financial KPI variances, auto-prunes older runs to a 5-run cap, and bypasses owned deals.

import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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

// Compare two input sets and compute human-readable deltas
function computeInputDiff(oldInputs: Record<string, any>, newInputs: Record<string, any>): Record<string, any>[] {
  const diffs: Record<string, any>[] = [];
  const keysToCheck = [
    { key: "purchasePrice", label: "Purchase Basis", isCurrency: true },
    { key: "downPaymentPercent", label: "Down Payment", isPct: true },
    { key: "interestRate", label: "Interest Rate", isPct: true },
    { key: "loanTerm", label: "Loan Term", suffix: " yrs" },
    { key: "grossRentAnnual", label: "Gross Annual Rent", isCurrency: true },
    { key: "monthlyRent", label: "Gross Monthly Rent", isCurrency: true },
    { key: "vacancyRate", label: "Vacancy Rate", isPct: true },
    { key: "rehabBudget", label: "Rehab / CapEx", isCurrency: true },
    { key: "exitCapRate", label: "Exit Cap Rate", isPct: true },
  ];

  for (const item of keysToCheck) {
    const oldVal = oldInputs[item.key] != null ? Number(oldInputs[item.key]) : null;
    const newVal = newInputs[item.key] != null ? Number(newInputs[item.key]) : null;

    if (oldVal !== null && newVal !== null && Math.abs(oldVal - newVal) > 0.001) {
      diffs.push({
        key: item.key,
        label: item.label,
        oldValue: oldVal,
        newValue: newVal,
        delta: newVal - oldVal,
        isCurrency: !!item.isCurrency,
        isPct: !!item.isPct,
        suffix: item.suffix || "",
      });
    } else if (oldVal === null && newVal !== null) {
      diffs.push({
        key: item.key,
        label: item.label,
        oldValue: null,
        newValue: newVal,
        delta: null,
        isCurrency: !!item.isCurrency,
        isPct: !!item.isPct,
      });
    }
  }
  return diffs;
}

// Compare key return metrics between runs
function computeMetricDiff(oldMetrics: Record<string, any>, newMetrics: Record<string, any>): Record<string, any>[] {
  const diffs: Record<string, any>[] = [];
  const metricsToCheck = [
    { key: "irr", label: "Target IRR", isPct: true },
    { key: "cashOnCash", label: "Cash-on-Cash Return", isPct: true },
    { key: "year1CashFlow", label: "Net Cash Flow (Yr 1)", isCurrency: true },
    { key: "capRate", label: "Cap Rate Yield", isPct: true },
    { key: "equityMultiple", label: "Equity Multiple", suffix: "x" },
    { key: "dscr", label: "DSCR", suffix: "x" },
  ];

  for (const m of metricsToCheck) {
    const oldVal = oldMetrics[m.key] != null ? Number(oldMetrics[m.key]) : null;
    const newVal = newMetrics[m.key] != null ? Number(newMetrics[m.key]) : null;

    if (oldVal !== null && newVal !== null && Math.abs(oldVal - newVal) > 0.001) {
      diffs.push({
        key: m.key,
        label: m.label,
        oldValue: oldVal,
        newValue: newVal,
        delta: newVal - oldVal,
        isCurrency: !!m.isCurrency,
        isPct: !!m.isPct,
        suffix: m.suffix || "",
      });
    }
  }
  return diffs;
}

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

  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({ error: "Supabase configuration missing" }, 500);
  }

  const dbClient = createClient(supabaseUrl, supabaseServiceKey);

  if (authHeader && supabaseAnonKey) {
    try {
      const authClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data, error } = await authClient.auth.getUser();
      if (!error && data?.user) {
        userId = data.user.id;
        userEmail = data.user.email || null;
      }
    } catch (e) {
      console.warn("[manage-scenarios] Auth token warning:", e);
    }
  }

  let body: Record<string, any> = {};
  if (req.method !== "GET") {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }

  const url = new URL(req.url);
  const action = (body.action as string) || url.searchParams.get("action") || "get_history";

  if (!userId) {
    return handleDemoScenarios(action, body, url);
  }

  try {
    switch (action) {
      // 1. AUTOMATICALLY RECORD PROSPECTIVE UNDERWRITING RUN
      case "record_run": {
        const dealId = body.deal_id || body.dealId;
        const inputs = (body.inputs && typeof body.inputs === "object") ? body.inputs : {};
        const metrics = (body.metrics && typeof body.metrics === "object") ? body.metrics : {};
        const runName = body.name ? String(body.name).trim() : null;

        if (!dealId) return jsonResponse({ error: "deal_id is required" }, 400);

        // Fetch deal to verify existence and prospect status
        const { data: deal, error: dealErr } = await dbClient
          .from("deals")
          .select("id, status, title, inputs, metrics, user_id")
          .eq("id", dealId)
          .maybeSingle();

        if (dealErr || !deal) return jsonResponse({ error: "Deal not found" }, 404);

        // FREEZE CHURN: If deal is owned, do not auto-save scenario runs
        if (deal.status === "owned") {
          return jsonResponse({
            success: true,
            status: "ignored_owned",
            message: "Deal is marked as Owned Asset. Parameter scenario auto-saving is frozen.",
          });
        }

        // Fetch the most recent run for this deal
        const { data: recentRuns } = await dbClient
          .from("deal_parameter_history")
          .select("id, name, inputs, metrics, created_at")
          .eq("deal_id", dealId)
          .order("created_at", { ascending: false })
          .limit(1);

        const lastRun = recentRuns && recentRuns[0] ? recentRuns[0] : null;

        // Compute input changes
        const lastInputs = lastRun ? lastRun.inputs || {} : deal.inputs || {};
        const lastMetrics = lastRun ? lastRun.metrics || {} : deal.metrics || {};
        const inputDiff = computeInputDiff(lastInputs, inputs);
        const metricDiff = computeMetricDiff(lastMetrics, metrics);

        // If no parameters changed at all, skip redundant insert
        if (lastRun && inputDiff.length === 0 && !runName) {
          return jsonResponse({
            success: true,
            status: "no_change",
            message: "No parameter changes detected since last run.",
          });
        }

        // Format name based on key changed parameter if no custom name provided
        let generatedName = runName;
        if (!generatedName) {
          if (inputDiff.length > 0) {
            const topDiff = inputDiff[0];
            const sign = topDiff.delta > 0 ? "+" : "";
            const fmtDelta = topDiff.isCurrency
              ? sign + "$" + Math.round(topDiff.delta).toLocaleString()
              : topDiff.isPct
              ? sign + topDiff.delta.toFixed(2) + "%"
              : sign + topDiff.delta;
            generatedName = `Run: ${topDiff.label} (${fmtDelta})`;
          } else {
            generatedName = `Run #${Date.now().toString().slice(-4)}`;
          }
        }

        // Insert new parameter history snapshot
        const { data: newRun, error: insErr } = await dbClient
          .from("deal_parameter_history")
          .insert({
            deal_id: dealId,
            user_id: userId,
            name: generatedName,
            category: "financing",
            inputs,
            metrics,
            input_diff: inputDiff,
            metric_diff: metricDiff,
            is_auto_run: true,
          })
          .select()
          .single();

        if (insErr) throw insErr;

        // PRUNING: Automatically enforce max 5 runs for prospect deals
        const { data: allRuns } = await dbClient
          .from("deal_parameter_history")
          .select("id")
          .eq("deal_id", dealId)
          .order("created_at", { ascending: false });

        if (allRuns && allRuns.length > 5) {
          const idsToDelete = allRuns.slice(5).map((r: any) => r.id);
          await dbClient.from("deal_parameter_history").delete().in("id", idsToDelete);
        }

        return jsonResponse({
          success: true,
          run: newRun,
          input_diff: inputDiff,
          metric_diff: metricDiff,
          message: "Prospective parameter run recorded.",
        });
      }

      // 2. GET RECENT RUNS & SENSITIVITY DIFFS
      case "get_history": {
        const dealId = body.deal_id || body.dealId || url.searchParams.get("deal_id");
        if (!dealId) return jsonResponse({ error: "deal_id parameter required" }, 400);

        const { data: runs, error: runsErr } = await dbClient
          .from("deal_parameter_history")
          .select("id, name, category, inputs, metrics, input_diff, metric_diff, is_baseline, is_auto_run, created_at")
          .eq("deal_id", dealId)
          .order("created_at", { ascending: false })
          .limit(5);

        if (runsErr) throw runsErr;
        return jsonResponse({ success: true, runs: runs || [] });
      }

      // 3. RESTORE HISTORICAL RUN
      case "restore_run": {
        const historyId = body.history_id || body.historyId;
        let dealId = body.deal_id || body.dealId;

        if (!historyId) {
          return jsonResponse({ error: "history_id required" }, 400);
        }

        const { data: run, error: rErr } = await dbClient
          .from("deal_parameter_history")
          .select("*")
          .eq("id", historyId)
          .single();

        if (rErr || !run) return jsonResponse({ error: "Historical run not found" }, 404);

        dealId = dealId || run.deal_id;

        // Update deal inputs
        const restoredInputs = run.inputs || {};
        const purchasePrice = restoredInputs.purchasePrice ? Number(restoredInputs.purchasePrice) : undefined;

        const updatePayload: Record<string, any> = { inputs: restoredInputs, updated_at: new Date().toISOString() };
        if (purchasePrice) updatePayload.purchase_price = purchasePrice;

        if (dealId) {
          const { error: updErr } = await dbClient.from("deals").update(updatePayload).eq("id", dealId);
          if (updErr) throw updErr;
        }

        return jsonResponse({
          success: true,
          snapshot: run,
          restoredInputs,
          runName: run.name,
          message: `Restored parameters from "${run.name}"`,
        });
      }

      // 4. DELETE RUN / SNAPSHOT
      case "delete_snapshot":
      case "delete_run": {
        const historyId = body.history_id || body.historyId || url.searchParams.get("history_id");
        if (!historyId) return jsonResponse({ error: "history_id required" }, 400);

        const { error: delErr } = await dbClient
          .from("deal_parameter_history")
          .delete()
          .eq("id", historyId);

        if (delErr) throw delErr;
        return jsonResponse({ success: true, message: "Scenario run deleted." });
      }

      default:
        return jsonResponse({ error: `Unknown action "${action}"` }, 400);
    }
  } catch (err: any) {
    console.error("[manage-scenarios] Edge function error:", err);
    return jsonResponse({ error: err.message || "Internal server error" }, 500);
  }
}

function handleDemoScenarios(action: string, body: Record<string, any>, url: URL): Response {
  if (action === "get_history") {
    return jsonResponse({
      success: true,
      runs: [
        {
          id: "demo-run-1",
          name: "Run: Interest Rate (+0.50%)",
          inputs: { purchasePrice: 1200000, downPaymentPercent: 25, interestRate: 7.0 },
          metrics: { irr: 15.2, cashOnCash: 7.6, year1CashFlow: 9400, capRate: 3.95 },
          input_diff: [{ key: "interestRate", label: "Interest Rate", oldValue: 6.5, newValue: 7.0, delta: 0.5, isPct: true }],
          metric_diff: [
            { key: "irr", label: "Target IRR", oldValue: 16.8, newValue: 15.2, delta: -1.6, isPct: true },
            { key: "year1CashFlow", label: "Net Cash Flow (Yr 1)", oldValue: 10950, newValue: 9400, delta: -1550, isCurrency: true },
          ],
          is_baseline: false,
          created_at: new Date().toISOString(),
        },
      ],
    });
  }
  return jsonResponse({ success: true, message: "Demo scenario action simulated" });
}

serve(handleRequest);
