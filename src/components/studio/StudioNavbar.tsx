import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DealRecord, DealMetrics } from '../../lib/math/types';
import { exportDealBriefPDF } from '../../lib/export/pdfBrief';
import { exportDealProformaCSV } from '../../lib/export/csvExport';
import { resolveDealDisplayName } from '../../lib/math/pointInTime';
import { apnBadgeLabel, getAssessorPortalUrl } from '../../lib/services/assessorPortal';

interface StudioNavbarProps {
  deal: DealRecord;
  metrics: DealMetrics;
  activeTab: string;
  onSelectTab: (tab: string) => void;
  onOpenEditModal: () => void;
  onOpenHistoryModal?: () => void;
  onOpenShare?: () => void;
  scenarioCount?: number;
}

/** Same modules, order, icons and descriptions as the legacy analysis-module dropdown. */
export const MODULE_TABS = [
  { key: 'overview', icon: '📌', title: 'Deal Overview', mobile: 'Overview', subtitle: 'Executive summary, headline returns & capital structure' },
  { key: 'diligence', icon: '📋', title: 'Assumptions & Diligence', mobile: 'Diligence', subtitle: 'Purchase basis, capex & closing outlay, LTV & debt terms' },
  { key: 'proforma', icon: '📊', title: 'Pro-Forma & Cash Flows', mobile: 'Pro-Forma', subtitle: '10-year operating cash flows, stub period & monthly schedule' },
  { key: 'property', icon: '🏛️', title: 'Property & County Records', mobile: 'Property', subtitle: 'Assessor roll valuations, companion parcels & GIS data' },
  { key: 'debt', icon: '🏦', title: 'Debt & Financing', mobile: 'Debt', subtitle: 'Mortgage amortization, DSCR coverage & refinance stress' },
  { key: 'sensitivity', icon: '🎲', title: 'Risk & Sensitivity', mobile: 'Risk', subtitle: 'Monte Carlo probability simulation & 2D stress matrices' },
  { key: 'tax', icon: '📑', title: 'Tax & Wealth Strategy', mobile: 'Tax', subtitle: 'Cost segregation, accelerated depreciation & exit tax liability' },
] as const;

const STATUS_PILL: Record<string, string> = {
  owned: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  prospect: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  pipeline: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
};

const ASSET_LABEL: Record<string, string> = {
  commercial: 'Commercial',
  'multi-unit': 'Multi-Family',
  multi_family: 'Multi-Family',
  'single-family': 'Single-Family',
  residential: 'Single-Family',
  storage: 'Self-Storage',
};

