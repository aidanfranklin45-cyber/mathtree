import React, { useState, useMemo } from 'react';
import type { DealRecord, DealInputs } from '../../../lib/math/types';
import { resolveDealDisplayName } from '../../../lib/math/pointInTime';
import { formatCurrency } from '../../../lib/format';
import { dealPrice } from '../../../lib/compare/filters';
import { extractComparisonSummary, ComparisonColumn } from '../../../lib/compare/compareTypes';
import { buildColumn } from '../../../lib/compare/buildColumns';
import { buildAssumptionAuditTrail } from '../../../lib/compare/assumptionAudit';
import {
  FlaskConical,
  SlidersHorizontal,
  RotateCcw,
  ShieldCheck,
  TrendingUp,
  ArrowRight,
  Building2,
  CheckCircle2,
  FileCheck,
  FileText,
  AlertTriangle,
  Flame,
  CloudRain,
  Sparkles,
} from 'lucide-react';

interface ScenarioLabProps {
  deals: DealRecord[];
  activeDeal: DealRecord | null;
  selectedDealId: string | null;
  onSelectDeal: (dealId: string) => void;
  onPromoteScenariosToBoard: (columns: ComparisonColumn[]) => void;
  onOpenCustomCompareBoard: () => void;
}

type PresetScenarioKey = 'baseline' | 'conservative_debt' | 'bear_market' | 'upside_growth';

