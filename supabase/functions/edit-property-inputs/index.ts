import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { calculateProjections, auditDealRisks, DealInputs } from "./math-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, PUT, PATCH, OPTIONS",
};

function getEnv(key: string): string {
  try {
    return Deno.env.get(key) || "";
  } catch {
    return "";
  }
}

export interface UnitInput {
  id?: string;
  unitNumber?: string;
  unit_number?: string;
  unitType?: string;
  unit_type?: string;
  sqft?: number;
  marketRent?: number;
  market_rent?: number;
  status?: string;
}

export interface LeaseInput {
  id?: string;
  unitId?: string;
  unit_id?: string;
  tenantName?: string;
  tenant_name?: string;
  tenantEmail?: string;
  tenant_email?: string;
  tenantPhone?: string;
  tenant_phone?: string;
  monthlyRent?: number;
  monthly_rent?: number;
  leaseStartDate?: string;
  lease_start_date?: string;
  leaseEndDate?: string;
  lease_end_date?: string;
  leaseType?: string;
  securityDeposit?: number;
  security_deposit?: number;
  paymentDueDay?: number;
  gracePeriodDays?: number;
  escalationType?: string;
  escalation_type?: string;
  escalationRate?: number;
  escalation_rate?: number;
  escalationFrequency?: string;
  escalation_frequency?: string;
  nextEscalationDate?: string;
  next_escalation_date?: string;
  isActive?: boolean;
  is_active?: boolean;
}

export interface EditPropertyPayload {
  dealId?: string;
  id?: string;
  title?: string;
  name?: string;
  status?: string;
  assetType?: string;
  asset_class?: string;
  location?: string;
  entityId?: string;
  entity_id?: string;
  inputs?: Record<string, unknown>;
  units?: UnitInput[];
  leases?: LeaseInput[];
  operatingExpenses?: Record<string, unknown>;
  demo?: boolean;
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
    let userClient: ReturnType<typeof createClient> | null = null;
    let adminClient: ReturnType<typeof createClient> | null = null;

