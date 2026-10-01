import React, { useEffect } from 'react';
import type { Row } from '../../lib/operations/rentRoll';
import { toneBadge, type RowHandlers, type RowView } from './rowStatus';

interface Props {
  view: RowView | null;
  dealTitle: string;
  unit: Row | null;
  payments: Row[];
  handlers: RowHandlers;
  onClose: () => void;
}

const money = (v: unknown) => (parseFloat(String(v)) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</dt>
    <dd className="text-xs text-slate-200 mt-0.5">{children}</dd>
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="px-5 py-4 border-b border-slate-800">
    <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-3">{title}</h4>
    {children}
  </section>
);

/** Side panel with the full detail for one lease, so the table itself can stay quiet. */
export const LeaseDrawer: React.FC<Props> = ({ view, dealTitle, unit, payments, handlers, onClose }) => {
  useEffect(() => {
    if (!view) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [view, onClose]);

  if (!view) return null;
  const { row, derived, isPaid, esc, due } = view;
  const tip = derived ? 'Set up this tenancy as a lease first (Edit lease)' : undefined;
  const btn = 'px-3 py-2 rounded-lg text-xs font-bold border transition disabled:opacity-40 disabled:cursor-not-allowed';
  const history = payments.filter((p) => p.lease_id === row.id).slice(0, 6);
  const steps = esc?.leaseScheduledSteps ?? [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Lease details">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <aside className="relative w-full sm:w-[440px] h-full bg-slate-950 border-l border-slate-800 shadow-2xl overflow-y-auto">
        <header className="px-5 py-4 border-b border-slate-800 flex items-start justify-between gap-3 sticky top-0 bg-slate-950 z-10">
          <div className="min-w-0">
            <h3 className="text-base font-extrabold text-white truncate">{row.tenant_name}</h3>
            <p className="text-xs text-slate-400 truncate">{dealTitle}{unit ? ` · ${unit.unit_number}` : ''}</p>
            <span className={`inline-flex mt-2 px-2 py-0.5 rounded-full text-[10px] font-bold border ${toneBadge[view.tone]}`}>{view.statusLabel}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-lg text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 transition">✕</button>
        </header>

        <Section title="Actions">
          <div className="flex flex-wrap gap-2">
            {!isPaid && <button type="button" disabled={derived} title={tip} onClick={() => handlers.pay(row)} className={`${btn} text-emerald-200 bg-emerald-950/80 border-emerald-600 hover:bg-emerald-600`}>✓ Mark paid</button>}
            {!isPaid && <button type="button" disabled={derived} title={tip} onClick={() => handlers.snooze(row)} className={`${btn} text-amber-200 bg-amber-950/60 border-amber-700 hover:bg-amber-700`}>Snooze</button>}
            {!isPaid && <button type="button" disabled={derived} title={tip} onClick={() => handlers.remind(row)} className={`${btn} text-indigo-200 bg-indigo-950/60 border-indigo-700 hover:bg-indigo-700`}>Remind</button>}
            <button type="button" disabled={derived} title={tip} onClick={() => handlers.log(row)} className={`${btn} text-slate-200 bg-slate-900 border-slate-700 hover:bg-slate-800`}>Log payment</button>
            <button type="button" disabled={derived} title={tip} onClick={() => handlers.escalate(row)} className={`${btn} text-blue-200 bg-blue-950/60 border-blue-700 hover:bg-blue-700`}>Escalate</button>
            <button type="button" onClick={() => handlers.edit(row)} className={`${btn} text-cyan-200 bg-cyan-950/60 border-cyan-700 hover:bg-cyan-700`}>Edit lease</button>
            <button type="button" onClick={() => handlers.history(row)} className={`${btn} text-slate-300 bg-slate-900 border-slate-700 hover:bg-slate-800`}>Audit trail</button>
          </div>
        </Section>

        <Section title="Lease">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Monthly rent"><span className="font-mono font-bold text-emerald-400">{money(row.monthly_rent)}</span></Field>
            <Field label="Rent due">Day {due?.dueDay ?? '—'}{due ? ` · next ${due.nextDue.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</Field>
            <Field label="Started">{row.lease_start_date || '—'}</Field>
            <Field label="Ends">{row.lease_end_date || <span className="text-amber-400">Month-to-month</span>}</Field>
            <Field label="Grace period">{row.grace_period_days || 5} days</Field>
            <Field label="Unit">{unit ? `${unit.unit_number}${unit.unit_type ? ` (${unit.unit_type})` : ''}` : '—'}</Field>
          </dl>
        </Section>

        <Section title="Tenant contact">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Email">{row.tenant_email || <span className="text-slate-500">None on file</span>}</Field>
            <Field label="Phone">{row.tenant_phone || <span className="text-slate-500">None on file</span>}</Field>
          </dl>
        </Section>

        <Section title="Escalation">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 mb-3">
            <Field label="Last change">{row.last_rent_increase_date || row.lease_start_date || '—'}</Field>
            <Field label="Schedule">
              {esc?.hasDefinedSchedule
                ? `${row.escalation_frequency || 'Annual'} ${esc.scheduledValStr || (row.escalation_rate ? `+${row.escalation_rate}%` : '')}`.trim()
                : <span className="text-amber-300">{esc?.isUnscheduledReviewDue ? 'None — review due' : 'None defined'}</span>}
            </Field>
          </dl>
          {steps.length > 0 && (
            <ul className="space-y-1">
              {steps.map((s) => (
                <li key={`${s.effective_date}-${s.id ?? ''}`} className="flex justify-between text-[11px] text-slate-300 bg-slate-900 rounded-lg px-3 py-1.5">
                  <span className="font-mono">{s.effective_date}</span>
                  <span className="font-mono text-cyan-300">{s.increase_type === 'fixed_step' ? `+$${s.scheduled_amount}` : `+${s.scheduled_amount}%`}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Recent payments">
          {history.length === 0 ? (
            <p className="text-xs text-slate-500">No payments recorded yet.</p>
          ) : (
            <ul className="space-y-1">
              {history.map((p) => (
                <li key={p.id ?? p.period_month} className="flex justify-between items-center text-[11px] bg-slate-900 rounded-lg px-3 py-1.5">
                  <span className="font-mono text-slate-300">{String(p.period_month).slice(0, 7)}</span>
                  <span className="text-slate-400 capitalize">{p.status}</span>
                  <span className="font-mono text-slate-200">{money(p.amount_paid)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </aside>
    </div>
  );
};
