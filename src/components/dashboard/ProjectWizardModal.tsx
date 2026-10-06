import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase/client';
import { AddressService } from '../../lib/services/addressService';

import { seedFromAssumptions, reconcileBasis, managerChoice, DEFAULT_CLOSING_WEEKS, type InputBasis } from '../../../supabase/functions/_shared/underwritingAssumptions';
import { getProfile } from '../../lib/profile';
import { mapSupabaseDeal } from '../../stores/useDealStore';
import { formatCurrency } from '../../lib/format';
import { openQuestions } from '../../lib/ingestion/openQuestions';
import { findParcels, isRealParcel } from '../../lib/services/parcelLookup';
import { uploadDealDocuments } from '../../lib/documents/dealDocuments';
import { VARIANCE_DISCLOSURE } from '../../lib/ingestion/apply';
import { clearWizardDraft, loadWizardDraft, saveWizardDraft } from '../../lib/wizardDraft';
import { buildIntakeRecord, type IntakeSnapshot } from '../../lib/ingestion/intakeRecord';
import type { DealRecord } from '../../lib/math/types';
import { WizardAutofill, type Autofill, type ProfileFilled } from './WizardAutofill';
import { applyToForm, assetFromDocs, FORM_FIELD_FOR_KEY, formAsInputs, PROFILE_FIELD, profileFill } from '../../lib/ingestion/wizardMap';

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
    price: '', down: '', closing: '', closingDate: '', rehab: '', grossRent: '', other: '',
    vacancy: '', rentGrowth: '', opexRatio: '', expenseGrowth: '',
    rate: '', amort: '', maturity: '', exitCap: '', apprec: '', exitYear: '', discountRate: '', sellingCost: '',
    capexKind: 'annual', capexValue: '', managementFee: '', payroll: '', taxes: '', insurance: '', maintenance: '', utilities: '',
    storageUnits: '', storageSqft: '', storageAutomated: 'false', storageRentPerUnit: '', storageGrossRent: '',
    multiUnits: '', multiSqft: '', multiRentPerUnit: '', multiGrossRent: '',
    commSqft: '', commAnnualRent: '', commGrossRent: '',
    sfrArv: '', sfrSqft: '', sfrGrossRent: '',
    financingType: 'fixed', armInitial: '', armRate: '', armCap: '', ioYears: '', manageProperty: 'false',
  };
};

