import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase/client';
import { mapSupabaseDeal } from '../stores/useDealStore';
import { fetchProfile } from '../lib/profile';
import { buildBriefModel, type LeaseRow, type ParcelRow } from '../lib/export/buildBriefModel';
import { DealBrief, useBriefMonteCarlo } from '../components/brief/DealBrief';
import type { DealRecord } from '../lib/math/types';

interface Facts { deal: DealRecord; leases: LeaseRow[]; parcels: ParcelRow[] }

const shell = 'min-h-screen bg-white text-slate-700 flex items-center justify-center p-6 text-center';

/** Print-ready deal brief, rendered in the browser from the same deal, leases and parcels the app already uses. */
export const DealBriefPage: React.FC = () => {
  const [params] = useSearchParams();
  const dealId = params.get('id');
  const [facts, setFacts] = useState<Facts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (!dealId) throw new Error('No deal selected.');
        const { data: auth } = await supabase.auth.getUser();
        // Lease-expiry defaults feed the engine; load them first so the brief matches the Studio
        if (auth?.user) await fetchProfile(supabase, auth.user).catch(() => undefined);

        const [dealRes, leaseRes, parcelRes] = await Promise.all([
          supabase.from('deals').select('*').eq('id', dealId).single(),
          supabase.from('leases').select('*').eq('deal_id', dealId).eq('is_active', true).order('lease_start_date', { ascending: true }),
          supabase.from('parcels').select('*').eq('deal_id', dealId).order('is_primary', { ascending: false }).order('apn', { ascending: true }),
        ]);
        if (dealRes.error || !dealRes.data) throw new Error(dealRes.error?.message || 'Deal not found.');
        // A failed fact query must be visible, not silently turned into an empty rent roll or parcel list
        if (leaseRes.error) throw new Error(`Could not load the rent roll: ${leaseRes.error.message}`);
        if (parcelRes.error) throw new Error(`Could not load parcels: ${parcelRes.error.message}`);
        if (live) setFacts({ deal: mapSupabaseDeal(dealRes.data), leases: (leaseRes.data ?? []) as LeaseRow[], parcels: (parcelRes.data ?? []) as ParcelRow[] });
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not load the brief.');
      }
    })();
    return () => { live = false; };
  }, [dealId]);

  const model = useMemo(() => {
    if (!facts) return null;
    try { return buildBriefModel(facts.deal, facts.leases, facts.parcels); } catch (e) { console.error('[brief] model failed', e); return null; }
  }, [facts]);

  const mc = useBriefMonteCarlo(model?.assetClass ?? 'commercial', model?.monteCarloInputs ?? {}, model?.discountRate ?? 8, String(facts?.deal.id ?? 'mathtree'));

  useEffect(() => {
    if (model) document.title = `MathTree Institutional Underwriting Brief - ${model.title}`;
  }, [model]);

  if (error) return <div className={shell}><div><h3 className="font-bold text-rose-600">Failed to generate brief</h3><p className="text-sm mt-2">{error}</p></div></div>;
  if (!facts) return <div className={shell}><div className="w-8 h-8 rounded-full border-2 border-emerald-500/30 border-t-emerald-500 animate-spin" /></div>;
  if (!model) return <div className={shell}><p className="text-sm">This deal could not be computed. Check its underwriting inputs.</p></div>;

  return (
    <div className="bg-white min-h-screen">
      <DealBrief model={model} monteCarlo={mc} onPrint={() => window.print()} onClose={() => window.close()} />
    </div>
  );
};
