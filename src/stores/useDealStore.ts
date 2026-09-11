import { useState, useEffect, useCallback } from 'react';
import { supabase, BENCHMARK_DEAL } from '../lib/supabase/client';
import { calculateProjections } from '../lib/math/calculator';
import { DealRecord, DealInputs, DealMetrics } from '../lib/math/types';

export interface DealStoreState {
  deal: DealRecord | null;
  metrics: DealMetrics | null;
  loading: boolean;
  error: string | null;
  activeTab: string;
  isEditModalOpen: boolean;
  setActiveTab: (tab: string) => void;
  setIsEditModalOpen: (open: boolean) => void;
  updateInputs: (newInputs: Partial<DealInputs>) => void;
  saveDeal: () => Promise<boolean>;
  loadDeal: (dealId?: string) => Promise<void>;
}

// Map Postgres deal row into standard DealRecord
export function mapSupabaseDeal(d: any): DealRecord {
  const inputs: DealInputs = {
    purchasePrice: parseFloat(d.purchase_price) || 0,
    downPaymentPercent: d.inputs?.downPaymentPercent || 25,
    interestRate: parseFloat(d.inputs?.interestRate) || 6.5,
    loanTermYears: parseInt(d.inputs?.loanTermYears || d.inputs?.amortizationYears || 30, 10),
    holdingPeriod: parseInt(d.inputs?.holdingPeriod || d.inputs?.exitYear || 10, 10),
    grossRentAnnual: parseFloat(d.inputs?.grossRentAnnual) || (parseFloat(d.inputs?.monthlyRent || d.inputs?.grossRentPerMonth || 0) * 12),
    monthlyRent: parseFloat(d.inputs?.monthlyRent || d.inputs?.grossRentPerMonth) || 0,
    operatingExpensesAnnual: parseFloat(d.inputs?.operatingExpensesAnnual) || 0,
    vacancyRatePercent: parseFloat(d.inputs?.vacancyRatePercent !== undefined ? d.inputs.vacancyRatePercent : 5.0),
    rentGrowthPercent: parseFloat(d.inputs?.rentGrowthPercent !== undefined ? d.inputs.rentGrowthPercent : 3.0),
    expenseGrowthPercent: parseFloat(d.inputs?.expenseGrowthPercent !== undefined ? d.inputs.expenseGrowthPercent : 2.5),
    exitCapRatePercent: parseFloat(d.inputs?.exitCapRatePercent !== undefined ? d.inputs.exitCapRatePercent : 6.5),
    sellingCostPercent: parseFloat(d.inputs?.sellingCostPercent !== undefined ? d.inputs.sellingCostPercent : 3.0),
    discountRatePercent: parseFloat(d.inputs?.discountRatePercent !== undefined ? d.inputs.discountRatePercent : 8.0),
    primaryApn: d.inputs?.primaryApn || d.inputs?.apn || '',
    county: d.inputs?.county || '',
    squareFeet: parseInt(d.inputs?.squareFeet || d.inputs?.gla || 0, 10),
    leases: d.inputs?.leases || [],
    parcels: d.inputs?.parcels || [],
    assessorData: d.inputs?.assessorData || {},
    ...(d.inputs || {}),
  };

  return {
    id: d.id,
    user_id: d.user_id,
    title: d.title || d.name || 'Commercial Property',
    location: d.location || d.address || 'Washington State',
    address: d.address,
    city: d.city,
    state: d.state,
    zip: d.zip,
    asset_class: d.asset_class || d.asset_type || 'commercial',
    status: d.status || 'owned',
    purchase_price: parseFloat(d.purchase_price) || inputs.purchasePrice || 0,
    total_equity: parseFloat(d.total_equity) || 0,
    loan_amount: parseFloat(d.loan_amount) || 0,
    irr: parseFloat(d.irr) || 0,
    cash_on_cash: parseFloat(d.cash_on_cash) || 0,
    equity_multiple: parseFloat(d.equity_multiple) || 1.0,
    year1_cashflow: parseFloat(d.year1_cashflow) || 0,
    cap_rate: parseFloat(d.cap_rate) || 0,
    is_demo: d.is_demo || false,
    inputs,
    created_at: d.created_at,
    updated_at: d.updated_at,
  };
}

