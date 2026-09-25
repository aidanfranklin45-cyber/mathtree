// supabase/functions/configure-lease-terms/index.ts
// Supabase Edge Function to configure and persist contractual lease terms,
// security deposits, escalation schedules, and synchronization with parent deal financial models.

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

export interface ScheduledEscalationStep {
  id?: string;
  effective_date: string;
  increase_type: "percentage" | "fixed_step" | "cpi" | string;
  scheduled_amount: number;
  reason?: string;
}

export interface ConfigureLeaseTermsPayload {
  lease_id?: string;
  id?: string;
  deal_id: string;
  unit_id?: string | null;
  tenant_name: string;
  monthly_rent: number;
  lease_start_date: string;
  lease_end_date?: string | null;
  tenant_email?: string | null;
  tenant_phone?: string | null;
  security_deposit?: number;
  is_active?: boolean;
  status?: string;
  escalation_type?: string | null;
  escalation_rate?: number | null;
  escalation_frequency?: string | null;
  next_escalation_date?: string | null;
  notification_email?: string | null;
  notes?: string | null;
  scheduled_escalations?: ScheduledEscalationStep[];
  demo?: boolean;
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
    } catch (e) {
      console.warn("[configure-lease-terms] Auth verification warning:", e);
    }
  }

  // GET: Retrieve lease terms and schedule for a lease or deal
  if (req.method === "GET") {
    const url = new URL(req.url);
    const leaseId = url.searchParams.get("lease_id") || url.searchParams.get("id");
    const dealId = url.searchParams.get("deal_id");

    if (!dbClient) {
      return jsonResponse({ error: "Database client unavailable" }, 500);
    }

    try {
      let query = dbClient.from("leases").select("*");
      if (leaseId) {
        query = query.eq("id", leaseId);
      } else if (dealId) {
        query = query.eq("deal_id", dealId);
      } else {
        return jsonResponse({ error: "Provide lease_id or deal_id parameter" }, 400);
      }

      const { data: leases, error: leaseErr } = await query;
      if (leaseErr) throw leaseErr;

      const lease = leases?.[0] || null;
      let scheduledEscalations: unknown[] = [];

      if (lease?.id) {
        const { data: increases } = await dbClient
          .from("rent_increases")
          .select("*")
          .eq("lease_id", lease.id)
          .order("effective_date", { ascending: true });
        scheduledEscalations = increases || [];
      }

      return jsonResponse({
        success: true,
        lease,
        scheduled_escalations: scheduledEscalations,
      });
    } catch (err: any) {
      return jsonResponse({ error: err.message || "Failed to fetch lease terms" }, 500);
    }
  }

  // POST / PUT / PATCH: Configure or Update Lease Terms
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    let payload: ConfigureLeaseTermsPayload;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON request body" }, 400);
    }

    const dealId = String(payload.deal_id ?? "").trim();
    if (!dealId) {
      return jsonResponse({ error: "Missing required deal_id parameter" }, 400);
    }

    const tenantName = String(payload.tenant_name ?? "In-Place Commercial Tenant").trim();
    const monthlyRent = Math.max(0, parseFloat(String(payload.monthly_rent ?? 0)) || 0);
    const leaseStartDate = payload.lease_start_date ? String(payload.lease_start_date) : new Date().toISOString().split("T")[0];
    const leaseEndDate = payload.lease_end_date ? String(payload.lease_end_date) : null;
    const securityDeposit = Math.max(0, parseFloat(String(payload.security_deposit ?? (monthlyRent * 2))) || 0);
    const isActive = payload.is_active !== false && payload.status !== "terminated";
    const escType = payload.escalation_type || null;
    const escRate = payload.escalation_rate !== undefined && payload.escalation_rate !== null ? parseFloat(String(payload.escalation_rate)) : null;
    const escFreq = payload.escalation_frequency || "Annual on Anniversary";
    const nextEscDate = payload.next_escalation_date ? String(payload.next_escalation_date) : null;
    const tenantEmail = payload.tenant_email ? String(payload.tenant_email).trim() : null;
    const tenantPhone = payload.tenant_phone ? String(payload.tenant_phone).trim() : null;
    const notificationEmail = payload.notification_email ? String(payload.notification_email).trim() : null;
    const rawLeaseId = payload.lease_id || payload.id || null;

    const isRealUuid = (id: string | null | undefined): boolean => {
      return Boolean(id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
    };

    // Handle Demo Mode
    if (payload.demo === true || !isRealUuid(dealId)) {
      const demoLease = {
        id: rawLeaseId || `demo-lease-${Date.now()}`,
        deal_id: dealId,
        unit_id: payload.unit_id || null,
        tenant_name: tenantName,
        tenant_email: tenantEmail,
        tenant_phone: tenantPhone,
        monthly_rent: monthlyRent,
        security_deposit: securityDeposit,
        lease_start_date: leaseStartDate,
        lease_end_date: leaseEndDate,
        is_active: isActive,
        escalation_type: escType,
        escalation_rate: escRate,
        escalation_frequency: escFreq,
        next_escalation_date: nextEscDate,
        notification_email: notificationEmail,
        updated_at: new Date().toISOString(),
      };
      return jsonResponse({
        success: true,
        demo: true,
        lease: demoLease,
        scheduled_escalations: payload.scheduled_escalations || [],
        deal_id: dealId,
      });
    }

    if (!dbClient) {
      return jsonResponse({ error: "Database client unavailable" }, 500);
    }

    try {
      // 1. Fetch deal to verify existence and extract user_id if not present
      const { data: deal, error: dealErr } = await dbClient
        .from("deals")
        .select("id, user_id, title, inputs")
        .eq("id", dealId)
        .maybeSingle();

      if (dealErr) throw dealErr;
      if (!deal) {
        return jsonResponse({ error: "Deal not found" }, 404);
      }

      const effectiveUserId = userId || deal.user_id;

      // 2. Identify target lease record in public.leases
      let targetLeaseId: string | null = null;
      if (isRealUuid(rawLeaseId)) {
        targetLeaseId = rawLeaseId;
      } else {
        // If leaseId was synthetic (deal-lease-...), look for existing active lease for this deal
        const { data: existingLeases } = await dbClient
          .from("leases")
          .select("id")
          .eq("deal_id", dealId)
          .limit(1);

        if (existingLeases && existingLeases.length > 0) {
          targetLeaseId = existingLeases[0].id;
        }
      }

      const leaseRecord: Record<string, unknown> = {
        deal_id: dealId,
        user_id: effectiveUserId,
        tenant_name: tenantName,
        monthly_rent: monthlyRent,
        lease_start_date: leaseStartDate,
        lease_end_date: leaseEndDate,
        tenant_email: tenantEmail,
        tenant_phone: tenantPhone,
        security_deposit: securityDeposit,
        is_active: isActive,
        escalation_type: escType,
        escalation_rate: escRate,
        escalation_frequency: escType ? escFreq : null,
        next_escalation_date: escType ? nextEscDate : null,
        notification_email: notificationEmail,
        notes: payload.notes || null,
        updated_at: new Date().toISOString(),
      };

      if (payload.unit_id && isRealUuid(payload.unit_id)) {
        leaseRecord.unit_id = payload.unit_id;
      }

      let savedLease: Record<string, unknown>;

      if (targetLeaseId) {
        const { data: updatedLease, error: updateErr } = await dbClient
          .from("leases")
          .update(leaseRecord)
          .eq("id", targetLeaseId)
          .select()
          .single();

        if (updateErr) throw updateErr;
        savedLease = updatedLease;
      } else {
        const { data: insertedLease, error: insertErr } = await dbClient
          .from("leases")
          .insert(leaseRecord)
          .select()
          .single();

        if (insertErr) throw insertErr;
        savedLease = insertedLease;
      }

      const realLeaseId = String(savedLease.id);

      // 3. Synchronize public.rent_increases
      const scheduledSteps = Array.isArray(payload.scheduled_escalations) ? payload.scheduled_escalations : [];

      // Delete existing unapplied scheduled rent increases for this lease
      await dbClient
        .from("rent_increases")
        .delete()
        .eq("lease_id", realLeaseId)
        .eq("is_applied", false);

      const insertedIncreases: Record<string, unknown>[] = [];

      if (scheduledSteps.length > 0) {
        const newIncreases = scheduledSteps.map((step) => {
          const stepAmount = parseFloat(String(step.scheduled_amount || 0));
          const stepType = step.increase_type || "percentage";
          const newRent = stepType === "percentage"
            ? Math.round(monthlyRent * (1 + stepAmount / 100) * 100) / 100
            : monthlyRent + stepAmount;

          return {
            user_id: effectiveUserId,
            lease_id: realLeaseId,
            deal_id: dealId,
            effective_date: step.effective_date,
            increase_type: stepType,
            scheduled_amount: stepAmount,
            old_rent: monthlyRent,
            new_rent: newRent,
            reason: step.reason || `Scheduled ${stepType} escalation`,
            is_applied: false,
          };
        });

        const { data: incData, error: incErr } = await dbClient
          .from("rent_increases")
          .insert(newIncreases)
          .select();

        if (!incErr && incData) {
          insertedIncreases.push(...incData);
        }
      } else if (escType && escRate && escRate > 0 && nextEscDate) {
        // Automatically ensure next escalation milestone is registered
        const newRent = String(escType).includes("Percentage")
          ? Math.round(monthlyRent * (1 + escRate / 100) * 100) / 100
          : monthlyRent + escRate;

        const defaultIncrease = {
          user_id: effectiveUserId,
          lease_id: realLeaseId,
          deal_id: dealId,
          effective_date: nextEscDate,
          increase_type: String(escType).includes("Fixed") ? "fixed_step" : "percentage",
          scheduled_amount: escRate,
          old_rent: monthlyRent,
          new_rent: newRent,
          reason: `Scheduled ${escFreq} escalation`,
          is_applied: false,
        };

        const { data: defIncData } = await dbClient
          .from("rent_increases")
          .insert(defaultIncrease)
          .select();

        if (defIncData) {
          insertedIncreases.push(...defIncData);
        }
      }

      // 4. Synchronize parent deal inputs so model accuracy & pro-formas update immediately
      const currentInputs = (deal.inputs && typeof deal.inputs === "object")
        ? { ...(deal.inputs as Record<string, unknown>) }
        : {};

      currentInputs.monthlyRent = monthlyRent;
      currentInputs.grossRentPerMonth = monthlyRent;
      currentInputs.grossRentAnnual = Math.round(monthlyRent * 12);
      currentInputs.tenantName = tenantName;
      if (escRate) currentInputs.rentGrowthPercent = escRate;
      if (escType) currentInputs.escalationType = escType;
      if (nextEscDate) currentInputs.nextEscalationDate = nextEscDate;

      // Update leases array in deal inputs if present
      if (Array.isArray(currentInputs.leases)) {
        const existingIdx = currentInputs.leases.findIndex(
          (l: any) => l.id === realLeaseId || l.id === rawLeaseId
        );
        const leasePayload = {
          id: realLeaseId,
          tenantName,
          monthlyRent,
          leaseStartDate,
          leaseEndDate,
          securityDeposit,
          escalationType: escType,
          escalationRate: escRate,
          escalationFrequency: escFreq,
          nextEscalationDate: nextEscDate,
        };
        if (existingIdx >= 0) {
          currentInputs.leases[existingIdx] = leasePayload;
        } else {
          currentInputs.leases.push(leasePayload);
        }
      }

      // Persist updated deal inputs (PostgreSQL recompute_deal_financial_metrics trigger will fire)
      await dbClient
        .from("deals")
        .update({
          inputs: currentInputs,
          updated_at: new Date().toISOString(),
        })
        .eq("id", dealId);

      return jsonResponse({
        success: true,
        lease: savedLease,
        scheduled_escalations: insertedIncreases,
        deal_id: dealId,
      });
    } catch (err: any) {
      console.error("[configure-lease-terms] Error:", err);
      return jsonResponse({ error: err.message || "Failed to configure lease terms" }, 500);
    }
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

serve(handleRequest);
