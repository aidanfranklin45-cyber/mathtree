import React, { useState } from 'react';
import { Copy, Pencil, Trash2 } from 'lucide-react';
import type { CompareConfig } from '../../lib/compare/config';
import type { ComparePreset } from '../../lib/compare/config';
import type { RecentBoard, SavedView } from '../../lib/compare/savedViews';
import { SidePanel } from './SidePanel';

interface SavedPanelProps {
  open: boolean;
  onClose: () => void;
  presets: Array<{ preset: ComparePreset; config: CompareConfig | null }>;
  saved: SavedView[];
  savedLoading: boolean;
  recents: RecentBoard[];
  onOpenConfig: (config: CompareConfig, label: string, savedId?: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (view: SavedView) => void;
  onDelete: (view: SavedView) => void;
}

const describe = (c: CompareConfig): string => {
  const deals = new Set(c.entries.map((e) => e.dealId)).size;
  return `${c.entries.length} ${c.entries.length === 1 ? 'column' : 'columns'} · ${deals} ${deals === 1 ? 'property' : 'properties'} · ${c.metrics.length} metrics`;
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="py-3">
    <h4 className="px-5 pb-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">{title}</h4>
    {children}
  </section>
);

export const SavedPanel: React.FC<SavedPanelProps> = ({ open, onClose, presets, saved, savedLoading, recents, onOpenConfig, onRename, onDuplicate, onDelete }) => {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const rowBtn = 'w-full text-left px-5 py-3 hover:bg-slate-800/40 transition min-h-[56px] disabled:opacity-40 disabled:hover:bg-transparent';

  return (
    <SidePanel open={open} onClose={onClose} title="Saved comparisons" subtitle="Open a board you saved, a recent one, or a ready-made view.">
      {recents.length > 0 && (
        <Section title="Recent">
          {recents.map((r, i) => (
            <button key={i} type="button" className={rowBtn} onClick={() => { onOpenConfig(r.config, 'Recent board'); onClose(); }}>
              <span className="block text-sm font-bold text-slate-100">{i === 0 ? 'Last board' : `Board ${i + 1} back`}</span>
              <span className="block text-[11px] text-slate-500">{describe(r.config)}</span>
            </button>
          ))}
        </Section>
      )}

      <Section title="Your saved boards">
        {savedLoading ? (
          <p className="px-5 py-3 text-xs text-slate-500">Loading…</p>
        ) : saved.length === 0 ? (
          <p className="px-5 py-3 text-xs text-slate-500">Nothing saved yet. Build a board and tap Save.</p>
        ) : (
          saved.map((v) => (
            <div key={v.id} className="border-b border-slate-800/50 last:border-b-0">
              {renaming === v.id ? (
                <form
                  className="px-5 py-3 flex gap-2"
                  onSubmit={(e) => { e.preventDefault(); if (draftName.trim()) onRename(v.id, draftName.trim()); setRenaming(null); }}
                >
                  <input autoFocus value={draftName} onChange={(e) => setDraftName(e.target.value)} maxLength={80} className="flex-1 bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none" aria-label="Board name" />
                  <button type="submit" className="px-3 rounded-xl bg-emerald-600 text-slate-950 text-xs font-black">Save</button>
                </form>
              ) : (
                <div className="flex items-stretch">
                  <button type="button" className={`${rowBtn} flex-1 min-w-0`} onClick={() => { onOpenConfig(v.config, v.name, v.id); onClose(); }}>
                    <span className="block text-sm font-bold text-slate-100 truncate">{v.name}</span>
                    <span className="block text-[11px] text-slate-500">{describe(v.config)}</span>
                  </button>
                  {confirmDelete === v.id ? (
                    <div className="flex items-center gap-1 pr-3">
                      <button type="button" onClick={() => { setConfirmDelete(null); onDelete(v); }} className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold">Delete</button>
                      <button type="button" onClick={() => setConfirmDelete(null)} className="px-2.5 py-1.5 rounded-lg text-slate-400 text-xs font-bold">Keep</button>
                    </div>
                  ) : (
                    <div className="flex items-center pr-2">
                      <button type="button" onClick={() => { setRenaming(v.id); setDraftName(v.name); }} className="p-2.5 text-slate-500 hover:text-white" aria-label={`Rename ${v.name}`}><Pencil className="w-4 h-4" /></button>
                      <button type="button" onClick={() => onDuplicate(v)} className="p-2.5 text-slate-500 hover:text-white" aria-label={`Duplicate ${v.name}`}><Copy className="w-4 h-4" /></button>
                      <button type="button" onClick={() => setConfirmDelete(v.id)} className="p-2.5 text-slate-500 hover:text-rose-400" aria-label={`Delete ${v.name}`}><Trash2 className="w-4 h-4" /></button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </Section>

      <Section title="Ready-made views">
        {presets.map(({ preset, config }) => (
          <button key={preset.id} type="button" disabled={!config} className={rowBtn} onClick={() => { if (config) { onOpenConfig(config, preset.label); onClose(); } }}>
            <span className="block text-sm font-bold text-slate-100">{preset.label}</span>
            <span className="block text-[11px] text-slate-500">{config ? preset.description : 'Needs deals of this kind first.'}</span>
          </button>
        ))}
      </Section>
    </SidePanel>
  );
};
