import React from 'react';
import type { DealMetrics, DealRecord } from '../../lib/math/types';
import { resolveDealDisplayName } from '../../lib/math/pointInTime';
import { formatCurrency } from '../../lib/format';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  deal: DealRecord;
  metrics: DealMetrics;
}

function normalizeAsset(ac: string): 'single-family' | 'multi-unit' | 'commercial' | 'storage' {
  const s = String(ac || 'commercial').toLowerCase();
  if (s.includes('multi')) return 'multi-unit';
  if (s.includes('single') || s.includes('resid')) return 'single-family';
  if (s.includes('storage')) return 'storage';
  return 'commercial';
}

/** "Stochastic Market Volatility & Monte Carlo Primer": static methodology plus this deal's live numbers. */
export const StochasticPrimerModal: React.FC<Props> = ({ isOpen, onClose, deal, metrics }) => {
  if (!isOpen) return null;

  const inputs: Record<string, any> = deal.inputs || {};
  const asset = normalizeAsset(String(deal.asset_class));
  const dealName = resolveDealDisplayName(deal);
  const p1: Record<string, any> = (metrics.projections?.[0] as any) || {};
  const leases: any[] = Array.isArray(inputs.leases) ? inputs.leases : [];

  let tenantInfo: React.ReactNode;
  if (asset === 'commercial') {
    const lType = inputs.leaseType || 'NNN';
    const annRent = inputs.grossRentAnnual || p1.grossPotentialIncome || 0;
    const moRent = annRent > 0 ? annRent / 12 : inputs.monthlyRent || 0;
    const tName = leases.length ? leases[0].tenantName : (deal as any).name || 'Commercial Tenant';
    tenantInfo = (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between text-white font-semibold gap-1">
        <div className="flex items-center space-x-2"><span className="text-brand-400">🏢</span><span>{leases.length > 1 ? `${leases.length} Tenants` : 'Single-Tenant Property'}:</span><span className="text-slate-200">{tName}</span></div>
        <div className="flex items-center space-x-1.5"><span className="text-accent-emerald font-bold">{formatCurrency(moRent)}/mo {lType}</span><span className="text-slate-400 text-[11px]">({formatCurrency(annRent)}/yr)</span></div>
      </div>
    );
  } else if (asset === 'multi-unit') {
    const units = inputs.unitCount || 1;
    const perUnit = inputs.monthlyRentPerUnit || 0;
    const annRent = p1.grossPotentialIncome || units * perUnit * 12;
    tenantInfo = (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between text-white font-semibold gap-1">
        <div className="flex items-center space-x-2"><span className="text-brand-400">🏢</span><span>Multi-Family Roll:</span><span className="text-slate-200">{units} Units</span></div>
        <div className="flex items-center space-x-1.5"><span className="text-accent-emerald font-bold">{formatCurrency(perUnit)}/unit/mo</span><span className="text-slate-400 text-[11px]">({formatCurrency(annRent)}/yr gross)</span></div>
      </div>
    );
  } else if (asset === 'storage') {
    const units = inputs.unitCount || inputs.storageUnitCount || 0;
    const annRent = p1.grossPotentialIncome || inputs.grossRentAnnual || 0;
    tenantInfo = (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between text-white font-semibold gap-1">
        <div className="flex items-center space-x-2"><span className="text-brand-400">📦</span><span>Self-Storage Hub:</span><span className="text-slate-200">{units} Units</span></div>
        <span className="text-accent-emerald font-bold">{formatCurrency(annRent)}/yr gross</span>
      </div>
    );
  } else {
    tenantInfo = (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between text-white font-semibold gap-1">
        <div className="flex items-center space-x-2"><span className="text-brand-400">🏠</span><span>Single-Family Rental</span></div>
        <span className="text-accent-emerald font-bold">{formatCurrency(inputs.monthlyRent || 0)}/mo</span>
      </div>
    );
  }

  const price = Number(metrics.purchasePrice) || Number(inputs.purchasePrice) || 0;
  const initialCash = Number(metrics.initialCashInvested) || 0;
  const downPct = inputs.downPaymentPercent ?? 0;
  const closingCosts = inputs.closingCosts || 0;
  const loanAmt = Number(metrics.loanAmount) || 0;
  const intRate = inputs.interestRate ?? 0;
  const term = inputs.loanTerm ?? 30;
  const holdYrs = inputs.exitYear || 10;
  const noi = p1.netOperatingIncome || 0;
  const ds = p1.debtService || 0;
  const cf = p1.cashFlow !== undefined ? p1.cashFlow : noi - ds;
  const coc = p1.cashOnCash !== undefined ? p1.cashOnCash : initialCash > 0 ? (cf / initialCash) * 100 : 0;
  const irr = Number(metrics.irr) || 0;
  const oer = inputs.expenseRatio ?? inputs.operatingExpenseRatio ?? (p1.effectiveGrossIncome > 0 ? (p1.operatingExpenses / p1.effectiveGrossIncome) * 100 : 0);

  return (
    <div role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden my-auto max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-950/60 sticky top-0 z-10">
          <div className="flex items-center space-x-2.5">
            <span className="text-xl">📖</span>
            <div>
              <h3 className="text-base font-extrabold text-white tracking-tight">Stochastic Market Volatility &amp; Monte Carlo Primer</h3>
              <p className="text-xs text-slate-400">Quantitative risk underwriting theory, mathematical mechanics, and distribution interpretation</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close modal" className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition text-sm font-bold">✕</button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6 text-xs text-slate-300 leading-relaxed">
{/* Section 1: Deterministic vs. Stochastic */}
        <div className="space-y-2">
          <div className="flex items-center space-x-2 text-brand-400 font-bold uppercase tracking-wider text-[11px]">
            <span>1. Deterministic vs. Stochastic Underwriting</span>
          </div>
          <p>
            Standard real estate pro-formas are <strong className="text-white">deterministic</strong>: they assume static, straight-line parameters—such as exactly 3.0% rent growth every year, exactly 5.0% vacancy every month, and an exact exit cap rate at Year 5. In reality, commercial real estate markets undergo economic cycles, inflation fluctuations, localized supply gluts, and credit volatility.
          </p>
          <p>
            A <strong className="text-accent-violet">Stochastic Market Volatility Model</strong> executes 1,000 independent simulated market trajectories. Each iteration applies continuous Gaussian shocks (normal distribution sampling via the Box-Muller transform) to operational and terminal parameters, revealing the entire probability distribution of possible investment returns.
          </p>
        </div>

        {/* Section 2: The 3 Gaussian Shock Engines */}
        <div className="space-y-2">
          <div className="flex items-center space-x-2 text-brand-400 font-bold uppercase tracking-wider text-[11px]">
            <span>2. The 3 Random Shock Drivers</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
            <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800/80 space-y-1.5">
              <div className="flex items-center space-x-1.5 text-accent-violet font-bold">
                <span>📈</span>
                <span>Rent Growth Drift</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Samples &sigma; &asymp; 1.5% around baseline. Simulates localized tenant lease renewal friction, inflation dynamics, and wage growth variation.
              </p>
            </div>
            <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800/80 space-y-1.5">
              <div className="flex items-center space-x-1.5 text-accent-rose font-bold">
                <span>📉</span>
                <span>Vacancy Shocks</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Samples &sigma; &asymp; 2.5% around baseline (clamped at economic floor). Simulates unexpected tenant non-renewals, eviction delays, and concession surges.
              </p>
            </div>
            <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800/80 space-y-1.5">
              <div className="flex items-center space-x-1.5 text-amber-400 font-bold">
                <span>🏛️</span>
                <span>Exit Cap Rate Spread</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Samples &plusmn;100 bps spread at disposition. Captures macro liquidity tightening, interest rate cycle shifts, and capital market compression/expansion.
              </p>
            </div>
          </div>
        </div>

        {/* Section 3: Interpreting Key Risk Metrics */}
        <div className="space-y-2">
          <div className="flex items-center space-x-2 text-brand-400 font-bold uppercase tracking-wider text-[11px]">
            <span>3. How to Read Distribution Metrics</span>
          </div>
          <div className="bg-slate-950/50 rounded-xl border border-slate-800 divide-y divide-slate-900 text-xs">
            <div className="p-3 flex items-start space-x-3">
              <span className="font-mono text-accent-rose font-bold min-w-[70px]">P5 (VaR):</span>
              <div>
                <strong className="text-white">Value at Risk (5th Percentile Floor):</strong> In 95% of simulated economic environments (950 out of 1,000 runs), your actual IRR will equal or exceed this number. This is your downside safety net.
              </div>
            </div>
            <div className="p-3 flex items-start space-x-3">
              <span className="font-mono text-accent-violet font-bold min-w-[70px]">Median:</span>
              <div>
                <strong className="text-white">P50 Most Likely Outcome:</strong> The 50th percentile midpoint where half of scenarios are higher and half are lower. Unaffected by extreme outlier windfalls or catastrophic tails.
              </div>
            </div>
            <div className="p-3 flex items-start space-x-3">
              <span className="font-mono text-accent-emerald font-bold min-w-[70px]">P95:</span>
              <div>
                <strong className="text-white">Upside Bull Case (95th Percentile):</strong> Top 5% performance when rent growth accelerates and exit yields compress favorably.
              </div>
            </div>
            <div className="p-3 flex items-start space-x-3">
              <span className="font-mono text-amber-400 font-bold min-w-[70px]">Prob Neg:</span>
              <div>
                <strong className="text-white">Probability of Operating Deficit:</strong> Percentage of simulated years where Net Operating Income (NOI) drops below Annual Debt Service, necessitating an out-of-pocket cash injection (capital call).
              </div>
            </div>
          </div>
        </div>

        {/* Section 4: Asset-Class Specific Stochastic Models & Degrees of Delta */}
        <div className="space-y-2">
          <div className="flex items-center space-x-2 text-brand-400 font-bold uppercase tracking-wider text-[11px]">
            <span>4. Asset-Class Specific Stochastic Models & Degrees of Delta</span>
          </div>
          <p>
            Real estate risk is structurally non-uniform across property types. To reflect operational realities rather than theoretical approximations, our engine deploys dedicated stochastic architectures tailored to the asset class under review, each applying distinct degrees of delta:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800/80 space-y-1.5">
              <span className="font-bold text-white text-xs flex items-center gap-1.5">
                <span className="text-accent-violet">🏡</span> Single-Family Rental (SFR)
              </span>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                <strong className="text-slate-200">Discrete 1-Door Turnover Model:</strong> A single-family rental cannot experience a continuous 5% fractional vacancy. Vacancy is modeled as a discrete tenant turnover event (~78% renewal vs. ~22% turnover probability). In turnover iterations, the engine samples integer month vacancies (1 month = 8.33% annual loss; 2 months = 16.67%; extended eviction/make-ready = 25%–50%). This accurately exposes mortgage debt service shortfalls and surfaces genuine Year 1 cash deficit vulnerabilities. Terminal proceeds follow home appreciation volatility (&sigma; &asymp; 1.5%).
              </p>
            </div>
            <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800/80 space-y-1.5">
              <span className="font-bold text-white text-xs flex items-center gap-1.5">
                <span className="text-accent-emerald">🏢</span> Multifamily (Multi-Unit)
              </span>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                <strong className="text-slate-200">Door-Aggregated Absorption Model:</strong> Multi-door properties benefit from tenant diversification and the law of large numbers. Staggered lease cycles dampen portfolio-wide volatility inversely to unit count (&sigma; / &radic;N). Vacancy fluctuates continuously around underwritten absorption targets, providing natural cash flow buffering against total revenue disruption.
              </p>
            </div>
            <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800/80 space-y-1.5">
              <span className="font-bold text-white text-xs flex items-center gap-1.5">
                <span className="text-amber-400">🏭</span> Commercial (Office, Retail, Industrial)
              </span>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                <strong className="text-slate-200">Lease-Roll Cliff & Cap Rate Spread:</strong> Multi-year leases (3–10 years) provide multi-year operating stability, but concentrate vulnerability into binary lease expiration years. The simulation models non-renewal downtime (6–12 months) and capital market liquidity swings via exit capitalization rate spreads (&plusmn;100 bps), capturing market disposition volatility.
              </p>
            </div>
            <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800/80 space-y-1.5">
              <span className="font-bold text-white text-xs flex items-center gap-1.5">
                <span className="text-accent-rose">📦</span> Self-Storage
              </span>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                <strong className="text-slate-200">High-Velocity Elasticity Model:</strong> Characterized by hundreds of short-term month-to-month contracts. Vacancy is subject to rapid tenant churn velocity, seasonal demand shifts (spring/summer move-in surges vs. winter slowdowns), and rent hike price elasticity, modeled with elevated operational delta.
              </p>
            </div>
          </div>
        </div>

        
          {/* Section 5: Dynamic Deal Attribution & High-Yield Leverage Breakdown */}
          <div className="space-y-2">
            <div className="flex items-center space-x-2 text-brand-400 font-bold uppercase tracking-wider text-[11px]">
              <span>5. Active Underwriting Deal Attribution &amp; Leverage Mechanics</span>
            </div>
            <div className="space-y-3 bg-slate-950/90 p-4 rounded-xl border border-slate-800">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-2.5 gap-2">
                <div className="flex items-center space-x-2">
                  <span className="text-base">📌</span>
                  <div>
                    <h4 className="font-extrabold text-white text-xs">{dealName}</h4>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">{asset.replace('-', ' ')} &bull; {inputs.propertyClass || 'Class B'} &bull; {inputs.marketTier || 'Tier 2'}</p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-brand-500/20 text-brand-400 border border-brand-500/30">Deterministic Baseline: {irr.toFixed(2)}% IRR</span>
              </div>

              <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80 text-xs">{tenantInfo}</div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-800/60">
                  <span className="text-slate-500 block text-[9px] uppercase font-bold">Acquisition Price</span>
                  <span className="text-white font-bold text-xs">{formatCurrency(price)}</span>
                </div>
                <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-800/60">
                  <span className="text-slate-500 block text-[9px] uppercase font-bold">Initial Cash Out-of-Pocket</span>
                  <span className="text-white font-bold text-xs">{formatCurrency(initialCash)}</span>
                  <span className="text-[9px] text-slate-400 block">{downPct}% down {closingCosts > 0 ? `+ ${formatCurrency(closingCosts)} costs` : ''}</span>
                </div>
                <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-800/60">
                  <span className="text-slate-500 block text-[9px] uppercase font-bold">Financing &amp; Debt</span>
                  <span className="text-white font-bold text-xs">{formatCurrency(loanAmt)}</span>
                  <span className="text-[9px] text-slate-400 block">{intRate}% &bull; {term}-Yr Term</span>
                </div>
                <div className="bg-slate-900/40 p-2 rounded-lg border border-slate-800/60">
                  <span className="text-slate-500 block text-[9px] uppercase font-bold">Year 1 Performance</span>
                  <span className="text-emerald-400 font-bold text-xs">{coc.toFixed(2)}% CoC</span>
                  <span className="text-[9px] text-slate-400 block">{formatCurrency(cf)}/yr net cash</span>
                </div>
              </div>

              <div className="text-xs text-slate-300 space-y-2 pt-1 leading-relaxed">
                <p>
                  <strong className="text-white">Why is this deal&apos;s IRR projected at {irr.toFixed(2)}%?</strong>{' '}
                  This return is driven by high structural leverage. On a <strong className="text-white">{formatCurrency(price)}</strong> acquisition with only <strong className="text-white">{formatCurrency(initialCash)}</strong> out-of-pocket initial cash invested ({downPct}% down payment), the property generates <strong className="text-white">{formatCurrency(noi)}/year in NOI</strong> (at an underwritten {Number(oer).toFixed(1)}% OpEx ratio). After paying annual debt service of <strong className="text-white">{formatCurrency(ds)}/year</strong>, the net operating cash flow of <strong className="text-emerald-400">{formatCurrency(cf)}/year</strong> yields a <strong className="text-emerald-400 font-bold">{coc.toFixed(2)}% Year 1 cash-on-cash return</strong> on cash flow alone.
                </p>
                <p>
                  Over the <strong className="text-white">{holdYrs}-year hold</strong>, continuous tenant-funded debt paydown and terminal valuation compound this high cash-on-cash yield to an annualized <strong className="text-brand-400 font-bold">{irr.toFixed(2)}% IRR</strong>.
                </p>
                <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 text-[11px] text-slate-400">
                  <strong className="text-accent-violet">What Monte Carlo reveals about this specific return:</strong>{' '}
                  Because debt service ({formatCurrency(ds)}/yr) is fixed while equity ({formatCurrency(initialCash)}) is lean, adverse operational shocks (e.g. temporary vacancy or tenant turnover) reduce equity cash flow rapidly. The Monte Carlo simulation tests 1,000 randomized micro-economic paths against these exact parameters to verify whether the downside floor (P5 Value-at-Risk) remains economically viable without requiring capital calls.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-slate-800 flex justify-end bg-slate-950/60 sticky bottom-0">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 font-bold text-white text-xs transition">Got It, Return to Model</button>
        </div>
      </div>
    </div>
  );
};
