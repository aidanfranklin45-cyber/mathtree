import React from 'react';
import { Layers, MapPin, CheckCircle2 } from 'lucide-react';
import { DealParcelPackageView } from '../../lib/supabase/types';

export interface ParcelItem {
  id?: string;
  apn: string;
  formatted_apn?: string;
  is_primary: boolean;
  included: boolean;
  situs_address?: string;
  legal_description?: string;
  use_code?: string;
  zoning?: string;
  acres: number;
  sqft?: number;
  market_land_val: number;
  market_imp_val: number;
  total_assessed_val: number;
}

export type ParcelPackageData = DealParcelPackageView;

interface ParcelPackageCardProps {
  packageData?: ParcelPackageData | null;
  isLoading?: boolean;
}

export const ParcelPackageCard: React.FC<ParcelPackageCardProps> = ({ packageData, isLoading }) => {
  if (isLoading) {
    return (
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 animate-pulse">
        <div className="h-6 w-48 bg-slate-800 rounded mb-4"></div>
        <div className="h-20 bg-slate-800/50 rounded mb-4"></div>
        <div className="h-32 bg-slate-800/30 rounded"></div>
      </div>
    );
  }

  if (!packageData || !packageData.parcels || (packageData.parcels as any[]).length === 0) {
    return (
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 text-center text-slate-400">
        <Layers className="w-8 h-8 mx-auto text-slate-500 mb-2" />
        <p className="text-sm font-medium">No parcel records attached to this deal yet.</p>
      </div>
    );
  }

  const parcelsList: ParcelItem[] = Array.isArray(packageData.parcels) ? (packageData.parcels as any[]) : [];
  const totalParcels = packageData.total_parcels || parcelsList.length || 1;
  const adjacentParcelCount = packageData.adjacent_parcel_count || Math.max(0, totalParcels - 1);
  const totalAcres = Number(packageData.total_package_acres || 0);
  const totalSqft = Number(packageData.total_package_sqft || (totalAcres > 0 ? Math.round(totalAcres * 43560) : 0));
  const totalLandVal = Number(packageData.total_land_value || 0);
  const totalImpVal = Number(packageData.total_improvement_value || 0);
  const combinedVal = Number(packageData.combined_assessed_value || totalLandVal + totalImpVal);
  const primaryParcel = packageData.primary_parcel as Partial<ParcelItem> | undefined;

  const hasMultiple = totalParcels > 1;

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden mb-6 shadow-sm">
      {/* Card Header */}
      <div className="px-6 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-950/40">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              Attached Parcel Package Breakdown
              {hasMultiple ? (
                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold normal-case">
                  {totalParcels} Tax Lots ({adjacentParcelCount} Adjacent)
                </span>
              ) : (
                <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full font-semibold normal-case">
                  Single Tax Lot
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-400">Official County Assessor & Relational Boundary Audit</p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-right">
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-400">Total Land Footprint</div>
            <div className="text-sm font-bold font-mono text-emerald-400">
              {totalAcres.toFixed(3)} ac ({totalSqft.toLocaleString()} sf)
            </div>
          </div>
          <div className="border-l border-slate-800 pl-4">
            <div className="text-[10px] uppercase font-bold text-slate-400">Combined Assessment</div>
            <div className="text-sm font-bold font-mono text-white">
              ${Math.round(combinedVal).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Aggregated Package Summary Banner (If Multi-Parcel) */}
      {hasMultiple && (
        <div className="bg-emerald-950/20 border-b border-emerald-900/30 px-6 py-3 flex flex-wrap items-center justify-between text-xs text-emerald-300 font-medium">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              <strong>Multi-Parcel Bundle Scope:</strong> Purchase includes primary operating parcel plus {adjacentParcelCount} companion lot{adjacentParcelCount > 1 ? 's' : ''}.
            </span>
          </div>
          <div className="flex items-center gap-4 text-emerald-400/90 text-[11px] font-mono">
            <span><strong>Land Value:</strong> ${Math.round(totalLandVal).toLocaleString()}</span>
            <span>•</span>
            <span><strong>Improvements:</strong> ${Math.round(totalImpVal).toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Relational Parcel Records Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase text-[10px] bg-slate-950/30">
              <th className="py-3 px-4">Role</th>
              <th className="py-3 px-4">APN / Parcel</th>
              <th className="py-3 px-4">Situs Address</th>
              <th className="py-3 px-4">Zoning & Use</th>
              <th className="py-3 px-4 text-right">Lot Area</th>
              <th className="py-3 px-4 text-right">Assessed Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50 text-slate-300">
            {parcelsList.map((p, idx) => {
              const isPrim = p.is_primary;
              const displayApn = p.formatted_apn || p.apn;
              const addr = p.situs_address || 'Address Unassigned';
              const acresNum = Number(p.acres || 0);
              const sqftNum = p.sqft ? Number(p.sqft) : Math.round(acresNum * 43560);
              const totalVal = Number(p.total_assessed_val || 0);
              const landVal = Number(p.market_land_val || 0);
              const impVal = Number(p.market_imp_val || 0);

              return (
                <tr key={p.apn || idx} className={isPrim ? 'bg-slate-950/50 font-medium' : 'hover:bg-slate-800/30 transition'}>
                  <td className="py-3 px-4">
                    {isPrim ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        Primary Lot
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                        Adjacent Lot
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono font-bold text-white">{displayApn}</td>
                  <td className="py-3 px-4 text-slate-300 max-w-[200px] truncate" title={addr}>
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span>{addr}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-400">
                    <span className="font-semibold text-slate-200">{p.zoning || 'Commercial'}</span>
                    {p.use_code && <span className="text-slate-500 ml-1">({p.use_code})</span>}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums font-mono text-slate-300">
                    <span className="font-semibold">{acresNum.toFixed(3)} ac</span>
                    <span className="text-slate-500 text-[10px] block font-sans">({sqftNum.toLocaleString()} sf)</span>
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums font-mono">
                    <span className="font-bold text-emerald-400">${Math.round(totalVal).toLocaleString()}</span>
                    <span className="text-slate-500 text-[10px] block font-sans">
                      (${Math.round(landVal).toLocaleString()} L / ${Math.round(impVal).toLocaleString()} B)
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Primary Lot Legal Description Footer */}
      {primaryParcel?.legal_description && (
        <div className="bg-slate-950/40 border-t border-slate-800 px-6 py-3 text-[11px] text-slate-400">
          <strong className="text-slate-300">Primary Legal Description:</strong> {primaryParcel.legal_description}
        </div>
      )}
    </div>
  );
};
