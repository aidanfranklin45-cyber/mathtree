import React, { useEffect, useRef, useState } from 'react';
import { BarChart3, Bookmark, FileDown, Link2, ListChecks, MoreHorizontal, Plus, SlidersHorizontal, Table as TableIcon, Trash2, LayoutList, HelpCircle } from 'lucide-react';
import type { CompareView } from '../../lib/compare/config';
import { FilterChip } from '../../lib/compare/filters';

interface BuilderStripProps {
  columnsCount: number;
  metricsLabel: string;
  filterCount: number;
  chips: FilterChip[];
  onClearChip: (chip: FilterChip) => void;
  onClearAllFilters: () => void;
  shownDealCount: number;
  totalDealCount: number;
  isPhone: boolean;
  view: CompareView;
  onViewChange: (v: CompareView) => void;
  /** Phone only: ranked cards or the full table. */
  phoneTable: boolean;
  onPhoneTableChange: (t: boolean) => void;
  /** Name of the saved board that is open, and whether the board has changed since it was saved. */
  savedName: string | null;
  dirty: boolean;
  saveError: string | null;
  saveBusy: boolean;
  onOpenAdd: () => void;
  onOpenMetrics: () => void;
  onOpenFilters: () => void;
  onOpenSaved: () => void;
  onOpenInquiry?: () => void;
  inquiryActive?: boolean;
  onSaveNew: (name: string) => void;
  onUpdateSaved: () => void;
  onExportCsv: () => void;
  onCopyLink: () => void;
  onClearBoard: () => void;
}

const chipBase = 'px-3.5 py-2.5 rounded-xl text-xs font-bold border transition flex items-center gap-1.5 whitespace-nowrap min-h-[40px]';
const chipIdle = 'bg-slate-900 border-slate-800 text-slate-200 hover:text-white hover:border-slate-700';

