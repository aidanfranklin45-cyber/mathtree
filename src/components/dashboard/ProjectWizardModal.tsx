import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import { AddressService } from '../../lib/services/addressService';

import { seedFromAssumptions, reconcileBasis, type InputBasis } from '../../../supabase/functions/_shared/underwritingAssumptions';
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

/** The choices the wizard offers for each asset class. Choices only: no number here seeds a deal. */
interface Classification {
  marketTier: string; propertyClass: string; facilityType: string; subTypes: string[];
}

const DEFAULTS: Record<Asset, Classification> = {
  'single-family': {
    marketTier: 'Tier 2', propertyClass: 'Class B',
    facilityType: 'BRRRR Value-Add Single-Family',
    subTypes: ['Turnkey Single-Family Rental', 'BRRRR Value-Add Single-Family', 'New Construction Spec SFR', 'Single-Family Fix & Flip'],
  },
  'multi-unit': {
    marketTier: 'Tier 2', propertyClass: 'Class B',
    facilityType: 'Garden-Style Community',
    subTypes: ['Garden-Style Community', 'Mid / High-Rise Apartments', 'Duplex / Triplex / Quadplex (2-4 Units)', 'Build-to-Rent (BTR) Community'],
  },
  commercial: {
    marketTier: 'Tier 1', propertyClass: 'Class A',
    facilityType: 'Industrial Logistics / Warehouse',
    subTypes: ['Industrial Logistics / Warehouse', 'Retail Strip / Center', 'Class-A Office / Medical', 'Flex / R&D Facility'],
  },
  storage: {
    marketTier: 'Tier 1', propertyClass: 'Class A',
    facilityType: 'Drive-Up Standard (Single-Story)',
    subTypes: ['Climate-Controlled (Multi-Story)', 'Drive-Up Standard (Single-Story)', 'Outdoor / RV & Boat Parking', 'Hybrid Flex Facility'],
  },
};

export const ASSET_NAME_PLACEHOLDERS: Record<Asset, string> = {
  'single-family': 'e.g. 808 W Fremont Ave or West Valley Residential',
  'multi-unit': 'e.g. 12-Unit Multifamily Community or Apple Tree Vistas',
  commercial: 'e.g. Industrial Logistics Center Alpha or Downtown Commercial',
  storage: 'e.g. Automated Self-Storage Facility or Longfibre Storage',
};

export function deriveProjectName(customName: string, location: string, asset: Asset): string {
  const trimmedName = customName.trim();
  if (trimmedName) return trimmedName;
  const trimmedLoc = location.trim();
  if (trimmedLoc && trimmedLoc !== 'Synthetic Model • Generic Metro' && trimmedLoc !== 'United States') {
    const street = trimmedLoc.split(',')[0].trim();
    if (street) return street;
  }
  return `${ASSET_BADGES[asset]} Underwriting Project`;
}

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

