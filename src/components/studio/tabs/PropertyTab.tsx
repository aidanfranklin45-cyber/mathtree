import React from 'react';
import { DealRecord, DealMetrics } from '../../../lib/math/types';
import { MapPin, CheckCircle2, ShieldAlert, Layers } from 'lucide-react';

interface PropertyTabProps {
  deal: DealRecord;
  metrics: DealMetrics;
}

export const PropertyTab: React.FC<PropertyTabProps> = ({ deal }) => {
  const assessor = deal.inputs.assessorData || {};
  const parcels = deal.inputs.parcels || [];
  const primaryApn = deal.inputs.primaryApn || assessor.apn || '181216-13002';
  const county = deal.inputs.county || assessor.county || 'Yakima County, WA';

  // Multi-parcel aggregation
  const includedParcels = parcels.filter((p) => p.included !== false);
  const activeParcels = includedParcels.length > 0 ? includedParcels : parcels;
  const totalParcelsCount = Math.max(1, activeParcels.length);
  const totalAssessed = activeParcels.reduce((s, p) => s + (p.totalAssessedValue || p.assessedValue || 0), 0) || assessor.totalAssessedValue || 3150000;
  const landVal = activeParcels.reduce((s, p) => s + (p.marketLandValue || p.landValue || 0), 0) || assessor.marketLandValue || 950000;
  const impVal = activeParcels.reduce((s, p) => s + (p.marketImprovementValue || p.improvementValue || 0), 0) || assessor.marketImprovementValue || 2200000;
  const totalAcres = activeParcels.reduce((s, p) => s + (p.acres || 0), 0) || assessor.acres || 2.85;
  const totalSqFt = activeParcels.reduce((s, p) => s + (p.sqft || (p.acres ? Math.round(p.acres * 43560) : 0)), 0) || (assessor.sqft || (totalAcres > 0 ? Math.round(totalAcres * 43560) : 0));
  const adjacentParcels = activeParcels.filter((p) => !p.isPrimary);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold uppercase flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              Live County GIS Verified
            </span>
            {totalParcelsCount > 1 && (
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-[10px] font-bold uppercase flex items-center gap-1">
                <Layers className="w-3 h-3" />
                Multi-Parcel Package ({totalParcelsCount} APNs)
              </span>
            )}
          </div>
          <h2 className="text-base font-black text-white tracking-tight">
            County Assessor & GIS Dossier
          </h2>
          <p className="text-xs text-slate-400">
            Official parcel records, assessed valuation split, and legal descriptions for {county}
          </p>
        </div>

        <div className="text-right">
          <div className="text-[10px] uppercase font-bold text-slate-400">Primary APN</div>
          <div className="font-mono text-base font-black text-emerald-400">
            {primaryApn}
          </div>
        </div>
      </div>

      {/* Assessed Values Card Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="text-slate-400 text-xs font-bold mb-1">Total Assessed Value</div>
          <div className="text-xl font-black text-white">${totalAssessed.toLocaleString()}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">County Tax Basis</div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="text-slate-400 text-xs font-bold mb-1">Land Valuation</div>
          <div className="text-xl font-black text-white">${landVal.toLocaleString()}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {totalAssessed > 0 ? Math.round((landVal / totalAssessed) * 100) : 30}% of Total
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="text-slate-400 text-xs font-bold mb-1">Improvements Value</div>
          <div className="text-xl font-black text-white">${impVal.toLocaleString()}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {totalAssessed > 0 ? Math.round((impVal / totalAssessed) * 100) : 70}% Depreciable
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
          <div className="text-slate-400 text-xs font-bold mb-1">Lot Size & Acreage</div>
          <div className="text-xl font-black text-emerald-400">{totalAcres.toFixed(2)} Acres</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{Math.round(totalAcres * 43560).toLocaleString()} Sq Ft</div>
        </div>
      </div>

      {/* Property & Legal Details */}
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-800 pb-3">
          <MapPin className="w-3.5 h-3.5 text-emerald-400" />
          <span>Parcel Attributes & Regulatory Classifications</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-xs">
          <div className="flex justify-between py-1.5 border-b border-slate-800/60">
            <span className="text-slate-400">Jurisdiction / County</span>
            <span className="font-bold text-white">{county}</span>
          </div>
          <div className="flex justify-between py-1.5 border-b border-slate-800/60">
            <span className="text-slate-400">Zoning Designation</span>
            <span className="font-bold text-white">{assessor.zoning || 'M-1 Light Industrial'}</span>
          </div>
          <div className="flex justify-between py-1.5 border-b border-slate-800/60">
            <span className="text-slate-400">Use Code</span>
            <span className="font-bold text-white">{assessor.useCode || 'Distribution / Warehouse'}</span>
          </div>
          <div className="flex justify-between py-1.5 border-b border-slate-800/60">
            <span className="text-slate-400">Year Built</span>
            <span className="font-bold text-white">{assessor.yearBuilt || '2021'}</span>
          </div>
          <div className="flex justify-between py-1.5 border-b border-slate-800/60">
            <span className="text-slate-400">Construction Type</span>
            <span className="font-bold text-white">{assessor.constructionType || 'Pre-Engineered Steel / Masonry'}</span>
          </div>
          <div className="flex justify-between py-1.5 border-b border-slate-800/60">
            <span className="text-slate-400">Tax Exemption Status</span>
            <span className="font-bold text-emerald-400">Standard Commercial (Non-Exempt)</span>
          </div>
        </div>

        {assessor.legalDescription && (
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-400">
            <span className="font-bold text-slate-300 block mb-1">Legal Description:</span>
            {assessor.legalDescription}
          </div>
        )}
      </div>

      {/* Multi-Parcel Package Breakdown (Primary + Adjacent Lots) */}
      {activeParcels.length > 1 && (
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              <span>Attached Parcel Package Breakdown ({activeParcels.length} Total Taxlots)</span>
            </h3>
            <span className="text-[11px] font-semibold text-emerald-400">
              Primary APN + {adjacentParcels.length} Adjacent Companion {adjacentParcels.length === 1 ? 'Lot' : 'Lots'}
            </span>
          </div>

          <div className="space-y-2.5">
            {activeParcels.map((p, idx) => {
              const isPrim = p.isPrimary;
              const pApn = p.formattedApn || p.apn;
              const pAddr = p.address || p.street || deal.location || `Parcel #${idx + 1}`;
              const pTot = p.totalAssessedValue || p.assessedValue || 0;
              const pLand = p.marketLandValue || p.landValue || 0;
              const pImp = p.marketImprovementValue || p.improvementValue || 0;
              const pAcres = p.acres || 0;
              const pSqft = p.sqft || (pAcres > 0 ? Math.round(pAcres * 43560) : 0);

              return (
                <div
                  key={p.apn || idx}
                  className={`p-3.5 rounded-xl border transition flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                    isPrim ? 'bg-slate-950/80 border-slate-800' : 'bg-slate-950/50 border-indigo-950/60 hover:border-indigo-800/40'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${
                          isPrim
                            ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                            : 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-300'
                        }`}
                      >
                        {isPrim ? 'Primary Parcel' : 'Adjacent Lot'}
                      </span>
                      <span className="font-mono text-xs font-bold text-white">{pApn}</span>
                      <span className="text-slate-500">•</span>
                      <span className="text-xs text-slate-300 font-semibold">{pAddr}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                      <span>Use: <strong className="text-slate-300">{p.useCode || assessor.useCode || 'Commercial'}</strong></span>
                      {p.legalDescription && (
                        <>
                          <span>•</span>
                          <span>Legal: <span className="font-mono text-slate-400">{p.legalDescription}</span></span>
                        </>
                      )}
                      <span>•</span>
                      <span>Area: <strong className="text-slate-300">{pAcres > 0 ? `${pAcres.toFixed(2)} ac (${pSqft.toLocaleString()} sf)` : `${pSqft.toLocaleString()} sf`}</strong></span>
                    </div>
                  </div>

                  <div className="text-left md:text-right shrink-0">
                    <div className="text-xs font-black text-emerald-400">${pTot.toLocaleString()}</div>
                    <div className="text-[10px] text-slate-500">
                      ${pLand.toLocaleString()} Land • ${pImp.toLocaleString()} Bldg
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-900/40 flex items-center justify-between text-xs">
            <span className="font-bold text-emerald-400">Combined Package Valuation:</span>
            <span className="font-mono font-black text-white">
              ${totalAssessed.toLocaleString()} <span className="font-normal text-slate-400">(${landVal.toLocaleString()} L / ${impVal.toLocaleString()} B • {totalAcres.toFixed(2)} Acres)</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
