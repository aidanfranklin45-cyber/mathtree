import React, { useMemo, useState } from 'react';
import type { Row } from '../../lib/operations/rentRoll';
import { buildExpiryLadder, type ExpiryBucket } from '../../lib/operations/leaseExpiry';

interface Props {
  leases: Row[];
  sqftOf: (lease: Row) => number;
  dealTitle: (dealId: string) => string;
  onSelect: (leaseId: string) => void;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const pct = (n: number) => `${n < 10 && n > 0 ? n.toFixed(1) : Math.round(n)}%`;
const yrs = (n: number | null) => (n === null ? '—' : `${n.toFixed(1)} yrs`);
const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** Holdover and month to month are rent that can leave any time; this year and next are the near-term rollover. */
const toneOf = (b: ExpiryBucket, thisYear: number): { bar: string; text: string } => {
  if (b.key === 'holdover') return { bar: 'bg-rose-500/70', text: 'text-rose-300' };
  if (b.key === 'mtm') return { bar: 'bg-amber-400/70', text: 'text-amber-300' };
  const y = Number(b.key);
  if (!Number.isNaN(y) && y <= thisYear + 1) return { bar: 'bg-amber-400/50', text: 'text-amber-200' };
  return { bar: 'bg-emerald-500/60', text: 'text-slate-200' };
};

/** Lease-expiry ladder across tenants: rent rolling each year and the weighted-average lease term. Collapsed by default. */
export const LeaseExpiryLadder: React.FC<Props> = ({ leases, sqftOf, dealTitle, onSelect }) => {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const ladder = useMemo(() => buildExpiryLadder(leases, { sqftOf }), [leases, sqftOf]);
  const thisYear = new Date().getFullYear();
  const showSqft = ladder.buckets.some((b) => b.sqft > 0);
  const maxPct = Math.max(1, ...ladder.buckets.map((b) => b.rentPct));
  const near = ladder.buckets.filter((b) => b.key === 'holdover' || b.key === 'mtm' || b.key === String(thisYear) || b.key === String(thisYear + 1));
  const nearPct = near.reduce((s, b) => s + b.rentPct, 0);

  return (
    <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-800/30 transition">
        <div>
          <h3 className="text-sm font-extrabold text-white">Lease expiries</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {ladder.leaseCount === 0 ? 'No leases in force in this view.' : (
              <>
                WALT <span className="font-mono font-bold text-white">{yrs(ladder.waltByRent)}</span> by rent
                {ladder.waltBySqft !== null && <> · <span className="font-mono font-bold text-white">{yrs(ladder.waltBySqft)}</span> by area</>}
                {' · '}<span className={`font-mono font-bold ${nearPct > 0 ? 'text-amber-300' : 'text-emerald-400'}`}>{pct(nearPct)}</span> of rent can roll by end of {thisYear + 1}
              </>
            )}
          </p>
        </div>
        <span className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && ladder.leaseCount > 0 && (
        <div className="border-t border-slate-800 overflow-x-auto">
          <p className="px-5 pt-3 text-[11px] text-slate-500">
            Leases in force today, by the year they end. WALT is the average time left on the leases, weighted by monthly rent
            {ladder.waltBySqft !== null ? ' or by square feet' : ''}; month to month and past-end-date leases count as zero.
            {ladder.nextExpiry && <> Next to end: <span className="text-slate-300 font-semibold">{ladder.nextExpiry.tenant}</span> on {longDate(ladder.nextExpiry.endDate!)}.</>}
          </p>
          <table className="w-full text-left border-collapse text-xs mt-2">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] font-extrabold uppercase tracking-wider text-slate-400 bg-slate-950/50">
                <th className="py-3 px-4">Ends</th>
                <th className="py-3 px-4 text-right">Leases</th>
                <th className="py-3 px-4 text-right">Rent /mo</th>
                {showSqft && <th className="py-3 px-4 text-right">Sq ft</th>}
                <th className="hidden sm:table-cell py-3 px-4 w-1/3">Share of rent</th>
                <th className="hidden sm:table-cell py-3 px-4 text-right">Cumulative</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {ladder.buckets.map((b) => {
                const tone = toneOf(b, thisYear);
                const isOpen = expanded === b.key;
                const empty = b.leases.length === 0;
                return (
                  <React.Fragment key={b.key}>
                    <tr
                      onClick={empty ? undefined : () => setExpanded(isOpen ? null : b.key)}
                      className={empty ? 'text-slate-600' : 'hover:bg-slate-800/40 transition cursor-pointer'}
                      aria-expanded={empty ? undefined : isOpen}
                    >
                      <td className={`py-2.5 px-4 font-bold ${empty ? '' : tone.text}`}>
                        {!empty && <span className={`inline-block mr-1.5 text-slate-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}>▸</span>}
                        {b.label}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono">{empty ? '—' : b.leases.length}</td>
                      <td className={`py-2.5 px-4 text-right font-mono ${empty ? '' : 'font-bold text-white'}`}>{empty ? '—' : usd(b.monthlyRent)}</td>
                      {showSqft && <td className="py-2.5 px-4 text-right font-mono">{b.sqft > 0 ? Math.round(b.sqft).toLocaleString() : '—'}</td>}
                      <td className="hidden sm:table-cell py-2.5 px-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
                            <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${(b.rentPct / maxPct) * 100}%` }} />
                          </div>
                          <span className="w-10 text-right font-mono text-slate-300">{empty ? '' : pct(b.rentPct)}</span>
                        </div>
                      </td>
                      <td className="hidden sm:table-cell py-2.5 px-4 text-right font-mono text-slate-400">{pct(b.cumulativeRentPct)}</td>
                    </tr>
                    {isOpen && b.leases.map((l) => (
                      <tr key={l.id} onClick={() => onSelect(l.id)} className="bg-slate-950/40 hover:bg-slate-800/40 transition cursor-pointer">
                        <td className="py-2 pl-9 pr-4" colSpan={2}>
                          <span className="block font-semibold text-slate-200">{l.tenant}</span>
                          <span className="block text-[10px] text-slate-500">{dealTitle(l.dealId)}</span>
                        </td>
                        <td className="py-2 px-4 text-right font-mono text-slate-300">{usd(l.monthlyRent)}</td>
                        {showSqft && <td className="py-2 px-4 text-right font-mono text-slate-400">{l.sqft > 0 ? Math.round(l.sqft).toLocaleString() : '—'}</td>}
                        <td className="py-2 px-4 text-[11px] text-slate-400" colSpan={showSqft ? 3 : 2}>
                          {l.endDate ? `${b.key === 'holdover' ? 'Ended' : 'Ends'} ${longDate(l.endDate)}${b.key === 'holdover' ? ' (still active)' : ` · ${yrs(l.yearsRemaining)} left`}` : 'No end date'}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
