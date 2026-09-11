import React, { useState, useEffect } from 'react';
import { X, DollarSign, Calendar, CreditCard, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase/client';
import { MonthlyRentReconciliationView, RentPaymentInsert } from '../../lib/supabase/types';

interface LogPaymentModalProps {
  isOpen: boolean;
  item: MonthlyRentReconciliationView | null;
  onClose: () => void;
  onSuccess: () => void;
}

export const LogPaymentModal: React.FC<LogPaymentModalProps> = ({
  isOpen,
  item,
  onClose,
  onSuccess,
}) => {
  const [amountPaid, setAmountPaid] = useState<string>('');
  const [paidDate, setPaidDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<string>('ACH / Wire Transfer');
  const [referenceNote, setReferenceNote] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (item) {
      setAmountPaid(
        item.amount_paid && item.amount_paid > 0
          ? String(item.amount_paid)
          : String(item.contractual_rent || '')
      );
      setPaidDate(item.paid_date || new Date().toISOString().slice(0, 10));
      setPaymentMethod(item.payment_method || 'ACH / Wire Transfer');
      setReferenceNote(item.reference_note || '');
      setErrorMsg(null);
    }
  }, [item]);

  if (!isOpen || !item) return null;

  const contractualRent = Number(item.contractual_rent || 0);
  const enteredAmount = Number(amountPaid) || 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item.lease_id || !item.deal_id) {
      setErrorMsg('Missing lease or deal identifier.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const periodMonth = item.current_period || `${new Date().toISOString().slice(0, 7)}-01`;
      let paymentStatus = 'pending';
      if (enteredAmount >= contractualRent && contractualRent > 0) {
        paymentStatus = 'paid';
      } else if (enteredAmount > 0) {
        paymentStatus = 'partial';
      }

      const paymentRecord: RentPaymentInsert = {
        deal_id: item.deal_id,
        lease_id: item.lease_id,
        period_month: periodMonth,
        due_date: periodMonth,
        amount_due: contractualRent,
        amount_paid: enteredAmount,
        paid_date: paidDate,
        payment_method: paymentMethod,
        reference_note: referenceNote.trim() || null,
        status: paymentStatus,
        ...(item.payment_id ? { id: item.payment_id } : {}),
      };

      const { error } = await supabase
        .from('rent_payments')
        .upsert(paymentRecord);

      if (error) {
        throw error;
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Failed to log payment:', err);
      setErrorMsg(err.message || 'Failed to save payment record.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <DollarSign className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                {item.payment_id ? 'Update Lease Payment' : 'Log Tenant Rent Payment'}
              </h2>
              <p className="text-xs text-slate-400">
                Billing Period: {item.current_period || 'Current Month'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tenant Summary Banner */}
        <div className="bg-slate-950/60 px-6 py-3 border-b border-slate-800/80 flex items-center justify-between text-xs">
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-400">Tenant & Unit</div>
            <div className="font-bold text-white">
              {item.tenant_name || 'Commercial Tenant'}
              {item.unit_number && <span className="text-slate-400 ml-1">({item.unit_number})</span>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase font-bold text-slate-400">Contractual Due</div>
            <div className="font-mono font-bold text-emerald-400">
              ${contractualRent.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
              Payment Amount Received ($)
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 font-mono text-sm">$</span>
              <input
                type="number"
                step="0.01"
                required
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
                className="w-full pl-8 pr-3.5 py-2.5 bg-slate-950/80 border border-slate-700 rounded-xl text-white font-mono font-bold text-sm focus:outline-none focus:border-emerald-500 transition"
                placeholder="0.00"
              />
            </div>
            <div className="mt-1 text-[11px] text-slate-400 flex justify-between">
              <span>
                Status:{' '}
                <strong
                  className={
                    enteredAmount >= contractualRent
                      ? 'text-emerald-400'
                      : enteredAmount > 0
                      ? 'text-amber-400'
                      : 'text-slate-400'
                  }
                >
                  {enteredAmount >= contractualRent
                    ? 'PAID IN FULL'
                    : enteredAmount > 0
                    ? 'PARTIAL PAYMENT'
                    : 'UNPAID / PENDING'}
                </strong>
              </span>
              {enteredAmount < contractualRent && (
                <span className="text-amber-400">
                  Remaining: ${(contractualRent - enteredAmount).toLocaleString()}
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                Date Received
              </label>
              <div className="relative">
                <input
                  type="date"
                  required
                  value={paidDate}
                  onChange={(e) => setPaidDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950/80 border border-slate-700 rounded-xl text-white text-xs font-mono focus:outline-none focus:border-emerald-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
                Payment Channel
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950/80 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:border-emerald-500 transition"
              >
                <option value="ACH / Wire Transfer">ACH / Wire Transfer</option>
                <option value="Commercial Check">Commercial Check</option>
                <option value="Credit Card">Credit Card</option>
                <option value="Direct Deposit">Direct Deposit</option>
                <option value="Cash / Other">Cash / Other</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1.5">
              Reference Memo / Transaction ID
            </label>
            <input
              type="text"
              value={referenceNote}
              onChange={(e) => setReferenceNote(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-950/80 border border-slate-700 rounded-xl text-white text-xs placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
              placeholder="e.g., Check #1042 / Wire Reference W-9842"
            />
          </div>

          {/* Actions */}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 text-xs font-semibold transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 text-xs font-black transition flex items-center gap-1.5 shadow-sm"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{item.payment_id ? 'Update Record' : 'Confirm Payment'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
