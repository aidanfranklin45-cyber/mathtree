import React, { useState } from 'react';
import { invokeCreateProject } from '../../lib/supabase/edgeFunctions';
import { DealRecord, DealInputs } from '../../lib/math/types';
import {
  X,
  Building,
  Home,
  Store,
  Warehouse,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  DollarSign,
  Percent,
  Calendar,
  Layers,
} from 'lucide-react';

interface ProjectWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (project: DealRecord) => void;
}

export const ProjectWizardModal: React.FC<ProjectWizardModalProps> = ({
  isOpen,
  onClose,
  onProjectCreated,
}) => {
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form State
  const [title, setTitle] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('WA');
  const [county, setCounty] = useState('Yakima County');
  const [apn, setApn] = useState('');
  const [assetType, setAssetType] = useState<'single-family' | 'multi-unit' | 'commercial' | 'storage'>('commercial');
  const [stage, setStage] = useState<'screening' | 'loi' | 'due_diligence' | 'owned'>('screening');

  // Financial inputs
  const [purchasePrice, setPurchasePrice] = useState<number>(350000);
  const [downPaymentPercent, setDownPaymentPercent] = useState<number>(25);
  const [interestRate, setInterestRate] = useState<number>(6.5);
  const [loanTerm, setLoanTerm] = useState<number>(30);
  const [closingDate, setClosingDate] = useState<string>('');
  const [appreciationRate, setAppreciationRate] = useState<number>(3.5);

  // Operations
  const [monthlyRent, setMonthlyRent] = useState<number>(2800);
  const [expenseRatio, setExpenseRatio] = useState<number>(25);
  const [vacancyRate, setVacancyRate] = useState<number>(5);

  if (!isOpen) return null;

  const handleNext = () => {
    setErrorMessage(null);
    if (step === 1 && !title.trim() && !address.trim()) {
      setErrorMessage('Please provide a project name or property address.');
      return;
    }
    if (step === 3 && (!purchasePrice || purchasePrice <= 0)) {
      setErrorMessage('A valid purchase price is required.');
      return;
    }
    setStep((s) => Math.min(s + 1, 4));
  };

  const handleBack = () => {
    setErrorMessage(null);
    setStep((s) => Math.max(s - 1, 1));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const inputs: DealInputs = {
        purchasePrice,
        downPaymentPercent,
        interestRate,
        loanTermYears: loanTerm,
        loanTerm: loanTerm,
        closingDate: closingDate || undefined,
        appreciationRate,
        monthlyRent,
        grossRentPerMonth: monthlyRent,
        grossRentAnnual: monthlyRent * 12,
        operatingExpenseRatio: expenseRatio,
        expenseRatio,
        vacancyRatePercent: vacancyRate,
        vacancyRate,
        dealStage: stage,
        address,
        city,
        state,
        county,
        primaryApn: apn,
      } as any;

      const projectTitle = title.trim() || address.trim() || 'New Investment Deal';
      const location = address.trim() ? `${address}${city ? ', ' + city : ''}${state ? ', ' + state : ''}` : 'Yakima, WA';

      const res = await invokeCreateProject({
        title: projectTitle,
        assetType,
        location,
        inputs,
      });

      if (res.success && res.project) {
        onProjectCreated(res.project);
        onClose();
      } else {
        throw new Error(res.error || 'Failed to create project record');
      }
    } catch (err: any) {
      console.error('Wizard error:', err);
      setErrorMessage(err.message || 'Server error creating project via Edge Function');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-sm">
              ✨
            </div>
            <div>
              <h2 className="text-base font-black text-white">Create Underwriting Project</h2>
              <p className="text-xs text-slate-400">Step {step} of 4 • Edge-Powered Pro-Forma Engine</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="grid grid-cols-4 border-b border-slate-800/80 bg-slate-950/40 text-[11px] font-bold text-slate-400">
          <div className={`py-2 text-center border-b-2 transition ${step === 1 ? 'border-emerald-500 text-emerald-400' : 'border-transparent'}`}>
            1. Property
          </div>
          <div className={`py-2 text-center border-b-2 transition ${step === 2 ? 'border-emerald-500 text-emerald-400' : 'border-transparent'}`}>
            2. Asset Class
          </div>
          <div className={`py-2 text-center border-b-2 transition ${step === 3 ? 'border-emerald-500 text-emerald-400' : 'border-transparent'}`}>
            3. Capital & Debt
          </div>
          <div className={`py-2 text-center border-b-2 transition ${step === 4 ? 'border-emerald-500 text-emerald-400' : 'border-transparent'}`}>
            4. Operations
          </div>
        </div>

        {/* Step Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
              {errorMessage}
            </div>
          )}

          {/* STEP 1: Property Identity */}
          {step === 1 && (
            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Project Title / Display Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. 2820 Fruitvale Blvd Commercial Plaza"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Street Address
                </label>
                <input
                  type="text"
                  placeholder="e.g. 2820 Fruitvale Blvd"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">City</label>
                  <input
                    type="text"
                    placeholder="Yakima"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">State / County</label>
                  <input
                    type="text"
                    placeholder="Yakima County, WA"
                    value={county}
                    onChange={(e) => setCounty(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Primary Assessor Parcel Number (APN) <span className="text-slate-500 font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. 18131423456"
                  value={apn}
                  onChange={(e) => setApn(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          )}

          {/* STEP 2: Asset Class & Acquisition Stage */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-2">Select Asset Class</label>
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    { key: 'commercial', title: 'Commercial', desc: 'Retail, Industrial, Office', icon: <Store className="w-4 h-4 text-amber-400" /> },
                    { key: 'multi-unit', title: 'Multi-Family', desc: 'Duplex to 50+ Units', icon: <Building className="w-4 h-4 text-cyan-400" /> },
                    { key: 'single-family', title: 'Single-Family', desc: 'Residential & BRRRR', icon: <Home className="w-4 h-4 text-emerald-400" /> },
                    { key: 'storage', title: 'Self-Storage', desc: 'Standard & Climate Controlled', icon: <Warehouse className="w-4 h-4 text-purple-400" /> },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setAssetType(item.key as any)}
                      className={`p-3 rounded-xl border text-left flex items-start space-x-2.5 transition ${
                        assetType === item.key
                          ? 'bg-emerald-500/10 border-emerald-500/60 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="mt-0.5">{item.icon}</div>
                      <div>
                        <div className="text-xs font-black text-white">{item.title}</div>
                        <div className="text-[10px] text-slate-400">{item.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-2">Acquisition / Pipeline Stage</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { key: 'screening', label: 'Screening' },
                    { key: 'loi', label: 'LOI' },
                    { key: 'due_diligence', label: 'Due Diligence' },
                    { key: 'owned', label: 'Acquired / Owned' },
                  ].map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setStage(s.key as any)}
                      className={`py-2 px-2.5 rounded-xl text-xs font-bold border text-center transition ${
                        stage === s.key
                          ? 'bg-emerald-600 text-slate-950 border-emerald-500 font-black'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Capital & Debt Financing */}
          {step === 3 && (
            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Purchase Price ($)
                </label>
                <div className="relative">
                  <DollarSign className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="number"
                    step="1000"
                    value={purchasePrice}
                    onChange={(e) => setPurchasePrice(parseFloat(e.target.value) || 0)}
                    className="w-full pl-8 pr-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Down Payment (%)
                  </label>
                  <div className="relative">
                    <Percent className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="number"
                      step="0.5"
                      value={downPaymentPercent}
                      onChange={(e) => setDownPaymentPercent(parseFloat(e.target.value) || 0)}
                      className="w-full pl-8 pr-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Interest Rate (%)
                  </label>
                  <div className="relative">
                    <Percent className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="number"
                      step="0.05"
                      value={interestRate}
                      onChange={(e) => setInterestRate(parseFloat(e.target.value) || 0)}
                      className="w-full pl-8 pr-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Amortization (Years)
                  </label>
                  <input
                    type="number"
                    value={loanTerm}
                    onChange={(e) => setLoanTerm(parseInt(e.target.value, 10) || 30)}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Acquisition / Closing Date
                  </label>
                  <div className="relative">
                    <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="date"
                      value={closingDate}
                      onChange={(e) => setClosingDate(e.target.value)}
                      className="w-full pl-8 pr-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Operations & Pro-Forma Income */}
          {step === 4 && (
            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Gross Monthly Rental Income ($)
                </label>
                <div className="relative">
                  <DollarSign className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="number"
                    step="50"
                    value={monthlyRent}
                    onChange={(e) => setMonthlyRent(parseFloat(e.target.value) || 0)}
                    className="w-full pl-8 pr-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-1 font-mono">
                  ${(monthlyRent * 12).toLocaleString()} / year gross potential rent
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Operating Expense Ratio (%)
                  </label>
                  <input
                    type="number"
                    step="1"
                    value={expenseRatio}
                    onChange={(e) => setExpenseRatio(parseFloat(e.target.value) || 0)}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Annual Appreciation (%)
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    value={appreciationRate}
                    onChange={(e) => setAppreciationRate(parseFloat(e.target.value) || 0)}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Modal Footer Controls */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-800/80 mt-2">
            {step > 1 ? (
              <button
                type="button"
                onClick={handleBack}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold flex items-center space-x-1.5 transition"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            ) : (
              <div />
            )}

            {step < 4 ? (
              <button
                type="button"
                onClick={handleNext}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-black flex items-center space-x-1.5 transition shadow-sm"
              >
                <span>Continue</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-black flex items-center space-x-1.5 transition shadow-sm disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Executing Projections...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Create & Underwrite</span>
                  </>
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
