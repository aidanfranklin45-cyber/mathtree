import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { DealRecord, DealMetrics } from '../../lib/math/types';
import { exportDealBriefPDF } from '../../lib/export/pdfBrief';
import { ChevronDown, FileDown, Sliders, Layers, ArrowLeft } from 'lucide-react';

interface StudioNavbarProps {
  deal: DealRecord;
  metrics: DealMetrics;
  activeTab: string;
  onSelectTab: (tab: string) => void;
  onOpenEditModal: () => void;
}

const MODULE_TABS = [
  { key: 'overview', title: 'Deal Overview', subtitle: 'Executive summary & key metrics' },
  { key: 'proforma', title: 'Pro-Forma & Cash Flows', subtitle: '10-year cash flow projections' },
  { key: 'property', title: 'Property & County Records', subtitle: 'GIS, parcel data & assessment' },
  { key: 'debt', title: 'Debt & Financing', subtitle: 'Amortization & debt service' },
  { key: 'diligence', title: 'Assumptions & Diligence', subtitle: 'Checklist & underwriting notes' },
  { key: 'sensitivity', title: 'Risk & Sensitivity', subtitle: 'Matrix & Monte Carlo analysis' },
  { key: 'tax', title: 'Tax & Wealth Strategy', subtitle: 'Depreciation & cost segregation' },
];

export const StudioNavbar: React.FC<StudioNavbarProps> = ({
  deal,
  metrics,
  activeTab,
  onSelectTab,
  onOpenEditModal,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const isOwned = deal.status === 'owned';
  const availableTabs = isOwned ? MODULE_TABS.filter((t) => t.key !== 'diligence') : MODULE_TABS;
  const currentModule = MODULE_TABS.find((t) => t.key === activeTab) || MODULE_TABS[0];

  return (
    <header className="border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md sticky top-0 z-30 px-4 sm:px-6 py-3">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Left: Branding & Deal Info */}
        <div className="flex items-center space-x-3">
          <Link
            to="/"
            className="p-2 rounded-xl bg-slate-900/80 border border-slate-800 text-slate-400 hover:text-emerald-400 hover:border-emerald-500/30 transition shadow-sm"
            title="Return to Portfolio Dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>

          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-base sm:text-lg font-black text-white tracking-tight flex items-center gap-2">
                <span>{deal.title}</span>
              </h1>
              <span
                className={`text-[10px] uppercase font-black px-2 py-0.5 rounded-full border ${
                  isOwned
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                    : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
                }`}
              >
                {isOwned ? 'Owned Asset' : 'Pipeline'}
              </span>
              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-slate-800/80 text-slate-300 border border-slate-700/60 hidden sm:inline">
                {deal.asset_class}
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium">
              {deal.location || `${deal.city || 'Union Gap'}, ${deal.state || 'WA'}`} • ${deal.purchase_price.toLocaleString()} Purchase
            </p>
          </div>
        </div>

        {/* Right: Module Selector, Edit Inputs, Export PDF */}
        <div className="flex items-center space-x-2">
          {/* Analysis Module Dropdown */}
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-emerald-500/40 text-xs font-bold text-slate-200 flex items-center space-x-2 transition shadow-sm group"
            >
              <Layers className="w-3.5 h-3.5 text-emerald-400" />
              <span>{currentModule.title}</span>
              <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {dropdownOpen && (
              <div
                className="absolute left-0 sm:right-0 sm:left-auto top-full mt-1.5 w-64 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl py-2 z-40"
                onClick={() => setDropdownOpen(false)}
              >
                <div className="px-3 py-1 text-[10px] uppercase font-extrabold tracking-wider text-slate-400 border-b border-slate-800/80 mb-1">
                  Analysis Modules ({availableTabs.length} Sections)
                </div>
                {availableTabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => onSelectTab(tab.key)}
                    className={`w-full text-left px-3 py-2 text-xs flex flex-col transition ${
                      activeTab === tab.key
                        ? 'bg-emerald-500/10 text-emerald-400 font-bold border-l-2 border-emerald-500'
                        : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                    }`}
                  >
                    <span>{tab.title}</span>
                    <span className="text-[10px] text-slate-500 font-normal">{tab.subtitle}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Edit Inputs Button */}
          <button
            onClick={onOpenEditModal}
            className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-bold text-slate-200 flex items-center space-x-1.5 transition shadow-sm hover:text-white"
          >
            <Sliders className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Edit</span> Inputs
          </button>

          {/* Export Brief (PDF) */}
          <button
            onClick={() => exportDealBriefPDF(deal.id)}
            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs flex items-center space-x-1.5 transition shadow-sm shadow-emerald-950/50"
          >
            <FileDown className="w-3.5 h-3.5" />
            <span>Export Brief</span>
          </button>
        </div>
      </div>
    </header>
  );
};
