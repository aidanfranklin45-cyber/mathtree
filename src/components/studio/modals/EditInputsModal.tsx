import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { DealInputs, DealRecord } from '../../../lib/math/types';
import type { DealTopPatch } from '../../../stores/useDealStore';
import { supabase } from '../../../lib/supabase/client';
import { AddressService } from '../../../lib/services/addressService';
import { computeDealMetrics } from '../../../lib/engine/compute';
import { formatCurrency } from '../../../lib/format';

interface EditInputsModalProps {
  isOpen: boolean;
  deal: DealRecord;
  onClose: () => void;
  /** Persist facts (inputs + top-level columns). Analysis is never stored. */
  onSave: (inputsPatch: Partial<DealInputs>, top: DealTopPatch) => Promise<boolean>;
}

import { seedForm, buildInputs, type Form } from './editInputsForm';

const label = 'text-[11px] font-bold text-slate-400';
const inp = 'w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-brand-500';
const inp2 = 'w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-brand-500';
const smallInp = 'w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-white';

const modeBtn = (active: boolean) =>
  `py-2 px-3 rounded-xl text-xs font-bold transition flex flex-col items-center justify-center border text-center ${
    active ? 'bg-brand-500/20 text-brand-300 border-brand-500/40 shadow-sm' : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
  }`;

