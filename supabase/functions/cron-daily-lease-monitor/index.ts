// cron-daily-lease-monitor/index.ts
// Automated Daily Worker: Dynamic Due Date Dispatch, Grace Period Follow-Up, On-Demand Test Delivery & Dynamic Equity Recalculation

import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { getCaller, isCronAuthorized } from "../_shared/auth.ts";
import { decideFollowup, normalizeFollowupPrefs, DEFAULT_FOLLOWUP_PREFS, type FollowupPrefs } from "../_shared/followups.ts";

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

const APP_BASE_URL = getEnv("APP_URL") || "https://mathtree-app.web.app";

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

interface AlertPreferences extends FollowupPrefs {
  advance_notice_days: number;
  remind_on_due: boolean;
  escalation_notice_days: number;
}

const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
  advance_notice_days: 0,
  remind_on_due: true,
  escalation_notice_days: 30,
  ...DEFAULT_FOLLOWUP_PREFS,
};

async function getUserAlertPreferences(
  adminClient: any,
  userId: string | null | undefined
): Promise<AlertPreferences> {
  if (!userId) return { ...DEFAULT_ALERT_PREFERENCES };
  try {
    const { data: prof } = await adminClient
      .from("profiles")
      .select("alert_preferences")
      .eq("id", userId)
      .maybeSingle();

    if (prof?.alert_preferences && typeof prof.alert_preferences === "object") {
      const p = prof.alert_preferences;
      return {
        advance_notice_days: typeof p.advance_notice_days === "number" ? p.advance_notice_days : 0,
        remind_on_due: p.remind_on_due !== false,
        escalation_notice_days: typeof p.escalation_notice_days === "number" ? p.escalation_notice_days : 30,
        ...normalizeFollowupPrefs(p),
      };
    }
  } catch (_) {}
  return { ...DEFAULT_ALERT_PREFERENCES };
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

    // Who is calling? The scheduler presents the shared cron secret; the app presents the signed-in user's token.
    // Anyone else (including the public anon key) is rejected: this function can send email and change rents.
    const cronOk = isCronAuthorized(req);
    const caller = cronOk ? null : await getCaller(req);
    if (!cronOk && !caller) {
      return new Response(JSON.stringify({ success: false, error: "Authentication required" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    // A signed-in user only ever acts on their own leases; only the scheduler runs across every account.
    const scopeUserId: string | null = caller ? caller.id : null;
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
      // A signed-in user can only send the test to their own address (never an arbitrary recipient)
      if (caller) {
        body.recipient_email = caller.email || "";
        body.email = undefined;
      }

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

      const confirmUrl = `${APP_BASE_URL}/reconcile?action=confirm&token=${confirmToken}`;
      const snoozeUrl = `${APP_BASE_URL}/reconcile?action=snooze&token=${snoozeToken}`;

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

      if (caller && targetLease.user_id !== caller.id) {
        return new Response(
          JSON.stringify({ success: false, error: "Not authorized for this lease", logs }),
          { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      const { email: targetEmail, source: targetSource } = await resolveRecipientEmail(
        adminClient,
        targetLease.user_id,
        targetLease.notification_email,
        (caller ? undefined : body.recipient_email) || alertRecipientOverride
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

      const confirmUrl = `${APP_BASE_URL}/reconcile?action=confirm&token=${confirmToken}`;
      const snoozeUrl = `${APP_BASE_URL}/reconcile?action=snooze&token=${snoozeToken}`;
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

    // 1b. ADVANCE NOTICE FOR SCHEDULED RENT ESCALATIONS
    logs.push("Step 1b: Checking scheduled rent escalations for advance notice...");
    try {
      const { data: pendingIncreases } = await adminClient
        .from("rent_increases")
        .select(`
          id,
          lease_id,
          effective_date,
          new_rent,
          scheduled_amount,
          increase_type,
          leases ( id, tenant_name, monthly_rent, user_id, notification_email, deal_id, deals ( id, title ) )
        `)
        .eq("is_applied", false);

      if (pendingIncreases && Array.isArray(pendingIncreases)) {
        for (const inc of pendingIncreases) {
          const leaseObj = inc.leases as any;
          if (!leaseObj) continue;
          if (scopeUserId && leaseObj.user_id !== scopeUserId) continue;
          const userPrefs = await getUserAlertPreferences(adminClient, leaseObj.user_id);
          const noticeDays = userPrefs.escalation_notice_days ?? 30;
          if (noticeDays <= 0) continue;

          // Target date = today + noticeDays (YYYY-MM-DD)
          const targetDate = new Date();
          targetDate.setDate(targetDate.getDate() + noticeDays);
          const targetDateIso = targetDate.toISOString().split("T")[0];

          if (inc.effective_date === targetDateIso) {
            const { email: targetEmail } = await resolveRecipientEmail(adminClient, leaseObj.user_id, leaseObj.notification_email, alertRecipientOverride);
            const oldRentFormatted = "$" + Math.round(Number(leaseObj.monthly_rent || 0)).toLocaleString("en-US");
            const newRentFormatted = "$" + Math.round(Number(inc.new_rent || 0)).toLocaleString("en-US");
            const propTitle = leaseObj.deals?.title || "Property";

            if (resendApiKey) {
              await sendEmailWithResend(resendApiKey, {
                from: defaultFromEmail,
                to: targetEmail,
                subject: `Rent Escalation in ${noticeDays} Days: ${leaseObj.tenant_name} (${oldRentFormatted} ➔ ${newRentFormatted}) - ${propTitle}`,
                html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #020617; color: #f8fafc; margin: 0; padding: 24px; }
    .card { background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; max-width: 520px; margin: 0 auto; }
    .header { font-size: 12px; font-weight: 800; color: #38bdf8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .title { font-size: 22px; font-weight: 800; color: #ffffff; margin-bottom: 6px; }
    .sub { font-size: 13px; color: #94a3b8; margin-bottom: 24px; line-height: 1.5; }
    .details { background: #020617; border: 1px solid #1e293b; border-radius: 12px; padding: 16px; margin-bottom: 24px; }
    .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 12px; border-bottom: 1px solid #1e293b; }
    .row:last-child { border-bottom: none; }
    .lbl { color: #64748b; }
    .val { color: #f8fafc; font-weight: 700; }
    .footer { font-size: 11px; color: #475569; text-align: center; margin-top: 24px; line-height: 1.4; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">MathTree &bull; Scheduled Escalation Heads-Up</div>
    <div class="title">Rent Escalation in ${noticeDays} Days</div>
    <div class="sub">Contractual rent for <strong>${leaseObj.tenant_name}</strong> is scheduled to increase on <strong>${inc.effective_date}</strong>.</div>

    <div class="details">
      <div class="row"><span class="lbl">Property</span><span class="val">${propTitle}</span></div>
      <div class="row"><span class="lbl">Tenant</span><span class="val">${leaseObj.tenant_name}</span></div>
      <div class="row"><span class="lbl">Current Monthly Rent</span><span class="val">${oldRentFormatted}</span></div>
      <div class="row"><span class="lbl">Scheduled New Rent</span><span class="val" style="color: #34d399; font-weight: 800;">${newRentFormatted}</span></div>
      <div class="row"><span class="lbl">Effective Date</span><span class="val">${inc.effective_date}</span></div>
    </div>

    <div class="footer">
      MathTree will automatically bump the rent and recalculate dynamic equity on ${inc.effective_date}. No manual action required.
    </div>
  </div>
</body>
</html>
                `
              });
              logs.push(`Escalation advance notice sent to ${targetEmail} for lease ${leaseObj.id}`);
            }
          }
        }
      }
    } catch (eInc: any) {
      logs.push(`Notice: Escalation advance scan: ${eInc?.message || eInc}`);
    }

    // 2. DYNAMIC DUE DATE & ADVANCE NOTICE DISPATCHING
    logs.push(`Step 2: Checking leases due today (day ${todayDay}) or with custom advance notice...`);

    const { data: activeLeases, error: activeLeasesErr } = await adminClient
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
        lease_start_date,
        deals ( id, title, user_id ),
        units ( unit_number, unit_type )
      `)
      .eq("is_active", true);

    let dueEmailsSent = 0;

    if (!activeLeasesErr && Array.isArray(activeLeases)) {
      for (const lease of activeLeases) {
        if (scopeUserId && lease.user_id !== scopeUserId) continue;
        const userPrefs = await getUserAlertPreferences(adminClient, lease.user_id);
        // A due day of 29-31 falls on the last day of shorter months (otherwise those months would never trigger)
        const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const dueDay = Math.min(Number(lease.payment_due_day) || 1, lastDayOfMonth);
        const advanceDays = Number(userPrefs.advance_notice_days) || 0;

        let shouldSend = false;
        let isAdvanceNotice = false;

        // Check A: Advance Notice trigger
        if (advanceDays > 0 && todayDay === (dueDay - advanceDays)) {
          shouldSend = true;
          isAdvanceNotice = true;
        }
        // Check B: Exact Due Date trigger
        else if (todayDay === dueDay) {
          if (advanceDays === 0 || userPrefs.remind_on_due !== false) {
            shouldSend = true;
            isAdvanceNotice = false;
          }
        }
        // Catch-up: if a run was missed or failed on the due day, still send this month's reminder within a week of it,
        // unless one already went out for this period or the lease only started after the due date.
        else if (todayDay > dueDay && todayDay - dueDay <= 7 && userPrefs.remind_on_due !== false) {
          const dueIso = `${currentPeriodMonth.slice(0, 8)}${String(dueDay).padStart(2, "0")}`;
          const startedBeforeDue = !lease.lease_start_date || String(lease.lease_start_date) <= dueIso;
          const { count: alreadySent } = await adminClient
            .from("reconciliation_tokens")
            .select("id", { count: "exact", head: true })
            .eq("lease_id", lease.id)
            .eq("period_month", currentPeriodMonth)
            .eq("action", "confirm");
          if ((alreadySent ?? 0) === 0 && startedBeforeDue) {
            shouldSend = true;
            isAdvanceNotice = false;
            logs.push(`Catch-up reminder for ${lease.tenant_name}: no reminder recorded for this period (due day ${dueDay}).`);
          }
        }
        else if (body.force_all) {
          shouldSend = true;
          isAdvanceNotice = false;
        }

        if (!shouldSend) {
          continue;
        }

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
        logs.push(`Routing ${isAdvanceNotice ? 'advance reminder' : 'due reminder'} for ${lease.tenant_name} to ${targetEmail} (resolved via ${targetSource})`);

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

        const confirmUrl = `${APP_BASE_URL}/reconcile?action=confirm&token=${confirmToken}`;
        const snoozeUrl = `${APP_BASE_URL}/reconcile?action=snooze&token=${snoozeToken}`;
        const rentFormatted = "$" + Math.round(Number(lease.monthly_rent || 0)).toLocaleString("en-US");
        const dealTitle = (lease.deals as any)?.title || "Commercial Property";
        const unitName = (lease.units as any)?.unit_number ? `Unit ${(lease.units as any).unit_number}` : "Main Facility";
        const graceDays = lease.grace_period_days || 5;

        const emailTitle = isAdvanceNotice
          ? `Upcoming Rent Due: ${rentFormatted}`
          : `Rent Due Today: ${rentFormatted}`;
        const emailSub = isAdvanceNotice
          ? `Advance Notice: Contractual rent for <strong>${lease.tenant_name}</strong> is due in <strong>${advanceDays} day${advanceDays > 1 ? "s" : ""}</strong> (on day ${dueDay} of the month).`
          : `Contractual rent is due today for <strong>${lease.tenant_name}</strong>. Reconcile with a single click below.`;
        const emailSubject = isAdvanceNotice
          ? `Upcoming Rent Due in ${advanceDays} Day${advanceDays > 1 ? "s" : ""}: ${lease.tenant_name} (${rentFormatted}) - ${dealTitle}`
          : `Rent Due Today: ${lease.tenant_name} (${rentFormatted}) - ${dealTitle}`;

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
    <div class="title">${emailTitle}</div>
    <div class="sub">${emailSub}</div>

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
            subject: emailSubject,
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

    // 3. FOLLOW-UPS ON UNPAID RENT (user-configurable)
    // After the due-date reminder, unpaid rent keeps getting follow-ups at the pace in the owner's alert settings
    // (frequency, maximum count, on/off). They start when a snooze runs out or, if the reminder was ignored, when the
    // grace period ends. Snoozing again pauses them. (Previously a snoozed payment was re-emailed EVERY day after its snooze.)
    logs.push("Step 3: Evaluating follow-ups for unpaid rent (per-user frequency and limits)...");

    const { data: periodPayments } = await adminClient
      .from("rent_payments")
      .select("lease_id, status, amount_paid, amount_due, snooze_until")
      .eq("period_month", currentPeriodMonth);
    const { data: periodTokens } = await adminClient
      .from("reconciliation_tokens")
      .select("lease_id, created_at")
      .eq("action", "confirm")
      .eq("period_month", currentPeriodMonth);

    const paymentByLease = new Map<string, any>();
    for (const pay of (periodPayments || []) as any[]) paymentByLease.set(String(pay.lease_id), pay);
    const tokenTimesByLease = new Map<string, string[]>();
    for (const t of (periodTokens || []) as any[]) {
      const k = String(t.lease_id);
      tokenTimesByLease.set(k, [...(tokenTimesByLease.get(k) || []), t.created_at]);
    }

    const followupCandidates: Array<{ leases: any; deals: any; amount_due: number; reason: string; followupNumber: number }> = [];
    for (const lease of (Array.isArray(activeLeases) ? activeLeases : []) as any[]) {
      if (scopeUserId && lease.user_id !== scopeUserId) continue;
      const userPrefs = await getUserAlertPreferences(adminClient, lease.user_id);
      const payment = paymentByLease.get(String(lease.id)) || null;
      const decision = decideFollowup({
        today: now,
        dueDay: Number(lease.payment_due_day) || 1,
        graceDays: Number(lease.grace_period_days ?? 5),
        rent: Number(lease.monthly_rent) || 0,
        payment,
        reminderTimes: tokenTimesByLease.get(String(lease.id)) || [],
        prefs: userPrefs,
      });
      if (decision.send) {
        followupCandidates.push({
          leases: lease,
          deals: lease.deals,
          amount_due: Number(payment?.amount_due ?? lease.monthly_rent) || 0,
          reason: decision.reason,
          followupNumber: decision.followupNumber,
        });
      }
    }

    let graceFollowupsSent = 0;

    {
      for (const p of followupCandidates) {
        const lease = p.leases;
        const deal = p.deals;

        const { email: targetEmail, source: targetSource } = await resolveRecipientEmail(
          adminClient,
          lease.user_id,
          lease.notification_email,
          alertRecipientOverride
        );
        logs.push(`Routing grace period follow-up for ${lease.tenant_name} to ${targetEmail} (resolved via ${targetSource})`);

        const confirmToken = generateHexToken();
        const snoozeToken = generateHexToken();
        const tokenExpires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

        await adminClient.from("reconciliation_tokens").insert([
          { lease_id: lease.id, deal_id: deal?.id || lease.id, user_id: lease.user_id, period_month: currentPeriodMonth, action: "confirm", token_hash: confirmToken, expires_at: tokenExpires },
          { lease_id: lease.id, deal_id: deal?.id || lease.id, user_id: lease.user_id, period_month: currentPeriodMonth, action: "snooze", token_hash: snoozeToken, expires_at: tokenExpires },
        ]);

        const confirmUrl = `${APP_BASE_URL}/reconcile?action=confirm&token=${confirmToken}`;
        const snoozeUrl = `${APP_BASE_URL}/reconcile?action=snooze&token=${snoozeToken}`;
        const followupLabel = p.reason === "snooze_expired" ? "Snooze Ended" : "Rent Still Unpaid";
        const followupTag = p.followupNumber > 1 ? ` · Follow-up #${p.followupNumber}` : "";
        const followupSub = p.reason === "snooze_expired"
          ? "The snooze you set has ended and no payment has been recorded."
          : `The ${lease.grace_period_days ?? 5}-day grace period has passed without recorded payment.`;
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
    <div class="header">⚠️ ${followupLabel}${followupTag}</div>
    <div class="title">Past-Due Rent: ${lease.tenant_name} (${rentFormatted})</div>
    <div class="sub">${followupSub}</div>

    <div class="details">
      <p style="font-size: 12px; color: #cbd5e1; margin-bottom: 6px;"><strong>Property:</strong> ${deal?.title || "Commercial Asset"}</p>
      <p style="font-size: 12px; color: #cbd5e1; margin-bottom: 6px;"><strong>Tenant:</strong> ${lease.tenant_name}</p>
      <p style="font-size: 12px; color: #f87171; margin-bottom: 0;"><strong>Outstanding Balance:</strong> ${rentFormatted}</p>
    </div>

    <a href="${confirmUrl}" class="btn-confirm">✓ Confirm Payment Received Now</a>
    <a href="${snoozeUrl}" class="btn-ops">⏳ Snooze Again</a>
    <a href="https://mathtree-app.web.app/operations" class="btn-ops">Open Operations & Issue Late Notice</a>

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
            subject: `⚠️ ${followupLabel}${followupTag}: ${lease.tenant_name} (${rentFormatted}) Past Due`,
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
