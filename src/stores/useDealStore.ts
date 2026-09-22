import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, BENCHMARK_DEAL } from '../lib/supabase/client';
import { DealRecord, DealInputs, DealMetrics } from '../lib/math/types';

export interface DealStoreState {
  deal: DealRecord | null;
  metrics: DealMetrics | null;
  loading: boolean;
  error: string | null;
  activeTab: string;
  isEditModalOpen: boolean;
  selectedEntityId: string | null;
  selectedLLC: string | null;
  selectedLLCFilter: string | null;
  entities: any[];
  filteredLeases: any[];
  netEquityNAV: number;
  totalGAV: number;
  currentLoanBalance: number;
  blendedLTV: number;
  amortizationSchedule: any[];
  setActiveTab: (tab: string) => void;
  setIsEditModalOpen: (open: boolean) => void;
  setSelectedEntityId: (id: string | null) => void;
  setSelectedLLC: (llc: string | null) => void;
  setSelectedLLCFilter: (llc: string | null) => void;
  setEntities: (entities: any[]) => void;
  loadEntities: () => Promise<any[]>;
  filterLeasesByEntity: (entityId: string | null) => any[];
  filterLeasesByLLC: (llc: string | null) => any[];
  updateInputs: (newInputs: Partial<DealInputs>) => void;
  saveDeal: () => Promise<boolean>;
  loadDeal: (dealId?: string) => Promise<void>;
  loadPortfolioEquityAndAmortization: (entityId?: string | null) => Promise<void>;
}

