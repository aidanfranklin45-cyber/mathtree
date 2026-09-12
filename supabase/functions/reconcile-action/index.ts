// reconcile-action/index.ts
// Zero-Login 1-Click Rent Payment Confirmation & Dynamic Grace Period Snooze

import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function getEnv(key: string): string {
  try {
    return Deno.env.get(key) || "";
  } catch {
    return "";
  }
}

function renderHtmlResponse(title: string, contentHtml: string, isSuccess = true): Response {
  const accentColor = isSuccess ? "#10b981" : "#f43f5e";
  const statusIcon = isSuccess ? "✓" : "⚠️";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | MathTree Operations</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #020617;
      color: #f1f5f9;
      font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 20px;
      padding: 36px 32px;
      max-width: 480px;
      width: 100%;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      text-align: center;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      border-radius: 16px;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: ${accentColor};
      font-size: 26px;
      font-weight: 800;
      margin-bottom: 20px;
    }
    .badge.error {
      background: rgba(244, 63, 94, 0.12);
      border-color: rgba(244, 63, 94, 0.3);
    }
    h1 {
      font-size: 22px;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 8px;
    }
    p.subtitle {
      font-size: 13px;
      color: #94a3b8;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .details {
      background: #020617;
      border: 1px solid #1e293b;
      border-radius: 14px;
      padding: 16px;
      margin-bottom: 24px;
      text-align: left;
    }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      font-size: 12px;
      border-bottom: 1px solid rgba(30, 41, 59, 0.6);
    }
    .row:last-child {
      border-bottom: none;
    }
    .label {
      color: #64748b;
      font-weight: 600;
    }
    .val {
      color: #f8fafc;
      font-weight: 700;
      font-family: 'JetBrains Mono', monospace;
    }
    .val.highlight {
      color: #34d399;
      font-size: 14px;
    }
    .btn-group {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .btn {
      display: inline-block;
      width: 100%;
      padding: 12px 18px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
      transition: all 0.15s ease;
      text-align: center;
      border: none;
    }
    .btn-primary {
      background: #10b981;
      color: #022c22;
    }
    .btn-primary:hover {
      background: #34d399;
    }
    .btn-secondary {
      background: rgba(30, 41, 59, 0.8);
      color: #94a3b8;
      border: 1px solid #334155;
    }
    .btn-secondary:hover {
      background: #1e293b;
      color: #f1f5f9;
    }
    .footer {
      margin-top: 20px;
      font-size: 11px;
      color: #475569;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge ${isSuccess ? '' : 'error'}">${statusIcon}</div>
    <h1>${title}</h1>
    ${contentHtml}
    <div class="footer">
      MathTree Institutional Asset Management &bull; Zero-Login Secure Action
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: isSuccess ? 200 : 400,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...corsHeaders,
    },
  });
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = (url.searchParams.get("action") || "").toLowerCase().trim();
    const token = (url.searchParams.get("token") || "").trim();

    if (!token) {
      return renderHtmlResponse(
        "Invalid Link",
        `<p class="subtitle">No security token was provided. Please use the button in the original email notification.</p>
         <div class="btn-group">
           <a href="https://mathtree-app.web.app/operations.html" class="btn btn-secondary">Go to Operations</a>
         </div>`,
        false
      );
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
        return renderHtmlResponse(
          "Reconciliation Notice",
          `<p class="subtitle">${errMsg}</p>
           <div class="btn-group">
             <a href="https://mathtree-app.web.app/operations.html" class="btn btn-primary">Open Operations</a>
           </div>`,
          false
        );
      }

      const amountFormatted = "$" + Math.round(Number(data.amount_paid || 0)).toLocaleString("en-US");
      const undoUrl = `${url.origin}${url.pathname}?action=undo&token=${data.undo_token}`;

      return renderHtmlResponse(
        "Payment Reconciled ✓",
        `<p class="subtitle">Rent collection has been confirmed and recorded directly to the PostgreSQL ledger.</p>
         <div class="details">
           <div class="row">
             <span class="label">Property / Asset</span>
             <span class="val">${data.deal_title || "Commercial Asset"}</span>
           </div>
           <div class="row">
             <span class="label">Tenant</span>
             <span class="val">${data.tenant_name || "Verified Tenant"}</span>
           </div>
           <div class="row">
             <span class="label">Period</span>
             <span class="val">${data.period_month || "Current Period"}</span>
           </div>
           <div class="row">
             <span class="label">Amount Paid</span>
             <span class="val highlight">${amountFormatted}</span>
           </div>
           <div class="row">
             <span class="label">Reconciled Date</span>
             <span class="val">${data.paid_date || new Date().toISOString().split("T")[0]}</span>
           </div>
         </div>
         <div class="btn-group">
           <a href="https://mathtree-app.web.app/operations.html" class="btn btn-primary">View in Operations</a>
           <a href="${undoUrl}" class="btn btn-secondary">Undo This Action</a>
         </div>`
      );
    }

    // 2. Snooze / Missing Rent Action
    if (action === "snooze") {
      const { data, error } = await adminClient.rpc("snooze_rent_payment_by_token", {
        p_token: token,
      });

      if (error || !data?.success) {
        const errMsg = error?.message || data?.error || "Could not snooze alert.";
        return renderHtmlResponse(
          "Snooze Notice",
          `<p class="subtitle">${errMsg}</p>
           <div class="btn-group">
             <a href="https://mathtree-app.web.app/operations.html" class="btn btn-primary">Open Operations</a>
           </div>`,
          false
        );
      }

      const graceDays = data.grace_period_days || 5;
      const snoozeUntil = data.snooze_until || "in " + graceDays + " days";
      const undoUrl = `${url.origin}${url.pathname}?action=undo&token=${data.undo_token}`;

      return renderHtmlResponse(
        "Alert Snoozed ⏳",
        `<p class="subtitle">Dynamic late policy activated. Rent reminder has been snoozed according to lease terms.</p>
         <div class="details">
           <div class="row">
             <span class="label">Property / Asset</span>
             <span class="val">${data.deal_title || "Commercial Asset"}</span>
           </div>
           <div class="row">
             <span class="label">Tenant</span>
             <span class="val">${data.tenant_name || "Verified Tenant"}</span>
           </div>
           <div class="row">
             <span class="label">Grace Policy</span>
             <span class="val highlight">${graceDays} Days</span>
           </div>
           <div class="row">
             <span class="label">Next Alert Date</span>
             <span class="val">${snoozeUntil}</span>
           </div>
         </div>
         <p style="font-size: 11px; color: #64748b; margin-bottom: 20px;">
           MathTree will monitor this lease. If payment is not recorded by <strong>${snoozeUntil}</strong>, a follow-up late notice dispatch will be prepared automatically.
         </p>
         <div class="btn-group">
           <a href="https://mathtree-app.web.app/operations.html" class="btn btn-primary">Open Operations</a>
           <a href="${undoUrl}" class="btn btn-secondary">Undo This Action</a>
         </div>`
      );
    }

    // 3. Undo Action
    if (action === "undo") {
      const { data, error } = await adminClient.rpc("undo_rent_reconciliation", {
        p_token: token,
      });

      if (error || !data?.success) {
        const errMsg = error?.message || data?.error || "Could not revert action.";
        return renderHtmlResponse(
          "Undo Notice",
          `<p class="subtitle">${errMsg}</p>
           <div class="btn-group">
             <a href="https://mathtree-app.web.app/operations.html" class="btn btn-primary">Open Operations</a>
           </div>`,
          false
        );
      }

      return renderHtmlResponse(
        "Action Reverted",
        `<p class="subtitle">The previous payment or snooze action has been reverted. The lease status is now pending.</p>
         <div class="btn-group">
           <a href="https://mathtree-app.web.app/operations.html" class="btn btn-primary">Return to Operations</a>
         </div>`
      );
    }

    return renderHtmlResponse(
      "Unknown Action",
      `<p class="subtitle">The requested action is not recognized.</p>
       <div class="btn-group">
         <a href="https://mathtree-app.web.app/operations.html" class="btn btn-secondary">Go to Operations</a>
       </div>`,
      false
    );
  } catch (err: any) {
    console.error("Reconcile action error:", err);
    return renderHtmlResponse(
      "Server Error",
      `<p class="subtitle">${err?.message || "An unexpected error occurred."}</p>`,
      false
    );
  }
}

serve(handleRequest);
