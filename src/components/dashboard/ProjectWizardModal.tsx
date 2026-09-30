import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import { AddressService } from '../../lib/services/addressService';
import { getBenchmarkCapRateRange, calculateProjections } from '../../lib/engine';
import { getProfile } from '../../lib/profile';
import { mapSupabaseDeal } from '../../stores/useDealStore';
import { formatCurrency } from '../../lib/format';
import type { DealRecord } from '../../lib/math/types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (project: DealRecord) => void;
  /** Opens the LLC / entity portal (legacy "Manage / Add LLC"). */
  onManageEntities?: () => void;
}

type Asset = 'single-family' | 'multi-unit' | 'commercial' | 'storage';

interface Defaults {
  name: string; location: string; marketTier: string; propertyClass: string; facilityType: string; subTypes: string[];
  gla: number; leaseType: string; price: number; down: number; closing: number; rehab: number; rent: number; other: number;
  vacancy: number; rentGrowth: number; opexRatio: number; expenseGrowth: number; rate: number; amort: number; exitCap: number; apprec: number;
  sfrArv?: number; sfrSqFt?: number; multiUnits?: number; multiSqFt?: number; rentPerUnit?: number; commSqFt?: number; annualRent?: number;
  storageUnits?: number; storageSqFt?: number; isAutomated?: boolean;
}

const DEFAULTS: Record<Asset, Defaults> = {
  'single-family': {
    name: 'Benchmark Gamma: Single-Family BRRRR Case', location: 'Synthetic Model • Generic Metro', marketTier: 'Tier 2', propertyClass: 'Class B',
    facilityType: 'BRRRR Value-Add Single-Family',
    subTypes: ['Turnkey Single-Family Rental', 'BRRRR Value-Add Single-Family', 'New Construction Spec SFR', 'Single-Family Fix & Flip'],
    gla: 2400, sfrSqFt: 2400, sfrArv: 450000, leaseType: 'Gross', price: 450000, down: 20, closing: 9000, rehab: 20000, rent: 3200, other: 0,
    vacancy: 4.0, rentGrowth: 3.0, opexRatio: 30.0, expenseGrowth: 2.5, rate: 6.5, amort: 30, exitCap: 6.0, apprec: 3.5,
  },
  'multi-unit': {
    name: 'Benchmark Beta: 12-Unit Multifamily Value-Add', location: 'Synthetic Model • Generic Metro', marketTier: 'Tier 2', propertyClass: 'Class B',
    facilityType: 'Garden-Style Community',
    subTypes: ['Garden-Style Community', 'Mid / High-Rise Apartments', 'Duplex / Triplex / Quadplex (2-4 Units)', 'Build-to-Rent (BTR) Community'],
    multiUnits: 12, multiSqFt: 11000, gla: 11000, leaseType: 'Gross', rentPerUnit: 1500, price: 1850000, down: 25, closing: 37000, rehab: 75000,
    rent: 18000, other: 800, vacancy: 6.0, rentGrowth: 3.5, opexRatio: 40.0, expenseGrowth: 2.5, rate: 6.25, amort: 30, exitCap: 6.5, apprec: 4.0,
  },
  commercial: {
    name: 'Benchmark Alpha: Class-A Industrial Facility', location: 'Synthetic Model • Generic Metro', marketTier: 'Tier 1', propertyClass: 'Class A',
    facilityType: 'Industrial Logistics / Warehouse',
    subTypes: ['Industrial Logistics / Warehouse', 'Retail Strip / Center', 'Class-A Office / Medical', 'Flex / R&D Facility'],
    gla: 15000, commSqFt: 15000, leaseType: 'NNN', annualRent: 150000, price: 1200000, down: 25, closing: 24000, rehab: 50000, rent: 12500, other: 500,
    vacancy: 5.0, rentGrowth: 3.0, opexRatio: 35.0, expenseGrowth: 2.5, rate: 6.5, amort: 30, exitCap: 6.75, apprec: 3.5,
  },
  storage: {
    name: 'Benchmark Delta: Automated Self-Storage Facility', location: 'Synthetic Model • Generic Metro', marketTier: 'Tier 1', propertyClass: 'Class A',
    facilityType: 'Drive-Up Standard (Single-Story)',
    subTypes: ['Climate-Controlled (Multi-Story)', 'Drive-Up Standard (Single-Story)', 'Outdoor / RV & Boat Parking', 'Hybrid Flex Facility'],
    storageUnits: 20, storageSqFt: 2000, isAutomated: true, leaseType: 'Gross', rentPerUnit: 85, gla: 2000, price: 230000, down: 30, closing: 4600, rehab: 5000,
    rent: 1700, other: 0, vacancy: 5.0, rentGrowth: 3.0, opexRatio: 30.0, expenseGrowth: 2.5, rate: 6.75, amort: 25, exitCap: 7.2, apprec: 3.0,
  },
};

const ASSET_CARDS: { id: Asset; icon: string; title: string; sub: string }[] = [
  { id: 'single-family', icon: '🏡', title: 'Single-Family', sub: 'SFR, Turnkey, BRRRR' },
  { id: 'multi-unit', icon: '🏢', title: 'Multi-Unit', sub: 'Duplex to 50+ Units' },
  { id: 'commercial', icon: '🏬', title: 'Commercial RE', sub: 'Retail, Office, Industrial' },
  { id: 'storage', icon: '📦', title: 'Storage Units', sub: 'Self-storage, Flex Warehouses' },
];

const ASSET_BADGES: Record<Asset, string> = {
  'single-family': 'Single-Family', 'multi-unit': 'Multi-Unit Multifamily', commercial: 'Commercial Real Estate', storage: 'Self-Storage Facility',
};

const STEP_TITLES: Record<number, string> = { 1: 'Asset Class & Identity', 2: 'Capital & Valuation', 3: 'Income & Operations', 4: 'Debt & Exit Strategy' };

const LEASE_HINT: Record<string, string> = {
  NNN: 'NNN • Tenant reimburses taxes, insurance & CAM',
  Gross: 'Gross • Landlord absorbs operating expenses',
  'Modified Gross': 'Modified Gross • Landlord & tenant share expenses',
  'Absolute Net': 'Absolute Net (Bond) • Zero landlord capital obligation',
};

type W = Record<string, string>;