    if (supabaseUrl && supabaseAnonKey) {
      if (authHeader) {
        try {
          userClient = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: authHeader } }
          });
          const { data, error } = await userClient.auth.getUser();
          if (!error && data?.user) {
            userId = data.user.id;
          }
        } catch (authErr) {
          console.warn("Non-fatal token evaluation warning:", authErr);
        }
      }

      if (supabaseServiceKey) {
        try {
          adminClient = createClient(supabaseUrl, supabaseServiceKey);
        } catch (adminErr) {
          console.warn("Could not create admin client:", adminErr);
        }
      }
    }

    let payload: EditPropertyPayload;
    try {
      payload = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON request body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (!payload || typeof payload !== "object") {
      return new Response(JSON.stringify({ error: "Payload must be a JSON object" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const dealId = String(payload.dealId ?? payload.id ?? "").trim();
    const isDemo = payload.demo === true || !userId || !supabaseUrl;

    const dbClient = adminClient || userClient;
    let existingDeal: Record<string, unknown> | null = null;

    if (!isDemo && dbClient && dealId) {
      try {
        const { data, error } = await dbClient
          .from("deals")
          .select("*")
          .eq("id", dealId)
          .maybeSingle();

        if (!error && data) {
          existingDeal = data as Record<string, unknown>;
        }
      } catch (dbErr) {
        console.warn("Could not fetch existing deal from database:", dbErr);
      }
    }

    // 1. Resolve Asset Class & Core Fields
    const existingInputs = (existingDeal?.inputs && typeof existingDeal.inputs === "object"
      ? existingDeal.inputs
      : {}) as Record<string, unknown>;

    const mergedInputs: Record<string, unknown> = {
      ...existingInputs,
      ...(payload.inputs && typeof payload.inputs === "object" ? payload.inputs : {})
    };

    if (payload.operatingExpenses && typeof payload.operatingExpenses === "object") {
      mergedInputs.operatingExpenses = {
        ...(typeof mergedInputs.operatingExpenses === "object" ? (mergedInputs.operatingExpenses as Record<string, unknown>) : {}),
        ...payload.operatingExpenses
      };
    }

    const rawAsset = String(
      payload.assetType ??
      payload.asset_class ??
      existingDeal?.asset_type ??
      mergedInputs.assetType ??
      "commercial"
    ).toLowerCase().replace(/_/g, "-");

    const validAssets = ["single-family", "multi-unit", "commercial", "storage"];
    const assetType = validAssets.includes(rawAsset)
      ? rawAsset
      : (rawAsset === "multifamily" ? "multi-unit" : "commercial");

    const title = String(payload.title ?? payload.name ?? existingDeal?.title ?? `${assetType.toUpperCase()} Investment Memo`).trim();
    const status = String(payload.status ?? existingDeal?.status ?? "prospect").toLowerCase();
    const location = String(payload.location ?? existingDeal?.location ?? "United States").trim();
    const entityId = payload.entityId ?? payload.entity_id ?? existingDeal?.entity_id ?? null;

    // 2. Synchronize Units & Leases if provided
    let totalInPlaceRent = 0;
    const syncedUnits: Record<string, unknown>[] = [];
    const syncedLeases: Record<string, unknown>[] = [];

    if (Array.isArray(payload.units) && payload.units.length > 0) {
      for (const u of payload.units) {
        const unitNumber = String(u.unitNumber ?? u.unit_number ?? "Unit 1");
        const unitType = String(u.unitType ?? u.unit_type ?? "Commercial");
        const sqft = Number(u.sqft ?? 0);
        const marketRent = Number(u.marketRent ?? u.market_rent ?? 0);
        const unitStatus = String(u.status ?? "occupied");

        const unitRecord: Record<string, unknown> = {
          deal_id: dealId || "demo-deal",
          user_id: userId || "demo-user",
          unit_number: unitNumber,
          unit_type: unitType,
          market_rent: marketRent,
          status: unitStatus
        };

        if (u.id) unitRecord.id = u.id;

        if (!isDemo && dbClient && dealId) {
          try {
            const { data: upsertedUnit } = await dbClient
              .from("units")
              .upsert(unitRecord)
              .select()
              .single();
            if (upsertedUnit) syncedUnits.push(upsertedUnit);
          } catch (unitErr) {
            console.warn("Unit upsert error:", unitErr);
            syncedUnits.push(unitRecord);
          }
        } else {
          syncedUnits.push(unitRecord);
        }
      }
    }

    if (Array.isArray(payload.leases) && payload.leases.length > 0) {
      for (const l of payload.leases) {
        const tenantName = String(l.tenantName ?? l.tenant_name ?? "Commercial Tenant");
        const monthlyRent = Number(l.monthlyRent ?? l.monthly_rent ?? 0);
        const startDate = String(l.leaseStartDate ?? l.lease_start_date ?? new Date().toISOString().split("T")[0]);
        const endDate = l.leaseEndDate ?? l.lease_end_date ? String(l.leaseEndDate ?? l.lease_end_date) : null;
        const escType = l.escalationType ?? l.escalation_type ?? null;
        const escRate = l.escalationRate !== undefined ? Number(l.escalationRate) : (l.escalation_rate !== undefined ? Number(l.escalation_rate) : null);
        const escFreq = String(l.escalationFrequency ?? l.escalation_frequency ?? "Annual on Anniversary");
        const nextEscDate = l.nextEscalationDate ?? l.next_escalation_date ? String(l.nextEscalationDate ?? l.next_escalation_date) : null;
        const isActive = l.isActive !== false && l.is_active !== false;

        if (isActive && monthlyRent > 0) {
          totalInPlaceRent += monthlyRent;
        }

        const leaseRecord: Record<string, unknown> = {
          deal_id: dealId || "demo-deal",
          user_id: userId || "demo-user",
          unit_id: l.unitId ?? l.unit_id ?? null,
          tenant_name: tenantName,
          tenant_email: l.tenantEmail ?? l.tenant_email ?? null,
          tenant_phone: l.tenantPhone ?? l.tenant_phone ?? null,
          monthly_rent: monthlyRent,
          lease_start_date: startDate,
          lease_end_date: endDate,
          security_deposit: Number(l.securityDeposit ?? l.security_deposit ?? 0),
          escalation_type: escType,
          escalation_rate: escRate,
          escalation_frequency: escType ? escFreq : null,
          next_escalation_date: escType ? nextEscDate : null,
          is_active: isActive
        };

        if (l.id) leaseRecord.id = l.id;

        if (!isDemo && dbClient && dealId) {
          try {
            const { data: upsertedLease } = await dbClient
              .from("leases")
              .upsert(leaseRecord)
              .select()
              .single();

            if (upsertedLease) {
              syncedLeases.push(upsertedLease);

              // Record planned escalation in rent_increases if configured
              if (escType && escRate && escRate > 0) {
                const plannedNewRent = String(escType).includes("Percentage")
                  ? Math.round(monthlyRent * (1 + escRate / 100) * 100) / 100
                  : monthlyRent + escRate;
                const escReason = `Scheduled ${String(escType).includes("Percentage") ? escRate + "%" : "$" + escRate} ${escFreq} escalation`;

                await dbClient.from("rent_increases").upsert({
                  user_id: userId,
                  lease_id: upsertedLease.id,
                  deal_id: dealId,
                  effective_date: nextEscDate || startDate,
                  old_rent: monthlyRent,
                  new_rent: plannedNewRent,
                  reason: escReason,
                  notice_sent_date: null
                });
              }
            }
          } catch (leaseErr) {
            console.warn("Lease upsert error:", leaseErr);
            syncedLeases.push(leaseRecord);
          }
        } else {
          syncedLeases.push(leaseRecord);
        }
      }
    }

    // If active leases were provided, automatically reflect total in-place rent in underwriting
    if (totalInPlaceRent > 0) {
      mergedInputs.monthlyRent = totalInPlaceRent;
      mergedInputs.grossRentPerMonth = totalInPlaceRent;
      mergedInputs.grossRentAnnual = totalInPlaceRent * 12;
    }

    // 3. Compute Institutional Math Projections & Risk Audit
    const projectionsResult = calculateProjections(assetType, mergedInputs as DealInputs);
    const risks = auditDealRisks(assetType, mergedInputs as DealInputs, projectionsResult);

    const y1 = projectionsResult.projections[0];

    // 4. Construct Updated Deal Payload
    const updatedDeal: Record<string, unknown> = {
      id: dealId || `deal-${Date.now()}`,
      user_id: userId || "demo-user",
      title: title,
      status: status,
      asset_type: assetType,
      location: location,
      entity_id: entityId,
      purchase_price: projectionsResult.purchasePrice,
      irr: projectionsResult.irr,
      equity_multiple: projectionsResult.equityMultiplier,
      cash_on_cash: y1?.cashOnCash ?? 0,
      year1_cashflow: y1?.netCashFlow ?? 0,
      inputs: mergedInputs,
      metrics: {
        ...projectionsResult,
        noi: y1?.netOperatingIncome ?? 0,
        capRate: projectionsResult.purchasePrice > 0 ? ((y1?.netOperatingIncome ?? 0) / projectionsResult.purchasePrice) * 100 : 0,
        dscr: y1?.dscr ?? null,
        breakEvenOccupancyPct: y1?.breakEvenOccupancyPct ?? 0,
        initialCashInvested: projectionsResult.initialCashInvested,
        loanAmount: projectionsResult.loanAmount
      },
      updated_at: new Date().toISOString()
    };

    // 5. Persist Deal in Postgres if connected
    if (!isDemo && dbClient && dealId) {
      try {
        const { data: savedDeal, error: saveErr } = await dbClient
          .from("deals")
          .update(updatedDeal)
          .eq("id", dealId)
          .select()
          .single();

        if (!saveErr && savedDeal) {
          Object.assign(updatedDeal, savedDeal);
        }
      } catch (saveErr) {
        console.warn("Could not update deal in database:", saveErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        demo: isDemo,
        deal: updatedDeal,
        units: syncedUnits,
        leases: syncedLeases,
        projections: projectionsResult.projections,
        risks: risks,
        summary: {
          irr: projectionsResult.irr,
          equityMultiple: projectionsResult.equityMultiplier,
          noi: y1?.netOperatingIncome ?? 0,
          cashOnCash: y1?.cashOnCash ?? 0,
          purchasePrice: projectionsResult.purchasePrice,
          loanAmount: projectionsResult.loanAmount
        }
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}

// Start HTTP server
if (import.meta.main) {
  serve(handleRequest);
}