export const StudioNavbar: React.FC<StudioNavbarProps> = ({
  deal, metrics, activeTab, onSelectTab, onOpenEditModal, onOpenHistoryModal, onOpenShare, scenarioCount = 0,
}) => {
  const [moduleOpen, setModuleOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addrOpen, setAddrOpen] = useState(false);
  const moduleRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const addrRef = useRef<HTMLDivElement>(null);

  const isOwned = deal.status === 'owned';
  const pages = isOwned ? MODULE_TABS.filter((t) => t.key !== 'diligence') : MODULE_TABS;
  const current = MODULE_TABS.find((t) => t.key === activeTab) || MODULE_TABS[0];

  // Wrapping prev/next like the legacy arrows (which step in this order, not the dropdown's)
  const arrowOrder = ['overview', 'proforma', 'property', 'debt', 'diligence', 'sensitivity', 'tax'].filter((k) => pages.some((p) => p.key === k));
  const navigateRelative = (delta: number) => {
    const idx = arrowOrder.indexOf(activeTab);
    if (idx === -1) return;
    onSelectTab(arrowOrder[(idx + delta + arrowOrder.length) % arrowOrder.length]);
  };

  // Outside click, Escape, Alt+Arrow shortcuts (same as legacy)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (moduleRef.current && !moduleRef.current.contains(t)) setModuleOpen(false);
      if (menuRef.current && !menuRef.current.contains(t)) setMenuOpen(false);
      if (addrRef.current && !addrRef.current.contains(t)) setAddrOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setModuleOpen(false); setMenuOpen(false); setAddrOpen(false); }
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); navigateRelative(-1); }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); navigateRelative(1); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, deal.status]);

  const inputs = deal.inputs || {};
  const title = resolveDealDisplayName(deal);
  const location = deal.location || inputs.location || inputs.county || inputs.address || 'United States';
  const statusKey = isOwned ? 'owned' : 'prospect';
  const assetKey = String(deal.asset_class || deal.assetType || 'commercial');

  const addresses: string[] =
    Array.isArray(inputs.addresses) && inputs.addresses.length > 1
      ? inputs.addresses
      : Array.isArray(inputs.adjacentParcels) && inputs.adjacentParcels.length > 0
        ? [deal.location || 'Primary Address', ...inputs.adjacentParcels.map((p: any) => p.address || `APN: ${p.apn || p.parcelNumber}`)]
        : Array.isArray(inputs.parcels) && inputs.parcels.length > 1
          ? inputs.parcels.map((p: any) => (typeof p === 'string' ? p : p.address || `APN: ${p.apn || p.parcelNumber}`))
          : [];

  const apn: string | undefined = inputs.primaryApn || inputs.apn || inputs.assessorData?.apn;
  const county: string | undefined = inputs.county || inputs.parcels?.[0]?.county || inputs.assessorData?.county;
  const parcelCount = Array.isArray(inputs.parcels) ? inputs.parcels.length : 0;

  const menuBtn = 'w-full px-3.5 py-2 text-left text-xs font-semibold hover:bg-slate-800 hover:text-white flex items-center space-x-2.5 transition';

  return (
    <header className="border-b border-emerald-950 bg-slate-950/90 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 min-h-16 h-auto py-2 sm:py-0 flex items-center justify-between gap-2 sm:gap-4">
        {/* Back to Dashboard & deal identity */}
        <div className="flex items-center space-x-3 min-w-0">
          <Link to="/" className="group flex items-center space-x-1.5 py-1.5 px-2.5 sm:px-3 rounded-xl text-xs font-bold text-slate-300 hover:text-white bg-slate-900 border border-slate-800 hover:border-slate-700 transition shrink-0">
            <svg className="w-4 h-4 text-emerald-400 group-hover:-translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            <span>Dashboard</span>
          </Link>
          <div className="h-5 w-px bg-slate-800 hidden sm:block" />
          <div className="min-w-0">
            <div className="flex items-center space-x-2">
              <h1 className="text-xs sm:text-base font-extrabold text-white tracking-tight truncate max-w-[100px] xs:max-w-[160px] sm:max-w-xs md:max-w-md" title={title}>{title}</h1>
              <span className={`text-[9px] sm:text-[10px] uppercase font-bold tracking-wider px-1.5 sm:px-2 py-0.5 rounded-md border shrink-0 ${STATUS_PILL[statusKey]}`}>
                {isOwned ? 'Owned' : 'Prospect'}
              </span>
              <span className="hidden xs:inline-block text-[9px] sm:text-[10px] uppercase font-bold tracking-wider px-1.5 sm:px-2 py-0.5 rounded-md bg-brand-500/10 text-brand-400 border border-brand-500/20 shrink-0">
                {ASSET_LABEL[assetKey] || assetKey.replace('-', ' ')}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-0.5">
              <p className="flex items-center space-x-1">
                <svg className="w-3 h-3 text-slate-500 inline mr-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                <span>{location}</span>
              </p>

              {addresses.length > 1 && (
                <div className="relative inline-block" ref={addrRef}>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setAddrOpen((o) => !o); }}
                    className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/60 text-cyan-300 text-[10px] font-semibold hover:border-cyan-600 transition">
                    <span>📍</span><span>{addresses.length} Parcels</span> ▾
                  </button>
                  {addrOpen && (
                    <div className="absolute left-0 top-full mt-1 w-64 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-2.5 z-50 text-[11px] space-y-1.5">
                      <div className="font-bold text-white text-[10px] uppercase tracking-wider pb-1 border-b border-slate-800">Constituent Assemblage Parcels</div>
                      <div className="space-y-1 max-h-44 overflow-y-auto">
                        {addresses.map((addr, idx) => (
                          <div key={idx} className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
                            <span className="text-slate-200 truncate mr-2 font-medium text-xs">{addr}</span>
                            <span className="text-[9px] uppercase font-bold text-cyan-400 bg-cyan-950/80 px-1.5 py-0.5 rounded border border-cyan-800/40 shrink-0">{idx === 0 ? 'Primary' : `Parcel ${idx + 1}`}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {apn && (
                <a href={getAssessorPortalUrl(county, apn)} target="_blank" rel="noopener noreferrer"
                  className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-emerald-950/40 border border-emerald-900/60 text-emerald-400 text-[10px] font-semibold hover:border-emerald-700 transition"
                  title="Open the official County Assessor record">
                  <span>{apnBadgeLabel(county, apn, parcelCount)} ↗</span>
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Analysis module selector + quick arrows */}
        <div className="flex items-center space-x-1 sm:space-x-1.5 shrink-0">
          <button type="button" onClick={() => navigateRelative(-1)} title="Previous module (Alt + ←)"
            className="hidden sm:flex items-center justify-center w-8 h-8 rounded-xl text-slate-400 hover:text-white bg-slate-900 border border-slate-800 hover:border-slate-700 transition">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
          </button>

          <div className="relative" ref={moduleRef}>
            <button type="button" onClick={(e) => { e.stopPropagation(); setModuleOpen((o) => !o); }} aria-haspopup="true" aria-expanded={moduleOpen}
              className="group flex items-center space-x-1.5 sm:space-x-2 px-2 sm:px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-emerald-500/40 transition">
              <span className="text-base shrink-0">{current.icon}</span>
              <div className="text-left hidden md:block">
                <span className="block text-[8.5px] uppercase font-extrabold tracking-wider text-emerald-400 leading-none mb-0.5">Analysis Module</span>
                <span className="block text-xs font-bold text-slate-100 group-hover:text-white leading-tight">{current.title}</span>
              </div>
              <span className="block text-[11px] sm:text-xs font-bold text-slate-100 md:hidden truncate max-w-[65px] xs:max-w-[100px]">{current.mobile}</span>
              <svg className={`w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-400 transition-transform ml-0.5 ${moduleOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
            </button>

            {moduleOpen && (
              <div className="absolute right-0 sm:left-1/2 sm:-translate-x-1/2 top-11 w-[calc(100vw-1.5rem)] max-w-xs sm:max-w-sm sm:w-80 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl py-2 z-50">
                <div className="px-3.5 py-2 flex items-center justify-between">
                  <span className="text-[10px] uppercase font-extrabold tracking-wider text-slate-400">Property Analysis Modules</span>
                  <span className="text-[9px] text-slate-500 font-mono">{pages.length} Sections</span>
                </div>
                <div className="p-1.5 space-y-0.5">
                  {pages.map((tab) => {
                    const on = tab.key === activeTab;
                    return (
                      <button key={tab.key} type="button" onClick={() => { onSelectTab(tab.key); setModuleOpen(false); }}
                        className={`w-full flex items-center justify-between p-2 rounded-xl transition group text-left ${on ? 'bg-brand-600 text-white font-bold shadow-md' : 'text-slate-300 hover:bg-slate-800/90 hover:text-white'}`}>
                        <div className="flex items-center space-x-2.5">
                          <span className="text-base shrink-0">{tab.icon}</span>
                          <div>
                            <span className="block text-xs font-bold leading-snug">{tab.title}</span>
                            <span className="block text-[10px] text-slate-400 group-hover:text-slate-200 leading-snug">{tab.subtitle}</span>
                          </div>
                        </div>
                        {on && <span className="text-emerald-300 text-xs font-black ml-2">✓</span>}
                      </button>
                    );
                  })}
                  <div className="my-1 border-t border-slate-800/80" />
                  <Link to="/operations" className="flex items-center justify-between p-2 rounded-xl transition group text-emerald-300 hover:bg-slate-800/90 hover:text-white">
                    <div className="flex items-center space-x-2.5">
                      <span className="text-base shrink-0">🍀</span>
                      <div>
                        <span className="block text-xs font-bold leading-snug">Property Management</span>
                        <span className="block text-[10px] text-slate-400 group-hover:text-slate-200 leading-snug">Live rent roll, active leases &amp; collections ledger</span>
                      </div>
                    </div>
                    <span className="text-emerald-400 text-xs font-bold">↗</span>
                  </Link>
                </div>
              </div>
            )}
          </div>

          <button type="button" onClick={() => navigateRelative(1)} title="Next module (Alt + →)"
            className="hidden sm:flex items-center justify-center w-8 h-8 rounded-xl text-slate-400 hover:text-white bg-slate-900 border border-slate-800 hover:border-slate-700 transition">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>

        {/* Actions: Edit Inputs + menu */}
        <div className="flex items-center space-x-2">
          <button onClick={onOpenEditModal} className="px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition flex items-center space-x-1.5">
            <svg className="w-3.5 h-3.5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            <span>Edit Inputs</span>
          </button>

          <div className="relative" ref={menuRef}>
            <button onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }} aria-label="Deal Actions"
              className="p-1.5 rounded-xl text-slate-400 hover:text-white bg-slate-900 border border-slate-800 hover:border-slate-700 transition relative">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" /></svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-9 w-60 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl py-1.5 z-30" onClick={() => setMenuOpen(false)}>
                {onOpenShare && !deal.is_shared && (
                  <button onClick={onOpenShare} className={`${menuBtn} text-cyan-300`}>
                    <svg className="w-4 h-4 text-cyan-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                    <span>Share with Collaborators</span>
                  </button>
                )}
                {onOpenHistoryModal && (
                  <button type="button" onClick={onOpenHistoryModal} className={`${menuBtn} justify-between text-slate-200`}>
                    <div className="flex items-center space-x-2.5"><span className="text-sm">⚡</span><span>Scenario History &amp; Diff</span></div>
                    <span className="px-1.5 rounded-full bg-slate-950 text-[10px] font-mono font-bold text-slate-400">{scenarioCount}</span>
                  </button>
                )}
                <div className="my-1 border-t border-slate-800" />
                <Link to="/operations" className={`${menuBtn} text-emerald-300`} title="Property Management">
                  <span className="text-emerald-400 shrink-0">🍀</span>
                  <span>Property Management</span>
                </Link>
                <div className="my-1 border-t border-slate-800" />
                <button onClick={() => { void exportDealBriefPDF(deal.id); }} className={`${menuBtn} text-slate-200`}>
                  <svg className="w-3.5 h-3.5 text-rose-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                  <span>Print Executive Brief (PDF)</span>
                </button>
                <button onClick={() => exportDealProformaCSV(deal, metrics)} className={`${menuBtn} text-slate-200`}>
                  <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  <span>Download Spreadsheet (CSV)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
