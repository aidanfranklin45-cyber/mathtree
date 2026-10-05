import React, { useMemo } from 'react';
import type { DealMetrics, DealRecord } from '../../lib/math/types';
import { prepareEngineInputs, resolveProfileAssumptions } from '../../lib/engine/compute';
import { useAssumptionVersion, getAssumptionDefaults } from '../../lib/engine/assumptionDefaults';
import { buildAssumptionLedger, type LedgerRow } from '../../lib/assumptions/ledger';
import { DEFAULT_CLOSING_WEEKS } from '../../../supabase/functions/_shared/underwritingAssumptions';

interface Props {
  deal: DealRecord;
  metrics: DealMetrics;
  /** Opens Edit Inputs, where a figure is changed for this property only. */
  onOpenEdit: () => void;
}

const MODE_STYLE: Record<LedgerRow['mode'], string> = {
  entered: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
  document: 'bg-violet-500/10 text-violet-300 border-violet-500/20',
  copied: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  live: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  assumed: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
};

/**
 * Every figure this property's numbers rest on, in two groups: what is specific to this property, and where your global standards are
 * doing the work. Each line says what the figure is, where it came from (and your reason, if you gave one), and what it does to this
 * property's numbers. Change any figure for this property in Edit Inputs; it then moves to the first group.
 */
export const AssumptionsLedger: React.FC<Props> = ({ deal, metrics, onOpenEdit }) => {
  const version = useAssumptionVersion(); // lines that follow your profile follow it when you change it
  const rows = useMemo(() => {
    const { filled, basis } = resolveProfileAssumptions(deal);
    return buildAssumptionLedger({
      stored: (deal.inputs ?? {}) as Record<string, any>,
      prepared: prepareEngineInputs(deal),
      filled,
      filledBasis: basis,
      assetClass: String(deal.asset_class ?? 'commercial'),
      metrics,
      assumedClosingWeeks: getAssumptionDefaults().assumptions.assumedClosingWeeks ?? DEFAULT_CLOSING_WEEKS,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal, metrics, version]);

  const project = rows.filter((r) => r.group === 'project');
  const standard = rows.filter((r) => r.group === 'standard');

  const section = (title: string, note: string, list: LedgerRow[], action: string) => (
    <section aria-label={title} className="space-y-2.5">
      <div>
        <h4 className="text-xs font-black uppercase tracking-wider text-slate-200">{title} <span className="text-slate-500 font-semibold normal-case tracking-normal">({list.length})</span></h4>
        <p className="text-[11px] text-slate-400">{note}</p>
      </div>
      {list.length === 0 ? (
        <p className="text-[11px] text-slate-500 italic">Nothing here yet.</p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {list.map((r) => (
            <li key={r.id} className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[11px] font-bold text-slate-300 block">{r.label}</span>
                  <span className="text-sm font-black text-emerald-400">{r.value}</span>
                </div>
                <button type="button" onClick={onOpenEdit} className="shrink-0 text-[10px] font-bold text-slate-400 hover:text-white px-2 py-1 rounded-lg border border-slate-800 hover:border-slate-600">{action}</button>
              </div>
              {r.effect && <p className="text-[11px] text-slate-300 leading-snug">{r.effect}</p>}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded border ${MODE_STYLE[r.mode]}`}>{r.source}</span>
                {r.reason && <span className="text-[10.5px] text-slate-500 italic">{r.reason}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="space-y-6">
      {section('Specific to this property', 'Its contract, its loan, its lease, and anything you entered or took from a document for it.', project, 'Change')}
      {section('From your global standards', 'Your underwriting standards are doing the work here. Override any of them for this property when you know better; the rest keep following your profile.', standard, 'Override')}
    </div>
  );
};
