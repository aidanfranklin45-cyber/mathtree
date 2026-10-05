import React from 'react';
import type { DealInputs, DealRecord } from '../../../lib/math/types';
import type { DealTopPatch } from '../../../stores/useDealStore';
import { buildApplication, knownTenantNames } from '../../../lib/ingestion/apply';
import { DocumentIntake } from '../DocumentIntake';

interface Props {
  isOpen: boolean;
  deal: DealRecord;
  onClose: () => void;
  /** The same save the Edit Inputs form uses. */
  onApply: (inputsPatch: Partial<DealInputs>, top: DealTopPatch) => Promise<boolean>;
}

/** Read documents for a property that already exists: what the owner ticks is saved to it. */
export const ReadDocumentsModal: React.FC<Props> = ({ isOpen, deal, onClose, onApply }) => {
  if (!isOpen) return null;
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full p-4 sm:p-6 space-y-4 shadow-2xl my-2 max-h-[94vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-white">Read documents for {deal.title || 'this property'}</h2>
            <p className="text-[11px] text-slate-400">Rent rolls, leases, operating statements, loan terms, offering memorandums and purchase agreements. Tenant names, phone numbers and emails are hidden before anything is read, and nothing is saved until you tick it.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none">×</button>
        </div>
        <DocumentIntake
          deal={deal}
          knownNames={knownTenantNames(deal)}
          applyLabel={(n) => `Apply ${n} change${n === 1 ? '' : 's'}`}
          onCancel={onClose}
          onApply={async ({ proposal, ticked }) => {
            const { inputsPatch, top } = buildApplication(deal, proposal, ticked);
            const ok = await onApply(inputsPatch as Partial<DealInputs>, top);
            if (ok) onClose();
            return ok;
          }}
        />
      </div>
    </div>
  );
};
