// cron-daily-lease-monitor/index.ts
// Automated Daily Worker: Dynamic Due Date Dispatch, Grace Period Follow-Up, On-Demand Test Delivery & Dynamic Equity Recalculation

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

function generateHexToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface ResendEmailPayload {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
}

async function sendEmailWithResend(
  apiKey: string,
  payload: ResendEmailPayload
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data?.message || data?.error || JSON.stringify(data) };
    }
    return { success: true, id: data?.id };
  } catch (err: any) {
    return { success: false, error: err?.message || "Network error sending email" };
  }
}

async function resolveRecipientEmail(
  adminClient: any,
  leaseUserId: string | null | undefined,
  leaseNotificationEmail: string | null | undefined,
  alertRecipientOverride?: string
): Promise<{ email: string; source: string }> {
  // 1. Lease-level specific override
  if (leaseNotificationEmail && leaseNotificationEmail.includes("@")) {
    return { email: leaseNotificationEmail.trim(), source: "lease_notification_email" };
  }

  // 2. Alert recipient secret override (if explicitly specified)
  if (alertRecipientOverride && alertRecipientOverride.includes("@")) {
    return { email: alertRecipientOverride.trim(), source: "alert_recipient_override" };
  }

  // 3. User profile check (both custom notification_email and account email)
  if (leaseUserId) {
    try {
      const { data: prof } = await adminClient
        .from("profiles")
        .select("email, notification_email")
        .eq("id", leaseUserId)
        .maybeSingle();

      if (prof?.notification_email && prof.notification_email.includes("@")) {
        return { email: prof.notification_email.trim(), source: "profile_notification_email" };
      }
      if (prof?.email && prof.email.includes("@")) {
        return { email: prof.email.trim(), source: "profile_account_email" };
      }
    } catch (_) {}

    // 4. Infallible direct Supabase Auth lookup (auth.users)
    try {
      const { data: authData } = await adminClient.auth.admin.getUserById(leaseUserId);
      if (authData?.user?.email && authData.user.email.includes("@")) {
        return { email: authData.user.email.trim(), source: "auth_users_email" };
      }
    } catch (_) {}
  }

  return { email: "delivered@resend.dev", source: "default_fallback" };
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = getEnv("SUPABASE_URL");
    const supabaseServiceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY") || getEnv("SUPABASE_ANON_KEY");
    const resendApiKey = getEnv("RESEND_API_KEY");
    const defaultFromEmail = getEnv("RESEND_FROM_EMAIL") || "MathTree Operations <onboarding@resend.dev>";
    const alertRecipientOverride = getEnv("ALERT_RECIPIENT_EMAIL");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase credentials not configured in edge function environment.");
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const now = new Date();
    const todayDay = now.getDate();
    const todayIso = now.toISOString().split("T")[0];
    const currentPeriodMonth = `${todayIso.slice(0, 7)}-01`;

    let body: any = {};
    if (req.method === "POST") {
      try {
        body = await req.json();
      } catch (_) {
        body = {};
      }
    }

    const logs: string[] = [];

    // =========================================================================
    // BRANCH A: ON-DEMAND TEST EMAIL DISPATCH
    // =========================================================================
    if (body.test === true || body.action === "send_test") {
      logs.push("Executing test email dispatch...");

      if (!resendApiKey) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "RESEND_API_KEY secret is not configured in Supabase Edge Functions environment.",
            logs,
          }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Resolve recipient
      let targetEmail = (body.recipient_email || body.email || alertRecipientOverride || "").trim();
      let emailSource = "explicit_request_payload";

      if (!targetEmail || !targetEmail.includes("@")) {
        try {
          const { data: firstProf } = await adminClient
            .from("profiles")
            .select("email, notification_email")
            .not("email", "is", null)
            .limit(1)
            .maybeSingle();

          if (firstProf?.notification_email && firstProf.notification_email.includes("@")) {
            targetEmail = firstProf.notification_email.trim();
            emailSource = "profile_notification_email";
          } else if (firstProf?.email && firstProf.email.includes("@")) {
            targetEmail = firstProf.email.trim();
            emailSource = "profile_account_email";
          }
        } catch (_) {}
      }

      if (!targetEmail || !targetEmail.includes("@")) {
        targetEmail = "delivered@resend.dev";
        emailSource = "default_fallback";
      }

      // Fetch sample lease for realistic email preview
      let sampleLease: any = null;
      try {
        const { data: leases } = await adminClient
          .from("leases")
          .select(`
            id,
            tenant_name,
            monthly_rent,
            grace_period_days,
            deal_id,
            user_id,
            deals ( id, title ),
            units ( unit_number )
          `)
          .eq("is_active", true)
          .limit(1);

        if (leases && leases.length > 0) {
          sampleLease = leases[0];
        }
      } catch (_) {}

      const testLeaseId = sampleLease?.id || "7c6fff19-5fbf-4f6c-ae79-677e4a9a7ed8";
      const testDealId = sampleLease?.deal_id || "39ae6978-f10e-419f-a2b8-d50630bf3d6b";
      const testTenant = sampleLease?.tenant_name || "Valvoline Instant Oil Change";
      const testDealTitle = sampleLease?.deals?.title || "Union Gap Commercial Center";
      const testUnitNumber = sampleLease?.units?.unit_number ? `Unit ${sampleLease.units.unit_number}` : "Main Facility";
      const testRent = sampleLease?.monthly_rent
        ? "$" + Math.round(Number(sampleLease.monthly_rent)).toLocaleString("en-US")
        : "$11,139";
      const testGrace = sampleLease?.grace_period_days || 5;

      // Generate action tokens
      const confirmToken = generateHexToken();
      const snoozeToken = generateHexToken();
      const tokenExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      try {
        await adminClient.from("reconciliation_tokens").insert([
          {
            lease_id: testLeaseId,
            deal_id: testDealId,
            user_id: sampleLease?.user_id || null,
            period_month: currentPeriodMonth,
            action: "confirm",
            token_hash: confirmToken,
            expires_at: tokenExpires,
          },
          {
            lease_id: testLeaseId,
            deal_id: testDealId,
            user_id: sampleLease?.user_id || null,
            period_month: currentPeriodMonth,
            action: "snooze",
            token_hash: snoozeToken,
            expires_at: tokenExpires,
          },
        ]);
      } catch (tokErr: any) {
        logs.push(`Token preparation notice: ${tokErr?.message || tokErr}`);
      }

      const confirmUrl = `${supabaseUrl}/functions/v1/reconcile-action?action=confirm&token=${confirmToken}`;
      const snoozeUrl = `${supabaseUrl}/functions/v1/reconcile-action?action=snooze&token=${snoozeToken}`;

      const testEmailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #020617; color: #f8fafc; margin: 0; padding: 24px; }
    .card { background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; max-width: 520px; margin: 0 auto; }
    .badge { display: inline-block; background: #1e1b4b; border: 1px solid #4338ca; color: #a5b4fc; font-size: 10px; font-weight: 800; padding: 3px 10px; border-radius: 9999px; text-transform: uppercase; margin-bottom: 12px; }
    .header { font-size: 12px; font-weight: 800; color: #10b981; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .title { font-size: 22px; font-weight: 800; color: #ffffff; margin-bottom: 6px; }
    .sub { font-size: 13px; color: #94a3b8; margin-bottom: 24px; line-height: 1.5; }
    .details { background: #020617; border: 1px solid #1e293b; border-radius: 12px; padding: 16px; margin-bottom: 24px; }
    .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 12px; border-bottom: 1px solid #1e293b; }
    .row:last-child { border-bottom: none; }
    .lbl { color: #64748b; }
    .val { color: #f8fafc; font-weight: 700; }
    .val-highlight { color: #34d399; font-size: 15px; font-weight: 800; }
    .btn-confirm { display: block; width: 100%; text-align: center; background: #10b981; color: #022c22; font-weight: 800; font-size: 14px; padding: 14px 20px; border-radius: 12px; text-decoration: none; box-sizing: border-box; margin-bottom: 12px; }
    .btn-snooze { display: block; width: 100%; text-align: center; background: rgba(245, 158, 11, 0.12); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); font-weight: 700; font-size: 13px; padding: 12px 20px; border-radius: 12px; text-decoration: none; box-sizing: border-box; }
    .footer { font-size: 11px; color: #475569; text-align: center; margin-top: 24px; line-height: 1.4; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">TEST DIAGNOSTIC DELIVERY</div>
    <div class="header">MathTree &bull; Zero-Login Reconciliation</div>
    <div class="title">Rent Due: ${testRent}</div>
    <div class="sub">This is a verified test delivery dispatched to <strong>${targetEmail}</strong>. Test live 1-click ledger reconciliation buttons below:</div>

    <div class="details">
      <div class="row"><span class="lbl">Property</span><span class="val">${testDealTitle}</span></div>
      <div class="row"><span class="lbl">Unit</span><span class="val">${testUnitNumber}</span></div>
      <div class="row"><span class="lbl">Tenant</span><span class="val">${testTenant}</span></div>
      <div class="row"><span class="lbl">Amount Due</span><span class="val-highlight">${testRent}</span></div>
      <div class="row"><span class="lbl">Dynamic Grace Period</span><span class="val">${testGrace} Days</span></div>
    </div>

    <a href="${confirmUrl}" class="btn-confirm">✓ Confirm Paid in Full (${testRent})</a>
    <a href="${snoozeUrl}" class="btn-snooze">⏳ Missing Rent (Snooze ${testGrace} Days)</a>

    <div class="footer">
      MathTree Automated Rent Tracking &bull; Zero-Login Ledger Confirmation<br>
      Destination: ${targetEmail} (Resolved via ${emailSource})
    </div>
  </div>
</body>
</html>
      `;

      const sendRes = await sendEmailWithResend(resendApiKey, {
        from: defaultFromEmail,
        to: targetEmail,
        subject: `[TEST] MathTree Rent Reminder: ${testTenant} (${testRent})`,
        html: testEmailHtml,
      });

      if (!sendRes.success) {
        return new Response(
          JSON.stringify({
            success: false,
            error: sendRes.error,
            target_email: targetEmail,
            source: emailSource,
            logs,
          }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: `Test email sent successfully to ${targetEmail}`,
          email_id: sendRes.id,
          target_email: targetEmail,
          source: emailSource,
          logs,
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // =========================================================================
    // BRANCH B: MANUAL SINGLE-LEASE ON-DEMAND REMINDER DISPATCH
    // =========================================================================
    if (body.lease_id) {
      logs.push(`Manual reminder requested for lease: ${body.lease_id}`);

      if (!resendApiKey) {
        return new Response(
          JSON.stringify({ success: false, error: "RESEND_API_KEY secret is not configured in Supabase environment.", logs }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      const { data: targetLease, error: leaseErr } = await adminClient
        .from("leases")
        .select(`
          id,
          tenant_name,
          monthly_rent,
          payment_due_day,
          grace_period_days,
          notification_email,
          user_id,
          deal_id,
          deals ( id, title, user_id ),
          units ( unit_number, unit_type )
        `)
        .eq("id", body.lease_id)
        .maybeSingle();

      if (leaseErr || !targetLease) {
        return new Response(
          JSON.stringify({ success: false, error: "Lease record not found: " + (leaseErr?.message || body.lease_id), logs }),
          { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      const { email: targetEmail, source: targetSource } = await resolveRecipientEmail(
        adminClient,
        targetLease.user_id,
        targetLease.notification_email,
        body.recipient_email || alertRecipientOverride
      );

      const confirmToken = generateHexToken();
      const snoozeToken = generateHexToken();
      const tokenExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      await adminClient.from("reconciliation_tokens").insert([
        {
          lease_id: targetLease.id,
          deal_id: targetLease.deal_id,
          user_id: targetLease.user_id,
          period_month: currentPeriodMonth,
          action: "confirm",
          token_hash: confirmToken,
          expires_at: tokenExpires,
        },
        {
          lease_id: targetLease.id,
          deal_id: targetLease.deal_id,
          user_id: targetLease.user_id,
          period_month: currentPeriodMonth,
          action: "snooze",
          token_hash: snoozeToken,
          expires_at: tokenExpires,
        },
      ]);

      const confirmUrl = `${supabaseUrl}/functions/v1/reconcile-action?action=confirm&token=${confirmToken}`;
      const snoozeUrl = `${supabaseUrl}/functions/v1/reconcile-action?action=snooze&token=${snoozeToken}`;
      const rentFormatted = "$" + Math.round(Number(targetLease.monthly_rent || 0)).toLocaleString("en-US");
      const dealTitle = (targetLease.deals as any)?.title || "Commercial Property";
      const unitName = (targetLease.units as any)?.unit_number ? `Unit ${(targetLease.units as any).unit_number}` : "Main Facility";
      const graceDays = targetLease.grace_period_days || 5;

      const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #020617; color: #f8fafc; margin: 0; padding: 24px; }
    .card { background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; max-width: 520px; margin: 0 auto; }
    .header { font-size: 12px; font-weight: 800; color: #10b981; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .title { font-size: 22px; font-weight: 800; color: #ffffff; margin-bottom: 6px; }
    .sub { font-size: 13px; color: #94a3b8; margin-bottom: 24px; line-height: 1.5; }
    .details { background: #020617; border: 1px solid #1e293b; border-radius: 12px; padding: 16px; margin-bottom: 24px; }
    .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 12px; border-bottom: 1px solid #1e293b; }
    .row:last-child { border-bottom: none; }
    .lbl { color: #64748b; }
    .val { color: #f8fafc; font-weight: 700; }
    .val-highlight { color: #34d399; font-size: 15px; font-weight: 800; }
    .btn-confirm { display: block; width: 100%; text-align: center; background: #10b981; color: #022c22; font-weight: 800; font-size: 14px; padding: 14px 20px; border-radius: 12px; text-decoration: none; box-sizing: border-box; margin-bottom: 12px; }
    .btn-snooze { display: block; width: 100%; text-align: center; background: rgba(245, 158, 11, 0.12); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); font-weight: 700; font-size: 13px; padding: 12px 20px; border-radius: 12px; text-decoration: none; box-sizing: border-box; }
    .footer { font-size: 11px; color: #475569; text-align: center; margin-top: 24px; line-height: 1.4; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">MathTree &bull; Zero-Login Reconciliation</div>
    <div class="title">Rent Reminder: ${rentFormatted}</div>
    <div class="sub">Rent notice for <strong>${targetLease.tenant_name}</strong>. Reconcile with a single click below:</div>

    <div class="details">
      <div class="row"><span class="lbl">Property</span><span class="val">${dealTitle}</span></div>
      <div class="row"><span class="lbl">Unit</span><span class="val">${unitName}</span></div>
      <div class="row"><span class="lbl">Tenant</span><span class="val">${targetLease.tenant_name}</span></div>
      <div class="row"><span class="lbl">Amount Due</span><span class="val-highlight">${rentFormatted}</span></div>
      <div class="row"><span class="lbl">Grace Period</span><span class="val">${graceDays} Days</span></div>
    </div>

    <a href="${confirmUrl}" class="btn-confirm">✓ Confirm Paid in Full (${rentFormatted})</a>
    <a href="${snoozeUrl}" class="btn-snooze">⏳ Missing Rent (Snooze ${graceDays} Days)</a>

    <div class="footer">
      MathTree Automated Rent Tracking &bull; Zero-Login Ledger Confirmation<br>
      Destination: ${targetEmail} (${targetSource})
    </div>
  </div>
</body>
</html>
      `;

      const sendRes = await sendEmailWithResend(resendApiKey, {
        from: defaultFromEmail,
        to: targetEmail,
        subject: `Rent Reminder: ${targetLease.tenant_name} (${rentFormatted}) - ${dealTitle}`,
        html: emailHtml,
      });

      if (!sendRes.success) {
        return new Response(
          JSON.stringify({ success: false, error: sendRes.error, target_email: targetEmail, source: targetSource, logs }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: `Rent reminder dispatched to ${targetEmail}`,
          email_id: sendRes.id,
          target_email: targetEmail,
          source: targetSource,
          logs,
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // =========================================================================
    // BRANCH C: STANDARD DAILY CRON SCAN (06:00 UTC)
    // =========================================================================

    // 1. EXECUTE SCHEDULED RENT ESCALATIONS & RECALCULATE DYNAMIC EQUITY
    logs.push("Step 1: Running execute_scheduled_rent_escalations RPC...");
    const { data: escData, error: escError } = await adminClient.rpc("execute_scheduled_rent_escalations");
    if (escError) {
      logs.push(`Escalation execution error: ${escError.message}`);
    } else {
      logs.push(`Escalations: ${escData?.leases_escalated || 0} leases bumped, ${escData?.deals_recalculated || 0} deals equity recalculated.`);
    }

    // 2. DYNAMIC DUE DATE DISPATCHING
    logs.push(`Step 2: Checking leases with payment_due_day = ${todayDay}...`);

    let query = adminClient
      .from("leases")
      .select(`
        id,
        tenant_name,
        monthly_rent,
        payment_due_day,
        grace_period_days,
        notification_email,
        user_id,
        deal_id,
        deals ( id, title, user_id ),
        units ( unit_number, unit_type )
      `)
      .eq("is_active", true);

    if (!body.force_all) {
      query = query.eq("payment_due_day", todayDay);
    }

    const { data: dueLeases, error: dueLeasesErr } = await query;
    let dueEmailsSent = 0;

    if (!dueLeasesErr && Array.isArray(dueLeases)) {
      for (const lease of dueLeases) {
        const { data: existingPayment } = await adminClient
          .from("rent_payments")
          .select("id, status, amount_paid, amount_due")
          .eq("lease_id", lease.id)
          .eq("period_month", currentPeriodMonth)
          .maybeSingle();

        if (existingPayment && existingPayment.status === "paid" && Number(existingPayment.amount_paid) >= Number(existingPayment.amount_due)) {
          continue;
        }

        const { email: targetEmail, source: targetSource } = await resolveRecipientEmail(
          adminClient,
          lease.user_id,
          (lease as any).notification_email,
          alertRecipientOverride
        );
        logs.push(`Routing reminder for ${lease.tenant_name} to ${targetEmail} (resolved via ${targetSource})`);

        const confirmToken = generateHexToken();
        const snoozeToken = generateHexToken();
        const tokenExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        await adminClient.from("reconciliation_tokens").insert([
          {
            lease_id: lease.id,
            deal_id: lease.deal_id,
            user_id: lease.user_id,
            period_month: currentPeriodMonth,
            action: "confirm",
            token_hash: confirmToken,
            expires_at: tokenExpires,
          },
          {
            lease_id: lease.id,
            deal_id: lease.deal_id,
            user_id: lease.user_id,
            period_month: currentPeriodMonth,
            action: "snooze",
            token_hash: snoozeToken,
            expires_at: tokenExpires,
          },
        ]);

        const confirmUrl = `${supabaseUrl}/functions/v1/reconcile-action?action=confirm&token=${confirmToken}`;
        const snoozeUrl = `${supabaseUrl}/functions/v1/reconcile-action?action=snooze&token=${snoozeToken}`;
        const rentFormatted = "$" + Math.round(Number(lease.monthly_rent || 0)).toLocaleString("en-US");
        const dealTitle = (lease.deals as any)?.title || "Commercial Property";
        const unitName = (lease.units as any)?.unit_number ? `Unit ${(lease.units as any).unit_number}` : "Main Facility";
        const graceDays = lease.grace_period_days || 5;

        const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #020617; color: #f8fafc; margin: 0; padding: 24px; }
    .card { background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; max-width: 520px; margin: 0 auto; }
    .header { font-size: 12px; font-weight: 800; color: #10b981; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .title { font-size: 22px; font-weight: 800; color: #ffffff; margin-bottom: 6px; }
    .sub { font-size: 13px; color: #94a3b8; margin-bottom: 24px; }
    .details { background: #020617; border: 1px solid #1e293b; border-radius: 12px; padding: 16px; margin-bottom: 24px; }
    .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 12px; border-bottom: 1px solid #1e293b; }
    .row:last-child { border-bottom: none; }
    .lbl { color: #64748b; }
    .val { color: #f8fafc; font-weight: 700; }
    .val-highlight { color: #34d399; font-size: 15px; font-weight: 800; }
    .btn-confirm { display: block; width: 100%; text-align: center; background: #10b981; color: #022c22; font-weight: 800; font-size: 14px; padding: 14px 20px; border-radius: 12px; text-decoration: none; box-sizing: border-box; margin-bottom: 12px; }
    .btn-snooze { display: block; width: 100%; text-align: center; background: rgba(245, 158, 11, 0.12); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); font-weight: 700; font-size: 13px; padding: 12px 20px; border-radius: 12px; text-decoration: none; box-sizing: border-box; }
    .footer { font-size: 11px; color: #475569; text-align: center; margin-top: 24px; line-height: 1.4; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">MathTree &bull; Zero-Login Reconciliation</div>
    <div class="title">Rent Due Today: ${rentFormatted}</div>
    <div class="sub">Contractual rent is due today for <strong>${lease.tenant_name}</strong>. Reconcile with a single click below.</div>

    <div class="details">
      <div class="row"><span class="lbl">Property</span><span class="val">${dealTitle}</span></div>
      <div class="row"><span class="lbl">Unit</span><span class="val">${unitName}</span></div>
      <div class="row"><span class="lbl">Tenant</span><span class="val">${lease.tenant_name}</span></div>
      <div class="row"><span class="lbl">Amount Due</span><span class="val-highlight">${rentFormatted}</span></div>
      <div class="row"><span class="lbl">Grace Period</span><span class="val">${graceDays} Days</span></div>
    </div>

    <a href="${confirmUrl}" class="btn-confirm">✓ Confirm Paid in Full (${rentFormatted})</a>
    <a href="${snoozeUrl}" class="btn-snooze">⏳ Missing Rent (Snooze ${graceDays} Days)</a>

    <div class="footer">
      No sign-in required. Clicking "Confirm" records receipt directly to the Postgres ledger.<br>
      Clicking "Missing Rent" applies your dynamic ${graceDays}-day grace policy and snoozes reminders.
    </div>
  </div>
</body>
</html>
        `;

        if (resendApiKey) {
          const sendRes = await sendEmailWithResend(resendApiKey, {
            from: defaultFromEmail,
            to: targetEmail,
            subject: `Rent Due Today: ${lease.tenant_name} (${rentFormatted}) - ${dealTitle}`,
            html: emailHtml,
          });

          if (sendRes.success) {
            dueEmailsSent++;
            logs.push(`Email dispatched to ${targetEmail} for lease ${lease.id} (Resend ID: ${sendRes.id})`);
          } else {
            logs.push(`Failed to send email to ${targetEmail}: ${sendRes.error}`);
          }
        } else {
          logs.push(`RESEND_API_KEY not configured. Generated tokens for lease ${lease.id} without email dispatch.`);
        }
      }
    }

    // 3. DYNAMIC GRACE PERIOD FOLLOW-UP
    logs.push("Step 3: Checking expired grace period snoozes (snooze_until <= today)...");

    const { data: snoozedPayments, error: snoozeErr } = await adminClient
      .from("rent_payments")
      .select(`
        id,
        lease_id,
        deal_id,
        amount_due,
        amount_paid,
        snooze_until,
        leases ( id, tenant_name, monthly_rent, user_id, grace_period_days, notification_email ),
        deals ( id, title )
      `)
      .eq("status", "snoozed")
      .lte("snooze_until", todayIso);

    let graceFollowupsSent = 0;

    if (!snoozeErr && Array.isArray(snoozedPayments)) {
      for (const p of snoozedPayments) {
        const lease = p.leases as any;
        const deal = p.deals as any;
        if (!lease) continue;

        const { email: targetEmail, source: targetSource } = await resolveRecipientEmail(
          adminClient,
          lease.user_id,
          lease.notification_email,
          alertRecipientOverride
        );
        logs.push(`Routing grace period follow-up for ${lease.tenant_name} to ${targetEmail} (resolved via ${targetSource})`);

        const confirmToken = generateHexToken();
        const tokenExpires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

        await adminClient.from("reconciliation_tokens").insert({
          lease_id: lease.id,
          deal_id: deal?.id || lease.id,
          user_id: lease.user_id,
          period_month: currentPeriodMonth,
          action: "confirm",
          token_hash: confirmToken,
          expires_at: tokenExpires,
        });

        const confirmUrl = `${supabaseUrl}/functions/v1/reconcile-action?action=confirm&token=${confirmToken}`;
        const rentFormatted = "$" + Math.round(Number(p.amount_due || lease.monthly_rent || 0)).toLocaleString("en-US");

        const followupHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #020617; color: #f8fafc; margin: 0; padding: 24px; }
    .card { background: #0f172a; border: 1px solid #dc2626; border-radius: 16px; padding: 32px; max-width: 520px; margin: 0 auto; }
    .header { font-size: 12px; font-weight: 800; color: #f87171; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .title { font-size: 20px; font-weight: 800; color: #ffffff; margin-bottom: 6px; }
    .sub { font-size: 13px; color: #94a3b8; margin-bottom: 24px; }
    .details { background: #020617; border: 1px solid #1e293b; border-radius: 12px; padding: 16px; margin-bottom: 24px; }
    .btn-confirm { display: block; width: 100%; text-align: center; background: #10b981; color: #022c22; font-weight: 800; font-size: 14px; padding: 14px 20px; border-radius: 12px; text-decoration: none; box-sizing: border-box; margin-bottom: 12px; }
    .btn-ops { display: block; width: 100%; text-align: center; background: #1e293b; color: #cbd5e1; font-weight: 700; font-size: 13px; padding: 12px 20px; border-radius: 12px; text-decoration: none; box-sizing: border-box; }
    .footer { font-size: 11px; color: #475569; text-align: center; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">⚠️ Grace Period Expired</div>
    <div class="title">Past-Due Rent: ${lease.tenant_name} (${rentFormatted})</div>
    <div class="sub">The dynamic ${lease.grace_period_days || 5}-day grace period expired today without recorded payment.</div>

    <div class="details">
      <p style="font-size: 12px; color: #cbd5e1; margin-bottom: 6px;"><strong>Property:</strong> ${deal?.title || "Commercial Asset"}</p>
      <p style="font-size: 12px; color: #cbd5e1; margin-bottom: 6px;"><strong>Tenant:</strong> ${lease.tenant_name}</p>
      <p style="font-size: 12px; color: #f87171; margin-bottom: 0;"><strong>Outstanding Balance:</strong> ${rentFormatted}</p>
    </div>

    <a href="${confirmUrl}" class="btn-confirm">✓ Confirm Payment Received Now</a>
    <a href="https://mathtree-app.web.app/operations.html" class="btn-ops">Open Operations & Issue Late Notice</a>

    <div class="footer">
      MathTree Automated Rent Tracking &bull; Zero-Login Ledger Confirmation
    </div>
  </div>
</body>
</html>
        `;

        if (resendApiKey) {
          const sendRes = await sendEmailWithResend(resendApiKey, {
            from: defaultFromEmail,
            to: targetEmail,
            subject: `⚠️ Grace Period Expired: ${lease.tenant_name} (${rentFormatted}) Past Due`,
            html: followupHtml,
          });

          if (sendRes.success) {
            graceFollowupsSent++;
            logs.push(`Grace period reminder sent to ${targetEmail} for lease ${lease.id} (Resend ID: ${sendRes.id})`);
          } else {
            logs.push(`Failed to send grace period reminder to ${targetEmail}: ${sendRes.error}`);
          }
        } else {
          logs.push(`RESEND_API_KEY not configured. Tokens prepared for past-due lease ${lease.id} without dispatch.`);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        executed_at: now.toISOString(),
        escalations: escData,
        due_date_notifications_sent: dueEmailsSent,
        grace_period_followups_sent: graceFollowupsSent,
        logs: logs,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (err: any) {
    console.error("Cron monitor error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err?.message || "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
}

serve(handleRequest);