const seed = (a: Asset): W => {
  const d = DEFAULTS[a];
  const s = (n: unknown) => String(n ?? '');
  return {
    name: d.name, location: d.location, entity: '', asset: a, gla: s(d.gla), leaseType: d.leaseType,
    rehabMode: 'out_of_pocket', facilityType: d.facilityType, marketTier: d.marketTier, propertyClass: d.propertyClass,
    price: s(d.price), down: s(d.down), closing: s(d.closing), rehab: s(d.rehab), grossRent: s(d.rent), other: s(d.other),
    vacancy: s(d.vacancy), rentGrowth: s(d.rentGrowth), opexRatio: s(d.opexRatio), expenseGrowth: s(d.expenseGrowth),
    rate: s(d.rate), amort: s(d.amort), exitCap: s(d.exitCap), apprec: s(d.apprec),
    storageUnits: s(d.storageUnits ?? 20), storageSqft: s(d.storageSqFt ?? 2000), storageAutomated: String(d.isAutomated !== false),
    storageRentPerUnit: s(d.rentPerUnit ?? 85), storageGrossRent: s(d.rent ?? 1700),
    multiUnits: s(d.multiUnits ?? 12), multiSqft: s(d.multiSqFt ?? 11000), multiRentPerUnit: s(d.rentPerUnit ?? 1500), multiGrossRent: s(d.rent ?? 18000),
    commSqft: s(d.commSqFt ?? 15000), commAnnualRent: s(d.annualRent ?? d.rent * 12), commGrossRent: s(d.rent),
    sfrArv: s(d.sfrArv ?? 450000), sfrSqft: s(d.sfrSqFt ?? 2400), sfrGrossRent: s(d.rent),
    financingType: 'fixed', armInitial: '5', armRate: '7.75', armCap: '9.5', ioYears: '3',
  };
};

const inputBase = 'w-full bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500';
const lbl = 'text-xs font-bold uppercase tracking-wider text-slate-300';
const lbl2 = 'text-[11px] font-bold uppercase tracking-wider text-slate-300';
const inputSm = 'w-full bg-slate-900 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-brand-500 font-bold';
const inputLg = 'w-full bg-slate-900 border border-slate-800 rounded-xl py-2.5 px-3.5 text-sm text-white focus:outline-none focus:border-brand-500 font-bold';
const modeBtn = (active: boolean) =>
  `py-2.5 px-3 rounded-xl text-xs font-bold transition flex flex-col items-center justify-center border text-center ${
    active ? 'bg-brand-500/20 text-brand-300 border-brand-500/40 shadow-sm' : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
  }`;

const num = (v: string, fb = 0) => { const n = parseFloat(v); return isNaN(n) ? fb : n; };
const int = (v: string, fb = 0) => { const n = parseInt(v, 10); return isNaN(n) ? fb : n; };

