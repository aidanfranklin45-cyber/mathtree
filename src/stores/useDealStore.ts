import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, BENCHMARK_DEAL } from '../lib/supabase/client';
import { DealRecord, DealInputs, DealMetrics } from '../lib/math/types';
import { resolvePointInTimeDealMetrics } from '../lib/math/pointInTime';

/** Top-level deal columns that can be patched alongside inputs. */
export interface DealTopPatch {
  location?: string;
  purchase_price?: number;
  title?: string;
  status?: string;
  entity_id?: string | null;
}

export interface DealStoreState {
  deal: DealRecord | null;
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
  /** Merge facts into the deal (inputs and optional top-level fields) and persist them immediately. */
  patchDeal: (inputsPatch: Partial<DealInputs>, top?: DealTopPatch) => Promise<boolean>;
  loadDeal: (dealId?: string) => Promise<void>;
  loadPortfolioEquityAndAmortization: (entityId?: string | null) => Promise<void>;
}

// Map Postgres deal row into standard DealRecord
export function mapSupabaseDeal(d: any): DealRecord {
  // Inputs are the database facts, verbatim. The mapper must never invent values (a fabricated
  // alias such as vacancyRatePercent would shadow a legitimate 0 in the engine's alias chains).
  const raw: Record<string, any> = (d.inputs && typeof d.inputs === 'object') ? { ...d.inputs } : {};
  // A string once got spread into inputs on one deal (keys "0".."7" spelling "prospect"); never carry such keys forward.
  Object.keys(raw).forEach((k) => { if (/^d+$/.test(k)) delete raw[k]; });
  const inputs: DealInputs = {
    purchasePrice: parseFloat(d.purchase_price) || 0,
    ...raw,
    leases: Array.isArray(raw.leases) ? raw.leases : [],
    parcels: Array.isArray(raw.parcels) ? raw.parcels : [],
    assessorData: raw.assessorData || {},
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
    status: d.status || 'prospect',
    purchase_price: parseFloat(d.purchase_price) || inputs.purchasePrice || 0,
    // Analysis (IRR, equity, cash flow, ...) is never read from the row; it is computed on demand.
    is_demo: d.is_demo || false,
    inputs,
    created_at: d.created_at,
    updated_at: d.updated_at,
  };
}

export function useDealStore(initialDealId?: string): DealStoreState {
  const [deal, setDeal] = useState<DealRecord | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>(() => {
    // Deep links such as /project?id=...&tab=debt (the legacy project-<tab>.html pages redirect here)
    const t = new URLSearchParams(window.location.search).get('tab');
    // Empty means "no explicit choice": the deal screen then opens the tab its stage leads with (see lib/studio/stageLens.ts)
    return t && ['performance', 'operate', 'overview', 'proforma', 'property', 'debt', 'diligence', 'sensitivity'].includes(t) ? t : '';
  });
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
      { id: 'ent-demo-1', name: 'Apex Real Estate Capital LLC', formation_state: 'WA' },
      { id: 'ent-demo-2', name: 'Cascade Property Holdings LLC', formation_state: 'DE' }
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
    }
  }, [selectedEntityId, selectedLLC]);

  // Portfolio equity is derived on the fly from each owned deal's facts (inputs + closing date);
  // only rent receipts are fetched from the database.
  const loadPortfolioEquityAndAmortization = useCallback(async (entityIdFilter?: string | null) => {
    try {
      const targetEntity = (entityIdFilter && entityIdFilter !== 'all') ? entityIdFilter : null;

      let dealsQuery = supabase.from('deals').select('id, purchase_price, inputs, asset_type, entity_id, status, created_at, updated_at');
      if (targetEntity) {
        dealsQuery = dealsQuery.eq('entity_id', targetEntity);
      }
      const { data: dealsData, error: dealsErr } = await dealsQuery;
      if (dealsErr || !dealsData) return;

      const owned = dealsData.filter((d: any) => d.status === 'owned').map(mapSupabaseDeal);
      const today = new Date();
      let sumGAV = 0;
      let sumLoan = 0;
      let sumEquity = 0;
      owned.forEach((deal) => {
        const pit = resolvePointInTimeDealMetrics(deal, today);
        sumGAV += pit.currentVal;
        sumLoan += pit.currentDebt;
        sumEquity += pit.currentEquity;
      });

      setTotalGAV(sumGAV);
      setCurrentLoanBalance(sumLoan);
      setNetEquityNAV(sumEquity);
      setBlendedLTV(sumGAV > 0 ? Number(((sumLoan / sumGAV) * 100).toFixed(2)) : 0);

      const dealIds = dealsData.map((d: any) => d.id);
      if (dealIds.length > 0) {
        const { data: paymentsData } = await supabase
          .from('rent_payments')
          .select('id, deal_id, lease_id, period_month, due_date, amount_due, amount_paid, paid_date, status, payment_method, reference_note, snooze_until')
          .in('deal_id', dealIds);
        if (paymentsData) {
          const sorted = [...paymentsData].sort((x: any, y: any) => new Date(y.period_month).getTime() - new Date(x.period_month).getTime());
          setAmortizationSchedule(sorted);
        }
      }
    } catch (err) {
      console.warn('[Store] Could not load portfolio equity:', err);
    }
  }, []);

  // Realtime Supabase Channel Subscription for rent_payments and deals
  // The channel is created once; handlers read the latest entity from this ref so an entity switch never rebuilds it.
  const selectedEntityIdRef = useRef<string | null>(selectedEntityId);
  selectedEntityIdRef.current = selectedEntityId;

  // Refetch when the selected entity changes.
  useEffect(() => {
    loadPortfolioEquityAndAmortization(selectedEntityId);
  }, [loadPortfolioEquityAndAmortization, selectedEntityId]);

  useEffect(() => {
    const channelName = `mathtree_realtime_equity_${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rent_payments' },
        (payload) => {
          console.log('[Store Realtime] rent_payments changed:', payload.eventType);
          loadPortfolioEquityAndAmortization(selectedEntityIdRef.current);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'deals' },
        (payload) => {
          console.log('[Store Realtime] deals changed:', payload.eventType);
          loadPortfolioEquityAndAmortization(selectedEntityIdRef.current);
        }
      )
      .subscribe((status) => {
        console.log('[Store Realtime] Channel status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadPortfolioEquityAndAmortization]);

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
      const mergedInputs: DealInputs = { ...prev.inputs, ...(newInputs && typeof newInputs === 'object' ? newInputs : {}) };
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

  const patchDeal = useCallback(async (inputsPatch: Partial<DealInputs>, top: DealTopPatch = {}): Promise<boolean> => {
    if (!deal) return false;
    const inputs = { ...deal.inputs, ...inputsPatch } as DealInputs;
    setDeal((prev) => (prev ? ({ ...prev, ...top, inputs: { ...prev.inputs, ...inputsPatch } } as DealRecord) : prev));
    const payload: Record<string, any> = {
      inputs,
      purchase_price: top.purchase_price ?? inputs.purchasePrice,
      updated_at: new Date().toISOString(),
    };
    if (top.location !== undefined) payload.location = top.location;
    if (top.title !== undefined) payload.title = top.title;
    if (top.status !== undefined) payload.status = top.status;
    if (top.entity_id !== undefined) payload.entity_id = top.entity_id;
    const { error: saveErr } = await supabase.from('deals').update(payload as any).eq('id', deal.id);
    if (saveErr) console.warn('Database save warning:', saveErr);
    return !saveErr;
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
    patchDeal,
    loadDeal,
    loadPortfolioEquityAndAmortization,
  };
}
