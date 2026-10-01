import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase/client';
import { fetchProfile, getProfile, resolveHurdleRate } from '../lib/profile';
import { loadPortfolioDeals } from '../lib/portfolio/loadDeals';
import { buildPortfolioModel, type PortfolioParcelRow } from '../lib/export/buildPortfolioModel';
import { PortfolioBrief } from '../components/brief/PortfolioBrief';
import type { DealRecord } from '../lib/math/types';

interface Facts { deals: DealRecord[]; parcels: PortfolioParcelRow[]; investorName: string | null; companyName: string | null; hurdleRate: number }

const shell = 'min-h-screen bg-white text-slate-700 flex items-center justify-center p-6 text-center';

/** Print-ready portfolio and pipeline brief, rendered in the browser from the same deals the dashboard shows. */
export const PortfolioBriefPage: React.FC = () => {
  const [facts, setFacts] = useState<Facts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        // Profile first: its lease-expiry defaults feed the engine, and it supplies the investor name, entity and hurdle rate
        const profile = auth?.user ? await fetchProfile(supabase, auth.user).catch(() => getProfile(auth.user)) : getProfile();
        const { deals } = await loadPortfolioDeals();
        const ids = deals.map((d) => d.id);
        const parcelRes = ids.length > 0 ? await supabase.from('parcels').select('*').in('deal_id', ids) : { data: [], error: null };
        // A failed fact query must be visible, not silently turned into an empty parcel list
        if (parcelRes.error) throw new Error(`Could not load parcels: ${parcelRes.error.message}`);
        if (live) {
          setFacts({
            deals,
            parcels: (parcelRes.data ?? []) as PortfolioParcelRow[],
            investorName: profile.fullName || null,
            companyName: profile.companyName || null,
            hurdleRate: resolveHurdleRate(null, profile),
          });
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not load the brief.');
      }
    })();
    return () => { live = false; };
  }, []);

  const model = useMemo(() => {
    if (!facts) return null;
    try {
      return buildPortfolioModel(facts.deals, facts.parcels, { investorName: facts.investorName, companyName: facts.companyName, hurdleRate: facts.hurdleRate });
    } catch (e) {
      console.error('[portfolio-brief] model failed', e);
      return null;
    }
  }, [facts]);

  useEffect(() => {
    if (model) document.title = `MathTree Portfolio Command Brief - ${model.companyName ?? 'Portfolio'}`;
  }, [model]);

  if (error) return <div className={shell}><div><h3 className="font-bold text-rose-600">Failed to generate brief</h3><p className="text-sm mt-2">{error}</p></div></div>;
  if (!facts) return <div className={shell}><div className="w-8 h-8 rounded-full border-2 border-emerald-500/30 border-t-emerald-500 animate-spin" /></div>;
  if (!model) return <div className={shell}><p className="text-sm">The portfolio could not be computed.</p></div>;

  return (
    <div className="bg-white min-h-screen">
      <PortfolioBrief model={model} onPrint={() => window.print()} onClose={() => window.close()} />
    </div>
  );
};
