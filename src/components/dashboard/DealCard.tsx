import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { DealRecord } from '../../lib/math/types';
import { resolvePointInTimeDealMetrics, resolveDealDisplayName } from '../../lib/math/pointInTime';
import { tryComputeDealMetrics } from '../../lib/engine/compute';
import { exportDealBriefPDF } from '../../lib/export/pdfBrief';
import { exportDealProformaCSV } from '../../lib/export/csvExport';
import { formatCurrency } from '../../lib/format';

interface DealCardProps {
  deal: DealRecord;
  entities?: Array<{ id: string; name: string }>;
  onEdit: (deal: DealRecord) => void;
  onDelete: (deal: DealRecord) => void;
  onToggleStatus: (deal: DealRecord) => void;
  /** Optional until the collaborators hub exists; the menu entry only shows when provided. */
  onShare?: (deal: DealRecord) => void;
  isSelectedForCompare?: boolean;
  onToggleCompareSelect?: (dealId: string) => void;
}

const stageMap: Record<string, { label: string; className: string }> = {
  screening: { label: 'Underwriting', className: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' },
  loi: { label: 'LOI Submitted', className: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  due_diligence: { label: 'Due Diligence', className: 'bg-rose-500/10 text-rose-400 border-rose-500/20' },
  closing: { label: 'Closing', className: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
  owned: { label: 'Owned Asset', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  disposition: { label: 'Exited', className: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
};

const assetDisplayMap: Record<string, string> = {
  'single-family': 'SFR',
  residential: 'SFR',
  'multi-unit': 'Multi-Unit',
  multi_family: 'Multi-Unit',
  commercial: 'Commercial',
  storage: 'Storage',
};

const AssetIcon: React.FC<{ assetClass: string }> = ({ assetClass }) => {
  switch (assetClass) {
    case 'multi-unit':
    case 'multi_family':
      return (
        <svg className="w-5 h-5 text-accent-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
      );
    case 'commercial':
      return (
        <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
      );
    case 'storage':
      return (
        <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
      );
    default:
      return (
        <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
      );
  }
};

const menuItem = 'w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-200 hover:bg-slate-800 hover:text-white flex items-center space-x-2 transition';

const DealCardComponent: React.FC<DealCardProps> = ({
  deal,
  entities = [],
  onEdit,
  onDelete,
  onToggleStatus,
  onShare,
  isSelectedForCompare,
  onToggleCompareSelect,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const isOwned = deal.status === 'owned';

  // Close the dropdown on any outside click
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  // Everything below is computed on demand from the deal's inputs; memoized on deal identity
  const pit = useMemo(() => resolvePointInTimeDealMetrics(deal, new Date()), [deal]);
  const engine = useMemo(() => tryComputeDealMetrics(deal), [deal]);
  const inputs = deal.inputs || {};
  const aClass = String(deal.asset_class || deal.assetType || 'single-family');
  const dealTitle = resolveDealDisplayName(deal);
  const locStr = deal.location || inputs.propertyAddress || deal.address || 'Yakima, WA';

  const purchasePrice = Number(deal.purchase_price || inputs.purchasePrice || 0);
  const isZeroEq = !!engine?.isZeroEquity && purchasePrice > 0;
  const irrStr = isZeroEq ? 'N/M' : `${(pit.irr || 0).toFixed(1)}%`;
  const cfVal = pit.currentCashFlow;
  const cocVal = Number(engine?.cashOnCash) || (cfVal && pit.currentEquity > 0 ? (cfVal / pit.currentEquity) * 100 : 0);
  const cocStr = isZeroEq ? 'N/M' : `${cocVal.toFixed(1)}%`;

  const currentStage = isOwned ? 'owned' : (inputs.dealStage && inputs.dealStage !== 'owned' ? inputs.dealStage : 'screening');
  const stInfo = stageMap[currentStage] || (isOwned ? stageMap.owned : stageMap.screening);

  const matchedEntity = entities.find((e) => e.id === deal.entity_id || e.id === inputs.entity_id);

  const addressesList: string[] =
    Array.isArray(inputs.addresses) && inputs.addresses.length > 1
      ? inputs.addresses
      : Array.isArray(inputs.adjacentParcels) && inputs.adjacentParcels.length > 0
        ? [locStr, ...inputs.adjacentParcels.map((p: any) => p.address || `APN: ${p.apn || p.parcelNumber}`)]
        : Array.isArray(inputs.parcels) && inputs.parcels.length > 1
          ? inputs.parcels.map((p: any) => (typeof p === 'string' ? p : p.address || `APN: ${p.apn || p.parcelNumber}`))
          : [];
  const isMultiAddress = addressesList.length > 1;

  const leasesList: any[] = Array.isArray(inputs.leases)
    ? inputs.leases.filter((l: any) => l && (l.tenantName || parseFloat(l.monthlyRent) > 0 || parseFloat(l.annualRent) > 0))
    : [];
  const unitCount = parseInt(String(inputs.unitCount || inputs.numUnits || inputs.storageUnitCount || 0), 10);

  let tenancyRow: React.ReactNode = null;
  if (leasesList.length > 1) {
    const names = leasesList.map((l) => l.tenantName || 'Unit Lease');
    const more = names.length > 2 ? ` (+${names.length - 2})` : '';
    tenancyRow = (
      <div className="flex items-center justify-between text-[11px] bg-slate-950/50 px-2.5 py-1.5 rounded-xl border border-slate-900/80 text-slate-300">
        <span className="flex items-center space-x-1.5 truncate max-w-[210px]" title={names.join(', ')}>
          <span className="text-xs">👥</span>
          <span className="font-bold text-slate-200 whitespace-nowrap">{leasesList.length} Tenants</span>
          <span className="text-slate-500 truncate">• {names.slice(0, 2).join(', ')}{more}</span>
        </span>
        <span className="text-emerald-400 font-semibold text-[10px] whitespace-nowrap">Active Leases</span>
      </div>
    );
  } else if (unitCount > 1) {
    tenancyRow = (
      <div className="flex items-center justify-between text-[11px] bg-slate-950/50 px-2.5 py-1.5 rounded-xl border border-slate-900/80 text-slate-300">
        <span className="flex items-center space-x-1.5 truncate max-w-[210px]">
          <span className="text-xs">🏢</span>
          <span className="font-bold text-slate-200 whitespace-nowrap">{unitCount} Units</span>
          <span className="text-slate-500 truncate">• Multi-Unit Asset</span>
        </span>
        <span className="text-cyan-400 font-semibold text-[10px] whitespace-nowrap">Rent Roll</span>
      </div>
    );
  } else if (leasesList.length === 1 && leasesList[0].tenantName) {
    tenancyRow = (
      <div className="flex items-center justify-between text-[11px] bg-slate-950/50 px-2.5 py-1.5 rounded-xl border border-slate-900/80 text-slate-300">
        <span className="flex items-center space-x-1.5 truncate max-w-[210px]" title={leasesList[0].tenantName}>
          <span className="text-xs">👤</span>
          <span className="font-bold text-slate-200 truncate">{leasesList[0].tenantName}</span>
        </span>
        <span className="text-slate-400 text-[10px] whitespace-nowrap">{leasesList[0].leaseType || 'Single-Tenant'}</span>
      </div>
    );
  }

  const studioUrl = `/project?id=${encodeURIComponent(deal.id)}`;
  const openStudio = (e: React.MouseEvent | React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, [data-no-nav]')) return;
    if (typeof window !== 'undefined' && String(window.getSelection?.() ?? '').length > 0) return;
    try {
      sessionStorage.setItem('mathtree_active_deal_id', deal.id);
      localStorage.setItem('mathtree_active_deal_id', deal.id);
    } catch { /* storage unavailable */ }
    navigate(studioUrl);
  };

  const closeThen = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(false);
    fn();
  };

  const downloadCsv = () => {
    const m = tryComputeDealMetrics(deal);
    if (m) exportDealProformaCSV(deal, m);
  };

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={openStudio}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openStudio(e); }}
      className="bg-slate-900/60 border border-slate-900 hover:border-emerald-500/40 hover:bg-slate-900/90 rounded-3xl p-4 sm:p-5 shadow-xl flex flex-col justify-between transition-all duration-200 group hover:shadow-brand-500/10 hover:-translate-y-0.5 cursor-pointer relative overflow-visible w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
    >
      <div className="space-y-4">
        {/* Top Meta Row: Icon, Asset Type, Status & Menu */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-900/80 pb-3">
          <div className="flex items-center space-x-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center shadow-inner shrink-0 group-hover:border-brand-500/30 transition">
              <AssetIcon assetClass={aClass} />
            </div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-300 bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800 whitespace-nowrap">
              {assetDisplayMap[aClass] || aClass.replace('-', ' ')}
            </span>
            {deal.is_shared && (
              <span className="text-[9px] uppercase font-black tracking-wider px-1.5 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 whitespace-nowrap shrink-0" title="Shared by collaborator">🤝 Shared</span>
            )}
          </div>

          <div className="flex items-center space-x-2 shrink-0 ml-auto">
            {onToggleCompareSelect && (
              <label
                onClick={(e) => e.stopPropagation()}
                className={`flex items-center space-x-1 cursor-pointer px-2 py-0.5 rounded-md border text-[10px] font-bold transition ${
                  isSelectedForCompare
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-white'
                }`}
                title="Select asset for side-by-side comparison"
              >
                <input
                  type="checkbox"
                  checked={!!isSelectedForCompare}
                  onChange={() => onToggleCompareSelect(deal.id)}
                  className="w-3 h-3 rounded bg-slate-900 border-slate-700 text-emerald-500 focus:ring-0 cursor-pointer"
                />
                <span className="hidden sm:inline">Compare</span>
              </label>
            )}

            <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md ${stInfo.className} border whitespace-nowrap shrink-0`}>
              {stInfo.label}
            </span>

            <div className="relative" ref={menuRef}>
              <button
                onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
                aria-label="Deal Actions"
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" /></svg>
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-8 w-52 bg-slate-900/95 backdrop-blur-md border border-slate-700 rounded-2xl shadow-2xl py-1.5 z-50">
                  <button onClick={closeThen(() => navigate(`/compare?dealId=${deal.id}`))} className={menuItem}>
                    <svg className="w-3.5 h-3.5 text-cyan-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                    <span>Compare Deal Scenarios</span>
                  </button>
                  <button onClick={closeThen(() => onToggleStatus(deal))} className={menuItem}>
                    <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                    <span>{isOwned ? 'Move to Pipeline (Prospect)' : 'Mark as Acquired (Owned)'}</span>
                  </button>
                  <button onClick={closeThen(() => onEdit(deal))} className={menuItem}>
                    <svg className="w-3.5 h-3.5 text-brand-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    <span>Edit Project Inputs</span>
                  </button>
                  {onShare && (
                    <button onClick={closeThen(() => onShare(deal))} className={menuItem}>
                      <svg className="w-3.5 h-3.5 text-cyan-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                      <span>Share with Collaborators</span>
                    </button>
                  )}
                  <button onClick={closeThen(() => { void exportDealBriefPDF(deal.id); })} className={menuItem}>
                    <svg className="w-3.5 h-3.5 text-violet-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                    <span>View Pitch Deck</span>
                  </button>
                  <button onClick={closeThen(() => { void exportDealBriefPDF(deal.id); })} className={menuItem}>
                    <svg className="w-3.5 h-3.5 text-rose-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                    <span>Print Executive Brief (PDF)</span>
                  </button>
                  <button onClick={closeThen(downloadCsv)} className={menuItem}>
                    <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    <span>Download Spreadsheet (CSV)</span>
                  </button>
                  <div className="my-1 border-t border-slate-800" />
                  <button onClick={closeThen(() => onDelete(deal))} className="w-full px-3.5 py-2 text-left text-xs font-semibold text-rose-400 hover:bg-rose-950/40 hover:text-rose-300 flex items-center space-x-2 transition">
                    <svg className="w-3.5 h-3.5 text-rose-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    <span>Delete Project</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Deal Title & Location Row */}
        <div className="space-y-1.5">
          <h4 className="text-sm sm:text-base font-extrabold text-white group-hover:text-emerald-400 transition flex items-center justify-between">
            <span className="line-clamp-1 leading-snug">{dealTitle}</span>
            <span className="text-slate-500 group-hover:text-emerald-400 transition font-bold shrink-0 ml-2">→</span>
          </h4>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
            <span className="flex items-center space-x-1 truncate max-w-[210px]">
              <svg className="w-3 h-3 text-slate-500 inline mr-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              <span className="truncate">{locStr}</span>
            </span>
            {isMultiAddress && (
              <span className="text-[10px] font-semibold text-cyan-300 bg-cyan-950/60 border border-cyan-800/50 px-2 py-0.5 rounded-lg inline-flex items-center space-x-1 shrink-0 shadow-sm" title={addressesList.join(' • ')}>
                <span>📍</span>
                <span>{addressesList.length} Parcels / Addrs</span>
              </span>
            )}
            {matchedEntity && (
              <span className="text-[10px] font-semibold text-emerald-300 bg-emerald-950/50 border border-emerald-800/50 px-2 py-0.5 rounded-lg inline-flex items-center space-x-1 shrink-0" title={`Owned by ${matchedEntity.name}`}>
                <span>🏛️</span>
                <span className="truncate max-w-[140px]">{matchedEntity.name}</span>
              </span>
            )}
          </div>
          {tenancyRow}
        </div>

        {/* Deal Metrics Grid */}
        <div className="grid grid-cols-3 gap-2 bg-slate-950/60 p-3.5 rounded-2xl border border-slate-900 text-center">
          <div>
            <span className="text-[9px] uppercase font-bold text-slate-500 block">{pit.label}</span>
            <span className="text-xs font-black text-white mt-0.5 block">{formatCurrency(pit.currentVal)}</span>
          </div>
          <div>
            <span className="text-[9px] uppercase font-bold text-slate-500 block">10-Yr IRR</span>
            <span className="text-xs font-black text-brand-400 mt-0.5 block">{irrStr}</span>
          </div>
          <div>
            <span className="text-[9px] uppercase font-bold text-slate-500 block">
              {isOwned ? 'Annual Cash Flow' : isZeroEq ? 'Yr 1 Cash Flow' : 'Yr 1 CoC'}
            </span>
            <span className="text-xs font-black text-accent-cyan mt-0.5 block">
              {isOwned || isZeroEq ? formatCurrency(cfVal) : cocStr}
            </span>
            {isZeroEq && <span className="text-[8px] text-emerald-400 font-bold block leading-none mt-0.5">100% Financed</span>}
          </div>
        </div>
      </div>

      {/* Card Footer: Modeler Link + Edit Inputs */}
      <div className="pt-3 mt-1 border-t border-slate-900/60 flex items-center justify-between text-[11px]">
        <div className="flex items-center space-x-1 text-slate-500 group-hover:text-emerald-400 transition">
          <span>View Modeler</span>
          <span className="font-bold">→</span>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEdit(deal); }}
          className="px-2.5 py-1 rounded-lg text-xs font-bold text-slate-300 hover:text-white bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-brand-500/50 transition flex items-center space-x-1 shadow-sm"
          title="Edit Deal Inputs"
        >
          <span className="text-brand-400">✎</span>
          <span>Edit Inputs</span>
        </button>
      </div>
    </div>
  );
};

export const DealCard = React.memo(DealCardComponent);
