import React, { useEffect, useState } from 'react';
import type { BriefModel } from '../../lib/export/buildBriefModel';
import { createMonteCarloRunner, seedFromText, type MonteCarloResult, type MonteCarloHistogramBin } from '../../lib/engine';

export const NP = 'Not provided';
export const cur = (n: number): string => (n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
export const pct = (n: number, d = 2): string => `${n.toFixed(d)}%`;
const pctShort = (n: number): string => (Math.abs(n - Math.round(n)) < 0.005 ? n.toFixed(0) : n.toFixed(1));
const compact = (v: number): string => {
  const a = Math.abs(v);
  const t = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(2)}M` : a >= 1000 ? `${Math.round(a / 1000)}k` : `${Math.round(a)}`;
  return `${v < 0 ? '-' : ''}$${t}`;
};
const orNP = (v: string | null | undefined): string => (v && v.trim() ? v : NP);

/**
 * Print sizes are tuned for readability: body 12px, tables 11.5px, headline figures 17-22px (roughly 9pt and up on paper).
 * Each major section starts a new landscape page (`.pg`); fine print (methodology and disclosures) closes the document.
 */
export const BRIEF_CSS = `
@page { size: letter landscape; margin: 8mm 10mm; }
.brief { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; font-size: 12px; color: #0f172a; background: #ffffff; padding: 16px 22px; max-width: 1180px; margin: 0 auto; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.brief * { box-sizing: border-box; }
.brief ::selection { background: #bae6fd; color: #0f172a; }
.brief .pg { break-before: page; page-break-before: always; }
.brief .hdr { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #059669; padding-bottom: 8px; margin-bottom: 12px; gap: 16px; }
.brief .logo { font-size: 24px; font-weight: 900; color: #059669; letter-spacing: -0.5px; }
.brief h1 { font-size: 20px; font-weight: 800; margin: 4px 0 0 0; }
.brief .pill { display: inline-block; font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; }
.brief .pill-green { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
.brief .pill-blue { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
.brief .pill-slate { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; }
.brief .row { display: flex; align-items: center; gap: 8px; }
.brief .hmeta { font-size: 12px; color: #475569; font-weight: 600; margin-top: 4px; flex-wrap: wrap; }
.brief .hside { text-align: right; font-size: 12px; color: #64748b; line-height: 1.6; }
.brief .score { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 12px; }
.brief .tile { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; }
.brief .tl { font-size: 9.5px; font-weight: 700; color: #64748b; text-transform: uppercase; margin: 0; letter-spacing: 0.2px; }
.brief .tv { font-size: 19px; font-weight: 800; margin: 3px 0 0 0; }
.brief .tv small { font-size: 11px; color: #64748b; font-weight: 400; }
.brief .box { border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; margin-bottom: 12px; break-inside: avoid; page-break-inside: avoid; }
.brief .box.split { break-inside: auto; page-break-inside: auto; }
.brief .bh { background: #0f172a; color: #fff; padding: 6px 10px; font-size: 12px; font-weight: 800; text-transform: uppercase; display: flex; justify-content: space-between; align-items: center; letter-spacing: 0.3px; gap: 10px; }
.brief .bh .sub { font-size: 11px; color: #34d399; font-weight: 700; text-transform: none; }
.brief table { width: 100%; font-size: 11.5px; border-collapse: collapse; line-height: 1.4; }
.brief th { background: #f1f5f9; border-bottom: 1px solid #cbd5e1; font-weight: 800; color: #1e293b; padding: 5px 7px; text-align: left; font-size: 10.5px; }
.brief td { padding: 5px 7px; border-bottom: 1px solid #f1f5f9; }
.brief .num { text-align: right; }
.brief .k { color: #64748b; font-weight: 700; }
.brief .mono { font-family: monospace; font-weight: 700; color: #047857; }
.brief .tot td { background: #ecfdf5; font-weight: 800; border-top: 1px solid #a7f3d0; }
.brief .alt td { background: #f8fafc; }
.brief .pf table { font-size: 11px; }
.brief .pf th, .brief .pf td { padding: 5px 6px; }
.brief .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 10px; }
.brief .card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 9px 12px; background: #fff; }
.brief .card:nth-child(4n+2), .brief .card:nth-child(4n+3) { background: #f8fafc; }
.brief .lab { font-size: 10.5px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.3px; }
.brief .big { font-size: 22px; font-weight: 900; letter-spacing: -0.3px; }
.brief .mid { font-size: 15px; font-weight: 800; }
.brief .meta { font-size: 11.5px; color: #334155; margin-top: 3px; line-height: 1.45; }
.brief .fine { border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; background: #f8fafc; margin-bottom: 10px; break-inside: avoid; page-break-inside: avoid; }
.brief .fine h3 { font-size: 11px; font-weight: 800; text-transform: uppercase; color: #475569; margin: 0 0 4px 0; letter-spacing: 0.3px; }
.brief .fine ol { margin: 0; padding-left: 16px; columns: 2; column-gap: 24px; font-size: 9.5px; color: #475569; line-height: 1.45; }
.brief .fine li { break-inside: avoid; margin-bottom: 4px; }
.brief .fine p { font-size: 9px; color: #64748b; margin: 4px 0 0 0; line-height: 1.4; }
.brief .mc { padding: 10px 12px; }
.brief .mcg { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 8px; }
.brief .mct { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 5px; padding: 6px 9px; }
.brief .mct p { margin: 0; }
.brief .mct .l { font-size: 9.5px; color: #64748b; font-weight: 700; text-transform: uppercase; }
.brief .mct .v { font-size: 17px; font-weight: 800; margin-top: 2px; }
.brief .mcp { font-size: 11px; color: #334155; line-height: 1.5; margin: 0 0 8px 0; }
.brief .warn { border: 1px solid #fde68a; background: #fffbeb; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; break-inside: avoid; }
.brief .warn p { font-size: 11.5px; font-weight: 800; color: #92400e; text-transform: uppercase; margin: 0 0 3px 0; }
.brief .warn ul { margin: 0; padding-left: 16px; font-size: 11.5px; color: #78350f; line-height: 1.45; }
.brief .foot { border-top: 1px solid #cbd5e1; padding-top: 5px; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; margin-top: 10px; gap: 12px; }
.brief .toolbar { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 10px; }
.brief .btn { background: #059669; color: #fff; border: 0; border-radius: 6px; padding: 8px 16px; font-size: 13px; font-weight: 700; cursor: pointer; }
.brief .btn.alt2 { background: #e2e8f0; color: #0f172a; }
@media print { .brief { padding: 0; max-width: none; } .brief .toolbar { display: none; } }
@media screen and (max-width: 900px) { .brief .score { grid-template-columns: repeat(3, 1fr); } .brief .cards { grid-template-columns: 1fr; } .brief .mcg { grid-template-columns: repeat(2, 1fr); } .brief { overflow-x: auto; } .brief .fine ol { columns: 1; } }
`;

interface Marker { value: number; label: string; color: string; dash?: boolean }

/**
 * Distribution of the simulated runs. The extreme 1% tails are not drawn as stretched bars (they distort the axis); they are
 * stated in a note instead. Bars show the share of runs, the axis is proportional, and the percentile markers sit on the same scale.
 */
function DistributionChart({ bins, runs, fmt, markers, tone, axisTitle }: {
  bins: MonteCarloHistogramBin[]; runs: number; fmt: (v: number) => string; markers: Marker[];
  tone: (b: MonteCarloHistogramBin) => string; axisTitle: string;
}) {
  const core = bins.filter((b) => !b.isTail);
  const low = bins.find((b) => b.isTail && core.length > 0 && b.binEnd <= core[0].binStart);
  const high = bins.find((b) => b.isTail && core.length > 0 && b.binStart >= core[core.length - 1].binEnd);
  if (core.length < 2) {
    return <p className="mcp">Every run landed on {core[0] ? fmt(core[0].binStart) : fmt(0)}: nothing in this simulation moves this result.</p>;
  }
  const W = 1000, H = 200, x0 = 40, x1 = 972, base = 148, maxH = 96, gap = 5;
  const lo = core[0].binStart, hi = core[core.length - 1].binEnd;
  const xOf = (v: number) => x0 + ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (x1 - x0);
  const bw = (x1 - x0 - (core.length - 1) * gap) / core.length;
  const maxShare = Math.max(...core.map((b) => b.count / runs));
  const edges = [...core.map((b) => b.binStart), hi];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={axisTitle}>
        <line x1={x0} y1={base} x2={x1} y2={base} stroke="#94a3b8" strokeWidth={1.5} />
        {core.map((b, i) => {
          const share = b.count / runs;
          const h = (share / maxShare) * maxH;
          const x = x0 + i * (bw + gap);
          return (
            <g key={i}>
              <rect x={x} y={base - h} width={bw} height={h} rx={2} fill={tone(b)} opacity={0.9} />
              {share >= 0.005 && <text x={x + bw / 2} y={base - h - 5} fontSize={14} fontWeight="bold" fill="#334155" textAnchor="middle">{`${Math.round(share * 100)}%`}</text>}
            </g>
          );
        })}
        {edges.map((v, i) => i % 2 === 0 && (
          <text key={i} x={xOf(v)} y={base + 18} fontSize={14} fill="#475569" textAnchor="middle">{fmt(v)}</text>
        ))}
        {markers.map((m, i) => {
          const x = xOf(m.value);
          const ty = 16 + (i % 2) * 17;
          return (
            <g key={m.label}>
              <line x1={x} y1={ty + 4} x2={x} y2={base} stroke={m.color} strokeWidth={2} strokeDasharray={m.dash ? '5 4' : undefined} />
              <text x={x} y={ty} fontSize={14} fontWeight="bold" fill={m.color} textAnchor="middle">{m.label}</text>
            </g>
          );
        })}
        <text x={(x0 + x1) / 2} y={H - 8} fontSize={14} fontStyle="italic" fill="#64748b" textAnchor="middle">{axisTitle}</text>
      </svg>
      {(low || high) && (
        <p style={{ fontSize: 10, color: '#64748b', margin: '2px 0 0 0' }}>
          Not drawn (the extreme 1% on each side): {low ? `${low.count} run${low.count === 1 ? '' : 's'} below ${fmt(lo)}` : ''}{low && high ? '; ' : ''}{high ? `${high.count} run${high.count === 1 ? '' : 's'} above ${fmt(hi)}` : ''}.
        </p>
      )}
    </div>
  );
}

/** Same simulation the Sensitivity tab runs, seeded from the deal and sliced so the page never freezes. */
export function useBriefMonteCarlo(assetClass: string, inputs: Record<string, any>, hurdle: number, seedText: string): MonteCarloResult | null {
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const inputsKey = JSON.stringify(inputs);
  useEffect(() => {
    let cancelled = false;
    let handle = 0;
    setResult(null);
    const start = window.setTimeout(() => {
      try {
        const runner = createMonteCarloRunner(assetClass, inputs, { runs: 1000, hurdleRatePct: hurdle, seed: seedFromText(seedText) });
        const tick = () => {
          if (cancelled) return;
          runner.step(100);
          if (runner.completed < runner.total) { handle = window.setTimeout(tick, 0); return; }
          setResult(runner.finish());
        };
        tick();
      } catch (e) {
        console.warn('[brief] Monte Carlo failed', e);
      }
    }, 50);
    return () => { cancelled = true; window.clearTimeout(start); window.clearTimeout(handle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetClass, inputsKey, hurdle, seedText]);
  return result;
}

const dscrColor = (d: number | null): string => (d !== null && d >= 1.25 ? '#0284c7' : d !== null && d >= 1 ? '#d97706' : '#e11d48');

const MonteCarloSection: React.FC<{ m: BriefModel; mc: MonteCarloResult | null }> = ({ m, mc }) => {
  if (!mc) {
    return (
      <div className="box pg">
        <div className="bh" style={{ background: '#064e3b' }}><span>🎲 Monte Carlo Simulation &amp; Risk Distribution</span><span className="sub">Running 1,000 trials…</span></div>
        <div className="mc"><p className="mcp" style={{ margin: 0 }}>Simulating…</p></div>
      </div>
    );
  }
  const hurdle = m.discountRate;
  const td = mc.tenantDefault;
  const t = mc.telemetry;
  const v = t.volatility;
  const yrs = v.holdYears;
  const irrDec = mc.p95Irr - mc.p5Irr < 6 ? 1 : 0;
  const fmtIrr = (x: number) => `${x.toFixed(irrDec)}%`;
  const tight = mc.p95Irr - mc.p5Irr < 3;
  const rng = (r: [number, number]) => `${r[0]}% to ${r[1]}%`;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const factors: Array<{ name: string; base: string; how: string; range: string }> = [
    v.contractualRentFixed
      ? { name: 'Contractual lease rent', base: 'As signed', how: 'Not varied. A signed lease and its scheduled bumps are fixed.', range: 'Fixed' }
      : { name: 'Rent', base: 'Deal rent inputs', how: 'No lease schedule, so all rent follows the sampled growth below.', range: '-' },
    { name: v.contractualRentFixed ? 'Market rent growth after a lease ends' : 'Rent growth', base: `${t.baselineRentGrowth}%/yr`, how: `σ = ${v.rentGrowthStdDev} pts`, range: rng(t.rentGrowthRange) },
    v.vacancyStdDev === null
      ? { name: 'Vacancy', base: `${t.baselineVacancy}%`, how: 'Random tenant-turnover events (not a bell curve)', range: rng(t.vacancyRange) }
      : { name: 'Vacancy', base: `${t.baselineVacancy}%`, how: `σ = ${v.vacancyStdDev} pts`, range: rng(t.vacancyRange) },
    { name: t.exitMetricType === 'Exit Cap Rate' ? 'Exit cap rate' : 'Annual land appreciation', base: `${t.baselineExitMetric}%`, how: `σ = ${v.exitMetricStdDev} pts`, range: rng(t.exitMetricRange) },
    { name: 'Property appreciation', base: `${v.baselineAppreciation}%/yr`, how: `σ = ${v.appreciationStdDev} pts`, range: rng([r1(v.baselineAppreciation - v.appreciationStdDev), r1(v.baselineAppreciation + v.appreciationStdDev)]) },
    { name: 'Operating cost inflation', base: `${v.costInflationMean}%/yr`, how: `σ = ${v.costInflationStdDev} pt`, range: rng([r1(v.costInflationMean - v.costInflationStdDev), r1(v.costInflationMean + v.costInflationStdDev)]) },
    td.applies
      ? { name: 'Tenant default', base: `${td.probabilityPct}% chance`, how: `One tenant stops paying for ${td.downtimeMonths} months, at a random point in the hold`, range: `Happened in ${td.runsAffectedPct}% of runs` }
      : { name: 'Tenant default', base: 'Not applied', how: 'Not modeled for this asset type', range: '-' },
    mc.turnover.applies
      ? { name: 'Tenant turnover', base: `${mc.turnover.annualPct}% a year`, how: `Each move-out leaves the space empty about ${mc.turnover.downtimeDays} days and costs $${mc.turnover.makeReadyCost.toLocaleString()} to re-let; fixed-term tenants leave only after their lease ends`, range: `${mc.turnover.avgMoveOutsPerRun} move-outs per run; ${mc.turnover.impliedVacancyPct}% average vacancy vs ${mc.turnover.dealVacancyPct}% set` }
      : { name: 'Tenant turnover', base: 'Not applied', how: 'Apartments and houses with tenant leases only', range: '-' },
  ];

  return (
    <div className="box pg">
      <div className="bh" style={{ background: '#064e3b' }}>
        <span>🎲 Monte Carlo Simulation &amp; Risk Distribution ({mc.runs.toLocaleString()} Runs, {yrs}-Year Hold)</span>
        <span className="sub" style={{ color: '#a7f3d0' }}>Value-at-Risk &amp; Volatility Stress Audit</span>
      </div>
      <div className="mc">
        <p className="mcp">
          <strong>How to read this.</strong> The deal is re-run {mc.runs.toLocaleString()} times. Each run draws random values for the factors in the table at the end of this page
          (centered on this deal's own inputs) and re-scores the whole {yrs}-year hold with the same engine as the pro-forma.
          P10 means 10% of runs did worse than this value, P50 is the middle run, and P90 means only 10% did better.
        </p>

        <div className="mcg">
          <div className="mct"><p className="l">P10 IRR (Downside)</p><p className="v" style={{ color: mc.p10Irr >= 0 ? '#d97706' : '#e11d48' }}>{mc.p10Irr.toFixed(1)}%</p></div>
          <div className="mct"><p className="l">P50 IRR (Median)</p><p className="v">{mc.p50Irr.toFixed(1)}%</p></div>
          <div className="mct"><p className="l">P90 IRR (Upside)</p><p className="v" style={{ color: '#059669' }}>{mc.p90Irr.toFixed(1)}%</p></div>
          <div className="mct"><p className="l">Runs Clearing {hurdle.toFixed(1)}% Hurdle</p><p className="v" style={{ color: '#047857' }}>{mc.probAboveHurdle}%</p></div>
          <div className="mct"><p className="l">Runs With Negative IRR</p><p className="v" style={{ color: mc.probNegativeIrr > 0 ? '#e11d48' : '#059669' }}>{mc.probNegativeIrr}%</p></div>
        </div>
        <div className="mcg">
          <div className="mct"><p className="l">P10 Net Profit (Downside)</p><p className="v" style={{ color: mc.profit.p10 >= 0 ? '#d97706' : '#e11d48' }}>{compact(mc.profit.p10)}</p></div>
          <div className="mct"><p className="l">P50 Net Profit (Median)</p><p className="v">{compact(mc.profit.median)}</p></div>
          <div className="mct"><p className="l">P90 Net Profit (Upside)</p><p className="v" style={{ color: '#059669' }}>{compact(mc.profit.p90)}</p></div>
          <div className="mct"><p className="l">Runs That Lose Money</p><p className="v" style={{ color: mc.profit.probLoss > 0 ? '#e11d48' : '#059669' }}>{mc.profit.probLoss}%</p></div>
          <div className="mct"><p className="l">Cash Put In At Closing</p><p className="v">{compact(mc.equity.cashInvested)}</p></div>
        </div>

        <div className="mct" style={{ marginBottom: 8, padding: '8px 10px' }}>
          <p style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>Return (IRR) across {mc.runs.toLocaleString()} runs</p>
          <p style={{ fontSize: 11, color: '#475569', margin: '2px 0 4px 0', lineHeight: 1.45 }}>
            IRR is the yearly return on the cash you put in, over the full {yrs}-year hold including the sale. Each bar is the share of runs that landed in that range.
            {tight
              ? ` The spread is tight (P5 ${fmtIrr(mc.p5Irr)} to P95 ${fmtIrr(mc.p95Irr)})${v.contractualRentFixed ? ' because most income is fixed by lease' : ''}, so most runs land close to the median.`
              : ` 90% of runs landed between ${fmtIrr(mc.p5Irr)} (P5) and ${fmtIrr(mc.p95Irr)} (P95).`}
          </p>
          <DistributionChart
            bins={mc.histogramBins} runs={mc.runs} fmt={fmtIrr} axisTitle="Levered IRR over the hold"
            tone={(b) => (b.binEnd < 0 ? '#e11d48' : b.binEnd < hurdle ? '#d97706' : '#059669')}
            markers={[
              { value: mc.p10Irr, label: `P10 ${fmtIrr(mc.p10Irr)}`, color: '#b45309' },
              { value: mc.p50Irr, label: `P50 ${fmtIrr(mc.p50Irr)}`, color: '#0f172a' },
              { value: mc.p90Irr, label: `P90 ${fmtIrr(mc.p90Irr)}`, color: '#047857' },
              { value: hurdle, label: `Hurdle ${hurdle.toFixed(1)}%`, color: '#7c3aed', dash: true },
            ]}
          />
        </div>

        <div className="mct" style={{ marginBottom: 8, padding: '8px 10px' }}>
          <p style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>Net profit in dollars over the {yrs}-year hold</p>
          <p style={{ fontSize: 11, color: '#475569', margin: '2px 0 4px 0', lineHeight: 1.45 }}>
            Net profit = every year's cash flow after debt service, plus the equity left at the end of year {yrs} (value less the remaining loan, as the pro-forma shows it),
            minus the {compact(mc.equity.cashInvested)} put in at closing. It is a plain dollar total: not discounted and before income tax.
            {mc.equity.thin ? ` Only ${mc.equity.pctOfPrice.toFixed(1)}% of the price is your own cash, so IRR swings widely on small changes and this dollar figure is the steadier measure.` : ''}
          </p>
          <DistributionChart
            bins={mc.profit.histogramBins} runs={mc.runs} fmt={compact} axisTitle={`Net profit over ${yrs} years ($)`}
            tone={(b) => (b.binEnd < 0 ? '#e11d48' : '#059669')}
            markers={[
              { value: mc.profit.p10, label: `P10 ${compact(mc.profit.p10)}`, color: '#b45309' },
              { value: mc.profit.median, label: `P50 ${compact(mc.profit.median)}`, color: '#0f172a' },
              { value: mc.profit.p90, label: `P90 ${compact(mc.profit.p90)}`, color: '#047857' },
              { value: 0, label: 'Break even $0', color: '#e11d48', dash: true },
            ]}
          />
        </div>

        <p style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', margin: '8px 0 3px 0' }}>What the simulation varied</p>
        <table>
          <thead><tr><th style={{ width: '25%' }}>Factor</th><th style={{ width: '14%' }}>This deal's base</th><th style={{ width: '37%' }}>How it was varied</th><th style={{ width: '24%' }}>Typical range (±1σ)</th></tr></thead>
          <tbody>
            {factors.map((f) => (
              <tr key={f.name}><td style={{ fontWeight: 700 }}>{f.name}</td><td>{f.base}</td><td>{f.how}</td><td>{f.range}</td></tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 10, color: '#64748b', lineHeight: 1.45, margin: '4px 0 0 0' }}>
          σ is one standard deviation: about two-thirds of runs fall within ±1σ of the base case and about 95% within ±2σ. Draws are bell-curve (normal) and independent.
          The simulation is seeded from the deal, so the same deal always prints the same charts.
        </p>
      </div>
    </div>
  );
};

const DownPaymentSection: React.FC<{ m: BriefModel }> = ({ m }) => {
  const matrix = m.downPaymentMatrix;
  const rows = matrix?.rows || [];
  if (rows.length === 0) return null;

  const maxDs = Math.max(...rows.map((r) => r.annualDebtService), 1);
  const cocs = rows.map((r) => r.cashOnCash);
  const minCoc = Math.min(0, ...cocs);
  const maxCoc = Math.max(15, ...cocs);
  const cocRange = maxCoc - minCoc || 1;

  const W = 1000;
  const H = 190;
  const padL = 60;
  const padR = 60;
  const padT = 20;
  const padB = 30;
  const usableW = W - padL - padR;
  const usableH = H - padT - padB;

  const stepX = rows.length > 1 ? usableW / (rows.length - 1) : usableW / 2;
  const pts = rows.map((r, i) => {
    const x = padL + i * stepX;
    const barH = Math.max(0, (r.annualDebtService / maxDs) * usableH);
    const barY = padT + usableH - barH;
    const cocFrac = (r.cashOnCash - minCoc) / cocRange;
    const lineY = padT + usableH - cocFrac * usableH;
    return { ...r, x, barH, barY, lineY };
  });

  const cocPath = pts.length > 1
    ? pts.reduce((acc, pt, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.lineY.toFixed(1)}`, '')
    : '';

  const baselinePt = pts.find((pt) => pt.isBaseline);

  const levLabel = matrix.leverageType === 'positive'
    ? 'Positive Financial Leverage'
    : matrix.leverageType === 'negative'
      ? 'Negative Financial Leverage'
      : 'Neutral Financial Leverage';

  const levColor = matrix.leverageType === 'positive'
    ? '#059669'
    : matrix.leverageType === 'negative'
      ? '#e11d48'
      : '#475569';

  return (
    <div className="box pg">
      <div className="bh" style={{ background: '#0284c7' }}>
        <span>📉 Down Payment &amp; Leverage Sensitivity</span>
        <span className="sub" style={{ color: '#bae6fd' }}>Cost of Debt vs. Cash-on-Cash Return</span>
      </div>
      <div className="mc">
        <p className="mcp">
          <strong>Leverage &amp; Capitalization Trade-Off.</strong> Evaluates the asset at fixed acquisition pricing across equity down payment tiers ({rows[0].downPaymentPercent}% to {rows[rows.length - 1].downPaymentPercent}%).
          {matrix.leverageType === 'positive' && (
            <span> Because the going-in cap rate ({matrix.goingInCapRate.toFixed(2)}%) exceeds the senior loan constant ({matrix.loanConstant?.toFixed(2)}%), borrowing generates <strong>positive leverage</strong>, amplifying cash-on-cash yield at higher leverage.</span>
          )}
          {matrix.leverageType === 'negative' && (
            <span> Because the senior loan constant ({matrix.loanConstant?.toFixed(2)}%) exceeds the going-in cap rate ({matrix.goingInCapRate.toFixed(2)}%), borrowing creates <strong>negative leverage</strong>. Increasing equity down payment improves cash-on-cash return while expanding debt service coverage.</span>
          )}
          {matrix.leverageType === 'neutral' && (
            <span> The senior loan constant is balanced with the going-in cap rate ({matrix.goingInCapRate.toFixed(2)}%), creating neutral leverage.</span>
          )}
          {matrix.debtServicePer5PctDown > 0 && (
            <span> Each incremental +5% equity down payment reduces debt service by approximately <strong>{cur(matrix.debtServicePer5PctDown)}/year</strong>.</span>
          )}
        </p>

        <div className="mcg" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 12 }}>
          <div className="mct">
            <p className="l">Going-In Cap Rate</p>
            <p className="v" style={{ color: '#0f172a' }}>{pct(matrix.goingInCapRate)}</p>
          </div>
          <div className="mct">
            <p className="l">Senior Loan Constant</p>
            <p className="v" style={{ color: '#0284c7' }}>{matrix.loanConstant !== null ? pct(matrix.loanConstant) : 'N/A'}</p>
          </div>
          <div className="mct">
            <p className="l">Leverage Profile</p>
            <p className="v" style={{ color: levColor, fontSize: 14, textTransform: 'uppercase' }}>{levLabel}</p>
          </div>
          <div className="mct">
            <p className="l">Debt Savings (+5% Down)</p>
            <p className="v" style={{ color: '#059669' }}>{matrix.debtServicePer5PctDown > 0 ? `${cur(matrix.debtServicePer5PctDown)}/yr` : 'N/A'}</p>
          </div>
        </div>

        {/* Dual-Metric SVG Visual Chart */}
        <div className="mct" style={{ marginBottom: 12, padding: '10px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>
              Annual Debt Service ($) vs. Cash-on-Cash Return (%)
            </span>
            <div style={{ display: 'flex', gap: 14, fontSize: 11, fontWeight: 700 }}>
              <span style={{ color: '#0284c7' }}>■ Annual Debt Service ($)</span>
              <span style={{ color: '#059669' }}>● Cash-on-Cash Return (%)</span>
              <span style={{ color: '#1d4ed8' }}>┆ Underwritten Baseline ({m.downPaymentPct.toFixed(0)}%)</span>
            </div>
          </div>

          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, overflow: 'visible' }}>
            {/* Horizontal Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1.0].map((frac, i) => {
              const y = padT + usableH * (1 - frac);
              const valDs = maxDs * frac;
              const valCoc = minCoc + cocRange * frac;
              return (
                <g key={i}>
                  <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#e2e8f0" strokeDasharray="3 3" />
                  <text x={padL - 8} y={y + 3} fill="#64748b" fontSize="10" textAnchor="end" fontFamily="sans-serif">
                    {compact(valDs)}
                  </text>
                  <text x={W - padR + 8} y={y + 3} fill="#059669" fontSize="10" textAnchor="start" fontFamily="sans-serif">
                    {valCoc.toFixed(1)}%
                  </text>
                </g>
              );
            })}

            {/* Baseline Marker */}
            {baselinePt && (
              <g>
                <line
                  x1={baselinePt.x}
                  y1={padT - 6}
                  x2={baselinePt.x}
                  y2={padT + usableH}
                  stroke="#1d4ed8"
                  strokeWidth="2"
                  strokeDasharray="4 3"
                />
                <rect
                  x={baselinePt.x - 38}
                  y={padT - 18}
                  width="76"
                  height="15"
                  rx="3"
                  fill="#eff6ff"
                  stroke="#3b82f6"
                  strokeWidth="1"
                />
                <text
                  x={baselinePt.x}
                  y={padT - 7}
                  fill="#1d4ed8"
                  fontSize="9"
                  fontWeight="bold"
                  textAnchor="middle"
                  fontFamily="sans-serif"
                >
                  Baseline {baselinePt.downPaymentPercent}%
                </text>
              </g>
            )}

            {/* Debt Service Bars */}
            {pts.map((pt) => {
              const barW = Math.max(16, Math.min(42, stepX * 0.44));
              const barFill = pt.isBaseline ? '#0284c7' : '#0f766e';
              return (
                <g key={`bar-${pt.downPaymentPercent}`}>
                  <rect
                    x={pt.x - barW / 2}
                    y={pt.barY}
                    width={barW}
                    height={pt.barH}
                    rx="3"
                    fill={barFill}
                    opacity="0.85"
                  />
                  <text
                    x={pt.x}
                    y={H - padB + 15}
                    fill={pt.isBaseline ? '#1d4ed8' : '#334155'}
                    fontSize="11"
                    fontWeight={pt.isBaseline ? 'bold' : '600'}
                    textAnchor="middle"
                    fontFamily="sans-serif"
                  >
                    {pt.downPaymentPercent}%
                  </text>
                  <text
                    x={pt.x}
                    y={H - padB + 27}
                    fill="#64748b"
                    fontSize="9"
                    textAnchor="middle"
                    fontFamily="sans-serif"
                  >
                    {compact(pt.downPaymentAmount)}
                  </text>
                </g>
              );
            })}

            {/* Cash-on-Cash Return Line */}
            {cocPath && (
              <path
                d={cocPath}
                fill="none"
                stroke="#059669"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Cash-on-Cash Points */}
            {pts.map((pt) => {
              const ptColor = pt.cashOnCash >= 0 ? '#059669' : '#e11d48';
              return (
                <g key={`pt-${pt.downPaymentPercent}`}>
                  <circle
                    cx={pt.x}
                    cy={pt.lineY}
                    r={pt.isBaseline ? 5.5 : 4}
                    fill={ptColor}
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                  {pt.isBaseline && (
                    <circle cx={pt.x} cy={pt.lineY} r="9" fill="none" stroke="#34d399" strokeWidth="1.5" />
                  )}
                  <text
                    x={pt.x}
                    y={pt.lineY - 7}
                    fill={ptColor}
                    fontSize="9.5"
                    fontWeight="bold"
                    textAnchor="middle"
                    fontFamily="sans-serif"
                  >
                    {pt.cashOnCash.toFixed(1)}%
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Comparative Matrix Table */}
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'center' }}>Down Payment %</th>
              <th className="num">Equity Required</th>
              <th className="num">Loan Amount (LTV)</th>
              <th className="num">Monthly Debt Service</th>
              <th className="num">Annual Debt Service</th>
              <th className="num" style={{ color: '#059669' }}>Net Cash Flow</th>
              <th className="num" style={{ color: '#047857' }}>Cash-on-Cash Return</th>
              <th className="num">Senior DSCR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isBase = row.isBaseline;
              const dscrText = row.dscr !== null ? `${row.dscr.toFixed(2)}x` : 'N/A (All-Cash)';
              const dscrCl = row.dscr !== null && row.dscr >= 1.25 ? '#0284c7' : '#d97706';
              return (
                <tr
                  key={row.downPaymentPercent}
                  style={isBase ? { background: '#eff6ff', fontWeight: 700 } : (i % 2 ? { background: '#f8fafc' } : {})}
                >
                  <td style={{ textAlign: 'center' }}>
                    {row.downPaymentPercent}%
                    {isBase && (
                      <span
                        className="pill pill-blue"
                        style={{ marginLeft: 6, fontSize: 8.5, padding: '1px 5px' }}
                      >
                        CURRENT BASELINE
                      </span>
                    )}
                  </td>
                  <td className="num">{cur(row.initialCashInvested)}</td>
                  <td className="num">
                    {cur(row.loanAmount)} <span style={{ fontSize: 9.5, color: '#64748b' }}>({row.ltv.toFixed(0)}% LTV)</span>
                  </td>
                  <td className="num">
                    {row.monthlyDebtService > 0 ? `${cur(row.monthlyDebtService)}/mo` : '$0 (All-Cash)'}
                  </td>
                  <td className="num">{cur(row.annualDebtService)}</td>
                  <td className="num" style={{ fontWeight: 800, color: row.netCashFlow >= 0 ? '#059669' : '#e11d48' }}>
                    {cur(row.netCashFlow)}/yr
                  </td>
                  <td className="num" style={{ fontWeight: 800, color: row.cashOnCash >= 0 ? '#047857' : '#e11d48' }}>
                    {pct(row.cashOnCash)}
                  </td>
                  <td className="num" style={{ fontWeight: 700, color: dscrCl }}>
                    {dscrText}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const DealBrief: React.FC<{ model: BriefModel; monteCarlo: MonteCarloResult | null; onPrint?: () => void; onClose?: () => void }> = ({ model: m, monteCarlo, onPrint, onClose }) => {
  const multi = m.parcels.length > 1;
  const primary = m.parcels[0];
  const stab = m.isProrated ? 'Stabilized' : 'Year 1';
  const dscrLabel = m.isProrated ? 'Stabilized DSCR' : 'Senior DSCR';
  const dpLine = m.rehabMode === 'roll_into_loan'
    ? `${cur(m.downPaymentAmt)} Down Payment (${pctShort(m.downPaymentPct)}% LTC) • ${cur(m.rehabCosts)} Rehab + ${cur(m.closingCosts)} Closing Financed`
    : `${cur(m.downPaymentAmt)} Down (${pctShort(m.downPaymentPct)}%) + ${cur(m.rehabCosts)} Rehab + ${cur(m.closingCosts)} Closing (Funded Out-of-Pocket)`;
  const leaseLine = m.underwritingLeases.length > 0
    ? m.underwritingLeases.map((l) => `${l.tenant ?? 'Tenant'} ${cur(l.monthlyRent)}/mo${l.start ? ` (${l.start}${l.end ? ` to ${l.end}` : ''})` : ''}`).join(' • ')
    : 'Underwritten from deal rent inputs (no underwriting lease schedule)';
  // The headline is the rent the user entered; the model's annual figure is a first-full-year average that includes escalations
  const enteredRent = m.underwritingLeases.reduce((s, l) => s + l.monthlyRent, 0);
  const showEnteredRent = enteredRent > 0 && Math.abs(enteredRent - m.monthlyRent) >= 0.5;

  // Methodology and diligence provenance are disclosures: they close the document in fine print
  const disclosures: Array<{ title: string; text: string }> = [
    { title: 'Acquisition Price & Basis', text: `Reconciled against official ${m.county ?? 'county'} assessed valuation (${m.parcelTotals.assessed > 0 ? `${cur(m.parcelTotals.assessed)} total assessed basis` : 'county tax roll'}) and purchase contract terms.` },
    { title: 'Total Initial Capital Outlay', text: `Total Day 1 sponsor equity required to capitalize the acquisition, fund closing costs (${cur(m.closingCosts)}), and execute renovation scope (${cur(m.rehabCosts)})${m.arv ? ` to capture After-Repair Value (${cur(m.arv)})` : ''}. ${m.rehabMode === 'roll_into_loan' ? 'Rehab and closing costs are rolled directly into the senior loan facility.' : 'Rehab and closing settlements are funded 100% upfront out of sponsor equity.'}${m.capexReservePct !== null ? ` Ongoing replacement reserves: ${m.capexReservePct}%/yr.` : ''}` },
    { title: 'Vacancy & Economic Downtime', text: m.vacancyPct <= 0.001 ? 'Models 100% economic occupancy with zero vacancy friction.' : `Underwriting allowance of ${pctShort(m.vacancyPct)}% buffers tenant rollover friction, collection delay, and physical downtime.` },
    { title: 'Loan-to-Value & Leverage', text: m.debtProvenance },
    { title: 'Financing Terms & Debt Service', text: m.dscrEvaluation },
    { title: 'Gross In-Place Revenue & Tenancy', text: m.revenueProvenance },
    { title: 'Operating Expenses & Management', text: m.opexProvenance },
    { title: 'Hold Horizon & Terminal Exit Cap Rate', text: `Exit value is capitalized at the ${m.exitCapRate}% terminal cap rate over the ${m.holdYears}-year investment horizon.` },
  ];

  return (
    <div className="brief" id="printable-brief">
      <style>{BRIEF_CSS}</style>

      {(onPrint || onClose) && (
        <div className="toolbar">
          {onClose && <button type="button" className="btn alt2" onClick={onClose}>Close</button>}
          {onPrint && <button type="button" className="btn" onClick={onPrint}>Print / Save as PDF</button>}
        </div>
      )}

      {/* PAGE 1: who, headline numbers, county record, rent roll */}
      <div className="hdr">
        <div>
          <div className="row">
            <span className="logo">MathTree</span>
            <span className="pill pill-green">{m.memoTypeLabel}</span>
            <span className={`pill ${m.status === 'owned' ? 'pill-green' : 'pill-blue'}`}>{m.status === 'owned' ? '🏛️ Owned Operating Asset' : '🎯 Pipeline Prospect'}</span>
          </div>
          <h1>{m.title}</h1>
          <div className="row hmeta">
            <span>📍 <strong>{orNP(m.location)}</strong></span><span>•</span>
            <span className="mono">APN: {primary ? primary.apn : 'Pending Link'}{multi ? ` (+${m.parcels.length - 1} Adjacent)` : ''}</span><span>•</span>
            <span>🏛️ {orNP(m.county)}</span><span>•</span>
            <span className="pill pill-slate">{m.gisBadge}</span>
            {multi && <span className="pill pill-green">📦 {m.parcels.length}-Parcel Package</span>}
          </div>
        </div>
        <div className="hside">
          <div>Report Date: <strong style={{ color: '#0f172a' }}>{m.dateStr}</strong></div>
          <div>Target Hold Period: <strong style={{ color: '#0f172a' }}>{m.holdYears} Years</strong></div>
          <div>Settlement Closing: <strong style={{ color: '#059669' }}>{m.closingDate ?? `${m.startYear} Full Calendar Year`}</strong></div>
        </div>
      </div>

      <div className="score">
        <div className="tile"><p className="tl">{m.holdYears}-Yr Levered IRR</p><p className="tv" style={{ color: '#059669' }}>{pct(m.irr)}</p></div>
        <div className="tile"><p className="tl">Gross Monthly Rent</p><p className="tv">{cur(m.monthlyRent)}<small>/mo</small></p></div>
        <div className="tile"><p className="tl">Year 1 Net Cash Flow</p><p className="tv" style={{ color: m.cashFlow >= 0 ? '#059669' : '#e11d48' }}>{cur(m.cashFlow)}<small> ({cur(m.monthlyCashFlow)}/mo)</small></p></div>
        <div className="tile"><p className="tl">Equity Multiplier</p><p className="tv">{m.equityMultiple.toFixed(2)}x</p></div>
        <div className="tile"><p className="tl">{stab} Cap Rate</p><p className="tv">{pct(m.capRate)}</p></div>
        <div className="tile"><p className="tl">{dscrLabel}</p><p className="tv" style={{ color: dscrColor(m.dscr) }}>{m.dscrFormatted}</p></div>
      </div>

      <div className="box">
        <div className="bh">
          <span>🏛️ Official County Assessor &amp; Parcel Records</span>
          <span className="sub">{multi ? `Multi-Parcel Package (${m.parcels.length} APNs • Tax Roll Audit)` : 'Tax Roll & Boundary Audit'}</span>
        </div>
        {m.parcels.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th style={{ width: '15%' }}>APN / Parcel</th><th style={{ width: '27%' }}>Address</th>
                <th className="num">Assessed</th><th className="num">Land</th><th className="num">Improvements</th>
                <th className="num">Acres</th><th className="num">Sq Ft</th>
              </tr>
            </thead>
            <tbody>
              {m.parcels.map((p) => (
                <tr key={p.apn}>
                  <td className="mono">{p.apn}{p.isPrimary && <span style={{ color: '#64748b', fontSize: 9, marginLeft: 4 }}>(PRIMARY)</span>}</td>
                  <td>{orNP(p.address)}</td>
                  <td className="num">{p.assessed > 0 ? cur(p.assessed) : 'Pending'}</td>
                  <td className="num">{cur(p.land)}</td><td className="num">{cur(p.improvement)}</td>
                  <td className="num">{p.acres.toFixed(2)}</td><td className="num">{Math.round(p.sqft).toLocaleString()}</td>
                </tr>
              ))}
              {multi && (
                <tr className="tot">
                  <td colSpan={2}>Combined Package ({m.parcels.length} parcels)</td>
                  <td className="num">{cur(m.parcelTotals.assessed)}</td><td className="num">{cur(m.parcelTotals.land)}</td><td className="num">{cur(m.parcelTotals.improvement)}</td>
                  <td className="num">{m.parcelTotals.acres.toFixed(2)}</td><td className="num">{Math.round(m.parcelTotals.sqft).toLocaleString()}</td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: '8px 10px', fontSize: 11.5, color: '#64748b' }}>No county parcel is linked to this deal. Assessment and boundary data: {NP}.</div>
        )}
        <table>
          <tbody>
            <tr>
              <td className="k" style={{ width: '14%' }}>Property Address</td><td style={{ width: '22%', fontWeight: 700 }}>{orNP(m.location)}</td>
              <td className="k" style={{ width: '14%' }}>County Jurisdiction</td><td style={{ width: '18%', fontWeight: 700 }}>{orNP(m.county)}</td>
              <td className="k" style={{ width: '14%' }}>Owner of Record</td><td style={{ width: '18%', fontWeight: 700 }}>{orNP(m.owner)}</td>
            </tr>
            <tr>
              <td className="k">Zoning &amp; Land Use</td><td style={{ fontWeight: 600 }}>{orNP(m.zoning)} • {orNP(m.useCode)}</td>
              <td className="k">Structural Specs</td>
              <td colSpan={3} style={{ fontWeight: 600 }}>
                {[m.yearBuilt ? `Built ${m.yearBuilt}` : null, m.buildingSqFt > 0 ? `${m.buildingSqFt.toLocaleString()} Sq Ft` : null, m.stories ? `${m.stories} Story` : null, m.construction].filter(Boolean).join(' • ') || NP}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="box">
        <div className="bh">
          <span>📋 In-Place Rent Roll</span>
          <span className="sub">{m.rentRoll.length > 0 ? `${m.rentRoll.length} active lease${m.rentRoll.length === 1 ? '' : 's'} • Operations rent roll` : 'No rent roll on file'}</span>
        </div>
        {m.rentRoll.length > 0 ? (
          <table>
            <thead>
              <tr><th>Tenant</th><th>Unit</th><th>Type</th><th className="num">Monthly Rent</th><th>Lease Start</th><th>Lease End</th><th>Escalation</th><th>Next Escalation</th></tr>
            </thead>
            <tbody>
              {m.rentRoll.map((l, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 700 }}>{orNP(l.tenant)}</td><td>{orNP(l.unit)}</td><td>{orNP(l.type)}</td>
                  <td className="num">{cur(l.monthlyRent)}</td><td>{orNP(l.start)}</td><td>{l.end ?? 'No end date'}</td>
                  <td>{orNP(l.escalation)}</td><td>{orNP(l.nextEscalation)}</td>
                </tr>
              ))}
              <tr className="tot">
                <td colSpan={3}>Total in-place rent roll</td>
                <td className="num">{cur(m.rentRollMonthly)}/mo</td>
                <td colSpan={4}>
                  {cur(m.rentRollMonthly * 12)}/yr • Underwritten: {cur(m.monthlyRent)}/mo
                  {m.rentVarianceMonthly !== null && ` • Variance ${m.rentVarianceMonthly >= 0 ? '+' : '-'}${cur(Math.abs(m.rentVarianceMonthly))}/mo`}
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <div style={{ padding: '8px 10px', fontSize: 11.5, color: '#64748b' }}>
            No active leases are recorded in Operations. Underwritten rent of {cur(m.monthlyRent)}/mo comes from the deal's underwriting inputs.
          </div>
        )}
      </div>

      {/* PAGE 2: the eight underwriting assumptions as large cards, then risk flags */}
      <div className="box pg">
        <div className="bh">
          <span>⚖️ Core Underwriting Assumptions &amp; Capital Structure</span>
          <span className="sub">Methodology notes are in the fine print at the end</span>
        </div>
        <div className="cards">
          <div className="card">
            <div className="lab">1. Acquisition Price &amp; Basis</div>
            <div><span className="big" style={{ color: '#059669' }}>{cur(m.price)}</span>{m.buildingSqFt > 0 && <span className="meta" style={{ marginLeft: 6 }}>(${(m.price / m.buildingSqFt).toFixed(0)}/sq ft)</span>}</div>
            <div className="meta">{m.parcelTotals.assessed > 0 ? `County assessed basis ${cur(m.parcelTotals.assessed)}` : 'County assessment: Not provided'}</div>
          </div>
          <div className="card">
            <div className="lab">2. Total Initial Capital Outlay</div>
            <div><span className="big" style={{ color: '#0284c7' }}>{cur(m.equity)}</span> <span className="pill" style={{ background: '#e0f2fe', color: '#0369a1' }}>Upfront cash required</span></div>
            <div className="meta">{dpLine}</div>
          </div>
          <div className="card">
            <div className="lab">3. Vacancy &amp; Economic Downtime</div>
            <div><span className="big">{pctShort(m.vacancyPct)}%</span> <span className="mid" style={{ color: '#64748b' }}>of gross</span></div>
            <div className="meta">{cur(m.vacancyLossAnnual)}/yr reserve</div>
          </div>
          <div className="card">
            <div className="lab">4. Loan-to-Value &amp; Leverage</div>
            <div><span className="big">{pctShort(m.ltvPct)}% {m.rehabMode === 'roll_into_loan' ? 'LTC' : 'LTV'}</span> <span className="mid" style={{ color: '#047857' }}>{cur(m.loanAmt)} senior debt</span></div>
            <div className="meta">Sponsor equity {cur(m.equity)} ({m.rehabMode === 'roll_into_loan' ? `${pctShort(m.downPaymentPct)}% LTC down payment` : `${cur(m.downPaymentAmt)} down + ${cur(m.rehabCosts + m.closingCosts)} outlay`})</div>
          </div>
          <div className="card">
            <div className="lab">5. Financing Terms &amp; Debt Service</div>
            <div><span className="mid">{m.interestRate}% • {m.loanTerm} yrs</span> <span className="mid" style={{ color: '#0284c7' }}>{cur(m.monthlyDebtService)}/mo P&amp;I</span></div>
            <div className="meta">
              {cur(m.debtService)}{m.isProrated ? ` stub Yr 1 debt (${m.p0.operatingMonths} mos)` : '/yr annual debt'} • {cur(m.principalPerMonth)}/mo principal, {cur(m.interestPerMonth)}/mo interest • DSCR <strong style={{ color: dscrColor(m.dscr) }}>{m.dscrFormatted}</strong>
            </div>
          </div>
          <div className="card">
            <div className="lab">6. Gross In-Place Revenue &amp; Tenancy</div>
            <div><span className="big" style={{ color: '#059669' }}>{cur(showEnteredRent ? enteredRent : m.monthlyRent)}/mo</span> <span className="meta">({cur((showEnteredRent ? enteredRent : m.monthlyRent) * 12)}/yr)</span></div>
            <div className="meta">{leaseLine}</div>
            {showEnteredRent && <div className="meta">Model average for first full year ({cur(m.monthlyRent)}/mo, {cur(m.annualRent)}/yr) differs from the entered rent because of lease escalations.</div>}
          </div>
          <div className="card">
            <div className="lab">7. Operating Expenses &amp; Management</div>
            <div><span className="big">{pctShort(m.expenseRatioPct)}%</span> <span className="mid" style={{ color: '#64748b' }}>of gross income</span></div>
            <div className="meta">{cur(m.opExAnnual)}/yr • {cur(m.opExAnnual / 12)}/mo</div>
          </div>
          <div className="card">
            <div className="lab">8. Hold Horizon &amp; Exit Cap Rate</div>
            <div><span className="big">{m.holdYears}-year hold</span> <span className="mid" style={{ color: '#059669' }}>{m.exitCapRate}% exit cap</span></div>
            <div className="meta">{m.closingDate ? `Closing ${m.closingDate}${m.isProrated ? ` (${m.p0.operatingMonths} months in year 1)` : ''}` : `Underwriting period: full calendar year ${m.startYear}`}</div>
          </div>
        </div>
      </div>

      {m.warnings.length > 0 && (
        <div className="warn">
          <p>Deal Risk &amp; Underwriting Audit Flags</p>
          <ul>{m.warnings.map((w, i) => <li key={i}><strong>{w.title}:</strong> {w.description}</li>)}</ul>
        </div>
      )}

      {/* PAGE 3: pro-forma */}
      <div className="box split pf pg">
        <div className="bh"><span>📊 {m.holdYears}-Year Pro-Forma Forecast</span><span className="sub">Calendar-Year Cash Flow Waterfall</span></div>
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'center' }}>Date / Period</th><th className="num">Asset Value</th><th className="num">Gross Income</th><th className="num">Vacancy</th>
              <th className="num">OpEx</th><th className="num">NOI</th><th className="num">Debt Service</th><th className="num" style={{ color: '#059669' }}>Net Cash Flow</th>
              <th className="num">CoC %</th><th className="num">Cap Rate</th><th className="num">Loan Balance</th><th className="num" style={{ color: '#059669' }}>Ending Equity</th>
            </tr>
          </thead>
          <tbody>
            {m.proj.map((p: any, i) => {
              const cf = Number(p.cashFlow ?? p.netCashFlow ?? 0);
              const coc = Number(p.cashOnCash ?? 0);
              return (
                <tr key={i} className={i % 2 ? 'alt' : ''}>
                  <td style={{ textAlign: 'center', fontWeight: 700 }}>{p.calendarYear || m.startYear + (p.year || i + 1) - 1} <span style={{ fontSize: 9.5, color: '#64748b', fontWeight: 400 }}>(Yr {p.year || i + 1})</span></td>
                  <td className="num">{cur(p.propertyValue)}</td>
                  <td className="num">{cur(p.grossPotentialIncome ?? p.effectiveGrossIncome ?? 0)}</td>
                  <td className="num" style={{ color: '#e11d48' }}>{cur(p.vacancyLoss || 0)}</td>
                  <td className="num" style={{ color: '#64748b' }}>{cur(p.operatingExpenses || 0)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{cur(p.netOperatingIncome ?? 0)}</td>
                  <td className="num" style={{ color: '#64748b' }}>{cur(p.debtService ?? 0)}</td>
                  <td className="num" style={{ fontWeight: 800, color: cf >= 0 ? '#059669' : '#e11d48' }}>{cur(cf)}</td>
                  <td className="num" style={{ fontWeight: 600, color: coc >= 0 ? '#047857' : '#e11d48' }}>{pct(coc)}</td>
                  <td className="num">{pct(Number(p.capRate ?? 0))}</td>
                  <td className="num" style={{ color: '#64748b' }}>{cur(p.loanBalanceRemaining ?? p.endingLoanBalance ?? 0)}</td>
                  <td className="num" style={{ fontWeight: 700, color: '#059669' }}>{cur(p.equity ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {m.proj.some((p: any) => p.methodologyFootnote) && (
          <div style={{ fontSize: 9.5, color: '#475569', padding: '6px 10px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', lineHeight: 1.45 }}>
            <span style={{ fontWeight: 800, color: '#047857', textTransform: 'uppercase' }}>Contractual lease &amp; calendar provenance footnotes</span>
            <ul style={{ margin: '3px 0 0 0', paddingLeft: 16 }}>
              {m.proj.filter((p: any) => p.methodologyFootnote).map((p: any, i) => (
                <li key={i}><strong>Yr {p.year} ({p.calendarYear || m.startYear + p.year - 1}):</strong> {p.methodologyFootnote}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* PAGE 4: Down Payment & Leverage Sensitivity */}
      <DownPaymentSection m={m} />

      {/* PAGE 5: Monte Carlo */}
      <MonteCarloSection m={m} mc={monteCarlo} />

      {/* LAST: methodology and diligence provenance, as fine print */}
      <div className="fine">
        <h3>Methodology, Diligence Provenance &amp; Disclosures</h3>
        <ol>
          {disclosures.map((d) => <li key={d.title}><strong>{d.title}.</strong> {d.text}</li>)}
        </ol>
        <p>Figures in this brief are computed from the deal's recorded inputs, its in-place rent roll and linked county parcels. Provenance statements describe how each figure was derived and are not independently verified.</p>
      </div>

      <div className="foot">
        <span>MathTree Real Estate Underwriting Platform • Computed from live deal data</span>
        <span>Confidential Investment Memo • {dscrLabel}: {m.dscrFormatted} • Generated {m.dateStr}</span>
      </div>
    </div>
  );
};