/** A new project starts blank. Nothing is assumed: every figure is entered, or filled from the owner's own assumptions on request. */
const seed = (a: Asset): W => {
  const d = DEFAULTS[a];
  return {
    name: '', location: '', entity: '', asset: a, gla: '', leaseType: '',
    rehabMode: 'out_of_pocket', facilityType: d.facilityType, marketTier: d.marketTier, propertyClass: d.propertyClass,
    price: '', down: '', closing: '', rehab: '', grossRent: '', other: '',
    vacancy: '', rentGrowth: '', opexRatio: '', expenseGrowth: '',
    rate: '', amort: '', maturity: '', exitCap: '', apprec: '', exitYear: '', discountRate: '', sellingCost: '',
    capexKind: 'annual', capexValue: '', managementFee: '', payroll: '', taxes: '', insurance: '', maintenance: '',
    storageUnits: '', storageSqft: '', storageAutomated: 'false', storageRentPerUnit: '', storageGrossRent: '',
    multiUnits: '', multiSqft: '', multiRentPerUnit: '', multiGrossRent: '',
    commSqft: '', commAnnualRent: '', commGrossRent: '',
    sfrArv: '', sfrSqft: '', sfrGrossRent: '',
    financingType: 'fixed', armInitial: '', armRate: '', armCap: '', ioYears: '',
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
  const [isNameTouched, setIsNameTouched] = useState(false);
  const [entities, setEntities] = useState<{ id: string; name: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addrResults, setAddrResults] = useState<any[]>([]);
  const [addrOpen, setAddrOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [assessor, setAssessor] = useState<any>(null);
  const [parcels, setParcels] = useState<any[]>([]);
  const [companions, setCompanions] = useState(0);
  // Figures copied from the owner's profile assumptions, with their reasons; saved with the deal as its record of where numbers came from
  const [seededBasis, setSeededBasis] = useState<Record<string, InputBasis>>({});
  const [seedNote, setSeedNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!isOpen) return;
    setStep(1); setW(seed('commercial')); setIsNameTouched(false); setError(null); setSubmitting(false);
    setAssessor(null); setParcels([]); setCompanions(0); setAddrResults([]); setAddrOpen(false); setSeededBasis({}); setSeedNote(null);
    supabase.from('entities').select('id,name').order('name').then(({ data }) => setEntities((data as any[]) ?? []));
  }, [isOpen]);

  const set = (patch: W) => setW((p) => ({ ...p, ...patch }));
  const asset = w.asset as Asset;

  const pkg = useMemo(() => {
    try { return AddressService.aggregateParcelPackage(parcels) as any; } catch { return { totalAcres: 0, totalSqFt: 0, totalAssessedValue: 0, totalParcels: 0 }; }
  }, [parcels]);

  const selectAsset = (a: Asset) => {
    // Identity and location carry across a change of asset class; everything else starts blank for the new class
    setW((prev) => ({
      ...seed(a),
      name: prev.name,
      location: prev.location,
      entity: prev.entity,
      marketTier: prev.location ? prev.marketTier : DEFAULTS[a].marketTier,
    }));
    setSeededBasis({});
    setSeedNote(null);
  };

  /** Copies the owner's profile assumptions into every blank field, with their reasons. Fields already filled are never overwritten. */
  const fillFromAssumptions = () => {
    const profile = getProfile();
    const units = asset === 'storage' ? int(w.storageUnits) : asset === 'multi-unit' ? int(w.multiUnits) : asset === 'single-family' ? 1 : 0;
    const sqft = num(asset === 'storage' ? w.storageSqft : asset === 'multi-unit' ? w.multiSqft : asset === 'commercial' ? (w.commSqft || w.gla) : w.sfrSqft);
    const seeded = seedFromAssumptions(profile.underwritingAssumptions, {
      assetClass: asset,
      leaseType: w.leaseType,
      purchasePrice: num(w.price) || null,
      unitCount: units > 0 ? units : null,
      squareFeet: sqft > 0 ? sqft : null,
      discountRate: profile.discountRate,
      exitYear: profile.exitYear,
      assessedValue: Number(assessor?.taxableValue) || Number(pkg.totalAssessedValue || assessor?.totalAssessedValue) || null,
    });
    const target: Record<string, string> = {
      vacancyRate: 'vacancy', expenseRatio: 'opexRatio', rentGrowth: 'rentGrowth', expenseGrowth: 'expenseGrowth', exitYear: 'exitYear',
      discountRate: 'discountRate', targetCapRate: 'exitCap', appreciationRate: 'apprec', sellingCostPercent: 'sellingCost',
      closingCosts: 'closing', managementFeePercent: 'managementFee', capexReserveAnnual: 'capexValue', capexReservePercent: 'capexValue',
      payrollMarketingPercent: 'payroll', annualTaxes: 'taxes', annualInsurance: 'insurance', annualMaintenance: 'maintenance',
    };
    const patch: W = {};
    const basis: Record<string, InputBasis> = {};
    for (const [key, value] of Object.entries(seeded.inputs)) {
      const field = target[key];
      if (!field || (w[field] ?? '').trim() !== '') continue;
      patch[field] = String(value);
      if (key === 'capexReserveAnnual') patch.capexKind = 'annual';
      if (key === 'capexReservePercent') patch.capexKind = 'percent';
      if (seeded.basis[key]) basis[key] = seeded.basis[key];
    }
    set(patch);
    setSeededBasis((b) => ({ ...b, ...basis }));
    const n = Object.keys(basis).length;
    setSeedNote(n === 0
      ? 'Nothing to fill: set your assumptions in your Investor Profile first, or every field you have an assumption for already has a value.'
      : `Filled ${n} blank field${n === 1 ? '' : 's'} from your assumptions. Each keeps your reason on this property.`);
  };


  const guidance = useMemo(() => {
    const tierDesc = w.marketTier.includes('1') ? 'Primary Gateway Metro (High Liquidity, Low Cap Rates)'
      : w.marketTier.includes('2') ? 'Secondary Growth Metro (Core-Plus Yields)' : 'Tertiary / Regional Market (Higher Yields, Lower Liquidity)';
    const classDesc = w.propertyClass.includes('A') ? 'Prime / Trophy Quality' : w.propertyClass.includes('B') ? 'Value-Add / Core-Plus' : 'Workforce Housing / Opportunity';
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

    // Auto-populate project name with street or parcel address if not manually customized
    const suggestedName = item.street?.trim() || item.formattedAddress?.split(',')[0]?.trim() || item.formattedAddress?.trim() || '';
    if (!isNameTouched || !w.name.trim()) {
      patch.name = suggestedName;
    }

    set(patch);
    setAddrOpen(false);
    try {
      const data = await AddressService.resolveParcelDetails(item);
      if (!data) return;
      setAssessor(data);
      setParcels([{ ...data, isPrimary: true, included: true }]);
      setCompanions(0);
      // The building's area from the county card when it has one; blank otherwise (a lot size is not a building size)
      if (!w.gla && Number((data as any).buildingSqFt) > 0) set({ gla: String(Math.round(Number((data as any).buildingSqFt))) });
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
      const name = deriveProjectName(w.name, w.location, asset);
      const location = w.location.trim() || 'United States';
      // Only what was entered is saved. A blank stays blank, and the property then asks for it: no price, rent, loan or cost is made up.
      const opt = (v: string | undefined): number | undefined => {
        if (v === undefined || v.trim() === '') return undefined;
        const n = parseFloat(v);
        return Number.isNaN(n) ? undefined : n;
      };
      const optInt = (v: string | undefined): number | undefined => { const n = opt(v); return n === undefined ? undefined : Math.round(n); };
      const purchasePrice = opt(w.price);

      let grossRent = opt(w.grossRent); // monthly, whole property
      let unitCount: number | undefined = asset === 'single-family' ? 1 : undefined;
      let storageUnitCount: number | undefined; let storageSqFt: number | undefined; let isAutomated = false;
      let rentPerUnit: number | undefined; let arv: number | undefined;
      let gla = opt(w.gla);

      if (asset === 'storage') {
        storageUnitCount = optInt(w.storageUnits); unitCount = storageUnitCount;
        storageSqFt = opt(w.storageSqft); gla = storageSqFt ?? gla;
        isAutomated = w.storageAutomated === 'true';
        rentPerUnit = opt(w.storageRentPerUnit);
        const tot = opt(w.storageGrossRent);
        grossRent = tot ?? (rentPerUnit !== undefined && storageUnitCount ? rentPerUnit * storageUnitCount : undefined);
        if (rentPerUnit === undefined && grossRent !== undefined && storageUnitCount) rentPerUnit = Math.round(grossRent / storageUnitCount);
      } else if (asset === 'multi-unit') {
        unitCount = optInt(w.multiUnits); gla = opt(w.multiSqft) ?? gla;
        rentPerUnit = opt(w.multiRentPerUnit);
        const tot = opt(w.multiGrossRent);
        grossRent = tot ?? (rentPerUnit !== undefined && unitCount ? rentPerUnit * unitCount : undefined);
        if (rentPerUnit === undefined && grossRent !== undefined && unitCount) rentPerUnit = Math.round(grossRent / unitCount);
      } else if (asset === 'commercial') {
        gla = opt(w.commSqft) ?? gla;
        const tot = opt(w.commGrossRent); const ann = opt(w.commAnnualRent);
        grossRent = tot ?? (ann !== undefined ? Math.round(ann / 12) : undefined);
      } else {
        gla = opt(w.sfrSqft) ?? gla; arv = opt(w.sfrArv);
        grossRent = opt(w.sfrGrossRent);
      }

      const a: any = assessor;
      const profile = getProfile();
      const isStorage = asset === 'storage';
      const isIncomeValued = asset === 'commercial' || asset === 'storage';
      const amort = optInt(w.amort);
      const hold = optInt(w.exitYear);
      const capex = opt(w.capexValue);
      const inputs: Record<string, any> = {
        purchasePrice,
        downPaymentPercent: opt(w.down),
        interestRate: opt(w.rate),
        // The wizard has always stored the amortization period as `loanTerm`; the engine reads either
        amortizationYears: amort, loanTerm: amort,
        loanMaturityYears: optInt(w.maturity),
        rehabCosts: opt(w.rehab) ?? 0, closingCosts: opt(w.closing),
        rehabFinancingMode: w.rehabMode, financeRehabAndClosingCosts: w.rehabMode === 'roll_into_loan',
        grossRentPerMonth: grossRent, grossRentAnnual: grossRent !== undefined ? grossRent * 12 : undefined, monthlyRent: grossRent,
        unitCount, numUnits: unitCount,
        storageUnitCount: isStorage ? storageUnitCount : undefined,
        storageSqFt: isStorage ? storageSqFt : undefined,
        totalSqFt: isStorage ? storageSqFt : gla,
        gla,
        isAutomated: isStorage ? isAutomated : undefined,
        storageRentPerUnit: isStorage ? rentPerUnit : undefined,
        monthlyRentPerUnit: isStorage || asset === 'multi-unit' ? rentPerUnit : undefined,
        leaseType: w.leaseType || undefined,
        arv: asset === 'single-family' ? arv : undefined,
        vacancyRate: opt(w.vacancy),
        expenseRatio: opt(w.opexRatio), operatingExpenseRatio: opt(w.opexRatio),
        expenseGrowth: opt(w.expenseGrowth), expenseInflation: opt(w.expenseGrowth),
        rentGrowth: opt(w.rentGrowth), annualRentGrowth: opt(w.rentGrowth),
        // Commercial and storage are valued by capitalising income at exit; the rest by appreciation
        ...(isIncomeValued ? { targetCapRate: opt(w.exitCap), targetExitCapRate: opt(w.exitCap) } : { appreciationRate: opt(w.apprec) }),
        sellingCostPercent: opt(w.sellingCost),
        managementFeePercent: opt(w.managementFee),
        payrollMarketingPercent: isStorage ? opt(w.payroll) : undefined,
        capexReserveAnnual: w.capexKind === 'percent' ? undefined : capex,
        capexReservePercent: w.capexKind === 'percent' ? capex : undefined,
        annualTaxes: opt(w.taxes), annualInsurance: opt(w.insurance), annualMaintenance: opt(w.maintenance),
        marketTier: w.marketTier, propertyClass: w.propertyClass, facilityType: w.facilityType,
        commTier: w.marketTier, commClass: w.propertyClass, storageTier: w.marketTier, storageClass: w.propertyClass,
        exitYear: hold, holdingPeriod: hold, discountRate: opt(w.discountRate), exitCapTiming: profile.exitCapTiming,
        propertyAddress: location, address: location,
        county: a?.county || null, primaryApn: a?.apn || null,
        totalAcreage: a?.packageAcres || pkg.totalAcres || a?.acres || null,
        totalAssessedValue: pkg.totalAssessedValue || a?.totalAssessedValue || null,
        marketLandValue: a?.marketLandValue || null, marketImprovementValue: a?.marketImprovementValue || null,
        acres: a?.acres || null, sqft: a?.sqft || null, yearBuilt: a?.yearBuilt || null, buildingSqFt: a?.buildingSqFt || null,
        stories: a?.stories || null, constructionType: a?.constructionType || null, condition: a?.condition || null, hvac: a?.hvac || null,
        zoning: a?.zoning || null, useCode: a?.useCode || null, owner: a?.owner || null, legalDescription: a?.legalDescription || null,
        assessorPortalUrl: a?.assessorPortalUrl || null, taxYear: a?.taxYear || null,
        taxableValue: a?.taxableValue || null, taxCodeArea: a?.taxCodeArea || null,
        assessorData: a || null,
        parcels: parcels.length ? parcels : a ? [a] : [],
        gisSync: { lastSyncedAt: new Date().toISOString(), syncSource: a?.source || 'county_arcgis', status: 'active' },
        financingType: w.financingType,
        armInitialYears: optInt(w.armInitial), armAdjustmentRate: opt(w.armRate), armRateCap: opt(w.armCap),
        interestOnlyYears: optInt(w.ioYears),
        entity_id: w.entity || null,
      };
      // Where each number came from: the owner's profile assumptions (with their reasons) or the owner's own entry
      inputs.assumptionBasis = reconcileBasis(seededBasis, inputs);
      Object.keys(inputs).forEach((k) => inputs[k] === undefined && delete inputs[k]);


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

  const fillBar = (
    <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-950/70 border border-slate-800">
      <p className="text-[11px] text-slate-400 leading-relaxed max-w-md">
        Nothing is pre-filled. Enter each figure, or copy the ones you have set in your Investor Profile (they keep your reason on this property).
      </p>
      <button type="button" onClick={fillFromAssumptions} className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
        Fill blanks from my assumptions
      </button>
      {seedNote && <p role="status" className="basis-full text-[10px] text-emerald-300/90 leading-relaxed">{seedNote}</p>}
    </div>
  );

  const stepDivs = (
    <>
      {/* Step 1 */}
      <div className={`space-y-5 ${step === 1 ? '' : 'hidden'}`}>
        <div className="space-y-1.5">
          <label htmlFor="wiz-deal-name" className={lbl}>Project / Deal Name</label>
          <input
            id="wiz-deal-name"
            type="text"
            placeholder={w.location ? (w.location.split(',')[0].trim() || ASSET_NAME_PLACEHOLDERS[asset]) : ASSET_NAME_PLACEHOLDERS[asset]}
            value={w.name}
            onChange={(e) => {
              const val = e.target.value;
              setIsNameTouched(val.trim().length > 0);
              set({ name: val });
            }}
            className={`${inputBase} py-2.5 px-3.5 text-sm placeholder-slate-600 font-medium`}
          />
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
              <option value="">Choose the lease structure…</option>
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
                <option value="Class A">Class A • Prime / Trophy</option>
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
        {fillBar}
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
        {fillBar}
        {asset === 'storage' && (
          <div className="p-3.5 bg-slate-950/70 rounded-2xl border border-slate-800/90 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">📦 Self-Storage Revenue Schedule</span>
              <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">Live Bidirectional Sync</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className={lbl}>Average Rent per Unit ($/mo)</label>
                <input type="number" value={w.storageRentPerUnit} onChange={(e) => syncStorage('rpu', e.target.value)} className={inputLg} />
              </div>
              <div className="space-y-1.5">
                <label className={lbl}>Total Monthly Facility Rent ($)</label>
                <input type="number" value={w.storageGrossRent} onChange={(e) => syncStorage('tot', e.target.value)} className={inputLg} />
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
                <input type="number" value={w.multiRentPerUnit} onChange={(e) => syncMulti('rpu', e.target.value)} className={inputLg} />
              </div>
              <div className="space-y-1.5">
                <label className={lbl}>Total Monthly Property Rent ($)</label>
                <input type="number" value={w.multiGrossRent} onChange={(e) => syncMulti('tot', e.target.value)} className={inputLg} />
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
                <input type="number" value={w.commAnnualRent} onChange={(e) => syncComm('ann', e.target.value)} className={inputLg} />
              </div>
              <div className="space-y-1.5">
                <label className={lbl}>Monthly Rent Equivalent ($/mo)</label>
                <input type="number" value={w.commGrossRent} onChange={(e) => syncComm('mo', e.target.value)} className={inputLg} />
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
                <input type="number" value={w.sfrGrossRent} onChange={(e) => set({ sfrGrossRent: e.target.value, grossRent: e.target.value })} className={inputLg} />
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:col-span-2">
            <div className="space-y-1.5">
              <label htmlFor="wiz-capex" className={lbl}>Replacement Reserve</label>
              <div className="flex gap-2">
                <input id="wiz-capex" type="number" min={0} step="any" value={w.capexValue} onChange={(e) => set({ capexValue: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
                <select aria-label="Reserve basis" value={w.capexKind} onChange={(e) => set({ capexKind: e.target.value })} className="bg-slate-900 border border-slate-800 rounded-xl px-2 text-[11px] text-white">
                  <option value="annual">$ a year</option>
                  <option value="percent">% of income</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="wiz-mgmt" className={lbl}>Management Fee (%)</label>
              <input id="wiz-mgmt" type="number" min={0} max={30} step="any" value={w.managementFee} onChange={(e) => set({ managementFee: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
            </div>
            {(asset === 'commercial' || w.leaseType === 'NNN' || !(num(w.grossRent) > 0)) && (
              <div className="grid grid-cols-3 gap-3 sm:col-span-2">
                <p className="col-span-3 text-[10px] text-slate-500 leading-relaxed">What it costs to carry: needed when there is no rent yet, or when tenants pay the building's costs. County records give the assessed value; set your tax rate in your Investor Profile to estimate taxes from it.</p>
                <div className="space-y-1.5">
                  <label htmlFor="wiz-taxes" className={lbl}>Property Taxes ($/yr)</label>
                  <input id="wiz-taxes" type="number" min={0} step="any" value={w.taxes} onChange={(e) => set({ taxes: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="wiz-insurance" className={lbl}>Insurance ($/yr)</label>
                  <input id="wiz-insurance" type="number" min={0} step="any" value={w.insurance} onChange={(e) => set({ insurance: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="wiz-maintenance" className={lbl}>Maintenance ($/yr)</label>
                  <input id="wiz-maintenance" type="number" min={0} step="any" value={w.maintenance} onChange={(e) => set({ maintenance: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
                </div>
              </div>
            )}
            {asset === 'storage' && (
              <div className="space-y-1.5">
                <label htmlFor="wiz-payroll" className={lbl}>Payroll &amp; Marketing (%)</label>
                <input id="wiz-payroll" type="number" min={0} max={60} step="any" value={w.payroll} onChange={(e) => set({ payroll: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Step 4 */}
      <div className={`space-y-5 ${step === 4 && !submitting ? '' : 'hidden'}`}>
        {fillBar}
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
            <label htmlFor="wiz-amortization" className={lbl}>Loan Term (Years)</label>
            <input id="wiz-amortization" type="number" value={w.amort} onChange={(e) => set({ amort: e.target.value })} className={`${inputBase} py-2.5 px-3.5 text-sm font-bold`} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="wiz-maturity" className={lbl}>Balloon Due (Years, optional)</label>
            <input id="wiz-maturity" type="number" min={1} value={w.maturity} onChange={(e) => set({ maturity: e.target.value })} className={`${inputBase} py-2.5 px-3.5 text-sm font-bold`} />
          </div>
          <p className="sm:col-span-2 text-[10px] text-slate-500 leading-relaxed">Every loan is its own: take the rate and term from this loan's term sheet. The loan is paid off at the end of its term, counted from the closing date. Only a loan with a balloon payment needs the optional due year, and it cannot come before your hold ends.</p>
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
          <div className="space-y-1.5">
            <label htmlFor="wiz-selling" className={lbl}>Selling Costs at Exit (%)</label>
            <input id="wiz-selling" type="number" min={0} max={20} step="any" value={w.sellingCost} onChange={(e) => set({ sellingCost: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="wiz-hold" className={lbl}>Hold Period (Years)</label>
            <input id="wiz-hold" type="number" min={1} max={30} value={w.exitYear} onChange={(e) => set({ exitYear: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="wiz-discount" className={lbl}>Discount Rate (%)</label>
            <input id="wiz-discount" type="number" min={0} max={50} step="any" value={w.discountRate} onChange={(e) => set({ discountRate: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
          </div>
        </div>

        <div className="p-4 bg-brand-950/30 border border-brand-800/60 rounded-2xl space-y-2">
          <div className="flex items-center space-x-2 text-xs font-bold text-brand-300"><span>🏛️ Underwriting Engine Ready</span></div>
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