export const BuilderStrip: React.FC<BuilderStripProps> = (p) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const viewBtn = (active: boolean) => `px-3 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 min-h-[36px] ${active ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 overflow-x-auto -mx-1 px-1 pb-1 md:pb-0 md:overflow-visible flex-1 min-w-0">
          <button type="button" onClick={p.onOpenAdd} className="px-4 py-2.5 rounded-xl text-xs font-extrabold text-white bg-gradient-to-r from-brand-600 to-emerald-500 hover:from-brand-500 hover:to-emerald-400 shadow-md shadow-emerald-500/20 transition flex items-center gap-1.5 whitespace-nowrap min-h-[40px]">
            <Plus className="w-4 h-4" /> Add
            {p.columnsCount > 0 && <span className="px-1.5 rounded-full bg-black/20 text-[10px] font-mono">{p.columnsCount}</span>}
          </button>
          {p.onOpenInquiry && (
            <button
              type="button"
              onClick={p.onOpenInquiry}
              className={`${chipBase} ${p.inquiryActive ? 'bg-emerald-950/80 border-emerald-500/80 text-emerald-300 ring-1 ring-emerald-500/30' : chipIdle}`}
            >
              <HelpCircle className="w-4 h-4 text-emerald-400" /> Inquiries
            </button>
          )}
          <button type="button" onClick={p.onOpenMetrics} className={`${chipBase} ${chipIdle}`}>
            <ListChecks className="w-4 h-4 text-cyan-400" /> Metrics: <span className="text-emerald-300">{p.metricsLabel}</span>
          </button>
          <button type="button" onClick={p.onOpenFilters} className={`${chipBase} ${chipIdle}`}>
            <SlidersHorizontal className="w-4 h-4 text-amber-400" /> Filters
            {p.filterCount > 0 && <span className="px-1.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-mono">{p.filterCount}</span>}
          </button>
          <button type="button" onClick={p.onOpenSaved} className={`${chipBase} ${chipIdle}`}>
            <Bookmark className="w-4 h-4 text-violet-400" /> Saved
          </button>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {p.savedName && p.dirty ? (
            <>
              <button type="button" disabled={p.saveBusy} onClick={p.onUpdateSaved} className={`${chipBase} bg-emerald-950/70 border-emerald-800/60 text-emerald-300 hover:text-emerald-200`}>Update “{p.savedName.length > 18 ? `${p.savedName.slice(0, 17)}…` : p.savedName}”</button>
              <button type="button" onClick={() => { setNaming(true); setName(`${p.savedName} copy`); }} className={`${chipBase} ${chipIdle}`}>Save as new</button>
            </>
          ) : p.savedName ? (
            <span className="text-xs text-slate-400 px-2">Saved as “{p.savedName}”</span>
          ) : (
            <button type="button" disabled={p.columnsCount === 0} onClick={() => { setNaming(true); setName(''); }} className={`${chipBase} ${chipIdle} disabled:opacity-40`}>Save</button>
          )}

          {p.isPhone ? (
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800" role="group" aria-label="Layout">
              <button type="button" onClick={() => p.onPhoneTableChange(false)} aria-pressed={!p.phoneTable} className={viewBtn(!p.phoneTable)}><LayoutList className="w-3.5 h-3.5" /> Cards</button>
              <button type="button" onClick={() => p.onPhoneTableChange(true)} aria-pressed={p.phoneTable} className={viewBtn(p.phoneTable)}><TableIcon className="w-3.5 h-3.5" /> Table</button>
            </div>
          ) : (
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800" role="group" aria-label="View">
              <button type="button" onClick={() => p.onViewChange('matrix')} aria-pressed={p.view === 'matrix'} className={viewBtn(p.view === 'matrix')}><TableIcon className="w-3.5 h-3.5" /> Matrix</button>
              <button type="button" onClick={() => p.onViewChange('charts')} aria-pressed={p.view === 'charts'} className={viewBtn(p.view === 'charts')}><BarChart3 className="w-3.5 h-3.5 text-cyan-400" /> Charts</button>
            </div>
          )}

          <div className="relative" ref={menuRef}>
            <button type="button" onClick={() => setMenuOpen((o) => !o)} className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white min-h-[40px]" aria-label="More actions" aria-expanded={menuOpen}>
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-2 w-52 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl z-30 py-1.5 overflow-hidden">
                <button type="button" disabled={p.columnsCount === 0} onClick={() => { setMenuOpen(false); p.onExportCsv(); }} className="w-full px-4 py-2.5 text-left text-xs font-bold text-slate-200 hover:bg-slate-800 flex items-center gap-2 disabled:opacity-40"><FileDown className="w-4 h-4 text-rose-400" /> Export CSV</button>
                <button
                  type="button"
                  disabled={p.columnsCount === 0}
                  onClick={() => { p.onCopyLink(); setCopied(true); setMenuOpen(false); window.setTimeout(() => setCopied(false), 2500); }}
                  className="w-full px-4 py-2.5 text-left text-xs font-bold text-slate-200 hover:bg-slate-800 flex items-center gap-2 disabled:opacity-40"
                ><Link2 className="w-4 h-4 text-cyan-400" /> Copy link</button>
                <button type="button" disabled={p.columnsCount === 0} onClick={() => { setMenuOpen(false); p.onClearBoard(); }} className="w-full px-4 py-2.5 text-left text-xs font-bold text-slate-200 hover:bg-slate-800 flex items-center gap-2 disabled:opacity-40"><Trash2 className="w-4 h-4 text-slate-400" /> Clear board</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {copied && <p className="text-xs text-emerald-400" role="status">Link copied. People with access to these deals can open the same board.</p>}
      {p.saveError && <p className="text-xs text-rose-400" role="alert">{p.saveError}</p>}

      {naming && (
        <form
          className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3"
          onSubmit={(e) => { e.preventDefault(); p.onSaveNew(name.trim() || 'Untitled comparison'); setNaming(false); }}
        >
          <label className="text-xs font-bold text-slate-300" htmlFor="compare-save-name">Name this comparison</label>
          <input id="compare-save-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Spring pipeline, ranked" className="flex-1 min-w-[12rem] bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none" />
          <button type="submit" className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-black">Save</button>
          <button type="button" onClick={() => setNaming(false)} className="px-3 py-2 text-xs font-bold text-slate-400 hover:text-white">Cancel</button>
        </form>
      )}

      {(p.chips.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {p.chips.map((c) => (
            <button key={c.id} type="button" onClick={() => p.onClearChip(c)} className="px-2.5 py-1.5 rounded-full text-[11px] font-bold bg-emerald-950/60 border border-emerald-800/50 text-emerald-300 capitalize flex items-center gap-1.5 hover:bg-emerald-900/50" aria-label={`Remove filter ${c.label}`}>
              {c.label} <span aria-hidden="true">×</span>
            </button>
          ))}
          <button type="button" onClick={p.onClearAllFilters} className="text-[11px] font-bold text-slate-400 hover:text-white">Clear all</button>
          <span className="text-[11px] text-slate-500">Showing {p.shownDealCount} of {p.totalDealCount} deals in Add</span>
        </div>
      )}
    </div>
  );
};