export function useDealStore(initialDealId?: string): DealStoreState {
  const [deal, setDeal] = useState<DealRecord | null>(null);
  const [metrics, setMetrics] = useState<DealMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);

  const recalculate = useCallback((currentDeal: DealRecord) => {
    try {
      const calculated = calculateProjections(currentDeal.asset_class, currentDeal.inputs);
      setMetrics(calculated);
    } catch (err: any) {
      console.error('Recalculation error:', err);
    }
  }, []);

  const loadDeal = useCallback(async (requestedId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const idToLoad =
        requestedId ||
        new URLSearchParams(window.location.search).get('id') ||
        sessionStorage.getItem('mathtree_active_deal_id') ||
        localStorage.getItem('mathtree_active_deal_id');

      const sessionRes = await supabase.auth.getSession();
      const user = sessionRes.data?.session?.user;

      let loadedDeal: DealRecord | null = null;

      if (idToLoad && idToLoad !== 'demo') {
        const { data, error: qErr } = await supabase.from('deals').select('*').eq('id', idToLoad).single();
        if (!qErr && data) {
          loadedDeal = mapSupabaseDeal(data);
        }
      }

      if (!loadedDeal && user) {
        const { data, error: qErr } = await supabase
          .from('deals')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1);
        if (!qErr && data && data.length > 0) {
          loadedDeal = mapSupabaseDeal(data[0]);
        }
      }

      if (!loadedDeal) {
        const { data, error: qErr } = await supabase
          .from('deals')
          .select('*')
          .eq('is_demo', true)
          .order('created_at', { ascending: false })
          .limit(1);
        if (!qErr && data && data.length > 0) {
          loadedDeal = mapSupabaseDeal(data[0]);
        } else {
          loadedDeal = BENCHMARK_DEAL as unknown as DealRecord;
        }
      }

      if (loadedDeal) {
        setDeal(loadedDeal);
        recalculate(loadedDeal);
        sessionStorage.setItem('mathtree_active_deal_id', loadedDeal.id);
        localStorage.setItem('mathtree_active_deal_id', loadedDeal.id);
      }
    } catch (err: any) {
      console.error('Error loading deal:', err);
      setError(err.message || 'Failed to load deal');
    } finally {
      setLoading(false);
    }
  }, [recalculate]);

  useEffect(() => {
    loadDeal(initialDealId);
  }, [loadDeal, initialDealId]);

  const updateInputs = useCallback((newInputs: Partial<DealInputs>) => {
    setDeal((prev) => {
      if (!prev) return null;
      const mergedInputs: DealInputs = { ...prev.inputs, ...newInputs };
      const updatedDeal: DealRecord = { ...prev, inputs: mergedInputs };
      recalculate(updatedDeal);
      return updatedDeal;
    });
  }, [recalculate]);

  const saveDeal = useCallback(async (): Promise<boolean> => {
    if (!deal) return false;
    try {
      const calculated = metrics || calculateProjections(deal.asset_class, deal.inputs);
      const payload = {
        purchase_price: deal.inputs.purchasePrice,
        irr: calculated.irr,
        cash_on_cash: calculated.cashOnCash,
        equity_multiple: calculated.equityMultiplier,
        year1_cashflow: calculated.year1Cashflow,
        cap_rate: calculated.capRate,
        inputs: deal.inputs,
        updated_at: new Date().toISOString(),
      };

      const { error: saveErr } = await supabase.from('deals').update(payload).eq('id', deal.id);
      if (saveErr) {
        console.warn('Database save warning:', saveErr);
      }
      return true;
    } catch (err: any) {
      console.error('Failed to save deal:', err);
      return false;
    }
  }, [deal, metrics]);

  return {
    deal,
    metrics,
    loading,
    error,
    activeTab,
    isEditModalOpen,
    setActiveTab,
    setIsEditModalOpen,
    updateInputs,
    saveDeal,
    loadDeal,
  };
}