export const EditInputsModal: React.FC<EditInputsModalProps> = ({ isOpen, deal, onClose, onSave }) => {
  const [form, setForm] = useState<Form>(() => seedForm(deal));
  const [entities, setEntities] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [addrResults, setAddrResults] = useState<any[]>([]);
  const addrTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!isOpen) return;
    setForm(seedForm(deal));
    setAddrResults([]);
    supabase.from('entities').select('id,name').order('name').then(({ data }) => setEntities((data as any[]) ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, deal.id]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const asset = String(deal.asset_class ?? 'commercial');

  const built = useMemo(() => buildInputs(form, deal), [form, deal]);

  // Live pro-forma: derived on demand by the shared engine, never stored.
  const preview = useMemo(() => {
    const price = parseFloat(form.price) || 0;
    const down = isNaN(parseFloat(form.downPayment)) ? 25 : Math.max(0, Math.min(100, parseFloat(form.downPayment)));
    const rehab = parseFloat(form.rehabCosts) || 0;
    const closing = parseFloat(form.closingCosts) || 0;
    const rolled = form.rehabMode === 'roll_into_loan';
    const basis = rolled ? price + rehab + closing : price;
    const downAmt = Math.round(basis * (down / 100));
    const loan = rolled ? Math.round(basis - downAmt) : Math.round(price * ((100 - down) / 100));
    const equity = rolled ? downAmt : Math.round(downAmt + rehab + closing);
    const ltv = price > 0 ? (loan / price) * 100 : 100 - down;
    let cf: number | null = null;
    let npv: number | null = null;
    try {
      const inputs: Record<string, any> = { ...built };
      if (inputs.grossRentAnnual === 0 || inputs.monthlyRent === 0) inputs.leases = [];
      const m: any = computeDealMetrics({ asset_class: deal.asset_class, inputs: { ...deal.inputs, ...inputs } as DealInputs });
      cf = m.projections?.[0]?.cashFlow ?? 0;
      npv = m.npv ?? 0;
    } catch {
      /* incomplete form: show the static part only */
    }
    return { ltv, loan, equity, cf, npv };
  }, [form, built, deal]);

  const onLocation = (val: string) => {
    set('location', val);
    clearTimeout(addrTimer.current);
    if (!val || val.length < 2) return setAddrResults([]);
    addrTimer.current = setTimeout(async () => {
      try {
        setAddrResults((await AddressService.searchAddresses(val)) || []);
      } catch {
        setAddrResults([]);
      }
    }, 250);
  };

  const gisBadge = /spokane/i.test(form.location)
    ? '🏛️ Spokane County GIS'
    : /yakima|selah|union gap|sunnyside|toppenish|wapato|zillah/i.test(form.location)
      ? '🏛️ Yakima GIS'
      : '🏛️ Live County GIS';

  if (!isOpen) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const patch: Record<string, any> = { ...built, entity_id: form.entity || null };
    const name = form.name.trim() || 'Underwriting Project';

    // In-place lease terms
    const monthlyRent = built.monthlyRent || built.grossRentPerMonth || 0;
    patch.tenantName = form.tenantName.trim() || name;
    patch.leaseStartDate = form.leaseStart || built.closingDate || '';
    patch.leaseEndDate = form.leaseEnd || '';
    const existingLease = (Array.isArray((deal.inputs as any)?.leases) && (deal.inputs as any).leases[0]) || {};
    const numOr = (v: string, fb: number) => { const n = parseFloat(v); return isNaN(n) ? fb : n; };
    // This form edits the primary (first) lease; any other leases on the deal (e.g. an earlier intercompany rent period) are kept as they are
    const otherLeases = Array.isArray((deal.inputs as any)?.leases) ? (deal.inputs as any).leases.slice(1) : [];
    patch.leases = monthlyRent > 0
      ? [{
          ...existingLease,
          paymentDueDay: Math.min(31, Math.max(1, parseInt(form.dueDay, 10) || 1)),
          gracePeriodDays: Math.min(60, Math.max(0, parseInt(form.graceDays, 10) || 0)),
          // Blank = use the investor default from the profile; an explicit choice is stored on this lease
          expiryAssumption: form.expiryAssumption || undefined,
          expirySource: undefined,
          // Only the details that belong to the chosen assumption are stored (the default carries its own)
          extensionYears: form.expiryAssumption === 'extend' ? numOr(form.extensionYears, 5) : undefined,
          extensionRentChangePct: form.expiryAssumption === 'extend' || form.expiryAssumption === 'renew' ? numOr(form.extensionRentChangePct, 0) : undefined,
          reletVacancyMonths: form.expiryAssumption === 'relet' ? numOr(form.reletVacancyMonths, 12) : undefined,
          reletRentChangePct: form.expiryAssumption === 'relet' ? numOr(form.reletRentChangePct, 0) : undefined,
          reletCosts: form.expiryAssumption === 'relet' ? numOr(form.reletCosts, 0) : undefined,
          tenantName: patch.tenantName,
          monthlyRent,
          annualRent: monthlyRent * 12,
          leaseStartDate: patch.leaseStartDate,
          leaseEndDate: patch.leaseEndDate,
          leaseType: built.leaseType || 'NNN',
          escalationType: form.escalationType || 'Percentage Bump (%)',
          escalationRate: built.rentGrowth || 3.0,
          escalationFrequency: 'Annual on Anniversary',
          nextEscalationDate: form.nextEscalation,
          is_active: true,
        }, ...otherLeases]
      : [];

    const ok = await onSave(patch as Partial<DealInputs>, {
      title: name,
      location: form.location.trim() || deal.location,
      status: form.status,
      entity_id: form.entity || null,
      purchase_price: built.purchasePrice,
    });
    setSaving(false);
    if (ok) onClose();
  };

  const modeBadge = form.rehabMode === 'roll_into_loan'
    ? <span className="text-[10px] font-semibold text-sky-400">Financed in Loan</span>
    : <span className="text-[10px] font-semibold text-emerald-400">Out of Pocket</span>;

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl max-w-2xl w-full p-4 sm:p-6 space-y-4 shadow-2xl my-2 sm:my-6 max-h-[96vh] sm:max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-brand-500/10 text-brand-400 flex items-center justify-center border border-brand-500/20 font-black text-base shrink-0">✎</div>
            <div>
              <h3 className="text-base font-extrabold text-white">Edit Project Inputs</h3>
              <p className="text-xs text-slate-400">{asset.toUpperCase().replace('-', ' ')} • Comprehensive Baseline Underwriting Parameters</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-white p-1 rounded-lg">✕</button>
        </div>

        <form noValidate onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={label}>Project Name</label>
              <input type="text" required value={form.name} onChange={(e) => set('name', e.target.value)} className={inp} />
            </div>
            <div className="space-y-1 relative">
              <div className="flex items-center justify-between">
                <label className={label}>Location / Street Address</label>
                <span className="text-[9px] text-emerald-400 font-semibold">{gisBadge}</span>
              </div>
              <input type="text" autoComplete="off" required value={form.location} onChange={(e) => onLocation(e.target.value)} className={inp} />
              {addrResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 max-h-52 overflow-y-auto">
                  {addrResults.map((item, idx) => {
                    const isYakima = item.isYakimaCounty || /yakima/i.test(item.county || '');
                    const isSpokane = item.isSpokaneCounty || /spokane/i.test(item.county || '');
                    const raw = (item.county || (isYakima ? 'Yakima' : isSpokane ? 'Spokane' : '')).replace(/\s*County/i, '').trim();
                    const countyLabel = raw ? `${raw} County` : '';
                    return (
                      <div
                        key={idx}
                        onClick={() => { set('location', item.formattedAddress); setAddrResults([]); }}
                        className="p-2.5 hover:bg-slate-800/80 cursor-pointer border-b border-slate-800/60 last:border-0 transition text-left"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white">{item.street || item.formattedAddress}</span>
                          {item.apn ? (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">🏛️ {countyLabel ? `${countyLabel} ` : ''}APN: {item.apn}</span>
                          ) : countyLabel ? (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-brand-500/10 text-brand-400 border border-brand-500/20">📍 {countyLabel} • Geocoded</span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-800 text-slate-400">OpenStreetMap</span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400">{item.formattedAddress}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className={label}>Portfolio Status</label>
              <select value={form.status} onChange={(e) => set('status', e.target.value)} className={inp}>
                <option value="prospect">Pipeline Prospect</option>
                <option value="owned">Owned Portfolio Asset</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className={label}>Ownership Entity</label>
              <select value={form.entity} onChange={(e) => set('entity', e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-emerald-400 font-semibold focus:outline-none focus:border-brand-500">
                <option value="">No Entity (Unassigned)</option>
                {entities.map((en) => <option key={en.id} value={en.id}>{en.name || 'Unnamed Entity'}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className={label}>Acquisition Price ($)</label>
              <input type="number" required min="0" step="any" value={form.price} onChange={(e) => set('price', e.target.value)} className={inp} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className={label}>Market Tier</label>
              <select value={form.marketTier} onChange={(e) => set('marketTier', e.target.value)} className={inp}>
                <option value="Tier 1">Tier 1 • Gateway</option>
                <option value="Tier 2">Tier 2 • Growth</option>
                <option value="Tier 3">Tier 3 • Tertiary</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className={label}>Property Class</label>
              <select value={form.propertyClass} onChange={(e) => set('propertyClass', e.target.value)} className={inp}>
                <option value="Class A">Class A (Trophy/Spec)</option>
                <option value="Class B">Class B (Value-Add)</option>
                <option value="Class C">Class C (Workforce)</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className={label}>Facility Sub-Type</label>
              <input type="text" placeholder="e.g. Industrial Warehouse" value={form.facilityType} onChange={(e) => set('facilityType', e.target.value)} className={inp} />
            </div>
          </div>

          <div className="p-3.5 bg-slate-950/60 rounded-2xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Revenue, Vacancy & Market Dynamics</span>
              <span className="text-[10px] text-slate-500 italic">Live dynamic projection drivers</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className={label}>Annual Gross Rent ($) <span className="text-slate-600 font-normal">(Commercial)</span></label>
                <input type="number" min="0" step="any" value={form.grossRentAnnual} onChange={(e) => set('grossRentAnnual', e.target.value)} className={inp2} />
              </div>
              <div className="space-y-1">
                <label className={label}>Monthly Rent / Unit ($) <span className="text-slate-600 font-normal">(SFR · Multi · Storage)</span></label>
                <input type="number" min="0" step="any" value={form.grossRentMonthly} onChange={(e) => set('grossRentMonthly', e.target.value)} className={inp2} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 pt-1 border-t border-slate-900">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-amber-400">Vacancy Rate (%)</label>
                <input type="number" min="0" max="100" step="any" placeholder="5" value={form.vacancyRate} onChange={(e) => set('vacancyRate', e.target.value)} className={inp2} />
              </div>
              <div className="space-y-1">
                <label className={label}>Annual Rent Growth (%)</label>
                <input type="number" min="-10" max="30" step="any" placeholder="3" value={form.rentGrowth} onChange={(e) => set('rentGrowth', e.target.value)} className={inp2} />
              </div>
              <div className="space-y-1">
                <label className={label}>Appreciation / Exit Cap (%)</label>
                <input type="number" min="0" max="30" step="any" placeholder="3.5" value={form.appreciation} onChange={(e) => set('appreciation', e.target.value)} className={inp2} />
              </div>
            </div>
          </div>

          <div className="p-3.5 bg-slate-950/60 rounded-2xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Operating Expenses &amp; Underwriting Assumptions</span>
              <span className="text-[10px] text-slate-500 italic">OER, management &amp; hold parameters</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <div className="space-y-1">
                <label className={label}>Expense Ratio (%)</label>
                <input type="number" min="0" max="100" step="any" value={form.opexRatio} onChange={(e) => set('opexRatio', e.target.value)} className={inp2} />
              </div>
              <div className="space-y-1">
                <label className={label}>Property Management</label>
                <label className="flex items-center space-x-2.5 cursor-pointer bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 hover:border-slate-700 transition h-[34px]" title="Include professional property management fees">
                  <input type="checkbox" checked={form.manageProperty === 'true'} onChange={(e) => set('manageProperty', String(e.target.checked))} className="w-4 h-4 rounded text-brand-500 bg-slate-950 border-slate-800 focus:ring-brand-500 cursor-pointer" />
                  <span className="text-xs font-semibold text-slate-200">Hire Property Management Company</span>
                </label>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2.5 border-t border-slate-900">
              <div className="space-y-1">
                <label className={label}>Rehab Budget ($)</label>
                <input type="number" min="0" step="any" placeholder="0" value={form.rehabCosts} onChange={(e) => set('rehabCosts', e.target.value)} className={inp2} />
              </div>
              <div className="space-y-1">
                <label className={label}>Closing Costs ($)</label>
                <input type="number" min="0" step="any" placeholder="0" value={form.closingCosts} onChange={(e) => set('closingCosts', e.target.value)} className={inp2} />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-emerald-400" title="Closing Date for debt amortization and pro-forma commencement">Closing Date</label>
                <input type="date" value={form.closingDate} onChange={(e) => set('closingDate', e.target.value)} className="w-full bg-slate-900 border border-emerald-900/60 rounded-xl px-2 py-2 text-xs text-emerald-200 focus:outline-none focus:border-emerald-400" />
              </div>
              <div className="space-y-1">
                <label className={label}>Exit Year (Hold)</label>
                <input type="number" min="1" max="30" step="1" placeholder="10" value={form.exitYear} onChange={(e) => set('exitYear', e.target.value)} className={inp2} />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-emerald-400" title="Investor Opportunity Cost / Hurdle Rate for NPV">Discount Rate (%)</label>
                <input type="number" min="0" max="50" step="any" placeholder="8" value={form.discountRate} onChange={(e) => set('discountRate', e.target.value)} className="w-full bg-slate-900 border border-emerald-900/60 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-400" />
              </div>
            </div>
          </div>

          <div className="p-3 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-300">Remodel &amp; Closing Costs Financing Structure</label>
              {modeBadge}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => set('rehabMode', 'out_of_pocket')} className={modeBtn(form.rehabMode !== 'roll_into_loan')}>
                <span>Out of Pocket (Capital Outlay)</span>
                <span className="text-[10px] font-normal text-slate-400 mt-0.5">Rehab &amp; closing added to initial equity</span>
              </button>
              <button type="button" onClick={() => set('rehabMode', 'roll_into_loan')} className={modeBtn(form.rehabMode === 'roll_into_loan')}>
                <span>Roll into Financing Package</span>
                <span className="text-[10px] font-normal text-slate-500 mt-0.5">Rehab &amp; closing rolled into senior loan</span>
              </button>
            </div>
          </div>

          <div className="p-3 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-300">Exit Cap Rate Calculation Method</label>
              <span className="text-[10px] font-semibold text-emerald-400">{form.exitCapTiming === 'day1' ? 'Day 1 Shift' : 'Amortized Over Hold Period'}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => set('exitCapTiming', 'amortized')} className={modeBtn(form.exitCapTiming !== 'day1')}>
                <span>Amortize Spread</span>
                <span className="text-[10px] font-normal text-slate-400">Amortize spread over hold period</span>
              </button>
              <button type="button" onClick={() => set('exitCapTiming', 'day1')} className={modeBtn(form.exitCapTiming === 'day1')}>
                <span>Day 1 Shift</span>
                <span className="text-[10px] font-normal text-slate-500">Force spread onto Day 1</span>
              </button>
            </div>
          </div>

          <div className="p-3.5 bg-slate-950/60 rounded-2xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Debt & Financing Parameters</span>
              <div className="flex items-center space-x-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Structure:</label>
                <select value={form.financingType} onChange={(e) => set('financingType', e.target.value)} className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-0.5 text-xs font-semibold text-white">
                  <option value="fixed">Traditional Fixed-Rate</option>
                  <option value="arm">Adjustable-Rate (ARM)</option>
                  <option value="interest_only">Interest-Only (I/O)</option>
                  <option value="bridge">Bridge / Hard Money</option>
                  <option value="seller_financing">Seller Financing</option>
                </select>
              </div>
            </div>

            {form.financingType === 'arm' && (
              <div className="grid grid-cols-3 gap-2 p-2.5 bg-slate-900/60 border border-slate-800 rounded-xl">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400">Fixed Yrs</label>
                  <input type="number" min="1" max="10" value={form.armInitial} onChange={(e) => set('armInitial', e.target.value)} className={smallInp} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400">Reset Rate %</label>
                  <input type="number" step="0.125" value={form.armRate} onChange={(e) => set('armRate', e.target.value)} className={smallInp} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400">Rate Cap %</label>
                  <input type="number" step="0.125" value={form.armCap} onChange={(e) => set('armCap', e.target.value)} className={smallInp} />
                </div>
              </div>
            )}
            {form.financingType === 'interest_only' && (
              <div className="p-2.5 bg-slate-900/60 border border-slate-800 rounded-xl">
                <div className="space-y-1 max-w-xs">
                  <label className="text-[10px] font-bold text-slate-400">Interest-Only Period (Years)</label>
                  <input type="number" min="1" max="10" value={form.ioYears} onChange={(e) => set('ioYears', e.target.value)} className={smallInp} />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className={label}>Down Payment (%)</label>
                <input type="number" min="0" max="100" step="any" value={form.downPayment} onChange={(e) => set('downPayment', e.target.value)} className={inp2} />
              </div>
              <div className="space-y-1">
                <label className={label}>Interest Rate (%)</label>
                <input type="number" min="0" max="30" step="any" value={form.interestRate} onChange={(e) => set('interestRate', e.target.value)} className={inp2} />
              </div>
              <div className="space-y-1">
                <label className={label}>Loan Term (Yrs)</label>
                <input type="number" min="1" max="50" step="any" value={form.loanTerm} onChange={(e) => set('loanTerm', e.target.value)} className={inp2} />
              </div>
            </div>
          </div>

          <div className="p-3 bg-slate-950/60 rounded-xl border border-emerald-900/40 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-400">📑 In-Place Lease & Tenant Terms</span>
              <span className="text-[10px] text-slate-400">Live Postgres Sync</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className={label}>Primary Lease Structure</label>
                <select value={form.leaseType} onChange={(e) => set('leaseType', e.target.value)} className={`${inp2} font-bold`}>
                  <option value="Gross">Full Service Gross</option>
                  <option value="Modified Gross">Modified Gross</option>
                  <option value="NNN">Triple Net (NNN)</option>
                  <option value="Absolute Net">Absolute Net (Bond Lease)</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className={label}>Tenant of Record</label>
                <input type="text" placeholder="e.g. In-Place Commercial Tenant" value={form.tenantName} onChange={(e) => set('tenantName', e.target.value)} className={inp2} />
              </div>
              <div className="space-y-1">
                <label className={label}>Lease Commencement</label>
                <input type="date" value={form.leaseStart} onChange={(e) => set('leaseStart', e.target.value)} className={inp2} />
              </div>
              <div className="space-y-1">
                <label className={label}>Lease Expiration</label>
                <input type="date" value={form.leaseEnd} onChange={(e) => set('leaseEnd', e.target.value)} className={inp2} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className={label}>Escalation Mechanism</label>
                <select value={form.escalationType} onChange={(e) => set('escalationType', e.target.value)} className={inp2}>
                  <option value="Percentage Bump (%)">Percentage Bump (%)</option>
                  <option value="Fixed Dollar ($)">Fixed Dollar ($)</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className={label}>Next Escalation Date</label>
                <input type="date" value={form.nextEscalation} onChange={(e) => set('nextEscalation', e.target.value)} className={inp2} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className={label}>Rent Due Day of Month</label>
                <input type="number" min="1" max="31" step="1" value={form.dueDay} onChange={(e) => set('dueDay', e.target.value)} className={inp2} />
              </div>
              <div className="space-y-1">
                <label className={label}>Grace Period (days)</label>
                <input type="number" min="0" max="60" step="1" value={form.graceDays} onChange={(e) => set('graceDays', e.target.value)} className={inp2} />
              </div>
            </div>

            <div className="pt-2.5 border-t border-emerald-900/30 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className={label}>At Lease Expiration</label>
                <span className="text-[10px] text-slate-500 italic">Income after the lease end date</span>
              </div>
              <select value={form.expiryAssumption} onChange={(e) => set('expiryAssumption', e.target.value)} className={`${inp2} font-bold`}>
                <option value="">Use my default (set in Profile)</option>
                <option value="renew">Keep going on current terms (annual increases continue)</option>
                <option value="relet">Vacancy while re-leasing, then new tenant</option>
                <option value="extend">Tenant exercises a fixed-length extension option</option>
                <option value="vacant">Pessimistic: the space stays vacant</option>
              </select>
              {form.expiryAssumption === 'extend' && (
                <div className="grid grid-cols-2 gap-3 p-2.5 bg-slate-900/60 border border-slate-800 rounded-xl">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400">Extension Term (Years)</label>
                    <input type="number" min="1" step="1" value={form.extensionYears} onChange={(e) => set('extensionYears', e.target.value)} className={smallInp} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400">Rent Change at Renewal (%)</label>
                    <input type="number" step="any" value={form.extensionRentChangePct} onChange={(e) => set('extensionRentChangePct', e.target.value)} className={smallInp} />
                  </div>
                </div>
              )}
              {form.expiryAssumption === 'relet' && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-2.5 bg-slate-900/60 border border-slate-800 rounded-xl">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400">Vacant Months</label>
                    <input type="number" min="0" step="1" value={form.reletVacancyMonths} onChange={(e) => set('reletVacancyMonths', e.target.value)} className={smallInp} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400">New Rent vs Expiring (%)</label>
                    <input type="number" step="any" value={form.reletRentChangePct} onChange={(e) => set('reletRentChangePct', e.target.value)} className={smallInp} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400">Leasing Costs ($)</label>
                    <input type="number" min="0" step="any" value={form.reletCosts} onChange={(e) => set('reletCosts', e.target.value)} className={smallInp} />
                  </div>
                  <p className="sm:col-span-3 text-[10px] text-slate-500 leading-relaxed">During vacancy you carry taxes, insurance and upkeep. The new tenant starts at the expiring rent adjusted by the percentage, then escalates annually. Leasing costs (commission, tenant improvements) are charged when the new lease starts.</p>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            {asset === 'commercial' && (
              <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-800/80">
                <div className="space-y-1">
                  <label className={label}>Gross Leasable Area (Sq Ft GLA)</label>
                  <input type="number" placeholder="15000" value={form.gla} onChange={(e) => set('gla', e.target.value)} className={inp2} />
                </div>
              </div>
            )}
            {asset === 'multi-unit' && (
              <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-800/80">
                <div className="space-y-1 max-w-xs">
                  <label className={label}>Total Apartment Units</label>
                  <input type="number" min="1" placeholder="4" value={form.unitCount} onChange={(e) => set('unitCount', e.target.value)} className={inp2} />
                </div>
              </div>
            )}
            {asset === 'storage' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-slate-950/40 rounded-xl border border-slate-800/80">
                <div className="space-y-1">
                  <label className={label}>Total Storage Units</label>
                  <input type="number" min="1" placeholder="100" value={form.storageUnits} onChange={(e) => set('storageUnits', e.target.value)} className={inp2} />
                </div>
                <div className="space-y-1">
                  <label className={label}>Facility Sq Ft</label>
                  <input type="number" placeholder="12000" value={form.storageSqft} onChange={(e) => set('storageSqft', e.target.value)} className={inp2} />
                </div>
                <div className="space-y-1 flex items-center pt-5">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input type="checkbox" checked={form.storageAutomated === 'true'} onChange={(e) => set('storageAutomated', String(e.target.checked))} className="w-4 h-4 rounded text-brand-500 bg-slate-900 border-slate-800 focus:ring-brand-500 cursor-pointer" />
                    <span className="text-xs font-semibold text-slate-300">Automated Facility</span>
                  </label>
                </div>
              </div>
            )}
            {asset === 'single-family' && (
              <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-800/80">
                <div className="space-y-1 max-w-xs">
                  <label className={label}>After Repair Value (ARV $)</label>
                  <input type="number" min="0" placeholder="Optional ARV" value={form.arv} onChange={(e) => set('arv', e.target.value)} className={inp2} />
                </div>
              </div>
            )}
          </div>

          <div className="px-4 py-3 bg-slate-950/80 border border-emerald-900/50 rounded-2xl flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
            <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Live Pro-Forma:</span>
            <div className="flex items-center flex-wrap gap-3 font-mono text-[11px]">
              <span>LTV: <strong className="text-emerald-400 font-bold">{preview.ltv.toFixed(1)}%</strong></span>
              <span className="text-slate-700">•</span>
              <span>Loan: <strong className="text-slate-100 font-bold">{formatCurrency(preview.loan)}</strong></span>
              <span className="text-slate-700">•</span>
              <span>Equity: <strong className="text-brand-400 font-bold">{formatCurrency(preview.equity)}</strong></span>
              <span className="text-slate-700">•</span>
              <span>Net Cash Flow: <strong className={preview.cf !== null && preview.cf < 0 ? 'text-rose-400 font-bold' : 'text-accent-cyan font-bold'}>{preview.cf === null ? '—' : `${formatCurrency(preview.cf)}/yr`}</strong></span>
              <span className="text-slate-700">•</span>
              <span>NPV: <strong className={preview.npv !== null && preview.npv < 0 ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>{preview.npv === null ? '—' : formatCurrency(preview.npv)}</strong></span>
            </div>
          </div>

          <div className="flex items-center space-x-3 pt-3 border-t border-slate-800">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-xs font-bold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-xl text-xs font-extrabold text-white bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 shadow-lg shadow-emerald-500/20 transition disabled:opacity-60">
              {saving ? 'Saving…' : 'Save & Recalculate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
