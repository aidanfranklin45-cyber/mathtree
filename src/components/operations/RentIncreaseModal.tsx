import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase/client';
import { MonthlyRentReconciliationView } from '../../lib/supabase/types';
import { X, TrendingUp, DollarSign, Calendar, AlertCircle } from 'lucide-react';

interface RentIncreaseModalProps {
  isOpen: boolean;
  item: MonthlyRentReconciliationView | null;
  onClose: () => void;
  onSuccess: () => void;
}

export const RentIncreaseModal: React.FC<RentIncreaseModalProps> = ({
  isOpen,
  item,
  onClose,
  onSuccess,
}) => {
  const [currentRent, setCurrentRent] = useState<number>(0);
  const [newRent, setNewRent] = useState<string>('');
  const [increaseType, setIncreaseType] = useState<string>('Percentage Bump (%)');
  const [pctBump, setPctBump] = useState<string>('3.0');
  const [effectiveDate, setEffectiveDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (item) {
      const cr = Number(item.contractual_rent) || 0;
      setCurrentRent(cr);
      // Default new rent to +3% bump
      const defNew = Math.round(cr * 1.03 * 100) / 100;
      setNewRent(defNew.toString());
      setEffectiveDate(new Date().toISOString().slice(0, 10));
      setError(null);
    }
  }, [item]);

  if (!isOpen || !item) return null;

  const handlePctChange = (val: string) => {
    setPctBump(val);
    const pct = parseFloat(val) || 0;
    const computed = Math.round(currentRent * (1 + pct / 100) * 100) / 100;
    setNewRent(computed.toString());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newRentNum = parseFloat(newRent) || 0;
    if (newRentNum <= 0) {
      setError('Please enter a valid new rent amount');
      return;
    }

    if (!item.lease_id) {
      setError('Invalid lease ID for this record');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const nextDate = new Date(effectiveDate);
      nextDate.setFullYear(nextDate.getFullYear() + 1);
      const nextDateStr = nextDate.toISOString().slice(0, 10);

      // 1. Update lease record
      const { error: leaseErr } = await supabase
        .from('leases')
        .update({
          previous_rent_amount: currentRent,
          monthly_rent: newRentNum,
          last_rent_increase_date: effectiveDate,
          next_escalation_date: nextDateStr,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.lease_id);

      if (leaseErr) throw leaseErr;

      // Record applied increase in rent_increases audit ledger if deal_id exists
      if (item.deal_id) {
        const sessionRes = await supabase.auth.getSession();
        const userId = sessionRes.data?.session?.user?.id;

        await supabase.from('rent_increases').insert({
          user_id: userId,
          lease_id: item.lease_id,
          deal_id: item.deal_id,
          effective_date: effectiveDate,
          old_rent: currentRent,
          new_rent: newRentNum,
          reason: notes.trim() || `Applied ${pctBump}% Contractual Escalation`,
          is_applied: true,
          increase_type: 'percentage',
          scheduled_amount: parseFloat(pctBump) || 3.0,
        });
      }

      // 2. Synchronize deal pro-forma inputs if deal_id exists
      if (item.deal_id) {
        const { data: dealData } = await supabase
          .from('deals')
          .select('inputs')
          .eq('id', item.deal_id)
          .single();

        if (dealData) {
          const curInputs = (dealData.inputs as Record<string, any>) || {};
          const curLeases = (curInputs.leases as any[]) || [];
          const updatedLeases = curLeases.map((l: any) => {
            if (l.tenantName === item.tenant_name || curLeases.length === 1) {
              return {
                ...l,
                monthlyRent: newRentNum,
                annualRent: newRentNum * 12,
              };
            }
            return l;
          });

          const totalAnnual = updatedLeases.reduce((s: number, l: any) => s + (l.monthlyRent * 12), 0);

          await supabase
            .from('deals')
            .update({
              inputs: {
                ...curInputs,
                leases: updatedLeases,
                grossRentAnnual: totalAnnual,
                grossRentPerMonth: totalAnnual / 12,
              },
            })
            .eq('id', item.deal_id);
        }
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Failed to apply rent increase:', err);
      setError(err.message || 'Failed to update rent amount');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full shadow-2xl p-6 relative">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
          <h3 className="text-base font-bold text-white flex items-center space-x-2">
            <span className="text-emerald-400">📈</span>
            <span>Record Rent Escalation</span>
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-xl text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-400 font-bold mb-1">Property & Tenant</label>
            <div className="bg-slate-950 border border-slate-800 p-2.5 rounded-xl">
              <div className="font-bold text-white">{item.tenant_name || 'Commercial Tenant'}</div>
              <div className="text-[11px] text-slate-400">
                {item.deal_title} • {item.unit_number || 'Unit 1'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 font-bold mb-1">Current Monthly Rent</label>
              <div className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-300 font-bold tabular-nums">
                ${currentRent.toLocaleString()}
              </div>
            </div>
            <div>
              <label className="block text-emerald-400 font-bold mb-1">Increase (%)</label>
              <div className="relative">
                <input
                  type="number"
                  step="0.1"
                  value={pctBump}
                  onChange={(e) => handlePctChange(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-bold focus:border-emerald-500 focus:outline-none tabular-nums"
                />
                <span className="absolute right-3 top-2 text-slate-400 tabular-nums">%</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-emerald-400 font-bold mb-1">New Monthly Rent ($) *</label>
              <input
                type="number"
                step="0.01"
                required
                value={newRent}
                onChange={(e) => setNewRent(e.target.value)}
                className="w-full bg-slate-950 border border-emerald-950 rounded-xl px-3 py-2 text-emerald-400 font-bold text-sm focus:border-emerald-500 focus:outline-none tabular-nums"
              />
            </div>
            <div>
              <label className="block text-slate-400 font-bold mb-1">Effective Date *</label>
              <input
                type="date"
                required
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:border-emerald-500 focus:outline-none tabular-nums"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-400 font-bold mb-1">Escalation Mechanism</label>
            <select
              value={increaseType}
              onChange={(e) => setIncreaseType(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="Percentage Bump (%)">Contractual Anniversary Escalation (%)</option>
              <option value="CPI Index">CPI Inflation Adjustment</option>
              <option value="Fair Market Review">Fair Market Value (FMV) Reset</option>
              <option value="Fixed Step ($)">Scheduled Fixed Step ($)</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-400 font-bold mb-1">Notes / Estoppel Reference</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Executed Lease Amendment #2, CPI adjustment"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-400 hover:text-white bg-slate-950 border border-slate-800 font-bold transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black transition disabled:opacity-50 flex items-center space-x-2"
            >
              {saving ? <span>Applying...</span> : <span>Apply Rent Increase</span>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