/** A new project starts with the owner's own choice about hiring a property manager (from their investor profile); this property can differ. */
const withManager = (w: W): W => ({ ...w, manageProperty: managerChoice(getProfile().underwritingAssumptions, w.asset).uses ? 'true' : 'false' });

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
  // Set once the owner has used the one fill action: from then on the fields still empty are marked
  const [filledOnce, setFilledOnce] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // The form was put back from a draft kept by this tab (a reload or a stale-version refresh would otherwise have thrown it away)
  const [restored, setRestored] = useState(false);
  // What was read from documents and what the owner decided, kept until the project is created and saved with it as the record of sources
  const [intake, setIntake] = useState<IntakeSnapshot | null>(null);
  // The owner confirms they reviewed what was read from documents and filled from their profile. Not kept in the draft: after a reload they confirm again.
  const [verified, setVerified] = useState(false);
  // Pressing Create before confirming: say what is missing and bring the confirmation into view
  const [verifyNudge, setVerifyNudge] = useState(false);
  // The original files the owner added to be read: kept with the project once it exists (files cannot be kept in the draft, so a reload drops them)
  const [docFiles, setDocFiles] = useState<Array<{ file: File; type?: string }>>([]);
  // How the county parcel was found, kept with the project so the Assumptions tab can say so
  const parcelHow = useRef<{ method: 'picked' | 'apn' | 'address'; addressesChecked: string[] } | null>(null);
  const verifyRef = useRef<HTMLLabelElement | null>(null);
  // The closing date the investor profile filled in (and the weeks it used), so it can be told apart from a date the owner entered
  const [closingFilled, setClosingFilled] = useState<{ date: string; weeks: number } | null>(null);
  const [answers, setAnswers] = useState<Record<string, { label: string; decision: string }>>({});
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
  // Read from documents: figures the form has no field for (the tenant list, loan amount, parcel number), saved with the project
  const [docExtra, setDocExtra] = useState<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!isOpen) return;
    const draft = loadWizardDraft();
    if (draft) {
      setW(draft.w as W); setFilledOnce(draft.filledOnce); setIsNameTouched(draft.isNameTouched); setError(null); setSubmitting(false);
      setAssessor(draft.assessor ?? null); setParcels((draft.parcels as any[]) ?? []); setCompanions(0); setAddrResults([]); setAddrOpen(false);
      setSeededBasis(draft.seededBasis as Record<string, InputBasis>); setSeedNote(null); setDocExtra(draft.docExtra); setRestored(true);
      setIntake((draft.intake as IntakeSnapshot) ?? null); setAnswers(draft.answers ?? {}); setClosingFilled(draft.closingFilled ?? null);
    } else {
      setRestored(false);
      setFilledOnce(false); setW(withManager(seed('commercial'))); setIsNameTouched(false); setError(null); setSubmitting(false);
      setAssessor(null); setParcels([]); setCompanions(0); setAddrResults([]); setAddrOpen(false); setSeededBasis({}); setSeedNote(null); setDocExtra({});
      setIntake(null); setAnswers({}); setClosingFilled(null);
    }
    setVerified(false); setVerifyNudge(false);
    supabase.from('entities').select('id,name').order('name').then(({ data }) => setEntities((data as any[]) ?? []));
  }, [isOpen]);

  const set = (patch: W) => setW((p) => ({ ...p, ...patch }));
  const asset = w.asset as Asset;

  const pkg = useMemo(() => {
    try { return AddressService.aggregateParcelPackage(parcels) as any; } catch { return { totalAcres: 0, totalSqFt: 0, totalAssessedValue: 0, totalParcels: 0 }; }
  }, [parcels]);

  // The owner-of-record check on a multi-parcel package: parcels sold together are normally held by one owner. A parcel held by someone else
  // may still belong (a related entity), but it is the first thing to double-check, so it is flagged rather than assumed.
  const ownerCheck = (p: any): 'primary' | 'same' | 'different' | 'unknown' => {
    if (p.isPrimary) return 'primary';
    const main = parcels.find((x) => x.isPrimary);
    const known = (o: unknown) => typeof o === 'string' && o.trim() !== '' && o !== 'Owner of Record';
    if (!main || !known(main.owner) || !known(p.owner)) return 'unknown';
    try { return AddressService.ownersMatch(main.owner, p.owner) ? 'same' : 'different'; } catch { return 'unknown'; }
  };
  const ownerMismatch = parcels.some((p) => p.included && !p.isPrimary && ownerCheck(p) !== 'same');

  const selectAsset = (a: Asset) => {
    // Identity and location carry across a change of asset class; everything else starts blank for the new class
    setW((prev) => ({
      ...withManager(seed(a)),
      name: prev.name,
      location: prev.location,
      entity: prev.entity,
      marketTier: prev.location ? prev.marketTier : DEFAULTS[a].marketTier,
    }));
    setSeededBasis({});
    setSeedNote(null);
  };

  /** A figure typed by the owner in answer to a question: it goes into the form field it belongs to. */
  /** Applies one figure the reader was unsure of, after the owner checked the document and chose to use it. */
  const acceptChange = (proposal: Parameters<typeof applyToForm>[0]['proposal'], key: string) => {
    const fill = applyToForm({ form: w, asset, proposal, ticked: new Set([key]) });
    setW(fill.form);
    setDocExtra((e) => ({ ...e, ...fill.extra }));
    setSeededBasis((b) => ({ ...b, ...fill.basis }));
  };

  const provide = (key: string, value: string) => {
    if (key === 'address') { set({ location: value }); return; }
    const field = FORM_FIELD_FOR_KEY[key];
    if (!field) return;
    set(key === 'capexReserveAnnual' ? { [field]: value, capexKind: 'annual' } : { [field]: value });
  };

  /** The owner's profile assumptions for every blank field of `base`, with their reasons. Fields already filled are never overwritten. */
  const assumptionFill = (base: W, assetKey: Asset) => {
    const profile = getProfile();
    return profileFill({
      assumptions: profile.underwritingAssumptions, discountRate: profile.discountRate, exitYear: profile.exitYear, base, asset: assetKey,
      assessedValue: Number(assessor?.taxableValue) || Number(pkg.totalAssessedValue || assessor?.totalAssessedValue) || null,
    });
  };

  /**
   * The one action. What the documents gave goes into the form first (facts), then the owner's own assumptions fill what is still blank, and
   * the fields that remain empty are marked. Nothing is asked here: the owner only answers what is left.
   */
  const autofill = async (a: Autofill | null): Promise<void> => {
    let form: W = w;
    let nextAsset: Asset = asset;
    let fromDocs: Record<string, InputBasis> = {};
    if (a) {
      // The asset class the documents point to
      const docAsset = a.ticked.has('assetClass') ? assetFromDocs(a.docs) : null;
      nextAsset = docAsset ?? asset;
      const base: W = nextAsset === asset ? w : { ...withManager(seed(nextAsset)), name: w.name, location: w.location, entity: w.entity };
      const fill = applyToForm({ form: base, asset: nextAsset, proposal: a.proposal, ticked: a.ticked });
      form = fill.form;
      fromDocs = fill.basis;
      setIntake({
        documents: a.documents,
        figures: a.proposal.changes.filter((c) => a.ticked.has(c.key)).map((c) => ({
          key: c.key, label: c.label, text: c.proposed, how: c.how, reliability: c.reliability, documentType: (a.proposal.patch.provenance as Record<string, { documentType?: string }>)[c.key]?.documentType,
          value: typeof c.value === 'number' || typeof c.value === 'string' ? c.value : undefined,
        })),
        claims: Object.values(a.proposal.patch.claims).map((c) => ({ how: c.how, value: c.value })),
        notes: a.proposal.patch.notes,
        checks: a.checks,
        lineage: a.lineage,
      });
      setDocExtra((e) => ({ ...(nextAsset === asset ? e : {}), ...fill.extra }));
    }
    const fromProfile = assumptionFill(form, nextAsset);
    setW({ ...form, ...fromProfile.patch });
    if (fromProfile.closing) setClosingFilled(fromProfile.closing);
    setSeededBasis((b) => ({ ...(nextAsset === asset ? b : {}), ...fromDocs, ...fromProfile.basis }));
    if (form.location && form.location !== w.location) onLocation(form.location);
    setFilledOnce(true);
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
    parcelHow.current = { method: 'picked', addressesChecked: [] };
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

      // The county parcel: the one picked from the address list, else looked up now (by the parcel number the documents gave, or by the
      // street address with any unit taken off). Only a real county record is used: nothing is saved as county data without figures behind it.
      let a: any = assessor;
      if (!isRealParcel(a)) {
        const found = await findParcels({ apn: String(docExtra.primaryApn ?? ''), location: w.location });
        a = found.primary;
        if (found.method) parcelHow.current = { method: found.method, addressesChecked: found.addressesChecked };
        // Other parcels the owner has to decide about: other street numbers that lead to a different parcel, and parcels next door with the same
        // owner. Nothing is included silently: the owner chooses which belong to the project, then presses Create again.
        if (a) {
          const others: any[] = [...found.others];
          try {
            const near: any[] = (await AddressService.detectNearbySameOwnerParcels(a.apn, a.owner, a)) || [];
            near.forEach((n) => { if (!others.some((o) => String(o.apn) === String(n.apn)) && String(n.apn) !== String(a.apn)) others.push(n); });
          } catch { /* the nearby check is a courtesy; the parcel itself was found */ }
          if (others.length > 0) {
            setAssessor(a);
            setParcels([{ ...a, isPrimary: true, included: true }, ...others.map((o) => ({ ...o, isPrimary: false, included: false }))]);
            setCompanions(others.length);
            setError(`We found ${others.length} other parcel${others.length === 1 ? '' : 's'} connected to this address. Please choose which belong to this project in the parcel list above, then press Create project again.`);
            setTimeout(() => document.getElementById('wiz-parcel-package')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
            return;
          }
        }
      }
      if (!isRealParcel(a)) a = null;
      const profile = getProfile();
      const isStorage = asset === 'storage';
      const isIncomeValued = asset !== 'single-family';
      const amort = optInt(w.amort);
      const hold = optInt(w.exitYear);
      const capex = opt(w.capexValue);
      // The closing date is fixed now: the one entered, else today plus the owner's assumed weeks (set once, so it does not drift)
      const weeks = getProfile().underwritingAssumptions?.assumedClosingWeeks ?? DEFAULT_CLOSING_WEEKS;
      const enteredClosing = w.closingDate.trim();
      const closingDate = enteredClosing || new Date(Date.now() + weeks * 7 * 86400000).toISOString().slice(0, 10);
      const inputs: Record<string, any> = {
        closingDate,
        // A date the investor profile filled in is the profile's assumption, not something the owner entered
        closingDateSource: closingDate ? (enteredClosing && !(closingFilled && enteredClosing === closingFilled.date) ? 'entered' : 'assumed') : undefined,
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
        otherIncomeAnnual: opt(w.other),
        expenseRatio: opt(w.opexRatio), operatingExpenseRatio: opt(w.opexRatio),
        expenseGrowth: opt(w.expenseGrowth), expenseInflation: opt(w.expenseGrowth),
        rentGrowth: opt(w.rentGrowth), annualRentGrowth: opt(w.rentGrowth),
        // Everything but a single-family home is valued by capitalising its income at exit
        ...(isIncomeValued ? { targetCapRate: opt(w.exitCap), targetExitCapRate: opt(w.exitCap) } : { appreciationRate: opt(w.apprec) }),
        sellingCostPercent: opt(w.sellingCost),
        manageProperty: w.manageProperty === 'true',
        managementFeePercent: opt(w.managementFee),
        payrollMarketingPercent: isStorage ? opt(w.payroll) : undefined,
        capexReserveAnnual: w.capexKind === 'percent' ? undefined : capex,
        capexReservePercent: w.capexKind === 'percent' ? capex : undefined,
        annualTaxes: opt(w.taxes), annualInsurance: opt(w.insurance), annualMaintenance: opt(w.maintenance), annualUtilities: opt(w.utilities),
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
        // "Synced" only when a county record was actually found; the deal page tries the county again when it is not
        ...(a ? { parcelSource: { method: parcelHow.current?.method ?? 'picked', addressesChecked: (parcelHow.current?.addressesChecked ?? []).length > 1 ? parcelHow.current?.addressesChecked : undefined, foundAt: new Date().toISOString() } } : {}),
        ...(a ? { gisSync: { lastSyncedAt: new Date().toISOString(), syncSource: a.source || 'county_arcgis', status: 'active' } } : {}),
        financingType: w.financingType,
        armInitialYears: optInt(w.armInitial), armAdjustmentRate: opt(w.armRate), armRateCap: opt(w.armCap),
        interestOnlyYears: optInt(w.ioYears),
        entity_id: w.entity || null,
      };
      // Where each number came from: the owner's profile assumptions (with their reasons) or the owner's own entry
      inputs.assumptionBasis = reconcileBasis(seededBasis, inputs);
      // What was read from documents and has no field in the wizard (never overrides a figure the form or the county record supplied)
      for (const [k, v] of Object.entries(docExtra)) if (inputs[k] === undefined || inputs[k] === null) inputs[k] = v;
      Object.keys(inputs).forEach((k) => inputs[k] === undefined && delete inputs[k]);


      const { data: userRes } = await supabase.auth.getUser();
      const user = userRes?.user;
      if (!user) throw new Error('Please sign in to create a project.');

      // The record of where the figures came from: the documents read, the reasoning for each figure, the seller's claims, the notes and the owner's decisions
      const live = formAsInputs(w, asset) as Record<string, unknown>;
      const currentFor = (key: string, value: unknown): number | string | undefined => {
        if (key === 'address') return typeof value === 'string' && w.location.toLowerCase().startsWith(value.toLowerCase()) ? value : w.location || undefined;
        const v = live[key];
        return typeof v === 'number' || typeof v === 'string' ? v : undefined;
      };
      const record = buildIntakeRecord({
        documents: intake?.documents ?? [],
        documentFigures: (intake?.figures ?? []).map((f) => ({ ...f, current: currentFor(f.key, f.value) })),
        profileFigures,
        claims: intake?.claims ?? [],
        checks: intake?.checks,
        lineage: intake?.lineage,
        // The two assumptions that are not figures in the form: whether a manager is hired, and when closing is taken to be
        notes: [
          ...(intake?.notes ?? []),
          ...((intake?.documents ?? []).length > 0 ? [VARIANCE_DISCLOSURE] : []),
          w.manageProperty === 'true'
            ? `Property manager: you hire one; a fee of ${w.managementFee.trim() || '(not set)'}% of collected income is charged on top of the expense ratio.`
            : 'Property manager: you manage it yourself; no management fee is charged.',
          ...(w.closingDate.trim() === '' || (closingFilled && w.closingDate === closingFilled.date)
            ? [`Closing date: ${closingFilled?.date ?? 'assumed'} — your investor profile is set to close ${closingFilled?.weeks ?? (getProfile().underwritingAssumptions?.assumedClosingWeeks ?? DEFAULT_CLOSING_WEEKS)} weeks after the project is created.`]
            : []),
        ],
        choices: Object.values(answers),
        verifiedBy: needsVerification && verified ? user.id : undefined,
      });
      if (record) inputs.intakeRecord = record;

      const { data, error: insErr } = await supabase
        .from('deals')
        .insert({
          user_id: user.id, entity_id: w.entity || null, title: name, asset_type: asset, status: 'prospect',
          location, purchase_price: purchasePrice, inputs: inputs as any,
        } as any)
        .select()
        .single();
      if (insErr || !data) throw new Error(insErr?.message || 'Failed to create project record');

      // Keep the original documents with the project (private to the owner). The project exists either way: a failure here is reported, not fatal.
      if (docFiles.length > 0) {
        try {
          const kept = await uploadDealDocuments({ userId: user.id, dealId: String((data as any).id), files: docFiles });
          if (kept.failed.length > 0) window.alert(`The project was created, but ${kept.failed.length === 1 ? 'one original file' : `${kept.failed.length} original files`} could not be stored with it: ${kept.failed.map((f) => `${f.name} (${f.reason})`).join('; ')}`);
        } catch (e) {
          console.warn('[wizard] storing the original documents failed:', e);
        }
      }

      onProjectCreated(mapSupabaseDeal(data));
      close();
    } catch (err: any) {
      console.error('Wizard error:', err);
      setError(err?.message || 'Could not create the project');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  // Keep the form as typed, so nothing is lost if the page reloads. A form nobody has touched is not kept.
  React.useEffect(() => {
    if (!isOpen || submitting) return;
    const pristine = JSON.stringify(w) === JSON.stringify(withManager(seed(w.asset as Asset))) && !filledOnce;
    if (pristine) return;
    const t = setTimeout(() => saveWizardDraft({ w, filledOnce, isNameTouched, docExtra, seededBasis, assessor, parcels, intake, answers, closingFilled }), 400);
    return () => clearTimeout(t);
  }, [isOpen, submitting, w, filledOnce, isNameTouched, docExtra, seededBasis, assessor, parcels, intake, answers, closingFilled]);

  /** Closing on purpose (Cancel, the X, or after creating) throws the draft away. */
  const close = () => { clearWizardDraft(); setRestored(false); onClose(); };

  /** Start again from a blank form. */
  const startOver = () => {
    clearWizardDraft();
    setRestored(false); setFilledOnce(false); setW(withManager(seed('commercial'))); setIsNameTouched(false); setError(null);
    setAssessor(null); setParcels([]); setCompanions(0); setAddrResults([]); setAddrOpen(false); setSeededBasis({}); setSeedNote(null); setDocExtra({});
    setIntake(null); setAnswers({}); setVerified(false); setVerifyNudge(false); setClosingFilled(null); setDocFiles([]);
  };

  // What the form holds from the owner's investor profile: recorded per figure when it was filled, and kept only while the field still holds that
  // value (a figure the owner changed is theirs now). Worked out from the form, not from the last click, so it stays true after a second fill or a reload.
  const profileFigures = useMemo<ProfileFilled[]>(() => (
    Object.entries(seededBasis).flatMap(([key, b]) => {
      if (b.source !== 'profile' || b.value === undefined) return [];
      const field = PROFILE_FIELD[key];
      if (!field || Number(w[field]) !== b.value) return [];
      // Apartments, commercial and storage are valued at the exit cap rate, so appreciation does not apply to them and is not listed
      if (key === 'appreciationRate' && asset !== 'single-family') return [];
      return [{ key, label: b.label, value: b.value, why: b.rationale }];
    })
  ), [seededBasis, w, asset]);

  // Anything read from a document or filled from the investor profile has to be confirmed by the owner before the project is created
  const needsVerification = filledOnce && (intake !== null || profileFigures.length > 0);

  // The facts and assumptions the engine still has nobody's answer for, as the form fields they belong to (the closing date is assumed at creation)
  const emptyFields = useMemo(() => {
    const out = new Set<string>();
    if (!filledOnce) return out;
    try {
      for (const m of openQuestions({ asset_class: asset, purchase_price: num(w.price) || undefined, inputs: formAsInputs(w, asset) })) {
        const f = FORM_FIELD_FOR_KEY[m.key];
        if (f && f !== 'closingDate') out.add(f);
      }
    } catch { /* an incomplete form is exactly what is being marked */ }
    if (!w.price.trim()) out.add('price');
    return out;
  }, [w, asset, filledOnce]);

  React.useEffect(() => {
    rootRef.current?.querySelectorAll<HTMLElement>('[data-field]').forEach((el) => el.classList.toggle('need-answer', emptyFields.has(el.dataset.field ?? '')));
  });

  const stepDivs = (
    <>
      {/* Step 1 */}
      <div className={`space-y-5 ${submitting ? 'hidden' : ''}`}>
        <h4 className="text-[11px] uppercase tracking-wider font-black text-slate-300 border-b border-slate-800 pb-1.5">1 · Property and documents</h4>
        <WizardAutofill deal={{ asset_class: asset, purchase_price: num(w.price) || null, inputs: formAsInputs(w, asset) }} onAutofill={autofill} onSet={provide} onAccept={acceptChange} onAnswered={(key, label, decision) => setAnswers((a) => ({ ...a, [key]: { label, decision } }))} onFiles={(files) => setDocFiles((prev) => [...prev.filter((p) => !files.some((f) => f.file.name === p.file.name && f.file.size === p.file.size)), ...files])} profileFigures={profileFigures}
          intake={intake}
          closing={w.closingDate.trim() === '' ? { weeks: getProfile().underwritingAssumptions?.assumedClosingWeeks ?? DEFAULT_CLOSING_WEEKS, date: null } : (closingFilled && w.closingDate === closingFilled.date ? closingFilled : null)} />

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
            <select id="wiz-entity-select" data-field="entity" value={w.entity} onChange={(e) => set({ entity: e.target.value })}
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
          <input id="wiz-location" type="text" autoComplete="off" placeholder="e.g. 128 N 2nd St, Yakima, WA" data-field="location" value={w.location}
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
                  <input type="number" min={1} placeholder="e.g. 20" data-field="storageUnits" value={w.storageUnits} onChange={(e) => set({ storageUnits: e.target.value })} className={inputSm} />
                </div>
                <div className="space-y-1.5">
                  <label className={lbl2}>Rentable Facility Area (Sq Ft)</label>
                  <input type="number" min={100} placeholder="e.g. 2000" data-field="storageSqft" value={w.storageSqft} onChange={(e) => set({ storageSqft: e.target.value })} className={inputSm} />
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
                  <input type="number" min={1} placeholder="e.g. 12" data-field="multiUnits" value={w.multiUnits} onChange={(e) => set({ multiUnits: e.target.value })} className={inputSm} />
                </div>
                <div className="space-y-1.5">
                  <label className={lbl2}>Gross Leasable Area (GLA Sq Ft)</label>
                  <input type="number" min={100} placeholder="e.g. 11000" data-field="multiSqft" value={w.multiSqft} onChange={(e) => set({ multiSqft: e.target.value })} className={inputSm} />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1.5 pb-1 border-b border-slate-800/60">
            <div className="flex items-center justify-between">
              <label htmlFor="wiz-lease-type" className={lbl2}>Primary Lease Structure</label>
              <span className="text-[10px] text-slate-400">{LEASE_HINT[w.leaseType] || ''}</span>
            </div>
            <select id="wiz-lease-type" data-field="leaseType" value={w.leaseType} onChange={(e) => set({ leaseType: e.target.value })}
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
                <input type="number" min={100} placeholder="e.g. 15000" data-field="commSqft" value={w.commSqft} onChange={(e) => set({ commSqft: e.target.value })} className={inputSm} />
              </div>
            </div>
          )}

          {asset === 'single-family' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className={lbl2}>Appraised / After-Repair Value ($)</label>
                  <input type="number" min={0} placeholder="e.g. 450000" data-field="sfrArv" value={w.sfrArv} onChange={(e) => set({ sfrArv: e.target.value })} className={inputSm} />
                </div>
                <div className="space-y-1.5">
                  <label className={lbl2}>Living Area (Sq Ft)</label>
                  <input type="number" min={100} placeholder="e.g. 2400" data-field="sfrSqft" value={w.sfrSqft} onChange={(e) => set({ sfrSqft: e.target.value })} className={inputSm} />
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
          <div id="wiz-parcel-package" className="p-3.5 bg-slate-900/90 border border-brand-500/40 rounded-2xl space-y-3 text-xs">
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
            {ownerMismatch && (
              <p role="alert" className="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1.5 leading-relaxed">
                A parcel you included is not held by the same owner of record as the primary parcel. Parcels sold together usually share an owner, so please check the county card for each before you create the project.
              </p>
            )}
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
                        {!p.isPrimary && (() => { const c = ownerCheck(p); return (
                          <span className={`block text-[10px] font-semibold ${c === 'same' ? 'text-emerald-400' : 'text-amber-300'}`}>
                            {c === 'same' ? `Same owner of record: ${p.owner}` : c === 'different' ? `Different owner of record: ${p.owner}. Double-check this parcel belongs to the sale.` : 'Owner of record could not be compared. Double-check this parcel belongs to the sale.'}
                          </span>); })()}
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
              <select id="wiz-market-tier" data-field="marketTier" value={w.marketTier} onChange={(e) => set({ marketTier: e.target.value })}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                <option value="Tier 1">Tier 1 • Primary / Gateway</option>
                <option value="Tier 2">Tier 2 • Secondary / Growth</option>
                <option value="Tier 3">Tier 3 • Tertiary / Regional</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="wiz-property-class" className={lbl2}>Property Class</label>
              <select id="wiz-property-class" data-field="propertyClass" value={w.propertyClass} onChange={(e) => set({ propertyClass: e.target.value })}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                <option value="Class A">Class A • Prime / Trophy</option>
                <option value="Class B">Class B • Value-Add / Core-Plus</option>
                <option value="Class C">Class C • Workforce / Opportunity</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="wiz-facility-type" className={lbl2}>Facility Sub-Type</label>
              <select id="wiz-facility-type" data-field="facilityType" value={w.facilityType} onChange={(e) => set({ facilityType: e.target.value })}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl py-2 px-3 text-xs text-white focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                {DEFAULTS[asset].subTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 italic">{guidance}</p>
        </div>
      </div>

      {/* Step 2 */}
      <div className={`space-y-5 ${submitting ? 'hidden' : ''}`}>
        <h4 className="text-[11px] uppercase tracking-wider font-black text-slate-300 border-b border-slate-800 pb-1.5">2 · Capital and valuation</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="wiz-purchase-price" className={lbl}>Purchase Price ($)</label>
            <input id="wiz-purchase-price" type="number" data-field="price" value={w.price} onChange={(e) => set({ price: e.target.value })} className={`${inputBase} py-2.5 px-3.5 text-sm font-bold`} />
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
            <input id="wiz-down-payment" type="number" step="0.5" data-field="down" value={w.down} onChange={(e) => set({ down: e.target.value })} className={`${inputBase} py-2.5 px-3.5 text-sm font-bold`} />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="wiz-closing-date" className={lbl}>Expected Closing Date (optional)</label>
          <input id="wiz-closing-date" type="date" data-field="closingDate" value={w.closingDate} onChange={(e) => set({ closingDate: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
          <p className="text-[10px] text-slate-500">Leave blank to assume closing {getProfile().underwritingAssumptions?.assumedClosingWeeks ?? DEFAULT_CLOSING_WEEKS} weeks from today (your investor profile's setting). The loan schedule starts then.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="wiz-closing-costs" className={lbl}>Closing Costs ($)</label>
            <input id="wiz-closing-costs" type="number" data-field="closing" value={w.closing} onChange={(e) => set({ closing: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="wiz-rehab-costs" className={lbl}>Initial Rehab / CapEx ($)</label>
            <input id="wiz-rehab-costs" type="number" data-field="rehab" value={w.rehab} onChange={(e) => set({ rehab: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
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
      <div className={`space-y-5 ${submitting ? 'hidden' : ''}`}>
        <h4 className="text-[11px] uppercase tracking-wider font-black text-slate-300 border-b border-slate-800 pb-1.5">3 · Income and operations</h4>
        {asset === 'storage' && (
          <div className="p-3.5 bg-slate-950/70 rounded-2xl border border-slate-800/90 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">📦 Self-Storage Revenue Schedule</span>
              <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">Live Bidirectional Sync</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className={lbl}>Average Rent per Unit ($/mo)</label>
                <input type="number" data-field="storageRentPerUnit" value={w.storageRentPerUnit} onChange={(e) => syncStorage('rpu', e.target.value)} className={inputLg} />
              </div>
              <div className="space-y-1.5">
                <label className={lbl}>Total Monthly Facility Rent ($)</label>
                <input type="number" data-field="storageGrossRent" value={w.storageGrossRent} onChange={(e) => syncStorage('tot', e.target.value)} className={inputLg} />
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
                <input type="number" step="any" data-field="multiRentPerUnit" value={w.multiRentPerUnit} onChange={(e) => syncMulti('rpu', e.target.value)} className={inputLg} />
              </div>
              <div className="space-y-1.5">
                <label className={lbl}>Total Monthly Property Rent ($)</label>
                <input type="number" step="any" data-field="multiGrossRent" value={w.multiGrossRent} onChange={(e) => syncMulti('tot', e.target.value)} className={inputLg} />
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
                <input type="number" data-field="commAnnualRent" value={w.commAnnualRent} onChange={(e) => syncComm('ann', e.target.value)} className={inputLg} />
              </div>
              <div className="space-y-1.5">
                <label className={lbl}>Monthly Rent Equivalent ($/mo)</label>
                <input type="number" data-field="commGrossRent" value={w.commGrossRent} onChange={(e) => syncComm('mo', e.target.value)} className={inputLg} />
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
                <input type="number" data-field="sfrGrossRent" value={w.sfrGrossRent} onChange={(e) => set({ sfrGrossRent: e.target.value, grossRent: e.target.value })} className={inputLg} />
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
            <label htmlFor="wiz-other-income" className={lbl}>Other Income Besides Rent ($ a year)</label>
            <input id="wiz-other-income" type="number" data-field="other" value={w.other} onChange={(e) => set({ other: e.target.value })} className={`${inputBase} py-2.5 px-3.5 text-sm`} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="wiz-vacancy-rate" className={lbl}>Vacancy Rate (%)</label>
              <input id="wiz-vacancy-rate" type="number" step="0.5" data-field="vacancy" value={w.vacancy} onChange={(e) => set({ vacancy: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="wiz-rent-growth" className={lbl}>Annual Rent Growth (%)</label>
              <input id="wiz-rent-growth" type="number" step="0.1" data-field="rentGrowth" value={w.rentGrowth} onChange={(e) => set({ rentGrowth: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="wiz-opex-ratio" className={lbl}>Operating Expense Ratio (%)</label>
              <input id="wiz-opex-ratio" type="number" step="1.0" data-field="opexRatio" value={w.opexRatio} onChange={(e) => set({ opexRatio: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="wiz-expense-growth" className={lbl}>Expense Inflation (%)</label>
              <input id="wiz-expense-growth" type="number" step="0.1" data-field="expenseGrowth" value={w.expenseGrowth} onChange={(e) => set({ expenseGrowth: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:col-span-2">
            <div className="space-y-1.5">
              <label htmlFor="wiz-capex" className={lbl}>Replacement Reserve</label>
              <div className="flex gap-2">
                <input id="wiz-capex" type="number" min={0} step="any" data-field="capexValue" value={w.capexValue} onChange={(e) => set({ capexValue: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
                <select aria-label="Reserve basis" data-field="capexKind" value={w.capexKind} onChange={(e) => set({ capexKind: e.target.value })} className="bg-slate-900 border border-slate-800 rounded-xl px-2 text-[11px] text-white">
                  <option value="annual">$ a year</option>
                  <option value="percent">% of income</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer mb-1"><input type="checkbox" checked={w.manageProperty === 'true'} onChange={(e) => set({ manageProperty: e.target.checked ? 'true' : 'false' })} />I hire a property manager</label>
              <label htmlFor="wiz-mgmt" className={lbl}>Management Fee (%)</label>
              <input id="wiz-mgmt" type="number" min={0} max={30} step="any" data-field="managementFee" value={w.managementFee} onChange={(e) => set({ managementFee: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
            </div>
            {(asset === 'commercial' || w.leaseType === 'NNN' || !(num(w.grossRent) > 0)) && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:col-span-2">
                <p className="col-span-2 sm:col-span-4 text-[10px] text-slate-500 leading-relaxed">Taxes, insurance, upkeep and utilities are already inside your expense ratio in a normal year. These amounts are used only for a year with no rent and for the months a space is vacant (they are required when there is no rent yet, or when tenants pay the building's costs). County records give the assessed value; set your tax rate in your Investor Profile to estimate taxes from it.</p>
                <div className="space-y-1.5">
                  <label htmlFor="wiz-taxes" className={lbl}>Property Taxes ($/yr)</label>
                  <input id="wiz-taxes" type="number" min={0} step="any" data-field="taxes" value={w.taxes} onChange={(e) => set({ taxes: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="wiz-insurance" className={lbl}>Insurance ($/yr)</label>
                  <input id="wiz-insurance" type="number" min={0} step="any" data-field="insurance" value={w.insurance} onChange={(e) => set({ insurance: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="wiz-maintenance" className={lbl}>Maintenance ($/yr)</label>
                  <input id="wiz-maintenance" type="number" min={0} step="any" data-field="maintenance" value={w.maintenance} onChange={(e) => set({ maintenance: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="wiz-utilities" className={lbl}>Utilities ($/yr)</label>
                  <input id="wiz-utilities" type="number" min={0} step="any" data-field="utilities" value={w.utilities} onChange={(e) => set({ utilities: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
                </div>
              </div>
            )}
            {asset === 'storage' && (
              <div className="space-y-1.5">
                <label htmlFor="wiz-payroll" className={lbl}>Payroll &amp; Marketing (%)</label>
                <input id="wiz-payroll" type="number" min={0} max={60} step="any" data-field="payroll" value={w.payroll} onChange={(e) => set({ payroll: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Step 4 */}
      <div className={`space-y-5 ${submitting ? 'hidden' : ''}`}>
        <h4 className="text-[11px] uppercase tracking-wider font-black text-slate-300 border-b border-slate-800 pb-1.5">4 · Debt and exit</h4>
        <div className="space-y-1.5">
          <label htmlFor="wiz-financing-type" className={lbl}>Financing Structure / Loan Type</label>
          <select id="wiz-financing-type" data-field="financingType" value={w.financingType} onChange={(e) => set({ financingType: e.target.value })}
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
              <input type="number" min={1} max={10} data-field="armInitial" value={w.armInitial} onChange={(e) => set({ armInitial: e.target.value })} className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white" /></div>
            <div className="space-y-1"><label className="text-[11px] font-bold text-slate-400">Reset Rate (%)</label>
              <input type="number" step="0.125" data-field="armRate" value={w.armRate} onChange={(e) => set({ armRate: e.target.value })} className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white" /></div>
            <div className="space-y-1"><label className="text-[11px] font-bold text-slate-400">Max Rate Cap (%)</label>
              <input type="number" step="0.125" data-field="armCap" value={w.armCap} onChange={(e) => set({ armCap: e.target.value })} className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white" /></div>
          </div>
        )}
        {w.financingType === 'interest_only' && (
          <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl">
            <div className="space-y-1 max-w-xs"><label className="text-[11px] font-bold text-slate-400">Interest-Only Period (Years)</label>
              <input type="number" min={1} max={10} data-field="ioYears" value={w.ioYears} onChange={(e) => set({ ioYears: e.target.value })} className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white" /></div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="wiz-interest-rate" className={lbl}>Senior Debt Interest Rate (%)</label>
            <input id="wiz-interest-rate" type="number" step="0.125" data-field="rate" value={w.rate} onChange={(e) => set({ rate: e.target.value })} className={`${inputBase} py-2.5 px-3.5 text-sm font-bold`} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="wiz-amortization" className={lbl}>Loan Term (Years)</label>
            <input id="wiz-amortization" type="number" data-field="amort" value={w.amort} onChange={(e) => set({ amort: e.target.value })} className={`${inputBase} py-2.5 px-3.5 text-sm font-bold`} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="wiz-maturity" className={lbl}>Balloon Due (Years, optional)</label>
            <input id="wiz-maturity" type="number" min={1} data-field="maturity" value={w.maturity} onChange={(e) => set({ maturity: e.target.value })} className={`${inputBase} py-2.5 px-3.5 text-sm font-bold`} />
          </div>
          <p className="sm:col-span-2 text-[10px] text-slate-500 leading-relaxed">Every loan is its own: take the rate and term from this loan's term sheet. The loan is paid off at the end of its term, counted from the closing date. Only a loan with a balloon payment needs the optional due year, and it cannot come before your hold ends.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {asset !== 'single-family' && (
          <div className="space-y-1.5">
            <label htmlFor="wiz-exit-cap" className={lbl}>Exit Cap Rate (%)</label>
            <input id="wiz-exit-cap" type="number" step="0.1" data-field="exitCap" value={w.exitCap} onChange={(e) => set({ exitCap: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
          </div>
          )}
          {asset === 'single-family' && (
          <div className="space-y-1.5">
            <label htmlFor="wiz-appreciation" className={lbl}>Annual Property Appreciation (%)</label>
            <input id="wiz-appreciation" type="number" step="0.1" data-field="apprec" value={w.apprec} onChange={(e) => set({ apprec: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
          </div>
          )}
          <div className="space-y-1.5">
            <label htmlFor="wiz-selling" className={lbl}>Selling Costs at Exit (%)</label>
            <input id="wiz-selling" type="number" min={0} max={20} step="any" data-field="sellingCost" value={w.sellingCost} onChange={(e) => set({ sellingCost: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="wiz-hold" className={lbl}>Hold Period (Years)</label>
            <input id="wiz-hold" type="number" min={1} max={30} data-field="exitYear" value={w.exitYear} onChange={(e) => set({ exitYear: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="wiz-discount" className={lbl}>Discount Rate (%)</label>
            <input id="wiz-discount" type="number" min={0} max={50} step="any" data-field="discountRate" value={w.discountRate} onChange={(e) => set({ discountRate: e.target.value })} className={`${inputBase} py-2 px-3 text-xs`} />
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
      <style>{`.need-answer { box-shadow: 0 0 0 2px rgba(251, 191, 36, 0.75) !important; border-color: rgb(251 191 36) !important; }`}</style>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[96vh] sm:max-h-[92vh] transition-all">
        <div className="p-4 sm:p-6 border-b border-slate-800/80 bg-slate-950/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5 sm:space-x-3">
              <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl bg-gradient-to-tr from-brand-600 to-emerald-400 flex items-center justify-center shadow-lg shadow-brand-500/20 text-white font-black text-sm shrink-0">✨</div>
              <div>
                <h3 id="wizard-modal-title" className="text-base sm:text-lg font-black text-white tracking-tight">Create New Project</h3>
                <p className="text-[11px] sm:text-xs text-slate-400">{filledOnce ? <><span className="text-amber-300 font-bold">{emptyFields.size}</span> field{emptyFields.size === 1 ? '' : 's'} still need{emptyFields.size === 1 ? 's' : ''} an answer</> : 'One page: fill everything you can, then answer what is left'}</p>
              </div>
            </div>
            <button aria-label="Close project creation wizard" onClick={close} className="text-slate-400 hover:text-white text-sm p-1.5 rounded-lg hover:bg-slate-800/80 transition">✕</button>
          </div>
        </div>

        <div ref={rootRef} className="p-4 sm:p-6 overflow-y-auto space-y-8 flex-grow">
          {restored && (
            <p role="status" className="flex flex-wrap items-center gap-2 text-[11px] text-emerald-300">
              Your unfinished project was kept and is back as you left it.
              <button type="button" onClick={startOver} className="font-bold text-slate-300 hover:text-white underline">Start over</button>
            </p>
          )}
          {stepDivs}
          {needsVerification && !submitting && (
            <label ref={verifyRef} className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer ${verifyNudge && !verified ? 'border-rose-500/60 bg-rose-500/10' : 'border-amber-500/30 bg-amber-500/5'}`}>
              <input type="checkbox" className="mt-0.5" checked={verified} onChange={(e) => { setVerified(e.target.checked); if (e.target.checked) setVerifyNudge(false); }} />
              <span className="text-[11px] text-slate-300 leading-relaxed">
                <span className="font-bold text-slate-100 block">I have reviewed what was read from my documents and what was filled in from my investor profile.</span>
                Automated reading can miss or misread things, so I have checked the figures against my source documents. {VARIANCE_DISCLOSURE} I stand behind each figure. This tool helps me underwrite faster, but I am the one underwriting this deal, and a record of where each figure came from is saved with it.
              </span>
            </label>
          )}
          {error && <p className="text-xs text-rose-400 font-semibold">{error}</p>}
        </div>

        {verifyNudge && needsVerification && !verified && (
          <p role="alert" className="px-5 py-2 text-xs font-semibold text-rose-300 bg-rose-500/10 border-t border-rose-500/30">Almost there. Please scroll down to the bottom of the page and confirm that you have read and checked everything, then create the project.</p>
        )}
        <div className="p-5 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <button onClick={close} className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-300 transition">Cancel</button>
          <button onClick={() => {
            if (needsVerification && !verified) { setVerifyNudge(true); verifyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
            void submit();
          }} disabled={submitting} title={needsVerification && !verified ? 'Please scroll to the bottom of the page and confirm you have reviewed everything first' : undefined}
            className="px-6 py-2.5 rounded-xl text-xs font-black text-white bg-gradient-to-r from-brand-600 via-emerald-500 to-teal-400 hover:opacity-95 shadow-lg shadow-emerald-500/20 transition disabled:opacity-60">
            <span>⚡ Create project and run the engine</span>
          </button>
        </div>
      </div>
    </div>
  );
};
