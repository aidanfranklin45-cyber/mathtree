import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { DealRecord } from '../../lib/math/types';
import { resolveDealDisplayName } from '../../lib/math/pointInTime';
import { transferDealOwnership } from '../../lib/dealTransfer';

interface Props {
  deal: DealRecord | null;
  onClose: () => void;
  /** Called after a successful transfer so the dashboard can reload (the deal is no longer the caller's). */
  onTransferred: () => void;
}

export const TransferOwnershipModal: React.FC<Props> = ({ deal, onClose, onTransferred }) => {
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEmail('');
    setStep('enter');
    setError(null);
  }, [deal]);

  if (!deal) return null;
  const name = resolveDealDisplayName(deal);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await transferDealOwnership(deal.id, email);
    setBusy(false);
    if (res.ok) {
      onTransferred();
      onClose();
    } else {
      setError(res.message);
      setStep('enter');
    }
  };

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-extrabold text-white">Transfer Ownership</h3>
            <p className="text-xs text-slate-400 mt-0.5">{name}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-white p-1 rounded-lg">✕</button>
        </div>

        {step === 'enter' ? (
          <div className="space-y-3">
            <label className="text-[11px] font-bold text-slate-400 block">New owner&apos;s email (must already have a MathTree account)</label>
            <input
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
            />
            {error && <p className="text-xs text-rose-400">{error}</p>}
          </div>
        ) : (
          <div className="space-y-3 bg-slate-950/60 p-4 rounded-2xl border border-slate-800 text-xs text-slate-300 leading-relaxed">
            <p>
              Give <strong className="text-white">{name}</strong> to <strong className="text-emerald-400">{email.trim()}</strong>?
              Its leases, units, payments, baseline and history move with it.
            </p>
            <ul className="list-disc pl-4 space-y-1 text-slate-400">
              <li>You lose access to this property immediately.</li>
              <li>Its legal entity link and all sharing are removed.</li>
              <li>Only the new owner can transfer it back.</li>
            </ul>
          </div>
        )}

        <div className="flex items-center space-x-3 pt-1">
          <button type="button" onClick={step === 'enter' ? onClose : () => setStep('enter')} disabled={busy} className="flex-1 py-2.5 rounded-xl text-xs font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 transition">
            {step === 'enter' ? 'Cancel' : 'Back'}
          </button>
          {step === 'enter' ? (
            <button type="button" onClick={() => setStep('confirm')} disabled={!emailOk} className={`flex-1 py-2.5 rounded-xl text-xs font-extrabold text-white bg-emerald-600 transition ${emailOk ? 'hover:bg-emerald-500' : 'opacity-40 cursor-not-allowed'}`}>
              Continue
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={busy} className="flex-1 py-2.5 rounded-xl text-xs font-extrabold text-white bg-rose-600 hover:bg-rose-500 transition disabled:opacity-40">
              {busy ? <span className="inline-flex items-center justify-center"><Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4" />Transferring...</span> : 'Transfer Ownership'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
