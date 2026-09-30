import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase/client';
import { X, Plus, Calendar, DollarSign, Building, AlertCircle } from 'lucide-react';

interface AddLeaseModalProps {
  isOpen: boolean;
  deals: Array<{ id: string; title: string }>;
  onClose: () => void;
  onSuccess: () => void;
  /** Preselect a property (vacant-row "Add Tenant" button, or an Alerts deep link). */
  initialDealId?: string | null;
}

export const AddLeaseModal: React.FC<AddLeaseModalProps> = ({
  isOpen,
  deals,
  onClose,
  onSuccess,
  initialDealId,
}) => {
  const [dealId, setDealId] = useState<string>('');
  const [unitNumber, setUnitNumber] = useState<string>('');
  const [tenantName, setTenantName] = useState<string>('');
  const [monthlyRent, setMonthlyRent] = useState<string>('');
  const [leaseStartDate, setLeaseStartDate] = useState<string>('');
  const [leaseEndDate, setLeaseEndDate] = useState<string>('');
  const [leaseType, setLeaseType] = useState<string>('NNN');
  const [escalationType, setEscalationType] = useState<string>('Percentage Bump (%)');
  const [escalationRate, setEscalationRate] = useState<string>('3.0');
  const [nextEscalationDate, setNextEscalationDate] = useState<string>('');
  const [tenantEmail, setTenantEmail] = useState<string>('');
  const [tenantPhone, setTenantPhone] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && initialDealId) setDealId(initialDealId);
  }, [isOpen, initialDealId]);

  useEffect(() => {
    if (deals.length > 0 && !dealId) {
      setDealId(deals[0].id);
    }
  }, [deals, dealId]);

  // Auto-set next escalation date to 1 year after lease start
  const handleStartDateChange = (val: string) => {
    setLeaseStartDate(val);
    if (val) {
      const d = new Date(val);
      d.setFullYear(d.getFullYear() + 1);
      setNextEscalationDate(d.toISOString().slice(0, 10));
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dealId || !tenantName.trim() || !monthlyRent) {
      setError('Please select a property, enter a tenant name and monthly rent.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const rentNum = parseFloat(monthlyRent) || 0;
      const rateNum = parseFloat(escalationRate) || 0;
      const sessionRes = await supabase.auth.getSession();
      const userId = sessionRes.data?.session?.user?.id || null;

      // 1. Insert into leases table
      const { data: newLease, error: leaseErr } = await supabase
        .from('leases')
        .insert({
          deal_id: dealId,
          user_id: userId,
          tenant_name: tenantName.trim(),
          monthly_rent: rentNum,
          lease_type: leaseType,
          lease_start_date: leaseStartDate || new Date().toISOString().slice(0, 10),
          lease_end_date: leaseEndDate || null,
          escalation_type: escalationType,
          escalation_rate: rateNum,
          escalation_frequency: 'Annual on Anniversary',
          last_rent_increase_date: leaseStartDate || new Date().toISOString().slice(0, 10),
          next_escalation_date: nextEscalationDate || null,
          tenant_email: tenantEmail.trim() || null,
          tenant_phone: tenantPhone.trim() || null,
          notes: notes.trim() || null,
          is_active: true,
        })
        .select()
        .single();

      if (leaseErr) throw leaseErr;

      // 2. Generate scheduled contractual escalations across the full lease term
      if (newLease && rateNum > 0 && leaseStartDate) {
        const startParts = leaseStartDate.split('-');
        const startY = parseInt(startParts[0], 10);
        const startM = startParts[1];
        const startD = startParts[2];

        let numYears = 10;
        if (leaseEndDate && leaseEndDate.includes('-')) {
          const endY = parseInt(leaseEndDate.split('-')[0], 10);
          if (endY > startY) {
            numYears = endY - startY;
          }
        }

        const scheduledRows = [];
        let runningRent = rentNum;
        for (let i = 1; i <= numYears; i++) {
          const effDate = `${startY + i}-${startM}-${startD}`;
          if (leaseEndDate && effDate > leaseEndDate) break;
          if (leaseEndDate && effDate === leaseEndDate && i === numYears) break;

          const nextRent = Math.round(runningRent * (1 + rateNum / 100) * 100) / 100;
          scheduledRows.push({
            user_id: userId,
            lease_id: newLease.id,
            deal_id: dealId,
            effective_date: effDate,
            old_rent: runningRent,
            new_rent: nextRent,
            reason: `Year ${i + 1} Lease Anniversary ${rateNum}% Escalation (Commenced ${leaseStartDate})`,
            is_applied: false,
            increase_type: 'percentage',
            scheduled_amount: rateNum,
          });
          runningRent = nextRent;
        }

        if (scheduledRows.length > 0) {
          await supabase.from('rent_increases').insert(scheduledRows);
        }
      }

      // 3. Sync to deal.inputs.leases if deal exists
      const { data: dealData } = await supabase
        .from('deals')
        .select('inputs')
        .eq('id', dealId)
        .single();

      if (dealData) {
        const curInputs = (dealData.inputs as Record<string, any>) || {};
        const curLeases = (curInputs.leases as any[]) || [];
        const updatedLeases = [
          ...curLeases,
          {
            tenantName: tenantName.trim(),
            monthlyRent: rentNum,
            annualRent: rentNum * 12,
            leaseStartDate: leaseStartDate || new Date().toISOString().slice(0, 10),
            leaseEndDate: leaseEndDate || '',
            leaseType: leaseType,
            escalationType: escalationType,
            escalationRate: rateNum,
            nextEscalationDate: nextEscalationDate || '',
          },
        ];

        // Recalculate grossRentAnnual
        const totalGrossRent = updatedLeases.reduce((sum: number, l: any) => sum + (l.monthlyRent * 12), 0);

        await supabase
          .from('deals')
          .update({
            inputs: {
              ...curInputs,
              leases: updatedLeases,
              grossRentAnnual: totalGrossRent,
              grossRentPerMonth: totalGrossRent / 12,
            },
          })
          .eq('id', dealId);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Failed to create lease:', err);
      setError(err.message || 'Failed to create lease');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full shadow-2xl p-6 relative max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
          <h3 className="text-base font-bold text-white flex items-center space-x-2">
            <span className="text-emerald-400">📝</span>
            <span>Add Property Unit & Lease</span>
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
            <label className="block text-slate-400 font-bold mb-1">Target Property *</label>
            <select
              value={dealId}
              onChange={(e) => setDealId(e.target.value)}
              required
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-bold focus:border-emerald-500 focus:outline-none"
            >
              {deals.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 font-bold mb-1">Unit / Suite #</label>
              <input
                type="text"
                value={unitNumber}
                onChange={(e) => setUnitNumber(e.target.value)}
                placeholder="e.g. Suite 100, Bay 2"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 font-bold mb-1">Lease Structure</label>
              <select
                value={leaseType}
                onChange={(e) => setLeaseType(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="NNN">Triple-Net (NNN)</option>
                <option value="Gross">Full Gross</option>
                <option value="Modified Gross">Modified Gross</option>
                <option value="Full Service">Full Service</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 font-bold mb-1">Tenant Name *</label>
              <input
                type="text"
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
                required
                placeholder="e.g. Cascade Logistics LLC"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 font-bold mb-1">Monthly Rent ($) *</label>
              <input
                type="number"
                step="0.01"
                value={monthlyRent}
                onChange={(e) => setMonthlyRent(e.target.value)}
                required
                placeholder="2500.00"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-emerald-400 font-bold focus:border-emerald-500 focus:outline-none tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 font-bold mb-1">Lease Start Date *</label>
              <input
                type="date"
                value={leaseStartDate}
                onChange={(e) => handleStartDateChange(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:border-emerald-500 focus:outline-none tabular-nums"
              />
            </div>
            <div>
              <label className="block text-slate-400 font-bold mb-1">Lease Expiration</label>
              <input
                type="date"
                value={leaseEndDate}
                onChange={(e) => setLeaseEndDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:border-emerald-500 focus:outline-none tabular-nums"
              />
            </div>
          </div>

          {/* Predetermined Escalation Schedule */}
          <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                📈 Rent Escalation Settings
              </span>
              <button
                type="button"
                onClick={() => {
                  setEscalationRate('3.0');
                  setEscalationType('Percentage Bump (%)');
                  if (leaseStartDate) {
                    const d = new Date(leaseStartDate);
                    d.setFullYear(d.getFullYear() + 1);
                    setNextEscalationDate(d.toISOString().slice(0, 10));
                  }
                }}
                className="px-2 py-0.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-800/60 text-[10px] font-semibold transition"
              >
                ⚡ Auto Annual 3%
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Type</label>
                <select
                  value={escalationType}
                  onChange={(e) => setEscalationType(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-white text-[11px] focus:outline-none"
                >
                  <option value="Percentage Bump (%)">Percentage Bump (%)</option>
                  <option value="Fixed Step ($)">Fixed Step ($)</option>
                  <option value="CPI Index">CPI Index</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Rate / Amount</label>
                <input
                  type="number"
                  step="0.1"
                  value={escalationRate}
                  onChange={(e) => setEscalationRate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-white font-mono text-[11px] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[10px] text-slate-400 mb-1">Next Escalation</label>
                <input
                  type="date"
                  value={nextEscalationDate}
                  onChange={(e) => setNextEscalationDate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-white font-mono text-[11px] focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 font-bold mb-1">Tenant Email</label>
              <input
                type="email"
                value={tenantEmail}
                onChange={(e) => setTenantEmail(e.target.value)}
                placeholder="tenant@example.com"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-400 font-bold mb-1">Tenant Phone</label>
              <input
                type="text"
                value={tenantPhone}
                onChange={(e) => setTenantPhone(e.target.value)}
                placeholder="(509) 555-0100"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>
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
              {saving ? <span>Saving...</span> : <span>Create Lease Record</span>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
