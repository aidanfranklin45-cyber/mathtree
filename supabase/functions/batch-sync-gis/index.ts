import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const YAKIMA_TAXLOTS_URL = "https://maps.yakimacounty.us/server/rest/services/Assessor/Taxlots/FeatureServer/2/query";
const WA_CADASTRE_URL = "https://gis.dnr.wa.gov/site3/rest/services/Public_Boundaries/WADNR_PUBLIC_Cadastre/MapServer/0/query";
const WA_CADASTRE_FALLBACK_URL = "https://services.arcgis.com/Ie0K5n4UyLAfvdiX/arcgis/rest/services/Washington_2024_DOR_Parcels/FeatureServer/0/query";

function mapWaCadastreRecord(f: Record<string, unknown>): Record<string, unknown> | null {
  if (!f) return null;
  const a = (f.attributes as Record<string, unknown>) || {};
  const apn = String(a.PARCEL_ID || a.COUNTY_PARCEL_NO || a.APN || a.PIN || a.ASSESSOR_N || "").trim();
  if (!apn) return null;

  const county = String(a.COUNTY || a.COUNTY_NAME || a.COUNTY_LABEL_NM || (a.CO_NO ? `County ${a.CO_NO}` : "") || "").trim();
  let acres = parseFloat(String(a.ACRES || a.ACREAGE || a.CALC_ACRES || a.PRCL_REVW_TOTAL_ACRES || 0)) || 0;
  if (!acres && a.Shape__Area) {
    acres = parseFloat(String(a.Shape__Area)) / 43560;
  }
  const land = parseFloat(String(a.LND_VAL || a.MKT_LAND || 0)) || 0;
  const imp = parseFloat(String(a.IMP_VAL || a.MKT_IMPVT || 0)) || 0;
  const total = parseFloat(String(a.TOTAL_VAL || a.TOTAL_ASSESSED_VALUE || a.JV || 0)) || (land + imp);

  const street = String(a.SITUS_ADDR || a.SITUS_ADDRESS || a.PHY_ADDR1 || a.ADDRESS || "").trim();
  const city = String(a.SITUS_CITY || a.PHY_CITY || a.CITY || "").trim();
  const zip = String(a.SITUS_ZIP || a.PHY_ZIPCD || "").trim();
  const address = street ? [street, city, "WA", zip].filter(Boolean).join(", ") : `Parcel ${apn} (${county || "WA"})`;

  const owner = String(a.OWN_NAME || a.OWNER || a.LANDOWNERS || [a.FIRST_NAME, a.LAST_NAME].filter(Boolean).join(" ") || "Owner of Record").trim();

  return {
    apn,
    formattedApn: apn,
    address,
    marketLandValue: land,
    marketImprovementValue: imp,
    totalAssessedValue: total,
    acres: Math.round(acres * 1000) / 1000,
    sqft: Math.round(acres * 43560),
    taxYear: a.ASMNT_YR || a.TAX_YEAR || new Date().getFullYear(),
    zoning: String(a.ZONING || a.ZONE || "WA State Cadastre"),
    useCode: String(a.DOR_UC || a.USE_CODE || "General"),
    owner,
    legal: String(a.S_LEGAL || a.LEGAL || ""),
    county: county || "Washington",
    source: "wa_state_cadastre"
  };
}

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

  const startTime = Date.now();
  const supabaseUrl = getEnv("SUPABASE_URL");
  const supabaseServiceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY") || getEnv("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(JSON.stringify({ error: "Missing Supabase configuration" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // 1. Fetch all active deals that have an APN or parcels attached
    const { data: deals, error: fetchErr } = await supabase
      .from("deals")
      .select("id, user_id, title, location, inputs")
      .in("status", ["prospect", "owned"]);

    if (fetchErr) {
      throw new Error(`Failed to fetch deals: ${fetchErr.message}`);
    }

    if (!deals || deals.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "No active deals found to sync",
        totalDeals: 0,
        updatedDeals: 0,
        durationMs: Date.now() - startTime
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 2. Collect all unique APNs that belong to Yakima County
    const apnToDealIds = new Map<string, string[]>();
    for (const deal of deals) {
      const inputs = (deal.inputs as Record<string, unknown>) || {};
      const primaryApn = String(inputs.primaryApn || inputs.apn || "").trim().replace(/[^0-9]/g, "");
      if (primaryApn && primaryApn.length >= 6) {
        if (!apnToDealIds.has(primaryApn)) apnToDealIds.set(primaryApn, []);
        apnToDealIds.get(primaryApn)!.push(deal.id);
      }

      // Also check attached parcels array
      if (Array.isArray(inputs.parcels)) {
        for (const p of inputs.parcels) {
          const parcelObj = p as Record<string, unknown>;
          const parcelApn = String(parcelObj.apn || "").trim().replace(/[^0-9]/g, "");
          if (parcelApn && parcelApn.length >= 6) {
            if (!apnToDealIds.has(parcelApn)) apnToDealIds.set(parcelApn, []);
            apnToDealIds.get(parcelApn)!.push(deal.id);
          }
        }
      }
    }

    const uniqueApns = Array.from(apnToDealIds.keys());
    if (uniqueApns.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "No Yakima County APNs found in active deals",
        totalDeals: deals.length,
        updatedDeals: 0,
        durationMs: Date.now() - startTime
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 3. Batch query Yakima County GIS in chunks of 40
    const chunkSize = 40;
    const parcelDataMap = new Map<string, Record<string, unknown>>();

    for (let i = 0; i < uniqueApns.length; i += chunkSize) {
      const chunk = uniqueApns.slice(i, i + chunkSize);
      const whereClause = `ASSESSOR_N IN (${chunk.map(a => `'${a}'`).join(",")})`;
      const params = new URLSearchParams({
        where: whereClause,
        outFields: "*",
        f: "json"
      });

      try {
        const gisRes = await fetch(`${YAKIMA_TAXLOTS_URL}?${params.toString()}`);
        if (gisRes.ok) {
          const gisData = await gisRes.json();
          if (Array.isArray(gisData?.features)) {
            for (const f of gisData.features) {
              const a = f.attributes || {};
              const apn = String(a.ASSESSOR_N || "").trim();
              if (apn) {
                const land = parseFloat(String(a.MKT_LAND ?? 0)) || 0;
                const imp = parseFloat(String(a.MKT_IMPVT ?? 0)) || 0;
                const acres = parseFloat(String(a.ACRES ?? 0)) || 0;

                parcelDataMap.set(apn, {
                  apn,
                  formattedApn: apn.length === 11 ? `${apn.slice(0, 6)}-${apn.slice(6)}` : apn,
                  address: [a.SITUS_ADDR, a.SITUS_CITY, "WA", a.SITUS_ZIP].filter(Boolean).join(", "),
                  marketLandValue: land,
                  marketImprovementValue: imp,
                  totalAssessedValue: land + imp,
                  acres: Math.round(acres * 1000) / 1000,
                  sqft: Math.round(acres * 43560),
                  taxYear: a.TAX_YEAR || new Date().getFullYear(),
                  zoning: a.CNY_ZONE || a.CYAK_ZONG || a.UG_ZONING || "Standard",
                  useCode: a.USE_CODE || "General",
                  owner: [a.FIRST_NAME, a.LAST_NAME, a.ORG_NAME].filter(Boolean).join(" "),
                  legal: a.LEGAL || ""
                });
              }
            }
          }
        }
      } catch (err) {
        console.warn("GIS chunk query error:", err);
      }
    }

    // 3b. Fallback: Query WA State Statewide Cadastre for APNs not resolved in Yakima County
    const missingApns = uniqueApns.filter(a => !parcelDataMap.has(a));
    let statewideResolvedCount = 0;

    if (missingApns.length > 0) {
      console.log(`[batch-sync-gis] ${missingApns.length} APNs not found in Yakima County GIS. Initiating WA State Cadastre fallback...`);
      const waEndpoints = [WA_CADASTRE_URL, WA_CADASTRE_FALLBACK_URL];

      for (const apn of missingApns) {
        let resolved = false;
        for (const url of waEndpoints) {
          if (resolved) break;
          try {
            const whereClause = url === WA_CADASTRE_URL
              ? `PARCEL_ID = '${apn}' OR COUNTY_PARCEL_NO = '${apn}' OR APN = '${apn}'`
              : `PARCEL_ID = '${apn}' OR PARCEL_ID LIKE '%${apn}%'`;

            const params = new URLSearchParams({
              where: whereClause,
              outFields: "*",
              f: "json",
              resultRecordCount: "1"
            });

            const waRes = await fetch(`${url}?${params.toString()}`);
            if (waRes.ok) {
              const waData = await waRes.json();
              if (Array.isArray(waData?.features) && waData.features.length > 0) {
                const mapped = mapWaCadastreRecord(waData.features[0]);
                if (mapped) {
                  parcelDataMap.set(apn, mapped);
                  statewideResolvedCount++;
                  resolved = true;
                  console.log(`[batch-sync-gis] Resolved APN ${apn} via WA State Cadastre (${mapped.county || "WA"})`);
                }
              }
            } else {
              console.warn(`[batch-sync-gis] WA Cadastre request failed with HTTP ${waRes.status} on ${url}`);
            }
          } catch (waErr) {
            console.warn(`[batch-sync-gis] Error querying WA State Cadastre for APN ${apn}:`, waErr);
          }
        }
      }
    }

    // 4. Update deals with refreshed parcel and assessor information
    let updatedCount = 0;
    const nowIso = new Date().toISOString();

    for (const deal of deals) {
      const inputs = (deal.inputs as Record<string, unknown>) || {};
      const primaryApn = String(inputs.primaryApn || inputs.apn || "").trim().replace(/[^0-9]/g, "");
      const primaryData = parcelDataMap.get(primaryApn);

      let hasUpdate = false;
      const updatedInputs = { ...inputs };

      if (primaryData) {
        hasUpdate = true;
        updatedInputs.primaryApn = primaryApn;
        updatedInputs.assessorData = primaryData;
        updatedInputs.totalAssessedValue = primaryData.totalAssessedValue;
        updatedInputs.acreage = primaryData.acres;
      }

      // Update parcels array if present
      if (Array.isArray(inputs.parcels)) {
        let packageTotalVal = 0;
        let packageTotalAcres = 0;

        const updatedParcels = inputs.parcels.map(p => {
          const pObj = p as Record<string, unknown>;
          const pApn = String(pObj.apn || "").trim().replace(/[^0-9]/g, "");
          const fresh = parcelDataMap.get(pApn);
          if (fresh) {
            hasUpdate = true;
            const updatedP: Record<string, unknown> = {
              ...pObj,
              marketLandValue: fresh.marketLandValue,
              marketImprovementValue: fresh.marketImprovementValue,
              totalAssessedValue: fresh.totalAssessedValue,
              acres: fresh.acres,
              sqft: fresh.sqft
            };
            if (updatedP.included !== false) {
              packageTotalVal += (fresh.totalAssessedValue as number) || 0;
              packageTotalAcres += (fresh.acres as number) || 0;
            }
            return updatedP;
          }
          return pObj;
        });

        updatedInputs.parcels = updatedParcels;
        if (packageTotalVal > 0) updatedInputs.totalAssessedValue = packageTotalVal;
        if (packageTotalAcres > 0) updatedInputs.totalAcreage = Math.round(packageTotalAcres * 1000) / 1000;
      }

      if (hasUpdate) {
        const isStatewide = primaryData && primaryData.source === "wa_state_cadastre";
        updatedInputs.gisSync = {
          lastSyncedAt: nowIso,
          syncSource: isStatewide ? "wa_state_cadastre" : "yakima_arcgis",
          status: "active",
          batchJob: true
        };

        const { error: updateErr } = await supabase
          .from("deals")
          .update({ inputs: updatedInputs })
          .eq("id", deal.id);

        if (!updateErr) updatedCount++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: "Monthly batch GIS sync completed",
      totalDeals: deals.length,
      apnsQueried: uniqueApns.length,
      parcelsRefreshed: parcelDataMap.size,
      yakimaRefreshed: uniqueApns.length - missingApns.length,
      statewideFallbackCount: statewideResolvedCount,
      updatedDeals: updatedCount,
      durationMs: Date.now() - startTime,
      syncedAt: nowIso
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}

if (import.meta.main) {
  serve(handleRequest);
}