export const ScenarioLab: React.FC<ScenarioLabProps> = ({
  deals,
  activeDeal,
  selectedDealId,
  onSelectDeal,
  onPromoteScenariosToBoard,
  onOpenCustomCompareBoard,
}) => {
  // Real-time interactive lever overrides
  const [priceDeltaPct, setPriceDeltaPct] = useState<number>(0);
  const [downPaymentOverride, setDownPaymentOverride] = useState<number | null>(null);
  const [interestRateDeltaBps, setInterestRateDeltaBps] = useState<number>(0);
  const [rentDeltaPct, setRentDeltaPct] = useState<number>(0);
  const [vacancyOverride, setVacancyOverride] = useState<number | null>(null);
  const [opexInflationPct, setOpexInflationPct] = useState<number>(0);

  // Active highlighted scenario
  const [selectedPreset, setSelectedPreset] = useState<PresetScenarioKey>('baseline');
  const [showAuditTrail, setShowAuditTrail] = useState(false);

  // Baseline deal values
  const basePrice = Number(activeDeal?.inputs?.purchasePrice || activeDeal?.purchase_price || 0);
  const baseDownPct = Number(activeDeal?.inputs?.downPaymentPercent ?? 25);
  const baseRate = Number(activeDeal?.inputs?.interestRate ?? 7.0);
  const baseRentAnnual = Number(activeDeal?.inputs?.grossRentAnnual || (activeDeal?.inputs?.monthlyRent ? activeDeal.inputs.monthlyRent * 12 : 0));
  const baseVacancy = Number(activeDeal?.inputs?.vacancyRate ?? 5.0);

  // Calculate current lever overrides
  const currentOverrides = useMemo<Partial<DealInputs>>(() => {
    if (!activeDeal) return {};
    const effectivePrice = Math.round(basePrice * (1 + priceDeltaPct / 100));
    const effectiveDownPct = downPaymentOverride !== null ? downPaymentOverride : baseDownPct;
    const effectiveRate = +(baseRate + interestRateDeltaBps / 100).toFixed(2);
    const effectiveRentAnnual = Math.round(baseRentAnnual * (1 + rentDeltaPct / 100));
    const effectiveVacancy = vacancyOverride !== null ? vacancyOverride : baseVacancy;

    const res: Partial<DealInputs> = {
      purchasePrice: effectivePrice,
      downPaymentPercent: effectiveDownPct,
      interestRate: effectiveRate,
      grossRentAnnual: effectiveRentAnnual,
      monthlyRent: Math.round(effectiveRentAnnual / 12),
      vacancyRate: effectiveVacancy,
    };

    if (opexInflationPct > 0) {
      const baseOpexRatio = Number(activeDeal.inputs?.expenseRatio ?? 35);
      res.expenseRatio = Math.min(90, +(baseOpexRatio * (1 + opexInflationPct / 100)).toFixed(1));
    }

    return res;
  }, [
    activeDeal,
    basePrice,
    baseDownPct,
    baseRate,
    baseRentAnnual,
    baseVacancy,
    priceDeltaPct,
    downPaymentOverride,
    interestRateDeltaBps,
    rentDeltaPct,
    vacancyOverride,
    opexInflationPct,
  ]);

  const hasModifications =
    priceDeltaPct !== 0 ||
    downPaymentOverride !== null ||
    interestRateDeltaBps !== 0 ||
    rentDeltaPct !== 0 ||
    vacancyOverride !== null ||
    opexInflationPct !== 0;

  const resetLevers = () => {
    setPriceDeltaPct(0);
    setDownPaymentOverride(null);
    setInterestRateDeltaBps(0);
    setRentDeltaPct(0);
    setVacancyOverride(null);
    setOpexInflationPct(0);
    setSelectedPreset('baseline');
  };

  // Compute the 4 canonical scenarios for the instant radiograph
  const scenarios = useMemo(() => {
    if (!activeDeal) return [];

    // 1. Live Contract Baseline
    const liveCol = buildColumn(activeDeal, 'live', 'Live Contract Model', undefined, true, 'lab:live');

    // 2. Conservative Debt (+5% Down, +50 bps Rate)
    const conservativeOverrides: Partial<DealInputs> = {
      downPaymentPercent: Math.min(100, baseDownPct + 5),
      interestRate: +(baseRate + 0.5).toFixed(2),
    };
    const conservativeCol = buildColumn(
      activeDeal,
      'custom',
      `Conservative Debt (${baseDownPct + 5}% Down)`,
      conservativeOverrides,
      false,
      'lab:conservative'
    );

    // 3. Bear Market Stress (-8% Rent, +3% Vacancy, +10% Opex)
    const bearRent = Math.round(baseRentAnnual * 0.92);
    const baseOpexRatio = Number(activeDeal.inputs?.expenseRatio ?? 35);
    const bearOverrides: Partial<DealInputs> = {
      grossRentAnnual: bearRent,
      monthlyRent: Math.round(bearRent / 12),
      vacancyRate: Math.min(30, +(baseVacancy + 3).toFixed(1)),
      expenseRatio: Math.min(90, +(baseOpexRatio * 1.1).toFixed(1)),
    };
    const bearCol = buildColumn(activeDeal, 'bear', 'Bear Market Shock (-8% Rent)', bearOverrides, false, 'lab:bear');

    // 4. Upside Growth (+5% Rent, Trimmed Vacancy)
    const upsideRent = Math.round(baseRentAnnual * 1.05);
    const upsideOverrides: Partial<DealInputs> = {
      grossRentAnnual: upsideRent,
      monthlyRent: Math.round(upsideRent / 12),
      vacancyRate: Math.max(1, +(baseVacancy - 1.5).toFixed(1)),
    };
    const upsideCol = buildColumn(activeDeal, 'bull', 'Optimized Upside (+5% Rent)', upsideOverrides, false, 'lab:upside');

    return [
      {
        key: 'baseline' as PresetScenarioKey,
        label: 'Live Baseline',
        tag: 'Current Fact',
        desc: 'Today\'s stated contract terms and market assumptions.',
        icon: Sparkles,
        column: liveCol,
      },
      {
        key: 'conservative_debt' as PresetScenarioKey,
        label: 'Strict Lender Debt',
        tag: '+5% Down · +50 bps',
        desc: 'Higher equity check to safeguard DSCR and lower default risk.',
        icon: ShieldCheck,
        column: conservativeCol,
      },
      {
        key: 'bear_market' as PresetScenarioKey,
        label: 'Bear Market Stress',
        tag: '-8% Rent · +3% Vac',
        desc: 'Downturn cushion test: higher vacancies and compressed rent.',
        icon: CloudRain,
        column: bearCol,
      },
      {
        key: 'upside_growth' as PresetScenarioKey,
        label: 'Operational Upside',
        tag: '+5% Rent Growth',
        desc: 'Proactive management upside and rent roll expansion.',
        icon: Flame,
        column: upsideCol,
      },
    ];
  }, [activeDeal, baseDownPct, baseRate, baseRentAnnual, baseVacancy]);

  // Active live simulation column (merging active preset + current custom levers)
  const activeSimulation = useMemo(() => {
    if (!activeDeal) return null;
    if (!hasModifications) {
      const match = scenarios.find((s) => s.key === selectedPreset);
      return match ? match.column : scenarios[0]?.column || null;
    }
    return buildColumn(activeDeal, 'custom', 'Interactive Lever Simulation', currentOverrides, false, 'lab:custom');
  }, [activeDeal, hasModifications, selectedPreset, scenarios, currentOverrides]);

  const auditTrail = useMemo(() => {
    if (!activeDeal) return [];
    return buildAssumptionAuditTrail(activeDeal, currentOverrides);
  }, [activeDeal, currentOverrides]);

  // STAGE 1: Ask which property they want to look at
  if (!selectedDealId) {
    return (
      <div className="rounded-3xl border border-slate-800 bg-slate-900/95 shadow-2xl p-6 sm:p-8 space-y-6 max-w-4xl mx-auto">
        <div className="space-y-1.5 text-center sm:text-left">
          <span className="text-[10px] uppercase font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-800/60 px-3 py-1 rounded-full">
            Scenario Lab · Step 1
          </span>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
            Which property do you want to explore?
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Select a property to illuminate how financing, rent changes, and market shocks impact performance:
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 pt-2">
          {deals.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onSelectDeal(d.id)}
              className="p-5 rounded-2xl border border-slate-800 bg-slate-950/60 hover:border-emerald-500/60 hover:bg-slate-950 transition text-left flex flex-col justify-between space-y-3 group cursor-pointer"
            >
              <div className="space-y-1">
                <span className="text-[10px] font-mono uppercase text-slate-400 block">
                  {d.status || 'Active Project'} · {d.asset_class || d.assetType || 'Commercial'}
                </span>
                <h4 className="text-sm font-black text-white group-hover:text-emerald-300 transition truncate">
                  {resolveDealDisplayName(d)}
                </h4>
                <p className="text-xs font-mono font-bold text-slate-300">
                  Basis: {formatCurrency(dealPrice(d))}
                </p>
              </div>

              <div className="flex items-center space-x-1 text-xs font-bold text-emerald-400 group-hover:translate-x-1 transition-transform pt-1">
                <span>Enter Scenario Lab</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!activeDeal || !activeSimulation) return null;

  const sum = activeSimulation.summary;
  const dscrVal = sum.dscr;
  const isBankable = dscrVal !== null && dscrVal >= 1.25;
  const isTight = dscrVal !== null && dscrVal >= 1.0 && dscrVal < 1.25;

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/95 shadow-2xl p-5 sm:p-7 space-y-7">
      {/* 1. Header: Property Info + Change Property Button */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-5 border-b border-slate-800">
        <div className="flex items-center space-x-3.5 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <FlaskConical className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">
                Scenario Lab Active
              </span>
              <span className="text-[10px] font-mono px-2 py-0.2 rounded bg-slate-800 text-slate-400">
                {activeDeal.asset_class || activeDeal.assetType || 'Commercial'}
              </span>
            </div>
            <h3 className="text-base sm:text-lg font-black text-white truncate max-w-[320px] sm:max-w-[480px]">
              {resolveDealDisplayName(activeDeal)}
            </h3>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => onSelectDeal('')}
            className="text-xs font-bold text-slate-400 hover:text-white px-3 py-1.5 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-950 transition cursor-pointer"
          >
            Change Property
          </button>
          <button
            type="button"
            onClick={() => onPromoteScenariosToBoard(scenarios.map((s) => s.column))}
            className="text-xs font-black text-white bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 px-3.5 py-1.5 rounded-xl shadow-md transition flex items-center space-x-1.5 cursor-pointer"
          >
            <span>Load All Scenarios in Table</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. Instant 4-Scenario Radiograph (Zero Guesswork) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-black uppercase tracking-wider text-slate-300">
            1. Comprehensive Performance Radiograph
          </span>
          <span className="text-[11px] text-slate-400">
            Click any scenario to inspect its exact metrics:
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {scenarios.map((sc) => {
            const isSelected = selectedPreset === sc.key && !hasModifications;
            const Icon = sc.icon;
            const sSum = sc.column.summary;
            const sDscr = sSum.dscr;

            return (
              <button
                key={sc.key}
                type="button"
                onClick={() => {
                  resetLevers();
                  setSelectedPreset(sc.key);
                }}
                className={`p-4 rounded-2xl border text-left transition flex flex-col justify-between space-y-3 cursor-pointer ${
                  isSelected
                    ? 'bg-emerald-950/40 border-emerald-500 ring-2 ring-emerald-500/30 text-white shadow-lg'
                    : 'bg-slate-950/60 border-slate-800/80 text-slate-300 hover:border-slate-700 hover:bg-slate-950'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase font-bold text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
                      {sc.tag}
                    </span>
                    <Icon className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="text-xs font-black text-white">{sc.label}</div>
                  <p className="text-[11px] text-slate-400 leading-snug">{sc.desc}</p>
                </div>

                {/* Micro stat summary */}
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono">
                  <div>
                    <span className="text-slate-500 block text-[9px] uppercase font-sans">DSCR</span>
                    <span className={`font-bold ${sDscr && sDscr >= 1.25 ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {sDscr ? `${sDscr.toFixed(2)}x` : 'N/A'}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-500 block text-[9px] uppercase font-sans">CoC / IRR</span>
                    <span className="font-bold text-white">
                      {sSum.cashOnCashYear1.toFixed(1)}% / {sSum.irr.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Dual-Perspective Impact HUD (Lender Standard vs. Investor Standard) */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-5 space-y-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-black text-white uppercase tracking-wider">
              2. Dual-Perspective Performance HUD
            </span>
            {hasModifications && (
              <span className="text-[10px] font-bold text-cyan-300 bg-cyan-950/80 border border-cyan-800 px-2 py-0.5 rounded-full">
                Interactive Levers Active
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-400">
            Simulating: <strong className="text-white">{activeSimulation.scenarioName}</strong>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* LENDER / UNDERWRITING LENS */}
          <div className="rounded-xl border border-slate-800/90 bg-slate-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-black text-emerald-300 uppercase tracking-wider">
                  Lender & Underwriting Standard
                </span>
              </div>
              <span
                className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
                  isBankable
                    ? 'bg-emerald-950 border-emerald-800 text-emerald-300'
                    : isTight
                      ? 'bg-amber-950 border-amber-800 text-amber-300'
                      : 'bg-rose-950 border-rose-800 text-rose-300'
                }`}
              >
                {isBankable ? 'Bankable' : isTight ? 'Tight Cushion' : 'Covenant Deficit'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs font-mono pt-1">
              <div>
                <span className="text-[10px] text-slate-400 font-sans block uppercase">DSCR Coverage</span>
                <span className="text-base font-black text-white">
                  {dscrVal !== null ? `${dscrVal.toFixed(2)}x` : 'N/A'}
                </span>
                <span className="text-[10px] text-slate-500 font-sans block mt-0.5">Lender Covenant: 1.25x</span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 font-sans block uppercase">Annual Debt Service</span>
                <span className="text-base font-black text-white">{formatCurrency(sum.annualDebt)}</span>
                <span className="text-[10px] text-slate-500 font-sans block mt-0.5">
                  Loan: {formatCurrency(sum.loanAmount)}
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 font-sans block uppercase">Stabilized NOI</span>
                <span className="text-sm font-bold text-slate-200">{formatCurrency(sum.noi)}</span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 font-sans block uppercase">Operating Expense Ratio</span>
                <span className="text-sm font-bold text-slate-200">{sum.expenseRatio.toFixed(1)}%</span>
              </div>
            </div>
          </div>

          {/* INVESTOR / EQUITY LENS */}
          <div className="rounded-xl border border-slate-800/90 bg-slate-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <TrendingUp className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-black text-cyan-300 uppercase tracking-wider">
                  Investor & Equity Standard
                </span>
              </div>
              <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950 border border-cyan-800 px-2 py-0.5 rounded font-bold">
                Target Hurdle: 15.0% IRR
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs font-mono pt-1">
              <div>
                <span className="text-[10px] text-slate-400 font-sans block uppercase">Year-1 Cash-on-Cash</span>
                <span className="text-base font-black text-white">{sum.cashOnCashYear1.toFixed(1)}%</span>
                <span className="text-[10px] text-slate-500 font-sans block mt-0.5">
                  Net Cash: {formatCurrency(sum.cashFlowYear1)}/yr
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 font-sans block uppercase">Projected 10-Yr IRR</span>
                <span className="text-base font-black text-white">{sum.irr.toFixed(1)}%</span>
                <span className="text-[10px] text-slate-500 font-sans block mt-0.5">
                  Equity Multiple: {sum.equityMultiple.toFixed(2)}x
                </span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 font-sans block uppercase">Initial Cash Invested</span>
                <span className="text-sm font-bold text-slate-200">{formatCurrency(sum.initialCash)}</span>
              </div>

              <div>
                <span className="text-[10px] text-slate-400 font-sans block uppercase">Net Present Value (NPV)</span>
                <span className={`text-sm font-bold ${sum.npv >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {formatCurrency(sum.npv)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Interactive Driver Levers (Scrubbing What-Ifs in Real Time) */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <SlidersHorizontal className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-black text-white uppercase tracking-wider">
              3. Interactive Driver Levers (What Happens If...)
            </span>
          </div>

          {hasModifications && (
            <button
              type="button"
              onClick={resetLevers}
              className="text-xs font-bold text-slate-400 hover:text-white flex items-center space-x-1 transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Levers</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-1 text-xs">
          {/* Lever 1: Purchase Price Delta */}
          <div className="space-y-1.5 bg-slate-900/60 border border-slate-850 p-3 rounded-xl">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-bold uppercase text-slate-400">Purchase Price</label>
              <span className="font-mono font-bold text-white">
                {formatCurrency(Math.round(basePrice * (1 + priceDeltaPct / 100)))} ({priceDeltaPct >= 0 ? '+' : ''}
                {priceDeltaPct}%)
              </span>
            </div>
            <input
              type="range"
              min={-20}
              max={20}
              step={1}
              value={priceDeltaPct}
              onChange={(e) => setPriceDeltaPct(parseFloat(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <div className="flex justify-between text-[9px] text-slate-500 font-mono">
              <span>-20%</span>
              <span>Baseline</span>
              <span>+20%</span>
            </div>
          </div>

          {/* Lever 2: Down Payment % */}
          <div className="space-y-1.5 bg-slate-900/60 border border-slate-850 p-3 rounded-xl">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-bold uppercase text-slate-400">Equity Down Payment</label>
              <span className="font-mono font-bold text-white">
                {downPaymentOverride !== null ? downPaymentOverride : baseDownPct}%
              </span>
            </div>
            <input
              type="range"
              min={10}
              max={60}
              step={2.5}
              value={downPaymentOverride !== null ? downPaymentOverride : baseDownPct}
              onChange={(e) => setDownPaymentOverride(parseFloat(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <div className="flex justify-between text-[9px] text-slate-500 font-mono">
              <span>10% Down</span>
              <span>Baseline ({baseDownPct}%)</span>
              <span>60% Down</span>
            </div>
          </div>

          {/* Lever 3: Interest Rate Shock */}
          <div className="space-y-1.5 bg-slate-900/60 border border-slate-850 p-3 rounded-xl">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-bold uppercase text-slate-400">Mortgage Interest Rate</label>
              <span className="font-mono font-bold text-white">
                {(baseRate + interestRateDeltaBps / 100).toFixed(2)}% ({interestRateDeltaBps >= 0 ? '+' : ''}
                {interestRateDeltaBps} bps)
              </span>
            </div>
            <input
              type="range"
              min={-150}
              max={250}
              step={25}
              value={interestRateDeltaBps}
              onChange={(e) => setInterestRateDeltaBps(parseInt(e.target.value, 10))}
              className="w-full accent-cyan-500 cursor-pointer"
            />
            <div className="flex justify-between text-[9px] text-slate-500 font-mono">
              <span>-150 bps</span>
              <span>Baseline ({baseRate}%)</span>
              <span>+250 bps</span>
            </div>
          </div>

          {/* Lever 4: Rent Growth / Shock */}
          <div className="space-y-1.5 bg-slate-900/60 border border-slate-850 p-3 rounded-xl">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-bold uppercase text-slate-400">Gross Rent Revenue</label>
              <span className="font-mono font-bold text-white">
                {formatCurrency(Math.round(baseRentAnnual * (1 + rentDeltaPct / 100)))} ({rentDeltaPct >= 0 ? '+' : ''}
                {rentDeltaPct}%)
              </span>
            </div>
            <input
              type="range"
              min={-15}
              max={20}
              step={1}
              value={rentDeltaPct}
              onChange={(e) => setRentDeltaPct(parseFloat(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <div className="flex justify-between text-[9px] text-slate-500 font-mono">
              <span>-15% Shock</span>
              <span>Baseline</span>
              <span>+20% Expansion</span>
            </div>
          </div>

          {/* Lever 5: Vacancy Rate */}
          <div className="space-y-1.5 bg-slate-900/60 border border-slate-850 p-3 rounded-xl">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-bold uppercase text-slate-400">Physical Vacancy</label>
              <span className="font-mono font-bold text-white">
                {vacancyOverride !== null ? vacancyOverride : baseVacancy}%
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={25}
              step={0.5}
              value={vacancyOverride !== null ? vacancyOverride : baseVacancy}
              onChange={(e) => setVacancyOverride(parseFloat(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />
            <div className="flex justify-between text-[9px] text-slate-500 font-mono">
              <span>1% Full Occ</span>
              <span>Baseline ({baseVacancy}%)</span>
              <span>25% Vacancy</span>
            </div>
          </div>

          {/* Lever 6: Operating Expense Inflation */}
          <div className="space-y-1.5 bg-slate-900/60 border border-slate-850 p-3 rounded-xl">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-bold uppercase text-slate-400">Opex Inflation Shock</label>
              <span className="font-mono font-bold text-white">+{opexInflationPct}% Opex</span>
            </div>
            <input
              type="range"
              min={0}
              max={30}
              step={2.5}
              value={opexInflationPct}
              onChange={(e) => setOpexInflationPct(parseFloat(e.target.value))}
              className="w-full accent-rose-500 cursor-pointer"
            />
            <div className="flex justify-between text-[9px] text-slate-500 font-mono">
              <span>Stated Costs</span>
              <span>+15% Inflation</span>
              <span>+30% Inflation</span>
            </div>
          </div>
        </div>
      </div>

      {/* 5. Defensible Ground-Truth Audit Trail (Expandable on Demand) */}
      {auditTrail.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAuditTrail(!showAuditTrail)}
            className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-900/60 transition cursor-pointer select-none"
          >
            <div className="flex items-center space-x-3">
              <div className="w-7 h-7 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400 flex items-center justify-center shrink-0">
                <FileCheck className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-black text-white">
                    Lender Underwriting Justification & Audit Trail
                  </span>
                  <span className="text-[9px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
                    Defensible Math
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 block mt-0.5">
                  Verify stated ground truths, loan constants, and covenant math behind this scenario.
                </span>
              </div>
            </div>
            <span className="text-xs font-bold text-violet-300 shrink-0 ml-2">
              {showAuditTrail ? 'Hide Audit ▴' : 'Inspect Audit ▾'}
            </span>
          </button>

          {showAuditTrail && (
            <div className="p-5 border-t border-slate-800 space-y-3 animate-in fade-in duration-150">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {auditTrail.map((item, idx) => (
                  <div key={idx} className="rounded-xl border border-slate-800/80 bg-slate-900/70 p-3.5 text-xs space-y-2">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-bold text-slate-200">{item.label}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border bg-slate-950 border-slate-700 text-slate-300">
                        {item.sourceBadge}
                      </span>
                    </div>

                    <div className="flex items-baseline space-x-2 font-mono">
                      <span className="text-sm font-bold text-white">{item.currentValue}</span>
                      {item.baselineValue && (
                        <span className="text-[10px] text-slate-500 line-through">
                          Baseline: {item.baselineValue}
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-400 leading-relaxed font-sans">{item.rationale}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
