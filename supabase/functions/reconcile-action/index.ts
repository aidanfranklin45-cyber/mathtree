// reconcile-action/index.ts
// Zero-Login 1-Click Rent Payment Confirmation & Dynamic Grace Period Snooze

import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function getEnv(key: string): string {
  try {
    return Deno.env.get(key) || "";
  } catch {
    return "";
  }
}

const APP_BASE_URL = getEnv("APP_URL") || "https://mathtree-app.web.app";

function createRedirectResponse(redirectUrl: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      "Location": redirectUrl,
      ...corsHeaders,
    },
  });
}

function createJsonResponse(data: any, isSuccess = true): Response {
  return new Response(JSON.stringify(data), {
    status: isSuccess ? 200 : 400,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
    },
  });
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = (url.searchParams.get("action") || "").toLowerCase().trim();
  const token = (url.searchParams.get("token") || "").trim();
  const accept = req.headers.get("accept") || "";
  const wantsJson = accept.includes("application/json") || url.searchParams.get("format") === "json" || req.method === "POST";

  try {
    if (!token) {
      if (wantsJson) {
        return createJsonResponse({ success: false, error: "No security token provided." }, false);
      }
      return createRedirectResponse(`${APP_BASE_URL}/reconcile.html?status=error&message=${encodeURIComponent("No security token was provided. Please use the button in the original email notification.")}`);
    }

    const supabaseUrl = getEnv("SUPABASE_URL");
    const supabaseServiceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY") || getEnv("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase credentials not configured in edge function environment.");
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Confirm Payment Action
    if (action === "confirm") {
      const { data, error } = await adminClient.rpc("confirm_rent_payment_by_token", {
        p_token: token,
        p_payment_method: "1-Click Direct Email",
      });

      if (error || !data?.success) {
        const errMsg = error?.message || data?.error || "Could not reconcile payment.";
        if (wantsJson) {
          return createJsonResponse({ success: false, error: errMsg }, false);
        }
        return createRedirectResponse(`${APP_BASE_URL}/reconcile.html?status=notice&message=${encodeURIComponent(errMsg)}`);
      }

      const amountFormatted = "$" + Math.round(Number(data.amount_paid || 0)).toLocaleString("en-US");

      if (wantsJson) {
        return createJsonResponse({
          success: true,
          action: "confirm",
          deal_title: data.deal_title || "Commercial Asset",
          tenant_name: data.tenant_name || "Verified Tenant",
          period_month: data.period_month || "Current Period",
          amount_paid: amountFormatted,
          paid_date: data.paid_date || new Date().toISOString().split("T")[0],
          undo_token: data.undo_token || "",
        }, true);
      }

      const redirectParams = new URLSearchParams({
        status: "success",
        action: "confirm",
        deal: data.deal_title || "Commercial Asset",
        tenant: data.tenant_name || "Verified Tenant",
        period: data.period_month || "Current Period",
        amount: amountFormatted,
        date: data.paid_date || new Date().toISOString().split("T")[0],
        undo_token: data.undo_token || "",
      });

      return createRedirectResponse(`${APP_BASE_URL}/reconcile.html?${redirectParams.toString()}`);
    }

    // 2. Snooze / Missing Rent Action
    if (action === "snooze") {
      const { data, error } = await adminClient.rpc("snooze_rent_payment_by_token", {
        p_token: token,
      });

      if (error || !data?.success) {
        const errMsg = error?.message || data?.error || "Could not snooze alert.";
        if (wantsJson) {
          return createJsonResponse({ success: false, error: errMsg }, false);
        }
        return createRedirectResponse(`${APP_BASE_URL}/reconcile.html?status=notice&message=${encodeURIComponent(errMsg)}`);
      }

      const graceDays = String(data.grace_period_days || 5);
      const snoozeUntil = data.snooze_until || ("in " + graceDays + " days");

      if (wantsJson) {
        return createJsonResponse({
          success: true,
          action: "snooze",
          deal_title: data.deal_title || "Commercial Asset",
          tenant_name: data.tenant_name || "Verified Tenant",
          grace_period_days: graceDays,
          snooze_until: snoozeUntil,
          undo_token: data.undo_token || "",
        }, true);
      }

      const redirectParams = new URLSearchParams({
        status: "success",
        action: "snooze",
        deal: data.deal_title || "Commercial Asset",
        tenant: data.tenant_name || "Verified Tenant",
        grace_days: graceDays,
        snooze_until: snoozeUntil,
        undo_token: data.undo_token || "",
      });

      return createRedirectResponse(`${APP_BASE_URL}/reconcile.html?${redirectParams.toString()}`);
    }

    // 3. Undo Action
    if (action === "undo") {
      const { data, error } = await adminClient.rpc("undo_rent_reconciliation", {
        p_token: token,
      });

      if (error || !data?.success) {
        const errMsg = error?.message || data?.error || "Could not revert action.";
        if (wantsJson) {
          return createJsonResponse({ success: false, error: errMsg }, false);
        }
        return createRedirectResponse(`${APP_BASE_URL}/reconcile.html?status=notice&message=${encodeURIComponent(errMsg)}`);
      }

      if (wantsJson) {
        return createJsonResponse({
          success: true,
          action: "undo",
          message: "The previous payment or snooze action has been reverted. The lease status is now pending.",
        }, true);
      }

      return createRedirectResponse(`${APP_BASE_URL}/reconcile.html?status=notice&message=${encodeURIComponent("The previous payment or snooze action has been reverted. The lease status is now pending.")}`);
    }

    if (wantsJson) {
      return createJsonResponse({ success: false, error: "The requested action is not recognized." }, false);
    }
    return createRedirectResponse(`${APP_BASE_URL}/reconcile.html?status=error&message=${encodeURIComponent("The requested action is not recognized.")}`);
  } catch (err: any) {
    console.error("Reconcile action error:", err);
    if (wantsJson) {
      return createJsonResponse({ success: false, error: err?.message || "An unexpected error occurred." }, false);
    }
    return createRedirectResponse(`${APP_BASE_URL}/reconcile.html?status=error&message=${encodeURIComponent(err?.message || "An unexpected error occurred.")}`);
  }
}

serve(handleRequest);
