import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import { BENCHMARK_DEAL } from '../../lib/supabase/client';
import { calculateProjections } from '../../lib/engine';
import { prepareEngineInputs } from '../../lib/engine/compute';
import type { DealRecord } from '../../lib/math/types';
import { formatCurrency } from '../../lib/format';
import { fetchProfile, saveProfile, type InvestorProfile } from '../../lib/profile';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (profile: InvestorProfile) => void;
  /** Opens the LLC / entity portal (Profile is reopened when the portal's back arrow is used). */
  onOpenEntities?: () => void;
  /** Deals on the current page; the first one benchmarks the live NPV preview (legacy behaviour). */
  deals?: DealRecord[];
}

type Ent = { id: string; name: string; entity_type?: string; formation_state?: string | null };

const inputCls = 'w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-brand-500';
const labelCls = 'text-[11px] font-bold text-slate-400';

export const InvestorProfileModal: React.FC<Props> = ({ isOpen, onClose, onSaved, onOpenEntities, deals = [] }) => {
  const [form, setForm] = useState<InvestorProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entities, setEntities] = useState<Ent[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('llc');
  const [newState, setNewState] = useState('');

  const loadEntities = async () => {
    const { data } = await supabase.from('entities').select('id,name,entity_type,formation_state').order('created_at', { ascending: true });
    setEntities((data as Ent[]) ?? []);
  };

  const benchmark = useMemo(() => deals[0] ?? (BENCHMARK_DEAL as unknown as DealRecord), [deals]);
  const discountForPreview = form?.discountRate;
  const npvPreview = useMemo(() => {
    const r = parseFloat(String(discountForPreview));
    const discountRate = isNaN(r) ? 8 : Math.max(0, Math.min(100, r));
    try {
      const inputs = prepareEngineInputs(benchmark, { discountRate } as any);
      if (!inputs.purchasePrice) inputs.purchasePrice = 1000000;
      const res: any = calculateProjections(String(benchmark.asset_class ?? 'commercial'), inputs);
      return { npv: res.npv ?? 0, spread: (res.irr ?? 0) - discountRate };
    } catch {
      return null;
    }
  }, [discountForPreview, benchmark]);

  const createCompany = async () => {
    const name = newName.trim();
    if (!name || !form) return;
    const { data: u } = await supabase.auth.getUser();
    const { data: created } = await supabase
      .from('entities')
      .insert({ user_id: u?.user?.id, name, entity_type: newType, formation_state: newState.trim() || null, notes: 'Created via Investor Profile modal' } as any)
      .select('id,name')
      .single();
    setNewName(''); setNewState(''); setAddOpen(false);
    await loadEntities();
    if (created) setForm({ ...form, primaryEntityId: (created as any).id, companyName: name });
  };

  useEffect(() => {
    if (!isOpen) return;
    let live = true;
    setError(null);
    (async () => {
      const { data } = await supabase.auth.getUser();
      const p = await fetchProfile(supabase, data?.user);
      if (live) setForm(p);
      if (live) void loadEntities();
    })();
    return () => { live = false; };
  }, [isOpen]);

  if (!isOpen || !form) return null;

  const set = <K extends keyof InvestorProfile>(k: K, v: InvestorProfile[K]) => setForm({ ...form, [k]: v });
  const hurdle = Number(form.discountRate) || 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getUser();
      const saved = await saveProfile({
        fullName: form.fullName.trim() || 'Investor',
        discountRate: parseFloat(String(form.discountRate)) || 8.0,
        exitYear: parseInt(String(form.exitYear), 10) || 10,
        marketTier: form.marketTier,
        propertyClass: form.propertyClass,
        exitCapTiming: form.exitCapTiming,
        leaseExpiryMode: form.leaseExpiryMode,
        leaseExpiryVacancyMonths: Math.min(60, Math.max(0, parseInt(String(form.leaseExpiryVacancyMonths), 10) || 0)),
        primaryEntityId: form.primaryEntityId || null,
        companyName: form.companyName,
      }, supabase, data?.user);
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl my-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-brand-500/10 text-brand-400 flex items-center justify-center border border-brand-500/20 font-black text-base shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-extrabold text-white">Investor Profile &amp; Settings</h3>
              <p className="text-xs text-slate-400">Global underwriting benchmarks &amp; opportunity cost parameters</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white p-1 rounded-lg" aria-label="Close">✕</button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className={labelCls}>Investor / Sponsor Name</label>
              {onOpenEntities && (
                <button type="button" onClick={onOpenEntities}
                  className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 transition flex items-center space-x-1">
                  <span>🏛️ Manage LLCs &amp; Entities Portal →</span>
                </button>
              )}
            </div>
            <input type="text" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="e.g. Alex Morgan" className={inputCls} />
          </div>

          <div className="p-3.5 bg-slate-950/70 rounded-2xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Associated Companies &amp; Entities</span>
                <span className="text-xs font-bold text-slate-200">Primary Operating Entity</span>
              </div>
              <button type="button" onClick={() => setAddOpen((v) => !v)} className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 transition flex items-center space-x-1">
                <span>{addOpen ? '✕ Close' : '+ Add Another Company'}</span>
              </button>
            </div>
            <div className="space-y-1">
              <select
                value={form.primaryEntityId || entities[0]?.id || ''}
                onChange={(e) => {
                  const m = entities.find((x) => x.id === e.target.value);
                  setForm({ ...form, primaryEntityId: e.target.value || null, companyName: m?.name ?? form.companyName });
                }}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                {entities.length === 0 && <option value="">{form.companyName || 'MathTree Capital'} (Default Company)</option>}
                {entities.map((en) => (
                  <option key={en.id} value={en.id}>{en.name} ({(en.entity_type || 'llc').toUpperCase()}{en.formation_state ? ` • ${en.formation_state}` : ''})</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Active Portfolio Entities:</span>
              <div className="flex flex-wrap gap-1.5">
                {entities.length === 0 ? (
                  <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    <span>{form.companyName || 'MathTree Capital'}</span>
                    <span className="text-[9px] font-mono text-emerald-400/80 uppercase">PRIMARY</span>
                  </span>
                ) : entities.map((en) => {
                  const primary = en.id === (form.primaryEntityId || entities[0]?.id);
                  return primary ? (
                    <span key={en.id} className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      <span>{en.name}</span>
                      <span className="text-[9px] font-mono text-emerald-400/80 uppercase">PRIMARY</span>
                    </span>
                  ) : (
                    <button
                      key={en.id} type="button" title={`Click to set ${en.name} as primary entity`}
                      onClick={() => setForm({ ...form, primaryEntityId: en.id, companyName: en.name })}
                      className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-900 text-slate-300 border border-slate-800 hover:border-slate-700 hover:text-white transition cursor-pointer"
                    >
                      <span>{en.name}</span>
                      <span className="text-[9px] font-mono text-slate-500">({(en.entity_type || 'llc').toUpperCase()})</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {addOpen && (
              <div className="pt-2.5 border-t border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">Register Associated Entity</span>
                  <span className="text-[10px] text-slate-400">Dynamically tracks deal ownership</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Company Name (e.g. Transparent Glass LLC)" className="sm:col-span-6 bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500" />
                  <select value={newType} onChange={(e) => setNewType(e.target.value)} className="sm:col-span-3 bg-slate-900 border border-slate-800 rounded-xl px-2 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500">
                    <option value="llc">LLC</option>
                    <option value="series_llc">Series LLC</option>
                    <option value="lp">LP</option>
                    <option value="corporation">Corporation</option>
                    <option value="trust">Trust</option>
                    <option value="individual">Sole Prop</option>
                  </select>
                  <input type="text" value={newState} onChange={(e) => setNewState(e.target.value)} placeholder="State (e.g. WA, DE)" maxLength={2} className="sm:col-span-3 bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-white uppercase focus:outline-none focus:border-emerald-500" />
                </div>
                <div className="flex items-center justify-end space-x-2 pt-1">
                  <button type="button" onClick={() => setAddOpen(false)} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-slate-400 hover:text-white bg-slate-800 transition">Cancel</button>
                  <button type="button" onClick={createCompany} className="px-3 py-1 rounded-lg text-[11px] font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 shadow-sm transition">Add &amp; Set as Primary</button>
                </div>
              </div>
            )}
          </div>

          <div className="p-3.5 bg-slate-950/70 rounded-2xl border border-emerald-900/40 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-extrabold text-emerald-400">Target Discount Rate / Hurdle Rate (%)</label>
              <span className="text-[10px] uppercase font-bold text-emerald-500/80 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">Opportunity Cost</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Your personal required annual return. This opportunity cost rate is used to discount future cash flows into{' '}
              <strong>Net Present Value (NPV)</strong>. Deals with an IRR above this rate yield positive NPV.
            </p>
            <div className="flex items-center space-x-3 pt-1">
              <div className="relative flex-1">
                <input
                  type="number" min={0} max={50} step={0.1} required
                  value={form.discountRate}
                  onChange={(e) => set('discountRate', e.target.value as unknown as number)}
                  className="w-full bg-slate-900 border border-emerald-900/80 rounded-xl px-3 py-2 text-sm font-black text-emerald-300 focus:outline-none focus:border-emerald-400 pr-8"
                />
                <span className="absolute right-3 top-2.5 text-xs font-bold text-slate-500">%</span>
              </div>
              <div className="flex items-center space-x-1.5">
                {([[8, 'Core'], [10, 'Growth'], [12, 'Opportunistic']] as const).map(([rate, label]) => (
                  <button
                    key={label} type="button" onClick={() => set('discountRate', rate)}
                    className={`text-[11px] font-bold px-2 py-1 rounded-lg bg-slate-900 border ${hurdle === rate ? 'border-emerald-500/60 text-emerald-300' : 'border-slate-800 text-slate-300 hover:text-white hover:border-slate-700'}`}
                  >
                    {rate}% ({label})
                  </button>
                ))}
              </div>
            </div>

            {npvPreview && (
              <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between mt-2">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Benchmark Portfolio NPV</span>
                  <span className={`text-base font-black font-mono ${npvPreview.npv >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatCurrency(npvPreview.npv)}</span>
                </div>
                <div className="text-center px-2">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Hurdle Spread</span>
                  <span className={`text-xs font-bold font-mono ${npvPreview.spread >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{npvPreview.spread >= 0 ? '+' : ''}{npvPreview.spread.toFixed(1)}%</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider mb-0.5">Decision Rule</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${npvPreview.npv >= 0 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                    {npvPreview.npv >= 0 ? 'Clears Hurdle (Positive NPV)' : 'Below Hurdle (Negative NPV)'}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="p-3.5 bg-slate-950/70 rounded-2xl border border-slate-800 space-y-3">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Default Underwriting Assumptions</span>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className={labelCls}>Default Hold Period (Years)</label>
                <input type="number" min={1} max={30} step={1} required value={form.exitYear} onChange={(e) => set('exitYear', e.target.value as unknown as number)} className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className={labelCls}>Default Market Tier</label>
                <select value={form.marketTier} onChange={(e) => set('marketTier', e.target.value)} className={inputCls}>
                  <option value="Tier 1">Tier 1 • Gateway</option>
                  <option value="Tier 2">Tier 2 • Growth</option>
                  <option value="Tier 3">Tier 3 • Tertiary</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Default Exit Cap Rate Method</label>
              <div className="grid grid-cols-2 gap-2">
                {([['amortized', 'Amortize Spread'], ['day1', 'Day 1 Shift']] as const).map(([val, text]) => (
                  <label key={val} className="flex items-center space-x-2 p-2 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer">
                    <input type="radio" name="prof-exit-cap-timing" checked={form.exitCapTiming === val} onChange={() => set('exitCapTiming', val)} className="text-brand-500 focus:ring-brand-500" />
                    <span className="text-xs font-semibold text-slate-300">{text}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>When a Lease Ends Before Your Exit</label>
              <select value={form.leaseExpiryMode} onChange={(e) => set('leaseExpiryMode', e.target.value as InvestorProfile['leaseExpiryMode'])} className={inputCls}>
                <option value="renew">Keep the lease going on current terms (annual increases continue)</option>
                <option value="relet">Brief vacancy, then back to the same rent with annual increases</option>
                <option value="vacant">Pessimistic: the space stays vacant</option>
              </select>
              {form.leaseExpiryMode === 'relet' && (
                <div className="flex items-center space-x-2">
                  <label className="text-[10px] font-bold text-slate-400">Vacant months</label>
                  <input type="number" min={0} max={60} step={1} value={form.leaseExpiryVacancyMonths} onChange={(e) => set('leaseExpiryVacancyMonths', e.target.value as unknown as number)} className={`${inputCls} w-24`} />
                </div>
              )}
              <p className="text-[10px] text-slate-500 leading-relaxed">Applies to every property unless you choose differently for it in Edit Inputs (At Lease Expiration).</p>
            </div>
          </div>

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <div className="flex items-center justify-end space-x-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition">Cancel</button>
            <button type="submit" disabled={saving} className="px-5 py-2 rounded-xl text-xs font-extrabold text-white bg-gradient-to-r from-brand-600 to-emerald-500 hover:from-brand-500 hover:to-emerald-400 shadow-md shadow-emerald-500/20 transition disabled:opacity-60">
              {saving ? 'Saving…' : 'Save Preferences'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