// Map Postgres deal row into standard DealRecord
export function mapSupabaseDeal(d: any): DealRecord {
  const inputs: DealInputs = {
    purchasePrice: parseFloat(d.purchase_price) || 0,
    downPaymentPercent: d.inputs?.downPaymentPercent !== undefined ? parseFloat(d.inputs.downPaymentPercent) : 25,
    interestRate: parseFloat(d.inputs?.interestRate) || 6.5,
    loanTermYears: parseInt(d.inputs?.loanTermYears || d.inputs?.amortizationYears || d.inputs?.loanTerm || 30, 10),
    holdingPeriod: parseInt(d.inputs?.holdingPeriod || d.inputs?.exitYear || 10, 10),
    grossRentAnnual: parseFloat(d.inputs?.grossRentAnnual) || (parseFloat(d.inputs?.monthlyRent || d.inputs?.grossRentPerMonth || 0) * 12) || (d.inputs?.leases?.[0]?.annualRent || (d.inputs?.leases?.[0]?.monthlyRent ? d.inputs.leases[0].monthlyRent * 12 : 0)),
    monthlyRent: parseFloat(d.inputs?.monthlyRent || d.inputs?.grossRentPerMonth) || (d.inputs?.leases?.[0]?.monthlyRent || 0),
    closingCosts: parseFloat(d.inputs?.closingCosts) || 0,
    rehabCosts: parseFloat(d.inputs?.rehabCosts || d.inputs?.rehabBudget) || 0,
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

  const [netEquityNAV, setNetEquityNAV] = useState<number>(0);
  const [totalGAV, setTotalGAV] = useState<number>(0);
  const [currentLoanBalance, setCurrentLoanBalance] = useState<number>(0);
  const [blendedLTV, setBlendedLTV] = useState<number>(0);
  const [amortizationSchedule, setAmortizationSchedule] = useState<any[]>([]);

  const initialStoredEntity = typeof window !== 'undefined' ? localStorage.getItem('mathtree_selected_entity_id') : null;
  const normalizedInitialEntity = (initialStoredEntity && initialStoredEntity !== 'all') ? initialStoredEntity : null;
  const [selectedEntityId, setSelectedEntityIdState] = useState<string | null>(normalizedInitialEntity);
  const [selectedLLC, setSelectedLLCState] = useState<string | null>(null);
  const [selectedLLCFilter, setSelectedLLCFilterState] = useState<string | null>(normalizedInitialEntity);

  const [entities, setEntitiesState] = useState<any[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('mathtree_entities_cache');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch (e) {}
    }
    return [
      { id: 'ent-demo-1', name: 'Apex Real Estate Capital LLC', formation_state: 'WA', bank_name: 'Chase Commercial (*4892)' },
      { id: 'ent-demo-2', name: 'Cascade Property Holdings LLC', formation_state: 'DE', bank_name: 'Wells Fargo Real Estate (*1042)' }
    ];
  });

  const loadEntities = useCallback(async (): Promise<any[]> => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (user) {
        const { data, error } = await supabase
          .from('entities')
          .select('*')
          .eq('user_id', user.id)
          .order('name', { ascending: true });
        if (!error && data) {
          setEntitiesState(data);
          if (typeof window !== 'undefined') {
            try { localStorage.setItem('mathtree_entities_cache', JSON.stringify(data)); } catch(e) {}
          }
          return data;
        }
      }
    } catch (e) {
      console.warn('Could not fetch entities from Supabase:', e);
    }
    return entities;
  }, [entities]);

  const setEntities = useCallback((newEntities: any[]) => {
    setEntitiesState(newEntities);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('mathtree_entities_cache', JSON.stringify(newEntities));
      } catch (e) {}
      window.dispatchEvent(new CustomEvent('mathtree:entity-changed', { detail: { entityId: selectedEntityId, llc: selectedLLC } }));
      window.dispatchEvent(new CustomEvent('mathtree:entity-changedd', { detail: { entityId: selectedEntityId, llc: selectedLLC } }));
    }
  }, [selectedEntityId, selectedLLC]);

  // Load portfolio equity and amortization schedule from Supabase (Server-side accuracy)
  const loadPortfolioEquityAndAmortization = useCallback(async (entityIdFilter?: string | null) => {
    try {
      const targetEntity = (entityIdFilter && entityIdFilter !== 'all') ? entityIdFilter : null;

      // Try RPC first if available
      const { data: rpcData, error: rpcErr } = await (supabase as any).rpc('get_portfolio_equity_and_amortization', {
        p_entity_id: targetEntity || null
      });

      if (!rpcErr && rpcData) {
        if (rpcData.summary) {
          setTotalGAV(Number(rpcData.summary.totalGAV) || 0);
          setCurrentLoanBalance(Number(rpcData.summary.totalLoanBalance) || 0);
          setNetEquityNAV(Number(rpcData.summary.netEquityNAV) || 0);
          setBlendedLTV(Number(rpcData.summary.blendedLTV) || 0);
        }
        if (Array.isArray(rpcData.amortizationSchedule)) {
          setAmortizationSchedule(rpcData.amortizationSchedule);
        }
        return;
      }

      // Fallback: Query view_deal_equity_summary and rent_payments with distinct deal aggregation
      let dealsQuery = supabase.from('deals').select('id, purchase_price, loan_amount, total_equity, entity_id, status, metrics');
      if (targetEntity) {
        dealsQuery = dealsQuery.eq('entity_id', targetEntity);
      }

      const { data: dealsData, error: dealsErr } = await dealsQuery;

      if (!dealsErr && dealsData && dealsData.length > 0) {
        const dealIds = dealsData.map((d: any) => d.id);
        
        let paymentsQuery = supabase.from('rent_payments').select('id, deal_id, lease_id, period_month, due_date, amount_due, amount_paid, paid_date, status, payment_method, reference_note, snooze_until').in('deal_id', dealIds);
        const { data: paymentsData } = await paymentsQuery;

        const paymentsByDeal = new Map<string, number>();
        (paymentsData || []).forEach((p: any) => {
          if (p.status === 'paid' || p.status === 'partial') {
            const cur = paymentsByDeal.get(p.deal_id) || 0;
            paymentsByDeal.set(p.deal_id, cur + (Number(p.amount_paid) || 0));
          }
        });

        let sumGAV = 0;
        let sumLoan = 0;
        let sumEquity = 0;

        dealsData.forEach((d: any) => {
          const price = Number(d.purchase_price) || 0;
          const initialLoan = Number(d.loan_amount) || (price * 0.75);
          const paid = paymentsByDeal.get(d.id) || 0;
          const curLoan = Math.max(0, initialLoan - paid);
          const curEquity = Math.max(0, price - curLoan);

          sumGAV += price;
          sumLoan += curLoan;
          sumEquity += curEquity;
        });

        setTotalGAV(sumGAV);
        setCurrentLoanBalance(sumLoan);
        setNetEquityNAV(sumEquity);
        setBlendedLTV(sumGAV > 0 ? Number(((sumLoan / sumGAV) * 100).toFixed(2)) : 0);

        if (paymentsData) {
          const sorted = [...paymentsData].sort((a: any, b: any) => new Date(b.period_month).getTime() - new Date(a.period_month).getTime());
          setAmortizationSchedule(sorted);
        }
      }
    } catch (err) {
      console.warn('[Store] Could not load realtime equity/amortization:', err);
    }
  }, []);

  // Realtime Supabase Channel Subscription for rent_payments and deals
  useEffect(() => {
    loadPortfolioEquityAndAmortization(selectedEntityId);

    const channelName = `mathtree_realtime_equity_${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rent_payments' },
        (payload) => {
          console.log('[Store Realtime] rent_payments changed:', payload.eventType);
          loadPortfolioEquityAndAmortization(selectedEntityId);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'deals' },
        (payload) => {
          console.log('[Store Realtime] deals changed:', payload.eventType);
          loadPortfolioEquityAndAmortization(selectedEntityId);
        }
      )
      .subscribe((status) => {
        console.log('[Store Realtime] Channel status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadPortfolioEquityAndAmortization, selectedEntityId]);

  // Reactive cross-tab and cross-component synchronization
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'mathtree_selected_entity_id') {
        const val = e.newValue && e.newValue !== 'all' ? e.newValue : null;
        setSelectedEntityIdState(val);
        setSelectedLLCFilterState(val);
      }
      if (e.key === 'mathtree_entities_cache' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (Array.isArray(parsed)) setEntitiesState(parsed);
        } catch(e) {}
      }
    };

    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel('mathtree_store_channel');
        bc.onmessage = (msg) => {
          if (msg.data?.type === 'ENTITY_CHANGED') {
            const val = msg.data.entityId && msg.data.entityId !== 'all' ? msg.data.entityId : null;
            setSelectedEntityIdState(val);
            setSelectedLLCFilterState(val);
          }
        };
      }
    } catch (e) {}

    const handleCustom = (e: Event) => {
      const customEvent = e as CustomEvent<{ entityId?: string | null; llc?: string | null }>;
      if (customEvent.detail?.entityId !== undefined) {
        const val = customEvent.detail.entityId && customEvent.detail.entityId !== 'all' ? customEvent.detail.entityId : null;
        setSelectedEntityIdState(val);
        setSelectedLLCFilterState(val);
      }
      if (customEvent.detail?.llc !== undefined) {
        setSelectedLLCState(customEvent.detail.llc || null);
        if (customEvent.detail.llc !== undefined) {
          const lVal = customEvent.detail.llc && customEvent.detail.llc !== 'all' ? customEvent.detail.llc : null;
          setSelectedLLCFilterState(lVal);
        }
      }
      try {
        const cached = localStorage.getItem('mathtree_entities_cache');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) setEntitiesState(parsed);
        }
      } catch (err) {}
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('mathtree:entity-changed', handleCustom);
    window.addEventListener('mathtree:entity-changedd', handleCustom);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('mathtree:entity-changed', handleCustom);
      window.removeEventListener('mathtree:entity-changedd', handleCustom);
      if (bc) {
        try { bc.close(); } catch(e) {}
      }
    };
  }, []);

  const setSelectedEntityId = useCallback((id: string | null) => {
    const val = (id && id !== 'all') ? id : null;
    setSelectedEntityIdState(val);
    setSelectedLLCFilterState(val);
    if (typeof window !== 'undefined') {
      try {
        if (val) {
          localStorage.setItem('mathtree_selected_entity_id', val);
          sessionStorage.setItem('mathtree_selected_entity_id', val);
        } else {
          localStorage.removeItem('mathtree_selected_entity_id');
          sessionStorage.removeItem('mathtree_selected_entity_id');
        }
      } catch (e) {}

      try {
        if (typeof BroadcastChannel !== 'undefined') {
          const bc = new BroadcastChannel('mathtree_store_channel');
          bc.postMessage({ type: 'ENTITY_CHANGED', event: 'mathtree:entity-changedd', entityId: val, llc: val });
          bc.close();
        }
      } catch (e) {}

      window.dispatchEvent(new CustomEvent('mathtree:entity-changed', { detail: { entityId: val, llc: val } }));
      window.dispatchEvent(new CustomEvent('mathtree:entity-changedd', { detail: { entityId: val, llc: val } }));
    }
  }, []);

  const setSelectedLLC = useCallback((llc: string | null) => {
    setSelectedLLCState(llc);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('mathtree:entity-changed', { detail: { llc } }));
      window.dispatchEvent(new CustomEvent('mathtree:entity-changedd', { detail: { llc } }));
    }
  }, []);

  const setSelectedLLCFilter = useCallback((llc: string | null) => {
    const val = (llc && llc !== 'all') ? llc : null;
    setSelectedLLCFilterState(val);
    setSelectedEntityIdState(val);
    if (typeof window !== 'undefined') {
      try {
        if (val) {
          localStorage.setItem('mathtree_selected_entity_id', val);
          sessionStorage.setItem('mathtree_selected_entity_id', val);
        } else {
          localStorage.removeItem('mathtree_selected_entity_id');
          sessionStorage.removeItem('mathtree_selected_entity_id');
        }
      } catch (e) {}

      try {
        if (typeof BroadcastChannel !== 'undefined') {
          const bc = new BroadcastChannel('mathtree_store_channel');
          bc.postMessage({ type: 'ENTITY_CHANGED', event: 'mathtree:entity-changedd', entityId: val, llc: val });
          bc.close();
        }
      } catch (e) {}

      window.dispatchEvent(new CustomEvent('mathtree:entity-changed', { detail: { entityId: val, llc: val } }));
      window.dispatchEvent(new CustomEvent('mathtree:entity-changedd', { detail: { entityId: val, llc: val } }));
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
        if (loadedDeal.metrics) {
          setMetrics(loadedDeal.metrics as any);
        }
        sessionStorage.setItem('mathtree_active_deal_id', loadedDeal.id);
        localStorage.setItem('mathtree_active_deal_id', loadedDeal.id);
      }
    } catch (err: any) {
      console.error('Error loading deal:', err);
      setError(err.message || 'Failed to load deal');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDeal(initialDealId);
  }, [loadDeal, initialDealId]);

  const updateInputs = useCallback((newInputs: Partial<DealInputs>) => {
    setDeal((prev) => {
      if (!prev) return null;
      const mergedInputs: DealInputs = { ...prev.inputs, ...newInputs };
      const updatedDeal: DealRecord = { ...prev, inputs: mergedInputs };
      return updatedDeal;
    });
  }, []);

  const saveDeal = useCallback(async (): Promise<boolean> => {
    if (!deal) return false;
    try {
      const payload = {
        purchase_price: deal.inputs.purchasePrice,
        inputs: deal.inputs as any,
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
  }, [deal]);

  const filterLeasesByEntity = useCallback((entityId: string | null) => {
    if (!deal || !deal.inputs?.leases) return [];
    if (!entityId || entityId === 'all') return deal.inputs.leases;
    return deal.inputs.leases.filter((l: any) => (l && (l.entity_id === entityId || l.entityId === entityId || l.llc_id === entityId || l.entity === entityId)));
  }, [deal]);

  const filterLeasesByLLC = useCallback((llc: string | null) => {
    if (!deal || !deal.inputs?.leases) return [];
    if (!llc || llc === 'all') return deal.inputs.leases;
    return deal.inputs.leases.filter((l: any) => (l && (l.entity_id === llc || l.entityId === llc || l.llc_id === llc || l.entity === llc)));
  }, [deal]);

  const filteredLeases = (deal && deal.inputs && Array.isArray(deal.inputs.leases)) ? filterLeasesByLLC(selectedLLCFilter || selectedEntityId) : [];

  return {
    deal,
    metrics,
    loading,
    error,
    activeTab,
    isEditModalOpen,
    selectedEntityId,
    selectedLLC,
    selectedLLCFilter,
    entities,
    filteredLeases,
    netEquityNAV,
    totalGAV,
    currentLoanBalance,
    blendedLTV,
    amortizationSchedule,
    setActiveTab,
    setIsEditModalOpen,
    setSelectedEntityId,
    setSelectedLLC,
    setSelectedLLCFilter,
    setEntities,
    loadEntities,
    filterLeasesByEntity,
    filterLeasesByLLC,
    updateInputs,
    saveDeal,
    loadDeal,
    loadPortfolioEquityAndAmortization,
  };
}