export const ProjectWizardModal: React.FC<Props> = ({ isOpen, onClose, onProjectCreated, onManageEntities }) => {
  const [step, setStep] = useState(1);
  const [w, setW] = useState<W>(() => seed('commercial'));
  const [entities, setEntities] = useState<{ id: string; name: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addrResults, setAddrResults] = useState<any[]>([]);
  const [addrOpen, setAddrOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [assessor, setAssessor] = useState<any>(null);
  const [parcels, setParcels] = useState<any[]>([]);
  const [companions, setCompanions] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!isOpen) return;
    setStep(1); setW(seed('commercial')); setError(null); setSubmitting(false);
    setAssessor(null); setParcels([]); setCompanions(0); setAddrResults([]); setAddrOpen(false);
    supabase.from('entities').select('id,name').order('name').then(({ data }) => setEntities((data as any[]) ?? []));
  }, [isOpen]);

  const set = (patch: W) => setW((p) => ({ ...p, ...patch }));
  const asset = w.asset as Asset;

  const pkg = useMemo(() => {
    try { return AddressService.aggregateParcelPackage(parcels) as any; } catch { return { totalAcres: 0, totalSqFt: 0, totalAssessedValue: 0, totalParcels: 0 }; }
  }, [parcels]);

  const selectAsset = (a: Asset) => set(seed(a));

  const benchmark = useMemo(() => {
    try { return getBenchmarkCapRateRange(asset, w.marketTier, w.propertyClass, w.facilityType) as any; } catch { return null; }
  }, [asset, w.marketTier, w.propertyClass, w.facilityType]);

  const guidance = useMemo(() => {
    const tierDesc = w.marketTier.includes('1') ? 'Primary Gateway Metro (High Liquidity, Low Cap Rates)'
      : w.marketTier.includes('2') ? 'Secondary Growth Metro (Core-Plus Yields)' : 'Tertiary / Regional Market (Higher Yields, Lower Liquidity)';
    const classDesc = w.propertyClass.includes('A') ? 'Trophy/Institutional Quality' : w.propertyClass.includes('B') ? 'Value-Add / Core-Plus' : 'Workforce Housing / Opportunity';
    return `${tierDesc} • ${classDesc}`;
  }, [w.marketTier, w.propertyClass]);

  const gisBadge = /spokane/i.test(w.location) ? '🏛️ Spokane County GIS'
    : /yakima|selah|union gap|sunnyside|toppenish|wapato|zillah/i.test(w.location) ? '🏛️ Yakima GIS' : '🏛️ Live County GIS';

  // ---- Upfront capital (derived on demand from the shared engine's own definitions) ----
  const cash = useMemo(() => {
    const price = num(w.price); const downPct = num(w.down); const closing = num(w.closing); const rehab = num(w.rehab);
    const rolled = w.rehabMode === 'roll_into_loan';
    const basis = rolled ? price + closing + rehab : price;
    const downAmt = basis * (downPct / 100);
    const total = rolled ? downAmt : downAmt + closing + rehab;
    const financed = rolled ? (closing + rehab) * ((100 - downPct) / 100) : 0;
    return { rolled, basis, downAmt, total, financed, downPct };
  }, [w.price, w.down, w.closing, w.rehab, w.rehabMode]);

  // ---- Address search ----
  const onLocation = (val: string) => {
    set({ location: val });
    clearTimeout(timer.current);
    if (!val || val.trim().length < 2) { setAddrOpen(false); setAddrResults([]); return; }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try { setAddrResults((await AddressService.searchAddresses(val)) || []); setAddrOpen(true); }
      catch { /* ignore */ }
      finally { setSearching(false); }
    }, 250);
  };

  const countyOf = (item: any) => {
    const isYakima = item.isYakimaCounty || /yakima/i.test(item.county || '');
    const isSpokane = item.isSpokaneCounty || /spokane/i.test(item.county || '');
    const raw = (item.county || (isYakima ? 'Yakima' : isSpokane ? 'Spokane' : '')).replace(/\s*County/i, '').trim();
    return { isYakima, isSpokane, raw, label: raw ? `${raw} County` : '' };
  };

  const selectAddress = async (item: any) => {
    const { isYakima, isSpokane } = countyOf(item);
    const patch: W = { location: item.formattedAddress };
    if (isYakima || isSpokane) patch.marketTier = isSpokane ? 'Tier 2' : 'Tier 3';
    set(patch);
    setAddrOpen(false);
    try {
      const data = await AddressService.resolveParcelDetails(item);
      if (!data) return;
      setAssessor(data);
      setParcels([{ ...data, isPrimary: true, included: true }]);
      setCompanions(0);
      if ((!w.gla || w.gla === '15000') && data.sqft > 0) set({ gla: String(Math.min(data.sqft, 25000)) });
      if (data.apn) {
        const found = (await AddressService.detectNearbySameOwnerParcels(data.apn, data.owner, data)) || [];
        if (found.length) {
          setCompanions(found.length);
          setParcels((prev) => {
            const next = [...prev];
            found.forEach((p: any) => { if (!next.some((e) => e.apn === p.apn)) next.push({ ...p, isPrimary: false, included: false }); });
            return next;
          });
        }
      }
    } catch (e) {
      console.warn('Assessor resolve warning:', e);
    }
  };

  const applyAssessedValue = () => {
    const v = pkg.totalAssessedValue || assessor?.totalAssessedValue;
    if (!v) return;
    set({ price: String(v) });
    window.alert(`Applied Assessor Package Value ($${Number(v).toLocaleString()}) as Purchase Price.`);
  };

  // ---- Bidirectional income sync ----
  const syncStorage = (from: 'rpu' | 'tot', v: string) => {
    const u = int(w.storageUnits, 20) || 20;
    if (from === 'rpu') { const tot = num(v) * u; set({ storageRentPerUnit: v, storageGrossRent: String(tot), grossRent: String(tot) }); }
    else { set({ storageGrossRent: v, storageRentPerUnit: String(u > 0 ? Math.round(num(v) / u) : 0), grossRent: v }); }
  };
  const syncMulti = (from: 'rpu' | 'tot', v: string) => {
    const u = int(w.multiUnits, 12) || 12;
    if (from === 'rpu') { const tot = num(v) * u; set({ multiRentPerUnit: v, multiGrossRent: String(tot), grossRent: String(tot) }); }
    else { set({ multiGrossRent: v, multiRentPerUnit: String(u > 0 ? Math.round(num(v) / u) : 0), grossRent: v }); }
  };
  const syncComm = (from: 'ann' | 'mo', v: string) => {
    if (from === 'ann') { const m = Math.round(num(v) / 12); set({ commAnnualRent: v, commGrossRent: String(m), grossRent: String(m) }); }
    else { set({ commGrossRent: v, commAnnualRent: String(num(v) * 12), grossRent: v }); }
  };

  const next = () => { setError(null); setStep((s) => Math.min(4, s + 1)); };
  const back = () => { setError(null); setStep((s) => Math.max(1, s - 1)); };

  // ---- Submit: insert facts only; every analysis figure is computed on demand ----
  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const name = w.name.trim() || 'New Underwriting Project';
      const location = w.location.trim() || 'United States';
      const purchasePrice = num(w.price) || 1000000;
      const downPaymentPercent = num(w.down) || 25;
      const interestRate = num(w.rate) || 6.5;

      let grossRent = num(w.grossRent);
      let unitCount = 1; let storageUnitCount = 20; let storageSqFt = 2000; let isAutomated = false; let rentPerUnit = 0; let arv = 0;
      let gla = num(w.gla);

      if (asset === 'storage') {
        storageUnitCount = int(w.storageUnits, 20) || 20; unitCount = storageUnitCount;
        storageSqFt = num(w.storageSqft, 2000) || 2000; gla = storageSqFt;
        isAutomated = w.storageAutomated === 'true';
        rentPerUnit = num(w.storageRentPerUnit);
        const tot = num(w.storageGrossRent);
        grossRent = tot > 0 ? tot : rentPerUnit > 0 ? rentPerUnit * storageUnitCount : 1700;
        if (!rentPerUnit && grossRent > 0 && storageUnitCount > 0) rentPerUnit = Math.round(grossRent / storageUnitCount);
      } else if (asset === 'multi-unit') {
        unitCount = int(w.multiUnits, 12) || 12; gla = num(w.multiSqft, 11000) || 11000;
        rentPerUnit = num(w.multiRentPerUnit);
        const tot = num(w.multiGrossRent);
        grossRent = tot > 0 ? tot : rentPerUnit > 0 ? rentPerUnit * unitCount : 18000;
        if (!rentPerUnit && grossRent > 0 && unitCount > 0) rentPerUnit = Math.round(grossRent / unitCount);
      } else if (asset === 'commercial') {
        gla = num(w.commSqft) || gla || 15000;
        const tot = num(w.commGrossRent); const ann = num(w.commAnnualRent);
        grossRent = tot > 0 ? tot : ann > 0 ? Math.round(ann / 12) : 12500;
      } else {
        unitCount = 1; gla = num(w.sfrSqft, 2400) || 2400; arv = num(w.sfrArv);
        const r = num(w.sfrGrossRent);
        grossRent = r > 0 ? r : 3200;
      }
      if (!grossRent || grossRent <= 0) grossRent = asset === 'storage' ? 1700 : asset === 'multi-unit' ? 18000 : 12500;

      const a: any = assessor;
      const profile = getProfile();
      const isStorage = asset === 'storage';
      const inputs: Record<string, any> = {
        purchasePrice, downPaymentPercent, interestRate,
        loanTerm: int(w.amort, 25) || 25,
        rehabCosts: num(w.rehab), closingCosts: num(w.closing) || purchasePrice * 0.02,
        rehabFinancingMode: w.rehabMode, financeRehabAndClosingCosts: w.rehabMode === 'roll_into_loan',
        grossRentPerMonth: grossRent, grossRentAnnual: grossRent * 12, monthlyRent: grossRent,
        unitCount, numUnits: unitCount,
        storageUnitCount: isStorage ? storageUnitCount : undefined,
        storageSqFt: isStorage ? storageSqFt : undefined,
        totalSqFt: isStorage ? storageSqFt : gla || 0,
        gla: gla || 0,
        isAutomated: isStorage ? isAutomated : undefined,
        storageRentPerUnit: isStorage ? rentPerUnit || Math.round(grossRent / storageUnitCount) : undefined,
        monthlyRentPerUnit: isStorage ? rentPerUnit || Math.round(grossRent / storageUnitCount)
          : asset === 'multi-unit' ? rentPerUnit || Math.round(grossRent / unitCount) : undefined,
        leaseType: w.leaseType || (asset === 'commercial' ? 'NNN' : 'Gross'),
        arv: asset === 'single-family' ? arv : undefined,
        vacancyRate: num(w.vacancy) || 5,
        expenseRatio: num(w.opexRatio) || 35, operatingExpenseRatio: num(w.opexRatio) || 35,
        rentGrowth: num(w.rentGrowth) || 3, annualRentGrowth: num(w.rentGrowth) || 3,
        targetCapRate: num(w.exitCap) || 6.5,
        marketTier: w.marketTier, propertyClass: w.propertyClass, facilityType: w.facilityType,
        commTier: w.marketTier, commClass: w.propertyClass, storageTier: w.marketTier, storageClass: w.propertyClass,
        exitYear: profile.exitYear, discountRate: profile.discountRate, exitCapTiming: profile.exitCapTiming,
        county: a?.county || null, primaryApn: a?.apn || null,
        totalAcreage: a?.packageAcres || pkg.totalAcres || a?.acres || null,
        totalAssessedValue: pkg.totalAssessedValue || a?.totalAssessedValue || null,
        marketLandValue: a?.marketLandValue || null, marketImprovementValue: a?.marketImprovementValue || null,
        acres: a?.acres || null, sqft: a?.sqft || null, yearBuilt: a?.yearBuilt || null, buildingSqFt: a?.buildingSqFt || null,
        stories: a?.stories || null, constructionType: a?.constructionType || null, condition: a?.condition || null, hvac: a?.hvac || null,
        zoning: a?.zoning || null, useCode: a?.useCode || null, owner: a?.owner || null, legalDescription: a?.legalDescription || null,
        assessorPortalUrl: a?.assessorPortalUrl || null, taxYear: a?.taxYear || null,
        assessorData: a || null,
        parcels: parcels.length ? parcels : a ? [a] : [],
        gisSync: { lastSyncedAt: new Date().toISOString(), syncSource: a?.source || 'county_arcgis', status: 'active' },
        financingType: w.financingType,
        armInitialYears: int(w.armInitial, 5), armAdjustmentRate: num(w.armRate, 7.75), armRateCap: num(w.armCap, 9.5),
        interestOnlyYears: int(w.ioYears, 3),
        entity_id: w.entity || null,
      };
      Object.keys(inputs).forEach((k) => inputs[k] === undefined && delete inputs[k]);

      // Sanity check the assumptions run through the engine before anything is saved (nothing from it is stored).
      try { calculateProjections(asset, inputs); } catch (e) { console.warn('Engine check notice:', e); }

      const { data: userRes } = await supabase.auth.getUser();
      const user = userRes?.user;
      if (!user) throw new Error('Please sign in to create a project.');

      const { data, error: insErr } = await supabase
        .from('deals')
        .insert({
          user_id: user.id, entity_id: w.entity || null, title: name, asset_type: asset, status: 'prospect',
          location, purchase_price: purchasePrice, inputs: inputs as any,
        } as any)
        .select()
        .single();
      if (insErr || !data) throw new Error(insErr?.message || 'Failed to create project record');

      onProjectCreated(mapSupabaseDeal(data));
      onClose();
    } catch (err: any) {
      console.error('Wizard error:', err);
      setError(err?.message || 'Could not create the project');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const stepDivs = (
    <>
      {/* Step 1 */}
      <div className={`space-y-5 ${step === 1 ? '' : 'hidden'}`}>
        <div className="space-y-1.5">
          <label htmlFor="wiz-deal-name" className={lbl}>Project / Deal Name</label>
          <input id="wiz-deal-name" type="text" placeholder="e.g. Industrial Logistics Center Alpha" value={w.name} onChange={(e) => set({ name: e.target.value })}
            className={`${inputBase} py-2.5 px-3.5 text-sm placeholder-slate-600 font-medium`} />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="wiz-entity-select" className={lbl}>Ownership Entity (LLC)</label>
            <button type="button" onClick={onManageEntities} className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 transition flex items-center space-x-1">
              <span>+</span><span>Manage / Add LLC</span>
            </button>
          </div>
          <div className="relative">
            <select id="wiz-entity-select" value={w.entity} onChange={(e) => set({ entity: e.target.value })}
              className={`${inputBase} py-2.5 px-3.5 text-xs appearance-none cursor-pointer`}>
              <option value="">No Entity Assigned (Holding / Unassigned)</option>
              {entities.map((en) => <option key={en.id} value={en.id}>{en.name || 'Unnamed Entity'}</option>)}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className={lbl}>Select Property Asset Class</label>
          <div className="grid grid-cols-2 gap-3">
            {ASSET_CARDS.map((c) => {
              const active = asset === c.id;
              return (
                <div key={c.id} role="button" tabIndex={0} aria-label={`${c.title} asset class`} onClick={() => selectAsset(c.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectAsset(c.id); }}
                  className={`p-3.5 rounded-xl cursor-pointer transition flex items-center space-x-3 focus:outline-none focus:ring-2 focus:ring-brand-500 ${active ? 'border-2 border-brand-500 bg-brand-500/10' : 'border border-slate-800 hover:border-brand-500 bg-slate-950/60'}`}>
                  <div className={`w-8 h-8 rounded-lg text-brand-400 flex items-center justify-center font-bold text-sm ${active ? 'bg-brand-500/20' : 'bg-brand-500/10'}`}>{c.icon}</div>
                  <div>
                    <div className="text-xs font-bold text-white">{c.title}</div>
                    <div className="text-[10px] text-slate-400">{c.sub}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5 relative">
          <div className="flex items-center justify-between">
            <label htmlFor="wiz-location" className={lbl}>Location / Street Address</label>
            <span className="text-[10px] text-emerald-400 font-semibold flex items-center space-x-1">
              <span>{gisBadge}</span>
              {searching && <span className="animate-spin text-[10px]">⏳</span>}
            </span>
          </div>
          <input id="wiz-location" type="text" autoComplete="off" placeholder="e.g. 128 N 2nd St, Yakima, WA" value={w.location}
            onChange={(e) => onLocation(e.target.value)} onFocus={() => { if (w.location.length >= 2 && addrResults.length) setAddrOpen(true); }}
            className={`${inputBase} py-2.5 px-3 text-xs placeholder-slate-600`} />
          {addrOpen && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 max-h-56 overflow-y-auto">
              {addrResults.length === 0 ? (
                <div className="p-2.5 text-xs text-slate-500 italic">No matching addresses found</div>
              ) : addrResults.map((item, idx) => {
                const c = countyOf(item);
                return (
                  <div key={idx} onClick={() => selectAddress(item)} className="p-2.5 hover:bg-slate-800/80 cursor-pointer border-b border-slate-800/60 last:border-0 transition text-left">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white">{item.street || item.formattedAddress}</span>
                      {item.apn ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">🏛️ {c.label ? `${c.label} ` : ''}APN: {item.apn}</span>
                      ) : c.label ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-brand-500/10 text-brand-400 border border-brand-500/20">📍 {c.label} • Geocoded</span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-800 text-slate-400">OpenStreetMap</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400">{item.formattedAddress}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-3.5 bg-slate-950/70 rounded-2xl border border-slate-800/90 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200">Asset Specifications &amp; Parameters</span>
            <span className="text-[10px] font-semibold text-brand-400 bg-brand-500/10 border border-brand-500/20 px-2 py-0.5 rounded-md">{ASSET_BADGES[asset]}</span>
          </div>

          {asset === 'storage' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className={lbl2}>Total Storage Units</label>
                  <input type="number" min={1} placeholder="e.g. 20" value={w.storageUnits} onChange={(e) => set({ storageUnits: e.target.value })} className={inputSm} />
                </div>
                <div className="space-y-1.5">
                  <label className={lbl2}>Rentable Facility Area (Sq Ft)</label>
                  <input type="number" min={100} placeholder="e.g. 2000" value={w.storageSqft} onChange={(e) => set({ storageSqft: e.target.value })} className={inputSm} />
                </div>
              </div>
              <label className="flex items-center space-x-2.5 cursor-pointer p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
                <input type="checkbox" checked={w.storageAutomated === 'true'} onChange={(e) => set({ storageAutomated: String(e.target.checked) })}
                  className="w-4 h-4 rounded text-brand-500 bg-slate-950 border-slate-700 focus:ring-brand-500 cursor-pointer" />
                <div>
                  <span className="text-xs font-bold text-white">Automated Facility (Remote / Keypad Access)</span>
                  <p className="text-[10px] text-slate-400">Unmanned or kiosk operations with reduced payroll &amp; operational overhead.</p>
                </div>
              </label>
            </div>
          )}

          {asset === 'multi-unit' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className={lbl2}>Total Apartment Units</label>
                  <input type="number" min={1} placeholder="e.g. 12" value={w.multiUnits} onChange={(e) => set({ multiUnits: e.target.value })} className={inputSm} />
                </div>
                <div className="space-y-1.5">
                  <label className={lbl2}>Gross Leasable Area (GLA Sq Ft)</label>
                  <input type="number" min={100} placeholder="e.g. 11000" value={w.multiSqft} onChange={(e) => set({ multiSqft: e.target.value })} className={inputSm} />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1.5 pb-1 border-b border-slate-800/60">
            <div className="flex items-center justify-between">
              <label htmlFor="wiz-lease-type" className={lbl2}>Primary Lease Structure</label>
              <span className="text-[10px] text-slate-400">{LEASE_HINT[w.leaseType] || ''}</span>
            </div>
            <select id="wiz-lease-type" value={w.leaseType} onChange={(e) => set({ leaseType: e.target.value })}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-brand-500 font-bold">
              <option value="Gross">Full Service Gross • Landlord absorbs operating expenses</option>
              <option value="Modified Gross">Modified Gross • Landlord &amp; tenant share expenses</option>
              <option value="NNN">Triple Net (NNN) • Tenant reimburses taxes, insurance &amp; CAM</option>
              <option value="Absolute Net">Absolute Net (Bond Lease) • Zero landlord capital obligation</option>
            </select>
          </div>

          {asset === 'commercial' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className={lbl2}>Gross Leasable Area (GLA Sq Ft)</label>
                <input type="number" min={100} placeholder="e.g. 15000" value={w.commSqft} onChange={(e) => set({ commSqft: e.target.value })} className={inputSm} />
              </div>
            </div>
          )}

          {asset === 'single-family' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className={lbl2}>Appraised / After-Repair Value ($)</label>
                  <input type="number" min={0} placeholder="e.g. 450000" value={w.sfrArv} onChange={(e) => set({ sfrArv: e.target.value })} className={inputSm} />
                </div>
                <div className="space-y-1.5">
                  <label className={lbl2}>Living Area (Sq Ft)</label>
                  <input type="number" min={100} placeholder="e.g. 2400" value={w.sfrSqft} onChange={(e) => set({ sfrSqft: e.target.value })} className={inputSm} />
                </div>
              </div>
            </div>
          )}
        </div>

        {assessor && (
          <div className="p-3.5 bg-emerald-950/25 border border-emerald-900/60 rounded-2xl space-y-2 text-xs">
            <div className="flex items-center justify-between border-b border-emerald-900/40 pb-2">
              <div className="flex items-center space-x-2">
                <span className="text-emerald-400 font-extrabold text-xs">🏛️ {assessor.county || 'County'} Assessor Record</span>
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px] font-mono font-bold">APN: {assessor.apn || '--'}</span>
              </div>
              {assessor.assessorPortalUrl && (
                <a href={assessor.assessorPortalUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 underline flex items-center space-x-1">
                  <span>{/spokane/i.test(assessor.county || '') ? 'View SCOUT Tax Card ↗' : /yakima/i.test(assessor.county || '') ? 'View Ascend Tax Card ↗' : 'View Assessor Portal ↗'}</span>
                </a>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px]">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Assessed Value</span>
                <span className="font-bold text-white">${Number(pkg.totalAssessedValue || assessor.totalAssessedValue || 0).toLocaleString()}{pkg.totalParcels > 1 ? ' (Package)' : ''}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Land / Building</span>
                <span className="font-semibold text-slate-300">${Math.round((assessor.marketLandValue || 0) / 1000)}k / ${Math.round((assessor.marketImprovementValue || 0) / 1000)}k</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Lot Size</span>
                <span className="font-semibold text-slate-300">{assessor.acres} Acres ({Number(assessor.sqft || 0).toLocaleString()} sqft)</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Zoning / Use</span>
                <span className="font-semibold text-slate-300">{(assessor.zoning || 'Standard')} • {(assessor.useCode || '').slice(0, 18)}</span>
              </div>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-emerald-900/30">
              <span className="text-[10px] text-slate-400 truncate max-w-[280px]">Owner: {assessor.owner || 'Of Record'}</span>
              <button type="button" onClick={applyAssessedValue} className="py-1 px-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-bold transition">Apply Value as Purchase Price</button>
            </div>
          </div>
        )}

        {companions > 0 && (
          <div className="p-3.5 bg-slate-900/90 border border-brand-500/40 rounded-2xl space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center space-x-2">
                <span className="text-brand-400 font-extrabold text-sm">📦 Multi-Parcel Acquisition Package</span>
                <span className="px-2 py-0.5 rounded bg-brand-500/10 text-brand-300 border border-brand-500/20 text-[10px] font-bold">{companions} Adjacent Parcel{companions > 1 ? 's' : ''} Found</span>
              </div>
              <span className="text-[10px] text-slate-400 font-medium">Contiguous / Same Owner</span>
            </div>
            <p className="text-[11px] text-slate-200 leading-relaxed">
              We identified adjacent or companion parcels owned by the same entity on this block. <span className="text-amber-300 font-semibold">Does the sale include these properties as well?</span> Select all that apply:
            </p>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {parcels.map((p, idx) => {
                const portal = p.assessorPortalUrl || (() => { try { return AddressService.getAssessorPortalUrl(p.apn, p.county); } catch { return '#'; } })();
                return (
                  <div key={p.apn || idx} className={`p-2.5 rounded-xl border transition flex items-center justify-between ${p.included ? 'bg-emerald-950/20 border-emerald-800/60 text-slate-100' : 'bg-slate-950/60 border-slate-800 text-slate-400'}`}>
                    <div className="flex items-center space-x-3">
                      <input type="checkbox" checked={!!p.included} disabled={!!p.isPrimary}
                        onChange={(e) => setParcels((prev) => prev.map((x, i) => (i === idx ? { ...x, included: e.target.checked } : x)))}
                        className="rounded border-slate-700 text-brand-500 focus:ring-brand-400 h-4 w-4" />
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className={`font-bold text-xs ${p.isPrimary ? 'text-brand-400' : 'text-slate-200'}`}>{p.address || p.street}</span>
                          {p.isPrimary && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-brand-500/20 text-brand-300">PRIMARY</span>}
                        </div>
                        <span className="text-[10px] text-slate-400">APN: {p.formattedApn || p.apn} • {p.acres} Acres ({Number(p.sqft || 0).toLocaleString()} sqft) • {p.useCode || ''}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-white block">${Number(p.totalAssessedValue || 0).toLocaleString()}</span>
                      <a href={portal} target="_blank" rel="noopener noreferrer" className="text-[10px] text-emerald-400 underline hover:text-emerald-300">Card ↗</a>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="p-2.5 bg-slate-950/80 rounded-xl border border-slate-800 flex items-center justify-between text-[11px]">
              <div>
                <span className="text-slate-400">Total Combined Land:</span>
                <span className="font-bold text-white ml-1">{pkg.totalAcres} Acres</span>
                <span className="text-slate-500 text-[10px] ml-1">({Number(pkg.totalSqFt || 0).toLocaleString()} sqft)</span>
              </div>
              <div>
                <span className="text-slate-400">Combined Assessed Value:</span>
                <span className="font-bold text-brand-400 ml-1">${Number(pkg.totalAssessedValue || 0).toLocaleString()}</span>
              </div>
            </div>
          </div>
        )}

        <div className="p-4 bg-slate-950/70 border border-slate-800/90 rounded-2xl space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <div className="flex items-center space-x-2">
              <span className="text-brand-400 font-bold text-xs">🏛️</span>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">Market &amp; Facility Classification</span>
            </div>
            <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
              {benchmark ? `Market Cap: ${Number(benchmark.min).toFixed(2)}% - ${Number(benchmark.max).toFixed(2)}%` : 'Benchmark Cap: 4.75% - 5.50%'}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="wiz-market-tier" className={lbl2}>Market Tier</label>
              <select id="wiz-market-tier" value={w.marketTier} onChange={(e) => set({ marketTier: e.target.value })}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                <option value="Tier 1">Tier 1 • Primary / Gateway</option>
                <option value="Tier 2">Tier 2 • Secondary / Growth</option>
                <option value="Tier 3">Tier 3 • Tertiary / Regional</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="wiz-property-class" className={lbl2}>Property Class</label>
              <select id="wiz-property-class" value={w.propertyClass} onChange={(e) => set({ propertyClass: e.target.value })}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                <option value="Class A">Class A • Institutional / Trophy</option>
                <option value="Class B">Class B • Value-Add / Core-Plus</option>
                <option value="Class C">Class C • Workforce / Opportunity</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="wiz-facility-type" className={lbl2}>Facility Sub-Type</label>
              <select id="wiz-facility-type" value={w.facilityType} onChange={(e) => set({ facilityType: e.target.value })}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                {DEFAULTS[asset].subTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 italic">{guidance}</p>
        </div>
      </div>

      {/* Step 2 */}
      <div className={`space-y-5 ${step === 2 ? '' : 'hidden'}`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="wiz-purchase-price" className={lbl}>Purchase Price ($)</label>
            <input id="wiz-purchase-price" type="number" value={w.price} onChange={(e) => set({ price: e.target.value })} className={`${inputBase} py-2.5 px-3.5 text-sm font-bold`} />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="wiz-down-payment" className={lbl}>Down Payment (%)</label>
              <span className="text-xs font-semibold text-slate-300">
                {cash.rolled ? (
                  <><span className="text-emerald-400 font-bold">{formatCurrency(cash.downAmt)}</span> <span className="text-[10px] text-slate-400">({cash.downPct}% of {formatCurrency(cash.basis)})</span></>
                ) : (
                  <><span className="text-slate-300 font-semibold">{formatCurrency(cash.downAmt)}</span> <span className="text-[10px] text-slate-400">({cash.downPct}% of purchase)</span></>
                )}
              </span>
            </div>
            <input id="wiz-down-payment" type="number" step="0.5" value={w.down} onChange={(e) => set({ down: e.target.value })} className={`${inputBase} py-2.5 px-3.5 text-sm font-bold`} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="wiz-closing-costs" className={lbl}>Closing Costs ($)</label>
            <input id="wiz-closing-costs" type="number" value={w.closing} onChange={(e) => set({ closing: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="wiz-rehab-costs" className={lbl}>Initial Rehab / CapEx ($)</label>
            <input id="wiz-rehab-costs" type="number" value={w.rehab} onChange={(e) => set({ rehab: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
          </div>
        </div>

        <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <label className={lbl}>Remodel &amp; Closing Costs Financing</label>
            <span className="text-[10px] font-semibold text-emerald-400">{cash.rolled ? 'Rolled into Loan' : 'Paid Out of Pocket'}</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <button type="button" onClick={() => set({ rehabMode: 'out_of_pocket' })} className={modeBtn(!cash.rolled)}>
              <span>Out of Pocket</span><span className="text-[10px] font-normal text-slate-400 mt-0.5">Pay on top of down payment</span>
            </button>
            <button type="button" onClick={() => set({ rehabMode: 'roll_into_loan' })} className={modeBtn(cash.rolled)}>
              <span>Roll into Loan</span><span className="text-[10px] font-normal text-slate-500 mt-0.5">Finance in loan package</span>
            </button>
          </div>
        </div>

        <div className="p-3.5 bg-slate-950/70 border border-slate-800/80 rounded-xl flex items-center justify-between text-xs">
          <span className="text-slate-400">Total Upfront Capital Required:</span>
          <span className="text-sm font-extrabold text-brand-400">
            {formatCurrency(cash.total)}
            {cash.rolled && <> <span className="text-[10px] font-normal text-slate-400">({formatCurrency(cash.financed)} rolled into loan)</span></>}
          </span>
        </div>
      </div>

      {/* Step 3 */}
      <div className={`space-y-5 ${step === 3 ? '' : 'hidden'}`}>
        {asset === 'storage' && (
          <div className="p-3.5 bg-slate-950/70 rounded-2xl border border-slate-800/90 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">📦 Self-Storage Revenue Schedule</span>
              <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">Live Bidirectional Sync</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className={lbl}>Average Rent per Unit ($/mo)</label>
                <input type="number" placeholder="85" value={w.storageRentPerUnit} onChange={(e) => syncStorage('rpu', e.target.value)} className={inputLg} />
              </div>
              <div className="space-y-1.5">
                <label className={lbl}>Total Monthly Facility Rent ($)</label>
                <input type="number" placeholder="1700" value={w.storageGrossRent} onChange={(e) => syncStorage('tot', e.target.value)} className={inputLg} />
              </div>
            </div>
            <div className="p-2.5 bg-slate-900/60 rounded-xl border border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-400">Gross Potential Revenue:</span>
              <span className="font-extrabold text-emerald-400">{formatCurrency(num(w.storageGrossRent) * 12)} / yr ({int(w.storageUnits, 20) || 20} units @ {num(w.storageRentPerUnit)}/mo)</span>
            </div>
          </div>
        )}

        {asset === 'multi-unit' && (
          <div className="p-3.5 bg-slate-950/70 rounded-2xl border border-slate-800/90 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">🏢 Multifamily Revenue Schedule</span>
              <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">Live Bidirectional Sync</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className={lbl}>Average Rent per Unit ($/mo)</label>
                <input type="number" placeholder="1500" value={w.multiRentPerUnit} onChange={(e) => syncMulti('rpu', e.target.value)} className={inputLg} />
              </div>
              <div className="space-y-1.5">
                <label className={lbl}>Total Monthly Property Rent ($)</label>
                <input type="number" placeholder="18000" value={w.multiGrossRent} onChange={(e) => syncMulti('tot', e.target.value)} className={inputLg} />
              </div>
            </div>
            <div className="p-2.5 bg-slate-900/60 rounded-xl border border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-400">Gross Potential Revenue:</span>
              <span className="font-extrabold text-emerald-400">{formatCurrency(num(w.multiGrossRent) * 12)} / yr ({int(w.multiUnits, 12) || 12} units @ {formatCurrency(num(w.multiRentPerUnit))}/mo)</span>
            </div>
          </div>
        )}

        {asset === 'commercial' && (
          <div className="p-3.5 bg-slate-950/70 rounded-2xl border border-slate-800/90 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">🏬 Commercial Revenue Schedule</span>
              <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">Annual / Monthly Sync</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className={lbl}>Annual Gross Rent ($/yr)</label>
                <input type="number" placeholder="150000" value={w.commAnnualRent} onChange={(e) => syncComm('ann', e.target.value)} className={inputLg} />
              </div>
              <div className="space-y-1.5">
                <label className={lbl}>Monthly Rent Equivalent ($/mo)</label>
                <input type="number" placeholder="12500" value={w.commGrossRent} onChange={(e) => syncComm('mo', e.target.value)} className={inputLg} />
              </div>
            </div>
            <div className="p-2.5 bg-slate-900/60 rounded-xl border border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-400">Gross Contract Rent:</span>
              <span className="font-extrabold text-emerald-400">{formatCurrency(num(w.commAnnualRent))} / yr</span>
            </div>
          </div>
        )}

        {asset === 'single-family' && (
          <div className="p-3.5 bg-slate-950/70 rounded-2xl border border-slate-800/90 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">🏡 Single-Family Rental Revenue</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className={lbl}>Monthly Rental Income ($/mo)</label>
                <input type="number" placeholder="3200" value={w.sfrGrossRent} onChange={(e) => set({ sfrGrossRent: e.target.value, grossRent: e.target.value })} className={inputLg} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Annual Gross Projection</label>
                <input type="text" value={`${formatCurrency(num(w.sfrGrossRent) * 12)} / yr`} disabled
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2.5 px-3.5 text-sm text-slate-400 font-bold cursor-not-allowed" />
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="wiz-other-income" className={lbl}>Other Monthly Income ($)</label>
            <input id="wiz-other-income" type="number" value={w.other} onChange={(e) => set({ other: e.target.value })} className={`${inputBase} py-2.5 px-3.5 text-sm`} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="wiz-vacancy-rate" className={lbl}>Vacancy Rate (%)</label>
              <input id="wiz-vacancy-rate" type="number" step="0.5" value={w.vacancy} onChange={(e) => set({ vacancy: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="wiz-rent-growth" className={lbl}>Annual Rent Growth (%)</label>
              <input id="wiz-rent-growth" type="number" step="0.1" value={w.rentGrowth} onChange={(e) => set({ rentGrowth: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="wiz-opex-ratio" className={lbl}>Operating Expense Ratio (%)</label>
              <input id="wiz-opex-ratio" type="number" step="1.0" value={w.opexRatio} onChange={(e) => set({ opexRatio: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="wiz-expense-growth" className={lbl}>Expense Inflation (%)</label>
              <input id="wiz-expense-growth" type="number" step="0.1" value={w.expenseGrowth} onChange={(e) => set({ expenseGrowth: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
            </div>
          </div>
        </div>
      </div>

      {/* Step 4 */}
      <div className={`space-y-5 ${step === 4 && !submitting ? '' : 'hidden'}`}>
        <div className="space-y-1.5">
          <label htmlFor="wiz-financing-type" className={lbl}>Financing Structure / Loan Type</label>
          <select id="wiz-financing-type" value={w.financingType} onChange={(e) => set({ financingType: e.target.value })}
            className={`${inputBase} py-2.5 px-3.5 text-sm font-bold`}>
            <option value="fixed">Traditional Fixed-Rate Mortgage</option>
            <option value="arm">Adjustable-Rate Mortgage (ARM / Floating)</option>
            <option value="interest_only">Interest-Only (I/O) Loan</option>
            <option value="bridge">Bridge / Hard Money Loan</option>
            <option value="seller_financing">Seller Financing</option>
          </select>
        </div>

        {w.financingType === 'arm' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-slate-950/70 border border-slate-800 rounded-xl">
            <div className="space-y-1"><label className="text-[11px] font-bold text-slate-400">Initial Fixed (Yrs)</label>
              <input type="number" min={1} max={10} value={w.armInitial} onChange={(e) => set({ armInitial: e.target.value })} className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white" /></div>
            <div className="space-y-1"><label className="text-[11px] font-bold text-slate-400">Reset Rate (%)</label>
              <input type="number" step="0.125" value={w.armRate} onChange={(e) => set({ armRate: e.target.value })} className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white" /></div>
            <div className="space-y-1"><label className="text-[11px] font-bold text-slate-400">Max Rate Cap (%)</label>
              <input type="number" step="0.125" value={w.armCap} onChange={(e) => set({ armCap: e.target.value })} className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white" /></div>
          </div>
        )}
        {w.financingType === 'interest_only' && (
          <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl">
            <div className="space-y-1 max-w-xs"><label className="text-[11px] font-bold text-slate-400">Interest-Only Period (Years)</label>
              <input type="number" min={1} max={10} value={w.ioYears} onChange={(e) => set({ ioYears: e.target.value })} className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white" /></div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="wiz-interest-rate" className={lbl}>Senior Debt Interest Rate (%)</label>
            <input id="wiz-interest-rate" type="number" step="0.125" value={w.rate} onChange={(e) => set({ rate: e.target.value })} className={`${inputBase} py-2.5 px-3.5 text-sm font-bold`} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="wiz-amortization" className={lbl}>Amortization Period (Years)</label>
            <input id="wiz-amortization" type="number" value={w.amort} onChange={(e) => set({ amort: e.target.value })} className={`${inputBase} py-2.5 px-3.5 text-sm font-bold`} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="wiz-exit-cap" className={lbl}>Target Exit Cap Rate (%)</label>
            <input id="wiz-exit-cap" type="number" step="0.1" value={w.exitCap} onChange={(e) => set({ exitCap: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="wiz-appreciation" className={lbl}>Annual Property Appreciation (%)</label>
            <input id="wiz-appreciation" type="number" step="0.1" value={w.apprec} onChange={(e) => set({ apprec: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
          </div>
        </div>

        <div className="p-4 bg-brand-950/30 border border-brand-800/60 rounded-2xl space-y-2">
          <div className="flex items-center space-x-2 text-xs font-bold text-brand-300"><span>🏛️ Institutional Underwriting Engine Ready</span></div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            When submitted, MathTree will compute your 10-year pro-forma, evaluate debt covenants, run Monte Carlo stress-testing, and deliver a presentation-ready Executive Pitch Deck.
          </p>
        </div>
      </div>

      {submitting && (
        <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-brand-600 to-emerald-400 flex items-center justify-center shadow-xl shadow-brand-500/30 animate-spin">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.22 8H18" /></svg>
          </div>
          <div className="space-y-1">
            <h4 className="text-base font-extrabold text-white">Underwriting Model in Progress...</h4>
            <p className="text-xs text-slate-400">Underwriting 10-year pro-forma &amp; generating pitch deck...</p>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="wizard-modal-title" className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[96vh] sm:max-h-[92vh] transition-all">
        <div className="p-4 sm:p-6 border-b border-slate-800/80 bg-slate-950/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5 sm:space-x-3">
              <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl bg-gradient-to-tr from-brand-600 to-emerald-400 flex items-center justify-center shadow-lg shadow-brand-500/20 text-white font-black text-sm shrink-0">✨</div>
              <div>
                <h3 id="wizard-modal-title" className="text-base sm:text-lg font-black text-white tracking-tight">Create New Project</h3>
                <p className="text-[11px] sm:text-xs text-slate-400">Step <span className="text-brand-400 font-bold">{step}</span> of 4: <span className="font-medium text-slate-300">{STEP_TITLES[step]}</span></p>
              </div>
            </div>
            <button aria-label="Close project creation wizard" onClick={onClose} className="text-slate-400 hover:text-white text-sm p-1.5 rounded-lg hover:bg-slate-800/80 transition">✕</button>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-3 sm:mt-4 overflow-hidden">
            <div className="bg-gradient-to-r from-brand-500 to-emerald-400 h-full transition-all duration-300 rounded-full" style={{ width: `${step * 25}%` }} />
          </div>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 sm:space-y-6 flex-grow">
          {stepDivs}
          {error && <p className="text-xs text-rose-400 font-semibold">{error}</p>}
        </div>

        <div className="p-5 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          {step > 1 && !submitting ? (
            <button onClick={back} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white bg-slate-900 border border-slate-800 transition">← Back</button>
          ) : <span />}
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-300 transition">Cancel</button>
          <div className="flex items-center space-x-2">
            {step < 4 ? (
              <button onClick={next} className="px-5 py-2.5 rounded-xl text-xs font-extrabold text-white bg-brand-600 hover:bg-brand-500 shadow-lg shadow-brand-600/30 transition flex items-center space-x-1.5">
                <span>Next Step</span><span>→</span>
              </button>
            ) : (
              <button onClick={submit} disabled={submitting}
                className="px-6 py-2.5 rounded-xl text-xs font-black text-white bg-gradient-to-r from-brand-600 via-emerald-500 to-teal-400 hover:opacity-95 shadow-lg shadow-emerald-500/20 transition disabled:opacity-60">
                <span>⚡ Run Engine &amp; Generate Pitch Deck</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
