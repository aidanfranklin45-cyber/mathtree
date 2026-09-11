import React from 'react';
import { Layers, MapPin, CheckCircle2, DollarSign, Building } from 'lucide-react';

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

export interface ParcelPackageData {
  deal_id: string;
  deal_title?: string;
  total_parcels: number;
  adjacent_parcel_count: number;
  total_package_acres: number;
  total_package_sqft: number;
  total_land_value: number;
  total_improvement_value: number;
  combined_assessed_value: number;
  primary_parcel?: Partial<ParcelItem>;
  parcels: ParcelItem[];
}

interface ParcelPackageCardProps {
  packageData?: ParcelPackageData | null;
  isLoading?: boolean;
}

export const ParcelPackageCard: React.FC<ParcelPackageCardProps> = ({ packageData, isLoading }) => {
  if (isLoading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 animate-pulse">
        <div className="h-6 w-48 bg-slate-200 rounded mb-4"></div>
        <div className="h-20 bg-slate-100 rounded mb-4"></div>
        <div className="h-32 bg-slate-50 rounded"></div>
      </div>
    );
  }

  if (!packageData || !packageData.parcels || packageData.parcels.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-slate-500">
        <Layers className="w-8 h-8 mx-auto text-slate-400 mb-2" />
        <p className="text-sm font-medium">No parcel records attached to this deal yet.</p>
      </div>
    );
  }

  const {
    total_parcels,
    adjacent_parcel_count,
    total_package_acres,
    total_package_sqft,
    total_land_value,
    total_improvement_value,
    combined_assessed_value,
    primary_parcel,
    parcels,
  } = packageData;

  const hasMultiple = total_parcels > 1;

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-6">
      {/* Card Header */}
      <div className="bg-slate-900 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              Attached Parcel Package Breakdown
              {hasMultiple ? (
                <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold normal-case">
                  {total_parcels} Tax Lots ({adjacent_parcel_count} Adjacent)
                </span>
              ) : (
                <span className="text-[10px] bg-slate-700 text-slate-300 px-2 py-0.5 rounded-full font-semibold normal-case">
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
            <div className="text-sm font-bold text-emerald-400">
              {Number(total_package_acres).toFixed(3)} ac ({Number(total_package_sqft).toLocaleString()} sf)
            </div>
          </div>
          <div className="border-l border-slate-700 pl-4">
            <div className="text-[10px] uppercase font-bold text-slate-400">Combined Assessment</div>
            <div className="text-sm font-bold text-white">
              ${Math.round(Number(combined_assessed_value)).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Aggregated Package Summary Banner (If Multi-Parcel) */}
      {hasMultiple && (
        <div className="bg-emerald-50 border-b border-emerald-100 px-6 py-3 flex flex-wrap items-center justify-between text-xs text-emerald-950 font-medium">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              <strong>Multi-Parcel Bundle Scope:</strong> Purchase includes primary operating parcel plus {adjacent_parcel_count} companion lot{adjacent_parcel_count > 1 ? 's' : ''}.
            </span>
          </div>
          <div className="flex items-center gap-4 text-emerald-900 text-[11px]">
            <span><strong>Land Value:</strong> ${Math.round(Number(total_land_value)).toLocaleString()}</span>
            <span>•</span>
            <span><strong>Improvements:</strong> ${Math.round(Number(total_improvement_value)).toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Relational Parcel Records Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold text-[11px] uppercase tracking-wider">
              <th className="py-3 px-4">Role</th>
              <th className="py-3 px-4">APN / Parcel</th>
              <th className="py-3 px-4">Situs Address</th>
              <th className="py-3 px-4">Zoning & Use</th>
              <th className="py-3 px-4 text-right">Lot Area</th>
              <th className="py-3 px-4 text-right">Assessed Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {parcels.map((p) => {
              const isPrim = p.is_primary;
              const displayApn = p.formatted_apn || p.apn;
              const addr = p.situs_address || 'Address Unassigned';
              const acresNum = Number(p.acres || 0);
              const sqftNum = p.sqft ? Number(p.sqft) : Math.round(acresNum * 43560);
              const totalVal = Number(p.total_assessed_val || 0);
              const landVal = Number(p.market_land_val || 0);
              const impVal = Number(p.market_imp_val || 0);

              return (
                <tr key={p.apn} className={isPrim ? 'bg-white font-medium' : 'bg-slate-50/50'}>
                  <td className="py-3 px-4">
                    {isPrim ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 border border-emerald-200">
                        Primary Lot
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-sky-100 text-sky-800 border border-sky-200">
                        Adjacent Lot
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono font-bold text-slate-900">{displayApn}</td>
                  <td className="py-3 px-4 text-slate-800 max-w-[200px] truncate" title={addr}>
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{addr}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-600">
                    <span className="font-semibold text-slate-900">{p.zoning || 'Commercial'}</span>
                    {p.use_code && <span className="text-slate-400 ml-1">({p.use_code})</span>}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums text-slate-700">
                    <span className="font-semibold">{acresNum.toFixed(3)} ac</span>
                    <span className="text-slate-400 text-[10px] block">({sqftNum.toLocaleString()} sf)</span>
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    <span className="font-bold text-slate-900">${Math.round(totalVal).toLocaleString()}</span>
                    <span className="text-slate-400 text-[10px] block">
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
      {primary_parcel?.legal_description && (
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-3 text-[11px] text-slate-500">
          <strong className="text-slate-700">Primary Legal Description:</strong> {primary_parcel.legal_description}
        </div>
      )}
    </div>
  );
};
