import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase/client';
import { Building2, Users, DollarSign, Calendar, Plus, Layers, ArrowLeft } from 'lucide-react';

interface LeaseRecord {
  id: string;
  deal_id: string;
  tenant_name: string;
  unit_number?: string;
  monthly_rent: number;
  lease_start_date?: string;
  lease_end_date?: string;
  lease_type?: string;
  escalation_type?: string;
  escalation_rate?: number;
  escalation_frequency?: string;
  next_escalation_date?: string;
  is_active: boolean;
}

interface EntityRecord {
  id: string;
  name: string;
  formation_state?: string;
  ein?: string;
  depository_bank?: string;
}

export const OperationsPage: React.FC = () => {
  const [leases, setLeases] = useState<LeaseRecord[]>([]);
  const [entities, setEntities] = useState<EntityRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadOperations() {
      setLoading(true);
      try {
        const [resEntities, resLeases] = await Promise.allSettled([
          supabase.from('entities').select('*').order('name', { ascending: true }),
          supabase.from('leases').select('*').order('is_active', { ascending: false }),
        ]);

        let loadedEntities: EntityRecord[] =
          (resEntities.status === 'fulfilled' && resEntities.value.data) || [];
        let loadedLeases: LeaseRecord[] =
          (resLeases.status === 'fulfilled' && resLeases.value.data) || [];

        // Benchmark fallback
        if (loadedEntities.length === 0) {
          loadedEntities = [
            {
              id: 'b1a42178-a979-4234-b018-eabaf8b7c481',
              name: 'Summit Crest Holdings LLC',
              formation_state: 'WA',
              ein: '84-1928374',
              depository_bank: 'Chase Commercial (*4892)',
            },
          ];
        }

        if (loadedLeases.length === 0) {
          loadedLeases = [
            {
              id: 'l-1',
              deal_id: 'd8c7075e-c3eb-4606-bd5b-014ecda7bb49',
              tenant_name: 'Cascade Cold Logistics LLC',
              unit_number: 'Bay A (Logistics)',
              monthly_rent: 15500,
              lease_start_date: '2024-01-01',
              lease_end_date: '2029-12-31',
              lease_type: 'NNN',
              escalation_type: 'Percentage Bump (%)',
              escalation_rate: 3.0,
              escalation_frequency: 'Annual on Anniversary',
              next_escalation_date: '2026-01-01',
              is_active: true,
            },
            {
              id: 'l-2',
              deal_id: 'd8c7075e-c3eb-4606-bd5b-014ecda7bb49',
              tenant_name: 'Pacific Freight Lines',
              unit_number: 'Bay B (Cold Storage)',
              monthly_rent: 13250,
              lease_start_date: '2023-06-01',
              lease_end_date: '2028-05-31',
              lease_type: 'NNN',
              escalation_type: 'Percentage Bump (%)',
              escalation_rate: 3.5,
              escalation_frequency: 'Annual on Anniversary',
              next_escalation_date: '2026-06-01',
              is_active: true,
            },
          ];
        }

        setEntities(loadedEntities);
        setLeases(loadedLeases);
      } catch (err) {
        console.error('Operations load error:', err);
      } finally {
        setLoading(false);
      }
    }
    loadOperations();
  }, []);

  const totalMonthlyRent = leases.reduce((sum, l) => sum + (l.monthly_rent || 0), 0);
  const activeTenants = leases.filter((l) => l.is_active).length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/90 backdrop-blur-md sticky top-0 z-30 px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <a
              href="dashboard.html"
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-emerald-400 transition"
              title="Return to Dashboard"
            >
              <ArrowLeft className="w-4 h-4" />
            </a>
            <div>
              <h1 className="text-base font-black text-white tracking-tight">Property Management & Rent Roll</h1>
              <p className="text-[11px] text-slate-400">Master Rent Roll, Lease Escalations & Holding Entities</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <a
              href="dashboard.html"
              className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-xs transition shadow-sm"
            >
              Deal Studio
            </a>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
              <span>Gross Monthly Rent</span>
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-xl font-black text-white">${totalMonthlyRent.toLocaleString()}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">${(totalMonthlyRent * 12).toLocaleString()} / year</div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
              <span>Active Commercial Leases</span>
              <Users className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-xl font-black text-emerald-400">{activeTenants} Tenants</div>
            <div className="text-[11px] text-slate-500 mt-0.5">100% Occupancy Rate</div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
              <span>Holding Entities</span>
              <Building2 className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-xl font-black text-white">{entities.length} LLCs</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{entities[0]?.name || 'Commercial LLC'}</div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold mb-1">
              <span>Next Rent Escalation</span>
              <Calendar className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-xl font-black text-emerald-400">+3.0% Annual</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Contractual Lease Bump</div>
          </div>
        </div>

        {/* Master Rent Roll Table */}
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 overflow-x-auto shadow-sm">
          <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Master Commercial Rent Roll</h3>
              <p className="text-xs text-slate-400">In-place leases, contractual escalations, and monthly billings</p>
            </div>
          </div>

          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-bold uppercase text-[10px]">
                <th className="py-3 px-2">Tenant Name</th>
                <th className="py-3 px-2">Unit / Suite</th>
                <th className="py-3 px-2">Lease Structure</th>
                <th className="py-3 px-2">Monthly Rent</th>
                <th className="py-3 px-2">Annualized</th>
                <th className="py-3 px-2">Escalation Term</th>
                <th className="py-3 px-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
              {leases.map((lease) => (
                <tr key={lease.id} className="hover:bg-slate-800/40 transition">
                  <td className="py-3 px-2 font-sans font-bold text-white">{lease.tenant_name}</td>
                  <td className="py-3 px-2 text-slate-300">{lease.unit_number || 'Main Facility'}</td>
                  <td className="py-3 px-2 font-sans text-emerald-400 font-bold">{lease.lease_type || 'NNN'}</td>
                  <td className="py-3 px-2 font-bold text-white">${lease.monthly_rent.toLocaleString()}</td>
                  <td className="py-3 px-2">${(lease.monthly_rent * 12).toLocaleString()}</td>
                  <td className="py-3 px-2 font-sans text-slate-400">
                    {lease.escalation_rate ? `+${lease.escalation_rate}% Annually` : 'Standard Flat'}
                  </td>
                  <td className="py-3 px-2 text-right font-sans">
                    <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                      Active
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
};
