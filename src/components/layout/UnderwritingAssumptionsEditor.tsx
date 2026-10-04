import React, { useState } from 'react';
import {
  ASSET_KEYS, FIELD_SPECS, type AssetKey, type AssetAssumptions, type AssumptionField, type CapexBasis, type UnderwritingAssumptions,
} from '../../../supabase/functions/_shared/underwritingAssumptions';

interface Props {
  value: UnderwritingAssumptions;
  onChange: (next: UnderwritingAssumptions) => void;
}

const ASSET_LABEL: Record<AssetKey, string> = { 'single-family': 'Single-family', 'multi-unit': 'Multi-unit', commercial: 'Commercial', storage: 'Storage' };
const CAPEX_LABEL: Record<CapexBasis, string> = { perUnit: '$ per unit a year', perSqFt: '$ per sq ft a year', percentOfIncome: '% of income' };

const inputCls = 'w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-brand-500';
const labelCls = 'text-[11px] font-bold text-slate-400';

/**
 * The owner's underwriting assumptions, per asset class. These are the only defaults in the product: a new deal is seeded from them,
 * and each figure keeps the reason written here so it can be shown to a lender. A blank field means "no assumption": a deal then
 * asks for that figure instead of guessing.
 */
export const UnderwritingAssumptionsEditor: React.FC<Props> = ({ value, onChange }) => {
  const [asset, setAsset] = useState<AssetKey>('multi-unit');
  const current: AssetAssumptions = value.assets?.[asset] ?? {};

  const writeAsset = (next: AssetAssumptions) => onChange({ ...value, assets: { ...value.assets, [asset]: next } });

  const setNumber = (field: AssumptionField, raw: string) => {
    const next: AssetAssumptions = { ...current };
    // A half-typed number is kept as typed until it parses; an emptied field removes the assumption (and its reason with it)
    if (raw.trim() === '') {
      delete (next as Record<string, unknown>)[field];
      if (next.rationale) { const r = { ...next.rationale }; delete r[field]; next.rationale = r; }
    } else {
      (next as Record<string, unknown>)[field] = raw as unknown as number;
    }
    writeAsset(next);
  };

  const setWhy = (field: AssumptionField, why: string) => writeAsset({ ...current, rationale: { ...current.rationale, [field]: why } });

  const specs = FIELD_SPECS.filter((s) => s.assets.includes(asset));
  const get = (f: AssumptionField): string => {
    const v = (current as Record<string, unknown>)[f];
    return v === undefined || v === null ? '' : String(v);
  };

  return (
    <div className="p-3.5 bg-slate-950/70 rounded-2xl border border-slate-800 space-y-3">
      <div>
        <span className="text-[10px] uppercase font-bold text-slate-400 block">My Underwriting Assumptions</span>
        <p className="text-[11px] text-slate-400 leading-relaxed mt-1">
          These seed every new deal and are copied onto it with your reason, so each number can be defended to a lender. Leave a field
          blank if you have no assumption: the deal will ask for it rather than guess.
        </p>
      </div>

      <div className="space-y-1">
        <label className={labelCls}>Marginal income tax rate (%)</label>
        <div className="grid grid-cols-3 gap-2">
          <input
            type="number" min={0} max={70} step={0.1} aria-label="Marginal tax rate"
            value={value.taxRate === undefined ? '' : String(value.taxRate)}
            onChange={(e) => {
              const next = { ...value };
              if (e.target.value.trim() === '') { delete next.taxRate; delete next.taxRateRationale; } else next.taxRate = e.target.value as unknown as number;
              onChange(next);
            }}
            className={inputCls}
          />
          <input
            type="text" placeholder="Reason" aria-label="Reason for tax rate" maxLength={500}
            value={value.taxRateRationale ?? ''} onChange={(e) => onChange({ ...value, taxRateRationale: e.target.value })}
            className={`${inputCls} col-span-2`}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className={labelCls} title="From the levy rates your county publishes for the tax code area. County records give the assessed value but not the bill.">Property tax rate (% of assessed value)</label>
        <div className="grid grid-cols-3 gap-2">
          <input
            type="number" min={0} max={10} step="any" aria-label="Property tax rate"
            value={value.propertyTaxRatePercent === undefined ? '' : String(value.propertyTaxRatePercent)}
            onChange={(e) => {
              const next = { ...value };
              if (e.target.value.trim() === '') { delete next.propertyTaxRatePercent; delete next.propertyTaxRateRationale; } else next.propertyTaxRatePercent = e.target.value as unknown as number;
              onChange(next);
            }}
            className={inputCls}
          />
          <input
            type="text" placeholder="Reason (e.g. county levy, tax code area, year)" aria-label="Reason for property tax rate" maxLength={500}
            value={value.propertyTaxRateRationale ?? ''} onChange={(e) => onChange({ ...value, propertyTaxRateRationale: e.target.value })}
            className={`${inputCls} col-span-2`}
          />
        </div>
      </div>

      <div role="tablist" className="grid grid-cols-4 gap-1.5">
        {ASSET_KEYS.map((k) => (
          <button
            key={k} type="button" role="tab" aria-selected={asset === k} onClick={() => setAsset(k)}
            className={`text-[11px] font-bold px-2 py-1.5 rounded-lg border ${asset === k ? 'bg-brand-500/20 text-brand-300 border-brand-500/40' : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'}`}
          >
            {ASSET_LABEL[k]}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {specs.map((s) => (
          <div key={s.key} className="space-y-1">
            <label className={labelCls} title={s.hint}>
              {s.label} {s.key === 'capexValue' ? '' : `(${s.unit})`}
            </label>
            <div className="grid grid-cols-3 gap-2">
              <div className="flex gap-1.5">
                <input
                  type="number" step="any" min={s.min} max={s.max} aria-label={s.label}
                  value={get(s.key)} onChange={(e) => setNumber(s.key, e.target.value)} className={inputCls}
                />
                {s.key === 'capexValue' && (
                  <select
                    aria-label="Reserve basis" value={current.capexBasis ?? ''}
                    onChange={(e) => writeAsset({ ...current, capexBasis: (e.target.value || undefined) as CapexBasis | undefined })}
                    className={`${inputCls} w-24`}
                  >
                    <option value="">Basis</option>
                    {(Object.keys(CAPEX_LABEL) as CapexBasis[]).map((b) => <option key={b} value={b}>{CAPEX_LABEL[b]}</option>)}
                  </select>
                )}
              </div>
              <input
                type="text" placeholder="Why this number" aria-label={`Reason for ${s.label}`} maxLength={500}
                disabled={get(s.key) === ''} value={current.rationale?.[s.key] ?? ''} onChange={(e) => setWhy(s.key, e.target.value)}
                className={`${inputCls} col-span-2 disabled:opacity-40`}
              />
            </div>
            <p className="text-[10px] text-slate-500 leading-snug">{s.hint}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
