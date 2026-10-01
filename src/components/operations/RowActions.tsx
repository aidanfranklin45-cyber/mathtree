import React from 'react';
import { MenuItem, Popover } from './Popover';
import type { RowHandlers, RowView } from './rowStatus';

const primaryBase = 'px-3 py-1.5 rounded-lg text-[11px] font-bold transition whitespace-nowrap';

/** One contextual primary button plus a "⋯" menu holding every other action. */
export const RowActions: React.FC<{ view: RowView; dealId: string; handlers: RowHandlers }> = ({ view, dealId, handlers }) => {
  const { row, vacant, derived, isPaid } = view;
  const tip = derived ? 'Set up this tenancy as a lease first (Edit lease)' : undefined;

  let primary: React.ReactNode = null;
  if (vacant) {
    primary = <button type="button" onClick={() => handlers.addTenant(dealId)} className={`${primaryBase} text-white bg-emerald-600 hover:bg-emerald-500`}>+ Add Tenant</button>;
  } else if (derived) {
    primary = <button type="button" onClick={() => handlers.edit(row)} className={`${primaryBase} text-cyan-200 bg-cyan-950/70 border border-cyan-700 hover:bg-cyan-800`}>Set up lease</button>;
  } else if (!isPaid) {
    primary = <button type="button" onClick={() => handlers.pay(row)} className={`${primaryBase} text-emerald-200 bg-emerald-950/80 border border-emerald-600 hover:bg-emerald-600 hover:text-white`}>✓ Mark Paid</button>;
  }

  return (
    <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
      {primary}
      <Popover
        trigger={<span className="text-base leading-none">⋯</span>}
        triggerTitle="More actions"
        triggerClassName="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition"
      >
        {(close) => {
          const run = (fn: () => void) => () => { close(); fn(); };
          return vacant ? (
            <>
              <MenuItem onClick={run(() => handlers.addTenant(dealId))}>Add tenant</MenuItem>
              <MenuItem onClick={run(() => handlers.history(row))}>Property history</MenuItem>
            </>
          ) : (
            <>
              {!isPaid && <MenuItem disabled={derived} title={tip} onClick={run(() => handlers.snooze(row))}>Snooze alert</MenuItem>}
              {!isPaid && <MenuItem disabled={derived} title={tip} onClick={run(() => handlers.remind(row))}>Email reminder</MenuItem>}
              <MenuItem disabled={derived} title={tip} onClick={run(() => handlers.log(row))}>Log payment…</MenuItem>
              <MenuItem disabled={derived} title={tip} onClick={run(() => handlers.escalate(row))}>Escalate rent…</MenuItem>
              <MenuItem onClick={run(() => handlers.edit(row))}>Edit lease</MenuItem>
              <MenuItem onClick={run(() => handlers.history(row))}>Audit trail</MenuItem>
            </>
          );
        }}
      </Popover>
    </div>
  );
};
