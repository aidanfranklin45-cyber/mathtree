import React, { useEffect, useRef, useState } from 'react';
import { DealRecord, DealMetrics, DealInputs } from '../../../lib/math/types';
import { AddressService } from '../../../lib/services/addressService';
import { getAssessorPortalUrl } from '../../../lib/services/assessorPortal';
import { formatCurrency } from '../../../lib/format';

interface PropertyTabProps {
  deal: DealRecord;
  metrics: DealMetrics;
  /** Merge facts into the deal and persist immediately (see useDealStore.patchDeal). */
  onPatchDeal: (inputsPatch: Partial<DealInputs>, top?: { location?: string; purchase_price?: number }) => Promise<boolean>;
}

const SAMPLE_PARCELS: Array<{ apn: string; address: string; title: string; sub: string; primary?: boolean }> = [
  { apn: '19133143417', address: '2239 LONGFIBRE RD, YAKIMA, WA 98903', title: '⚡ 2239 Longfibre Rd', sub: 'Industrial Logistics • APN: 191331-43417', primary: true },
  { apn: '19131922484', address: '128 N 2ND ST, YAKIMA, WA 98901', title: '128 N 2nd St', sub: 'Commercial / Gov • APN: 191319-22484' },
  { apn: '18132621455', address: '414 S 8TH ST, YAKIMA, WA 98901', title: '414 S 8th St', sub: '12-Unit Multifamily • APN: 181326-21455' },
  { apn: '19133034401', address: '2405 S 1ST ST, YAKIMA, WA 98903', title: '2405 S 1st St', sub: 'Light Industrial • APN: 191330-34401' },
  { apn: '18132644405', address: '1502 S 18TH AVE, YAKIMA, WA 98902', title: '1502 S 18th Ave', sub: 'Single-Family BRRRR • APN: 181326-44405' },
];

/** Facts copied from a resolved county parcel record onto the deal (same fields the legacy page wrote). */
function parcelToInputsPatch(data: any): Partial<DealInputs> {
  return {
    primaryApn: data.apn,
    apn: data.apn,
    county: data.county ? `${data.county} County, WA` : 'Washington',
    assessorData: data,
    totalAssessedValue: data.totalAssessedValue,
    marketLandValue: data.marketLandValue,
    marketImprovementValue: data.marketImprovementValue,
    acres: data.acres,
    sqft: data.sqft,
    yearBuilt: data.yearBuilt,
    buildingSqFt: data.buildingSqFt,
    stories: data.stories,
    constructionType: data.constructionType,
    condition: data.condition,
    hvac: data.hvac,
    zoning: data.zoning,
    useCode: data.useCode,
    owner: data.owner,
    legalDescription: data.legalDescription,
    gisSync: { lastSyncedAt: new Date().toISOString(), syncSource: data.source || 'gis_service', status: 'active' },
  } as Partial<DealInputs>;
}

export const PropertyTab: React.FC<PropertyTabProps> = ({ deal, onPatchDeal }) => {
  const inputs: Record<string, any> = deal.inputs || {};
  const raw: Record<string, any> = inputs.assessorData || {};

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const autoFetchedApn = useRef<string | null>(null);
  const companionsChecked = useRef<string | null>(null);

  const propAddress: string = deal.location || inputs.location || raw.address || 'Pending Address';
  const propApn: string = inputs.primaryApn || inputs.apn || raw.apn || '';
  const formattedApn: string = raw.formattedApn || (propApn.length === 11 ? `${propApn.slice(0, 6)}-${propApn.slice(6)}` : propApn) || 'Pending Link';
  const propCounty: string = inputs.county || (propAddress.toLowerCase().includes('yakima') ? 'Yakima County, WA' : 'County Assessor Record');

  const parcels: any[] = Array.isArray(inputs.parcels) ? inputs.parcels : [];
  const isMulti = parcels.length > 1;

  // Auto-fetch the assessor record when an APN exists but the record is empty/incomplete (once per APN)
  useEffect(() => {
    if (!propApn || autoFetchedApn.current === propApn) return;
    const incomplete = !raw || !raw.owner || raw.owner === 'Owner of Record' || !raw.marketLandValue;
    if (!incomplete) return;
    autoFetchedApn.current = propApn;
    let live = true;
    (AddressService as any).fetchYakimaAssessorData(propApn).then((data: any) => {
      if (live && data) void onPatchDeal(parcelToInputsPatch({ ...data, apn: propApn, county: inputs.county ? String(inputs.county).replace(/\s*County.*/i, '') : data.county }));
    }).catch((e: unknown) => console.warn('County auto-fetch warning:', e));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propApn]);

  const totalAssessedSingle = Number(raw.totalAssessedValue || inputs.totalAssessedValue || inputs.assessedValue || 0);
  const landSingle = Number(raw.marketLandValue || inputs.marketLandValue || 0);
  const impSingle = Number(raw.marketImprovementValue || inputs.marketImprovementValue || 0);
  const acresSingle = Number(raw.acres || inputs.acres || inputs.acreage || 0);
  const sqftSingle = Number(raw.sqft || inputs.sqft || (acresSingle > 0 ? Math.round(acresSingle * 43560) : 0));

  // Multi-parcel package totals
  const pkg = isMulti ? (AddressService as any).aggregateParcelPackage(parcels) : null;
  const totalAssessed: number = pkg ? pkg.totalAssessedValue : totalAssessedSingle;
  const land: number = pkg ? (pkg.totalLandValue ?? pkg.marketLandValue ?? 0) : landSingle;
  const imp: number = pkg ? (pkg.totalImprovementValue ?? pkg.marketImprovementValue ?? 0) : impSingle;
  const acres: number = pkg ? (pkg.totalAcres ?? pkg.acres ?? 0) : acresSingle;
  const sqft: number = pkg ? (pkg.totalSqFt ?? pkg.sqft ?? 0) : sqftSingle;
  const taxYear = raw.taxYear || inputs.taxYear || new Date().getFullYear();

  const zoning = raw.zoning || inputs.zoning || 'Commercial / Mixed';
  const useCode = raw.useCode || inputs.useCode || 'Commercial Real Estate';
  const owner = raw.owner || inputs.owner || 'Owner of Record';
  const legal = raw.legalDescription || inputs.legalDescription || 'Legal description pending county verification';
  const yearBuilt = raw.yearBuilt || inputs.yearBuilt || '';
  const bldgSqFt = Number(raw.buildingSqFt || inputs.buildingSqFt || inputs.gla || 0);
  const stories = raw.stories || inputs.stories || '';
  const condition = raw.condition || inputs.condition || 'Average';
  const construction = raw.constructionType || raw.buildingStyle || inputs.constructionType || 'Standard';
  const hvac = raw.hvac || inputs.hvac || 'Standard';
  const lastSync = inputs.gisSync?.lastSyncedAt;
  const genericLocation = !propApn && /^\s*yakima,?\s*wa\s*$/i.test(propAddress);

  // Detect same-owner companion parcels once per APN/owner
  useEffect(() => {
    if (isMulti || !propApn || !owner || owner === 'Owner of Record') return;
    const key = `${propApn}|${owner}`;
    if (companionsChecked.current === key) return;
    companionsChecked.current = key;
    let live = true;
    (AddressService as any).detectNearbySameOwnerParcels(propApn, owner, raw).then((companions: any[]) => {
      if (!live || !companions || companions.length === 0) return;
      const primary = {
        ...raw, apn: propApn, formattedApn, address: propAddress, owner,
        acres: raw.acres || inputs.acres || 0, sqft: raw.sqft || inputs.sqft || 0,
        marketLandValue: raw.marketLandValue || inputs.marketLandValue || 0,
        marketImprovementValue: raw.marketImprovementValue || inputs.marketImprovementValue || 0,
        totalAssessedValue: raw.totalAssessedValue || inputs.totalAssessedValue || 0,
        legalDescription: raw.legalDescription || inputs.legalDescription || '',
        useCode: raw.useCode || inputs.useCode || 'Primary Facility', isPrimary: true, included: true,
      };
      void onPatchDeal({ parcels: [primary, ...companions.map((c) => ({ ...c, isPrimary: false, included: true }))] } as Partial<DealInputs>);
    }).catch((e: unknown) => console.warn('Companion parcel detection warning:', e));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propApn, owner, isMulti]);

  const linkParcel = async (itemOrApn: any, formattedAddress?: string) => {
    setSearchOpen(false);
    setShowDropdown(false);
    setBusy(true);
    setStatus({ kind: 'info', text: 'Querying County Assessor...' });
    try {
      const data = typeof itemOrApn === 'object' && itemOrApn !== null
        ? await (AddressService as any).resolveParcelDetails(itemOrApn)
        : await (AddressService as any).resolveParcelDetails({ apn: String(itemOrApn).trim(), county: inputs.county });
      if (!data) return setStatus({ kind: 'err', text: 'No county record was found for that parcel.' });
      await onPatchDeal(parcelToInputsPatch(data), formattedAddress ? { location: formattedAddress } : undefined);
      setStatus({ kind: 'ok', text: `Linked parcel ${data.apn}${formattedAddress ? ` for ${formattedAddress}` : ''}.` });
    } catch (e) {
      setStatus({ kind: 'err', text: `Could not link parcel: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const onSearch = async (val: string) => {
    setQuery(val);
    if (!val || val.trim().length < 2) return setShowDropdown(false);
    const cleanApn = val.replace(/[^0-9]/g, '');
    if (cleanApn.length === 11 || cleanApn.length === 10) {
      setResults([{ __apn: cleanApn, __label: val.trim() }]);
      return setShowDropdown(true);
    }
    const found = await (AddressService as any).searchAddresses(val);
    setResults(found || []);
    setShowDropdown(!!found && found.length > 0);
  };

  const openSearch = (force?: boolean) => {
    const next = force !== undefined ? force : !searchOpen;
    setSearchOpen(next);
    if (next && deal.location && deal.location !== 'Yakima, WA') void onSearch(deal.location);
  };

  const forceRefresh = async () => {
    if (!propApn) {
      if (propAddress && /\d+/.test(propAddress)) {
        setStatus({ kind: 'info', text: 'Searching address in County GIS...' });
        const found = await (AddressService as any).searchYakimaAddresses(propAddress);
        if (found && found.length > 0 && found[0].apn) {
          await linkParcel(found[0].apn, found[0].formattedAddress);
          return;
        }
      }
      openSearch(true);
      return setStatus({ kind: 'err', text: `This property is set to a general location ('${propAddress || 'Yakima, WA'}') without a specific parcel. Search a specific address or APN to link one.` });
    }
    setBusy(true);
    setStatus({ kind: 'info', text: 'Querying County...' });
    try {
      const data = await (AddressService as any).fetchYakimaAssessorData(propApn);
      if (data) {
        await onPatchDeal({
          assessorData: data,
          totalAssessedValue: data.totalAssessedValue,
          acreage: data.acres,
          gisSync: { lastSyncedAt: new Date().toISOString(), syncSource: 'yakima_arcgis', status: 'active', manualRefresh: true },
        } as Partial<DealInputs>);
        setStatus({ kind: 'ok', text: `Refreshed from the County Assessor. Assessed value: $${Number(data.totalAssessedValue).toLocaleString()}` });
      }
    } catch (e) {
      setStatus({ kind: 'err', text: `Failed to refresh from county server: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const toggleParcel = async (idx: number, included: boolean) => {
    const next = parcels.map((p, i) => (i === idx && !p.isPrimary ? { ...p, included } : p));
    const agg = (AddressService as any).aggregateParcelPackage(next);
    await onPatchDeal({
      parcels: next,
      totalAssessedValue: agg.totalAssessedValue,
      marketLandValue: agg.totalLandValue ?? agg.marketLandValue,
      marketImprovementValue: agg.totalImprovementValue ?? agg.marketImprovementValue,
      acres: agg.totalAcres ?? agg.acres,
      sqft: agg.totalSqFt ?? agg.sqft,
    } as Partial<DealInputs>);
  };

  const applyAssessed = async () => {
    if (!totalAssessed || totalAssessed <= 0) return setStatus({ kind: 'err', text: 'No official assessed value on record for this parcel.' });
    await onPatchDeal({ purchasePrice: totalAssessed } as Partial<DealInputs>, { purchase_price: totalAssessed });
    const count = parcels.filter((p) => p.included).length;
    setStatus({ kind: 'ok', text: `Applied county assessed value of ${formatCurrency(totalAssessed)}${count > 1 ? ` (${count} Parcels Combined)` : ''} as project Purchase Price.` });
  };

  const apnPill = isMulti && pkg && pkg.totalParcels > 1
    ? `APN: ${parcels.find((p) => p.isPrimary)?.formattedApn || parcels[0]?.formattedApn || ''} (+${pkg.totalParcels - 1} Companion)`
    : propApn ? `APN: ${formattedApn}` : 'APN: Pending Link';

  const companionCount = parcels.filter((p) => !p.isPrimary).length;

  return (
    <div className="space-y-6">
      <div className="bg-slate-900/60 border border-slate-900 hover:border-slate-800 rounded-3xl p-5 space-y-4 shadow-xl backdrop-blur-md transition">
        <div className="flex items-center justify-between pb-3 border-b border-slate-900">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-sm">🏛️</div>
            <div>
              <h2 className="text-sm font-extrabold text-white">County Assessor &amp; Parcel Data</h2>
              <span className="text-[10px] font-semibold text-emerald-400">{propCounty.includes('Record') ? propCounty : `${propCounty} Official Record`}</span>
            </div>
          </div>
          <div className="flex items-center space-x-1.5">
            <a href={getAssessorPortalUrl(propCounty, propApn)} target="_blank" rel="noopener noreferrer"
              className={`text-[10px] font-bold text-emerald-400 hover:text-emerald-300 bg-emerald-950/40 border border-emerald-900/60 px-2.5 py-1 rounded-lg transition flex items-center space-x-1 ${propApn ? '' : 'opacity-50'}`}>
              <span>Ascend Tax Card</span><span>↗</span>
            </a>
            <button type="button" disabled={busy} onClick={forceRefresh} className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 hover:text-white transition disabled:opacity-60" title="Force Refresh Live GIS Data">
              <span className={busy ? 'inline-block animate-spin' : ''}>🔄</span>
            </button>
          </div>
        </div>

        {status && (
          <div className={`px-3 py-2 rounded-xl border text-[11px] font-semibold ${status.kind === 'ok' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : status.kind === 'err' ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' : 'bg-blue-500/10 border-blue-500/30 text-blue-300'}`}>{status.text}</div>
        )}

        {/* Situs address & APN */}
        <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-2xl space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500">Situs Address</span>
            <div className="flex items-center space-x-1.5">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">{apnPill}</span>
              <button type="button" onClick={() => openSearch()} className="text-[10px] font-bold text-brand-400 hover:text-brand-300 bg-brand-500/10 hover:bg-brand-500/20 border border-brand-500/30 px-2 py-0.5 rounded transition">
                <span>🔍 Link Parcel</span>
              </button>
            </div>
          </div>
          <p className="text-xs font-bold text-white leading-snug">{propAddress}</p>
          {genericLocation && (
            <div className="text-[11px] text-amber-400/90 pt-1 border-t border-slate-900 flex items-center justify-between">
              <span>⚠️ Generic location (&apos;Yakima, WA&apos;) needs a specific parcel to load owner &amp; tax records.</span>
              <button type="button" onClick={() => openSearch(true)} className="underline font-bold text-brand-400 hover:text-brand-300 ml-1">Link Parcel →</button>
            </div>
          )}
        </div>

        {/* Parcel linker */}
        {searchOpen && (
          <div className="p-3 bg-slate-950 border border-brand-500/30 rounded-2xl space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Link Official Yakima County Parcel</span>
              <button type="button" onClick={() => setSearchOpen(false)} className="text-slate-500 hover:text-white text-xs">✕</button>
            </div>
            <div className="relative">
              <input type="text" autoFocus value={query} onChange={(e) => { void onSearch(e.target.value); }} placeholder="Enter Yakima street address or 11-digit APN..."
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-brand-500" />
              {showDropdown && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 max-h-48 overflow-y-auto">
                  {results.map((item, idx) => {
                    if (item.__apn) {
                      return (
                        <div key="apn" onClick={() => linkParcel(item.__apn, item.__label)} className="p-2.5 hover:bg-slate-800/80 cursor-pointer border-b border-slate-800/60 last:border-0 transition text-left">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-emerald-400">🏛️ Fetch Assessor Record for APN: {item.__apn}</span>
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Direct APN</span>
                          </div>
                          <p className="text-[11px] text-slate-400">Click to fetch official ownership, valuation &amp; specs</p>
                        </div>
                      );
                    }
                    const isYakima = item.isYakimaCounty || /yakima/i.test(item.county || '');
                    const isSpokane = item.isSpokaneCounty || /spokane/i.test(item.county || '');
                    const rawCounty = String(item.county || (isYakima ? 'Yakima' : isSpokane ? 'Spokane' : '')).replace(/\s*County/i, '').trim();
                    const countyLabel = rawCounty ? `${rawCounty} County` : '';
                    return (
                      <div key={idx} onClick={() => linkParcel(item, item.formattedAddress)} className="p-2.5 hover:bg-slate-800/80 cursor-pointer border-b border-slate-800/60 last:border-0 transition text-left">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white">{item.street || item.formattedAddress}</span>
                          {item.apn
                            ? <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">🏛️ {countyLabel ? `${countyLabel} ` : ''}APN</span>
                            : countyLabel
                              ? <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-brand-500/10 text-brand-400 border border-brand-500/20">📍 {countyLabel} • Geocoded</span>
                              : <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-800 text-slate-400">OpenStreetMap</span>}
                        </div>
                        <p className="text-[11px] text-slate-400">{item.formattedAddress}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="pt-1">
              <span className="text-[9px] text-slate-500 block mb-1 uppercase font-bold">Sample County Parcels:</span>
              <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                {SAMPLE_PARCELS.map((s) => (
                  <button key={s.apn} type="button" onClick={() => linkParcel(s.apn, s.address)}
                    className={s.primary
                      ? 'p-1.5 rounded-lg bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-800/80 text-left truncate transition'
                      : 'p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-left truncate transition'}>
                    <strong className="text-white block truncate">{s.title}</strong>
                    <span className={s.primary ? 'text-emerald-400/80 text-[9px]' : 'text-slate-500 text-[9px]'}>{s.sub}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 4-tile metric grid */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-slate-950/60 p-3 rounded-2xl border border-slate-900">
            <span className="text-[9px] uppercase font-bold tracking-wider text-slate-500 block">Assessed Value</span>
            <span className="text-sm font-black text-emerald-400 mt-1 block">{totalAssessed > 0 ? formatCurrency(totalAssessed) : 'Pending Assessment'}</span>
            <span className="text-[10px] text-slate-500 mt-0.5 block">Tax Year: {taxYear}</span>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-2xl border border-slate-900">
            <span className="text-[9px] uppercase font-bold tracking-wider text-slate-500 block">Land / Building</span>
            <span className="text-xs font-bold text-slate-200 mt-1 block">
              {totalAssessed > 0 && (land > 0 || imp > 0) ? `${formatCurrency(land)} / ${formatCurrency(imp)}` : totalAssessed > 0 ? `${formatCurrency(totalAssessed)} Total` : '-- / --'}
            </span>
            <span className="text-[10px] text-slate-500 mt-0.5 block">
              {totalAssessed > 0 && (land > 0 || imp > 0)
                ? `${Math.round((land / totalAssessed) * 100)}% Land / ${100 - Math.round((land / totalAssessed) * 100)}% Bldg`
                : totalAssessed > 0 ? '100% Fee Simple Value' : 'Pending Breakdown'}
            </span>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-2xl border border-slate-900">
            <span className="text-[9px] uppercase font-bold tracking-wider text-slate-500 block">Lot Size</span>
            <span className="text-xs font-bold text-slate-200 mt-1 block">
              {acres > 0 ? `${parseFloat(String(acres)).toFixed(2)} Acres` : sqft > 0 ? `${(sqft / 43560).toFixed(2)} Acres` : 'N/A'}
            </span>
            <span className="text-[10px] text-slate-500 mt-0.5 block">{sqft > 0 ? `${Number(sqft).toLocaleString()} Sq Ft` : 'Pending Survey'}</span>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-2xl border border-slate-900">
            <span className="text-[9px] uppercase font-bold tracking-wider text-slate-500 block">Zoning / Use</span>
            <span className="text-xs font-bold text-slate-200 mt-1 block truncate">{zoning}</span>
            <span className="text-[10px] text-slate-500 mt-0.5 block truncate">{useCode}</span>
          </div>
        </div>

        {/* Building specs */}
        <div className="p-3 bg-slate-950/60 rounded-2xl border border-slate-900 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500">Building Characteristics &amp; Specs</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-500/10 text-blue-300 border border-blue-500/20">{yearBuilt ? (raw.latestYearBuilt && Number(raw.latestYearBuilt) !== Number(yearBuilt) ? `Built ${yearBuilt}-${raw.latestYearBuilt}` : `Year Built: ${yearBuilt}`) : 'Year Built: Pending'}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-900/60 text-center">
            <div><span className="text-[9px] text-slate-500 block uppercase">Bldg Area</span><span className="text-xs font-bold text-slate-200">{bldgSqFt > 0 ? `${Number(bldgSqFt).toLocaleString()} Sq Ft` : 'Pending Survey'}</span></div>
            <div><span className="text-[9px] text-slate-500 block uppercase">Stories</span><span className="text-xs font-bold text-slate-200">{stories ? `${stories} Stories` : '1 Story'}</span></div>
            <div><span className="text-[9px] text-slate-500 block uppercase">Condition</span><span className="text-xs font-bold text-slate-200">{condition}</span></div>
          </div>
          {Number(raw.buildingCount) > 1 && <p className="pt-1 border-t border-slate-900/60 text-[10px] text-amber-300/90 leading-relaxed">{raw.buildingCount} buildings on this parcel. {raw.buildingNote}</p>}
          <div className="flex items-center justify-between pt-1 border-t border-slate-900/60 text-[10px] text-slate-400">
            <span className="truncate">Frame: {construction}</span>
            <span className="truncate font-mono text-slate-400">HVAC: {hvac}</span>
          </div>
        </div>

        {/* Ownership */}
        <div className="p-3 bg-slate-950/50 rounded-2xl border border-slate-900 space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Owner of Record</span>
            <span className="text-[10px] font-bold text-slate-400">{lastSync || propApn ? 'County Records' : 'Manual Underwriting'}</span>
          </div>
          <p className="text-xs font-semibold text-slate-200 truncate">{owner}</p>
          <p className="text-[10px] text-slate-500 truncate pt-1 border-t border-slate-900/80">{legal}</p>
        </div>

        {/* Multi-parcel package */}
        {isMulti && (
          <div className="p-3 bg-slate-950/70 rounded-2xl border border-emerald-900/40 space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400">Multi-Parcel Package</span>
              <span className="text-[9px] font-bold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 px-1.5 py-0.5 rounded">{companionCount} Companion Parcel{companionCount > 1 ? 's' : ''} Attached</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">Adjacent parcel(s) owned by the same entity detected in this block. Toggle companion parcels to bundle them into this purchase.</p>
            <div className="space-y-1.5 pt-0.5">
              {parcels.map((p, idx) => {
                const inc = p.included !== false;
                return (
                  <div key={idx} className={`p-2.5 rounded-xl border transition flex items-center justify-between ${inc ? 'bg-emerald-950/30 border-emerald-800/60 text-slate-100' : 'bg-slate-950/60 border-slate-800 text-slate-400'}`}>
                    <div className="flex items-center space-x-3 overflow-hidden">
                      <input type="checkbox" checked={inc} disabled={!!p.isPrimary} onChange={(e) => { void toggleParcel(idx, e.target.checked); }}
                        className="rounded bg-slate-900 border-slate-700 text-emerald-500 focus:ring-emerald-500 w-3.5 h-3.5" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-bold truncate text-white">{p.address || p.street || `Parcel ${idx + 1}`}</span>
                          {p.isPrimary
                            ? <span className="text-[9px] bg-brand-500/20 text-brand-300 px-1.5 py-0.5 rounded font-bold uppercase shrink-0">Primary</span>
                            : <span className="text-[9px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded font-bold uppercase shrink-0">Adjacent</span>}
                        </div>
                        <div className="text-[10px] text-slate-400 flex items-center space-x-2 mt-0.5">
                          <span className="font-mono text-emerald-400">{p.formattedApn || p.apn}</span>
                          <span>•</span><span>{p.useCode || 'Taxlot'}</span>
                          {p.legalDescription && <><span>•</span><span className="truncate text-slate-500">{p.legalDescription}</span></>}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 pl-2">
                      <span className={`text-xs font-black ${inc ? 'text-emerald-400' : 'text-slate-500'}`}>{p.totalAssessedValue ? `$${Number(p.totalAssessedValue).toLocaleString()}` : '$0'}</span>
                      <span className="text-[10px] text-slate-500 block">{p.acres ? `${p.acres} ac` : ''}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {pkg && (
              <div className="p-2 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between text-[11px] font-bold">
                <span className="text-slate-400">Combined Package:</span>
                <span className="text-emerald-400">${pkg.totalAssessedValue.toLocaleString()} ({acres} Acres • {pkg.totalParcels} Parcels)</span>
              </div>
            )}
          </div>
        )}

        <div className="pt-1 flex items-center justify-between gap-2">
          <button type="button" onClick={applyAssessed}
            className="w-full py-2 px-3 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 hover:border-emerald-500/60 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5">
            <span>Apply Assessed Value as Purchase Price</span>
          </button>
        </div>
      </div>
    </div>
  );
};
