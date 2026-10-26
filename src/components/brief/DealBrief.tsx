import React, { useEffect, useState } from 'react';
import { HOW_ASSUMPTIONS_WORK } from '../../lib/assumptions/howAssumptionsWork';
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
.brief .box { border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; margin-bottom: 10px; break-inside: avoid; page-break-inside: avoid; }
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
.brief .fine ul { margin: 0 0 0 0; padding-left: 16px; font-size: 9.5px; color: #475569; line-height: 1.45; }
.brief .fine p { font-size: 9px; color: #64748b; margin: 4px 0 0 0; line-height: 1.4; }
.brief .mc { padding: 10px 12px; }
.brief .mcg { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 8px; }
.brief .mct { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 5px; padding: 6px 9px; }
.brief .mct p { margin: 0; }
.brief .mct .l { font-size: 9.5px; color: #64748b; font-weight: 700; text-transform: uppercase; }
.brief .mct .v { font-size: 17px; font-weight: 800; margin-top: 2px; }
.brief .mcp { font-size: 10.5px; color: #334155; line-height: 1.4; margin: 0 0 6px 0; }
.brief .warn { border: 1px solid #fde68a; background: #fffbeb; border-radius: 6px; padding: 5px 12px; margin-bottom: 10px; break-inside: avoid; }
.brief .warn p { font-size: 10.5px; font-weight: 800; color: #92400e; text-transform: uppercase; margin: 0 0 1px 0; }
.brief .warn ul { margin: 0; padding-left: 16px; font-size: 10.5px; color: #78350f; line-height: 1.4; }
.brief .foot { border-top: 1px solid #cbd5e1; padding-top: 5px; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; margin-top: 10px; gap: 12px; }
.brief .toolbar { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 10px; }
.brief .btn { background: #059669; color: #fff; border: 0; border-radius: 6px; padding: 8px 16px; font-size: 13px; font-weight: 700; cursor: pointer; }
.brief .btn.alt2 { background: #e2e8f0; color: #0f172a; }
.brief .stop { display: flex; align-items: center; gap: 14px; border: 2px solid; border-radius: 8px; padding: 6px 14px; margin-bottom: 10px; break-inside: avoid; }
.brief .stopv { font-size: 22px; font-weight: 900; letter-spacing: -0.3px; }
.brief .stopt { font-size: 13.5px; font-weight: 600; color: #0f172a; margin-top: 3px; line-height: 1.4; }
.brief .stopm { font-size: 10px; color: #475569; margin-top: 3px; line-height: 1.45; }
.brief .keyt .tv { font-size: 17px; }
.brief .keyt .meta { font-size: 10px; margin-top: 2px; }
.brief .strip { display: grid; grid-template-columns: 1fr 1.3fr 1.5fr 1.4fr; gap: 0; border: 1px solid #cbd5e1; border-radius: 6px; margin-bottom: 10px; break-inside: avoid; }
.brief .strip > div { padding: 5px 10px; border-right: 1px solid #e2e8f0; font-size: 11px; line-height: 1.35; }
.brief .strip > div:last-child { border-right: 0; }
.brief .strip .k { display: block; font-size: 9px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.2px; }
.brief .notes { margin: 0; padding: 6px 10px 6px 26px; font-size: 10px; color: #334155; line-height: 1.45; }
div.notes { padding-left: 10px; }
.brief .notes ul.cols { margin: 0; padding-left: 14px; columns: 2; column-gap: 22px; font-size: 9px; color: #475569; }
.brief .notes ul.cols li { break-inside: avoid; margin-bottom: 2px; }
.brief .mcg > .mct, .brief .pf tr { break-inside: avoid; page-break-inside: avoid; }
.brief .src { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.brief .src table { font-size: 9.5px; line-height: 1.3; }
.brief .src td { padding: 2px 5px; vertical-align: top; }
.brief .mc table { font-size: 10.5px; }
.brief .mc th, .brief .mc td { padding: 2px 6px; }
.brief .mc .mct { margin-bottom: 6px; }
.brief .lrb { display: flex; align-items: center; gap: 8px; border: 1px solid; border-radius: 6px; padding: 5px 10px; margin-bottom: 10px; font-size: 11.5px; line-height: 1.35; break-inside: avoid; }
.brief .lrb .dot { width: 12px; height: 12px; border-radius: 50%; flex: none; }
.brief .napkin { break-inside: avoid; }
.brief .eqwrap { padding: 6px 10px 4px 10px; border-bottom: 1px solid #f1f5f9; }
.brief .eqwrap:last-child { border-bottom: 0; }
.brief .eqt { font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 3px; }
.brief .eqrow { display: flex; align-items: stretch; gap: 5px; }
.brief .eqb { flex: 1 1 0; min-width: 0; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 5px; padding: 4px 8px; }
.brief .eqb.strong { background: #ecfdf5; border-color: #a7f3d0; }
.brief .eqb .l { font-size: 9px; font-weight: 700; color: #64748b; text-transform: uppercase; }
.brief .eqb .v { font-size: 15.5px; font-weight: 800; margin-top: 1px; white-space: nowrap; }
.brief .eqb .s { font-size: 9px; color: #64748b; margin-top: 1px; line-height: 1.25; }
.brief .op { flex: none; align-self: center; font-size: 16px; font-weight: 800; color: #94a3b8; width: 14px; text-align: center; }
.brief .eqn { font-size: 10.5px; color: #92400e; margin-top: 3px; font-weight: 600; }
.brief .score.k5 { grid-template-columns: repeat(5, 1fr); }
.brief .nk { display: grid; grid-template-columns: repeat(3, 1fr); }
.brief .nkc { padding: 6px 12px 8px 12px; border-right: 1px solid #e2e8f0; }
.brief .nkc:last-child { border-right: 0; }
.brief .nkt { font-size: 10px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 2px; }
.brief .nkr { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; padding: 3px 0; border-bottom: 1px solid #f1f5f9; }
.brief .nkr .l { font-size: 11px; color: #334155; line-height: 1.25; }
.brief .nkr .n { font-size: 9px; color: #64748b; line-height: 1.25; }
.brief .nkr .v { font-size: 12.5px; font-weight: 800; white-space: nowrap; }
.brief .nkr.strong { border-bottom: 0; border-top: 1px solid #94a3b8; background: #f8fafc; margin-top: 1px; padding: 4px 4px; }
.brief .nkr.strong .l { font-weight: 800; color: #0f172a; }
.brief .nkr.strong .v { font-size: 14px; }
.brief .nkf { font-size: 10px; color: #92400e; font-weight: 600; margin-top: 4px; line-height: 1.35; }
.brief .clamp3 { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.brief .fine { break-inside: auto; page-break-inside: auto; }
.brief .fine ul.cols { columns: 2; column-gap: 24px; font-size: 9px; color: #475569; margin: 0 0 6px 0; padding-left: 16px; line-height: 1.4; }
.brief .fine ul.cols li { break-inside: avoid; margin-bottom: 2px; }
.brief .pf.dense th, .brief .pf.dense td { padding: 2px 5px; font-size: 9.5px; }
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
  const W = 1000, x0 = 40, x1 = 972, maxH = 44, gap = 5, laneH = 17, charW = 8.4;
  const lo = core[0].binStart, hi = core[core.length - 1].binEnd;
  const xOf = (v: number) => x0 + ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (x1 - x0);
  // Marker labels sit in their own lanes above the bars: a label that would touch its neighbour drops to the next lane
  const placed = markers.map((m) => {
    const w = m.label.length * charW + 10;
    const cx = Math.min(W - w / 2, Math.max(w / 2, xOf(m.value)));
    return { m, x: xOf(m.value), cx, w, lane: 0 };
  }).sort((u, v) => u.cx - v.cx);
  const laneEnds: number[] = [];
  placed.forEach((pl) => {
    let lane = laneEnds.findIndex((end) => end + 6 <= pl.cx - pl.w / 2);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = pl.cx + pl.w / 2;
    pl.lane = lane;
  });
  const topPad = 6 + Math.max(1, laneEnds.length) * laneH;
  const base = topPad + 20 + maxH;
  const H = base + 26;
  const bw = (x1 - x0 - (core.length - 1) * gap) / core.length;
  const maxShare = Math.max(...core.map((b) => b.count / runs));
  const edges = [...core.map((b) => b.binStart), hi];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={axisTitle}>
        <line x1={x0} y1={base} x2={x1} y2={base} stroke="#94a3b8" strokeWidth={1.5} />
        {core.map((b, i) => {
          const h = ((b.count / runs) / maxShare) * maxH;
          return <rect key={i} x={x0 + i * (bw + gap)} y={base - h} width={bw} height={h} rx={2} fill={tone(b)} opacity={0.9} />;
        })}
        {placed.map(({ m, x, lane }) => (
          <line key={m.label} x1={x} y1={6 + lane * laneH + 15} x2={x} y2={base} stroke={m.color} strokeWidth={2} strokeDasharray={m.dash ? '5 4' : undefined} />
        ))}
        {core.map((b, i) => {
          const share = b.count / runs;
          const h = (share / maxShare) * maxH;
          return share >= 0.005 ? (
            <text key={i} x={x0 + i * (bw + gap) + bw / 2} y={base - h - 5} fontSize={14} fontWeight="bold" fill="#334155" textAnchor="middle" stroke="#ffffff" strokeWidth={4} paintOrder="stroke">{`${Math.round(share * 100)}%`}</text>
          ) : null;
        })}
        {edges.map((v, i) => i % 2 === 0 && (
          <text key={i} x={xOf(v)} y={base + 18} fontSize={14} fill="#475569" textAnchor="middle">{fmt(v)}</text>
        ))}
        {placed.map(({ m, cx, w, lane }) => (
          <g key={m.label}>
            <rect x={cx - w / 2} y={6 + lane * laneH} width={w} height={15} rx={3} fill="#ffffff" stroke={m.color} strokeWidth={1} />
            <text x={cx} y={6 + lane * laneH + 12} fontSize={13} fontWeight="bold" fill={m.color} textAnchor="middle">{m.label}</text>
          </g>
        ))}
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
    // No inputs yet (the deal is still loading) or a page that does not show the simulation: nothing to run
    if (Object.keys(inputs).length === 0) return undefined;
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
    ...(mc.turnover.applies
      ? [{ name: 'Tenant turnover', base: `${mc.turnover.annualPct}% a year`, how: `Each move-out leaves the space empty about ${mc.turnover.downtimeDays} days and costs $${mc.turnover.makeReadyCost.toLocaleString()} to re-let; fixed-term tenants leave only after their lease ends`, range: `${mc.turnover.avgMoveOutsPerRun} move-outs per run; ${mc.turnover.impliedVacancyPct}% average vacancy vs ${mc.turnover.dealVacancyPct}% set` }]
      : []),  // turnover is simply absent for asset types it does not apply to
  ];

  return (
    <div className="box pg">
      <div className="bh" style={{ background: '#064e3b' }}>
        <span>🎲 Monte Carlo Simulation &amp; Risk Distribution ({mc.runs.toLocaleString()} Runs, {yrs}-Year Hold)</span>
        <span className="sub" style={{ color: '#a7f3d0' }}>Value-at-Risk &amp; Volatility Stress Audit</span>
      </div>
      <div className="mc">
        <p className="mcp">
          <strong>How sure is the light on page 1?</strong> The deal is re-run {mc.runs.toLocaleString()} times with the factors in the table below drawn at random around this deal's own inputs.
          {' '}{mc.probAboveHurdle}% of runs beat your {hurdle.toFixed(1)}% opportunity cost. P10 means 10% of runs did worse than this value, P50 is the middle run, P90 means only 10% did better.
          The page 1 return is the plan; the median here is the middle of the random runs, so the two can differ.
        </p>

        <div className="mcg">
          <div className="mct"><p className="l">P10 IRR (Downside)</p><p className="v" style={{ color: mc.p10Irr >= 0 ? '#d97706' : '#e11d48' }}>{mc.p10Irr.toFixed(1)}%</p></div>
          <div className="mct"><p className="l">P50 IRR (Median)</p><p className="v">{mc.p50Irr.toFixed(1)}%</p></div>
          <div className="mct"><p className="l">P90 IRR (Upside)</p><p className="v" style={{ color: '#059669' }}>{mc.p90Irr.toFixed(1)}%</p></div>
          <div className="mct"><p className="l">Runs Clearing {hurdle.toFixed(1)}% Hurdle</p><p className="v" style={{ color: '#047857' }}>{mc.probAboveHurdle}%</p></div>
          <div className="mct"><p className="l">Runs That Lose Money</p><p className="v" style={{ color: mc.profit.probLoss > 0 ? '#e11d48' : '#059669' }}>{mc.profit.probLoss}%</p></div>
        </div>

        <div className="mct" style={{ marginBottom: 6, padding: '5px 10px' }}>
          <p style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>Return (IRR) across {mc.runs.toLocaleString()} runs</p>
          <p style={{ fontSize: 11, color: '#475569', margin: '2px 0 4px 0', lineHeight: 1.45 }}>
            Annualized return on the {compact(mc.equity.cashInvested)} put in, over the {yrs}-year hold including the sale. Each bar is the share of runs in that range.
            {tight
              ? ` Tight spread (P5 ${fmtIrr(mc.p5Irr)} to P95 ${fmtIrr(mc.p95Irr)})${v.contractualRentFixed ? ' because most income is fixed by lease' : ''}.`
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

        <div className="mct" style={{ marginBottom: 6, padding: '5px 10px' }}>
          <p style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>Net profit in dollars over the {yrs}-year hold</p>
          <p style={{ fontSize: 11, color: '#475569', margin: '2px 0 4px 0', lineHeight: 1.45 }}>
            Every year's cash flow after debt service plus the equity left in year {yrs}, minus the {compact(mc.equity.cashInvested)} put in. Not discounted, before income tax.
            {mc.equity.thin ? ` Only ${mc.equity.pctOfPrice.toFixed(1)}% of the price is your own cash, so IRR swings widely and this dollar figure is the steadier measure.` : ''}
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
          σ is one standard deviation: about two-thirds of runs fall within ±1σ of the base case, 95% within ±2σ. Draws are bell-curve and independent; the same deal always prints the same charts.
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

  const stepX = usableW / rows.length; // each tier owns a slot, so bars never sit on the axis labels
  const pts = rows.map((r, i) => {
    const x = padL + (i + 0.5) * stepX;
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
  // The engine's own rows, read: the tier with the highest cash-on-cash and the first tier where it is not negative
  const bestPt = pts.find((pt) => pt.downPaymentPercent === m.leverageMarks.best?.downPaymentPercent);
  const crossRaw = pts.find((pt) => pt.downPaymentPercent === m.leverageMarks.firstNonNegativePercent);
  const crossPt = crossRaw && crossRaw !== pts[0] ? crossRaw : undefined; // only worth marking when some tier is negative

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
              <span style={{ color: '#64748b' }}>■ Annual Debt Service ($)</span>
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
              const barFill = pt.isBaseline ? '#60a5fa' : '#cbd5e1';
              return (
                <g key={`bar-${pt.downPaymentPercent}`}>
                  <rect
                    x={pt.x - barW / 2}
                    y={pt.barY}
                    width={barW}
                    height={pt.barH}
                    rx="3"
                    fill={barFill}
                    opacity="0.9"
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
                    y={pt.lineY < padT + 24 ? pt.lineY + 17 : pt === bestPt ? pt.lineY - 15 : pt.lineY - 7}
                    fill={ptColor}
                    fontSize="9.5"
                    fontWeight="bold"
                    textAnchor="middle"
                    fontFamily="sans-serif"
                    stroke="#ffffff" strokeWidth="3" paintOrder="stroke"
                  >
                    {pt.cashOnCash.toFixed(1)}%
                  </text>
                </g>
              );
            })}

            {/* Where cash-on-cash turns non-negative, and where it is highest */}
            {crossPt && (
              <g>
                <line x1={crossPt.x} y1={padT} x2={crossPt.x} y2={padT + usableH} stroke="#7c3aed" strokeWidth="1.5" strokeDasharray="2 3" />
                <rect x={crossPt.x - 62} y={padT + usableH - 17} width="124" height="14" rx="3" fill="#f5f3ff" stroke="#7c3aed" strokeWidth="1" />
                <text x={crossPt.x} y={padT + usableH - 7} fill="#6d28d9" fontSize="9" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">
                  Cash-on-cash turns positive at {crossPt.downPaymentPercent}%
                </text>
              </g>
            )}
            {bestPt && (
              <g>
                <circle cx={bestPt.x} cy={bestPt.lineY} r="10" fill="none" stroke="#f59e0b" strokeWidth="2.5" />
                <rect x={Math.min(bestPt.x, W - 58) - 52} y={bestPt.lineY + (bestPt.lineY < padT + 24 ? 24 : 14)} width="104" height="14" rx="3" fill="#fffbeb" stroke="#f59e0b" strokeWidth="1" />
                <text x={Math.min(bestPt.x, W - 58)} y={bestPt.lineY + (bestPt.lineY < padT + 24 ? 34 : 24)} fill="#b45309" fontSize="9" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">
                  Highest: {bestPt.cashOnCash.toFixed(1)}% at {bestPt.downPaymentPercent}%
                </text>
              </g>
            )}
          </svg>
          {bestPt && (
            <p style={{ fontSize: 11, color: '#334155', margin: '6px 0 0 0', lineHeight: 1.45 }}>
              <strong>Where cash-on-cash is maximized:</strong> {bestPt.cashOnCash.toFixed(2)}% at {bestPt.downPaymentPercent}% down ({cur(bestPt.initialCashInvested)} of equity).
              {bestPt.isBaseline
                ? ' That is the structure underwritten here.'
                : ` The underwritten ${m.downPaymentPct.toFixed(0)}% down earns ${(baselinePt?.cashOnCash ?? 0).toFixed(2)}%.`}
              {crossPt
                ? crossPt.downPaymentPercent === rows[0].downPaymentPercent
                  ? ' Cash-on-cash is not negative at any tier shown.'
                  : ` Cash-on-cash is negative below ${crossPt.downPaymentPercent}% down.`
                : ' Cash-on-cash is negative at every tier shown.'}
            </p>
          )}
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

const LIGHT_STYLE: Record<'green' | 'yellow' | 'red', { fg: string; bg: string; border: string; word: string }> = {
  green: { fg: '#059669', bg: '#ecfdf5', border: '#a7f3d0', word: 'GREEN' },
  yellow: { fg: '#d97706', bg: '#fffbeb', border: '#fde68a', word: 'YELLOW' },
  red: { fg: '#e11d48', bg: '#fff1f2', border: '#fecdd3', word: 'RED' },
};

/** "Does it make money?": the yield on the whole cost against the owner's opportunity cost, capped by whether the income covers the loan. */
const StoplightBanner: React.FC<{ m: BriefModel }> = ({ m }) => {
  const v = m.napkinVerdict;
  const c = LIGHT_STYLE[v.light];
  const lamps: Array<['red' | 'yellow' | 'green', string]> = [['red', '#e11d48'], ['yellow', '#f59e0b'], ['green', '#10b981']];
  return (
    <div className="stop" style={{ background: c.bg, borderColor: c.border }} role="group" aria-label={`Does it make money: ${c.word.toLowerCase()}. ${v.verdict}`}>
      <svg width="34" height="80" viewBox="0 0 44 104" aria-hidden="true" style={{ flex: 'none' }}>
        <rect x="2" y="2" width="40" height="100" rx="10" fill="#0f172a" />
        {lamps.map(([name, col], i) => (
          <circle key={name} cx="22" cy={20 + i * 32} r="11" fill={name === v.light ? col : '#334155'} opacity={name === v.light ? 1 : 0.55} />
        ))}
      </svg>
      <div style={{ flex: 1 }}>
        <div className="stopv" style={{ color: c.fg }}>{v.verdict}</div>
        <div className="stopt">{v.headline}</div>
        <div className="stopm">
          Green: yield {v.bandPoints}+ point above your opportunity cost. Yellow: within {v.bandPoints} point. Red: more than {v.bandPoints} point below, or the income does not cover the loan payment.
        </div>
      </div>
    </div>
  );
};

/** The 10-year view, one slim line: the annualized IRR against the opportunity cost, and how often the stress test agrees. */
const LongRunBar: React.FC<{ m: BriefModel; mc: MonteCarloResult | null }> = ({ m, mc }) => {
  const s = m.stoplight;
  const c = LIGHT_STYLE[s.light];
  return (
    <div className="lrb" style={{ background: c.bg, borderColor: c.border }}>
      <span className="dot" style={{ background: c.fg }} aria-hidden="true" />
      <span><strong style={{ color: c.fg }}>Over {m.holdYears} years: {s.verdict.toLowerCase()}.</strong> {pct(s.irr)} annualized IRR against your {s.opportunityCost.toFixed(1)}% opportunity cost ({s.spreadPoints >= 0 ? '+' : '-'}{Math.abs(s.spreadPoints).toFixed(2)} pts, band ±{s.bandPoints}).
        {mc ? ` ${mc.probAboveHurdle}% of ${mc.runs.toLocaleString()} stress-test runs beat it.` : ''}</span>
    </div>
  );
};

type NkRow = { label: string; value: string; note?: string; color?: string; strong?: boolean };

const NkCard: React.FC<{ title: string; rows: NkRow[]; foot?: string }> = ({ title, rows, foot }) => (
  <div className="nkc">
    <div className="nkt">{title}</div>
    {rows.map((row, i) => (
      <div key={i} className={`nkr${row.strong ? ' strong' : ''}`}>
        <div className="lbl"><div className="l">{row.label}</div>{row.note && <div className="n">{row.note}</div>}</div>
        <div className="v" style={{ color: row.color }}>{row.value}</div>
      </div>
    ))}
    {foot && <div className="nkf">{foot}</div>}
  </div>
);

/**
 * The back-of-the-napkin math every investor starts with, as a plain statement in three columns: what it earns, what it cost, and whether it pays
 * for itself. Every figure is the pro forma's first full year, and every fact stated (units, tenant, rent as signed) is one the deal itself states.
 */
export const NapkinMath: React.FC<{ m: BriefModel; lender?: boolean }> = ({ m, lender = false }) => {
  const k = m.napkin;
  const v = m.napkinVerdict;
  const light = LIGHT_STYLE[v.light].fg;
  const monthly = (n: number) => `${cur(n)}/mo`;

  const earns: NkRow[] = [];
  if (k.units && k.avgRentMonthly !== null) {
    if (k.units.label === 'unit') earns.push({ label: 'Units', value: k.units.count.toLocaleString() });
    const grew = k.enteredRentMonthly !== null && Math.abs(k.enteredRentMonthly - k.avgRentMonthly) >= 0.5;
    earns.push({
      label: k.units.label === 'home' ? 'Monthly rent' : 'Average rent per unit',
      note: grew ? `You entered ${cur(k.enteredRentMonthly!)}; ${k.basisYear} is after rent growth` : undefined,
      value: monthly(k.avgRentMonthly),
    });
  }
  earns.push(
    { label: 'Rent for the year', note: k.units ? `${k.basisYear}, the first full year` : `${monthly(k.grossRentMonthly)} on average, ${k.basisYear}, the first full year`, value: cur(k.grossRentAnnual) },
    { label: 'Less vacancy', note: `${pctShort(m.vacancyPct)}% of rent`, value: cur(k.vacancyLoss), color: '#e11d48' },
    { label: 'Less operating expenses', note: `${pctShort(m.expenseRatioPct)}% of rent`, value: cur(k.operatingExpenses), color: '#64748b' },
    { label: 'Net operating income', note: 'what is left', value: cur(k.noi), strong: true },
  );

  const cost: NkRow[] = [{ label: 'Purchase price', value: cur(k.purchasePrice) }];
  if (k.rehabCosts + k.closingCosts > 0) cost.push({ label: 'Rehab and closing', value: cur(k.rehabCosts + k.closingCosts) });
  cost.push({ label: 'Total cost to buy', value: cur(k.totalCost), strong: true });
  cost.push({ label: 'Yield on cost', note: 'net operating income over total cost', value: k.yieldOnCostPct !== null ? pct(k.yieldOnCostPct) : 'N/A', color: lender ? undefined : light, strong: true });
  if (!lender) cost.push({ label: 'Your opportunity cost', value: `${v.opportunityCost.toFixed(1)}%`, color: '#64748b' });
  if (k.loanConstantPct !== null) cost.push({ label: 'What the loan costs', note: `${m.interestRate}% over ${m.loanTerm} years, ${cur(k.loanAmount)} borrowed`, value: pct(k.loanConstantPct), color: k.leverage === 'negative' ? '#e11d48' : undefined });
  const leverageNote = k.leverage === 'negative'
    ? 'The loan costs more than the property yields, so borrowing lowers the return.'
    : k.leverage === 'positive' ? 'The property yields more than the loan costs, so borrowing raises the return.' : undefined;

  const pays: NkRow[] = [{ label: 'Net operating income', value: cur(k.noi) }];
  if (k.debtService > 0) pays.push({ label: 'Less loan payments', note: monthly(k.debtService / 12), value: cur(k.debtService), color: '#64748b' });
  if (k.replacementReserve > 0) pays.push({ label: 'Less reserves', note: 'set aside for repairs', value: cur(k.replacementReserve), color: '#64748b' });
  if (k.otherCash !== 0) pays.push({ label: 'Less renovation paid in cash', value: cur(k.otherCash), color: '#64748b' });
  pays.push({ label: 'Cash flow a year', note: monthly(k.cashFlow / 12), value: cur(k.cashFlow), color: k.cashFlow >= 0 ? '#059669' : '#e11d48', strong: true });
  if (k.dscr !== null) pays.push({ label: 'Loan coverage', note: 'income over loan payments', value: `${k.dscr.toFixed(2)}x`, color: dscrColor(k.dscr) });

  return (
    <div className="box napkin">
      <div className="bh"><span>The back-of-the-napkin math</span><span className="sub">First full year{k.basisYear ? `, ${k.basisYear}` : ''}: the same figures as the pro forma</span></div>
      <div className="nk">
        <NkCard title="1. What it earns" rows={earns} />
        <NkCard title="2. What it cost, and the yield" rows={cost} foot={leverageNote} />
        <NkCard title="3. Whether it pays for itself" rows={pays} />
      </div>
    </div>
  );
};

interface Series { name: string; color: string; values: number[]; kind: 'bar' | 'line'; barColors?: string[] }

/** A compact year-by-year chart under the pro forma: bars and lines on one axis, an optional reference line, end labels. */
function YearChart({ title, takeaway, years, series, refLine, fmt }: {
  title: string; takeaway: string; years: string[]; series: Series[]; refLine?: { value: number; label: string }; fmt: (v: number) => string;
}) {
  const W = 360, H = 150, l = 44, r = 8, t = 10, b = 22;
  const all = series.flatMap((s) => s.values).concat(refLine ? [refLine.value] : []).concat([0]);
  const lo = Math.min(...all), hi = Math.max(...all);
  const span = hi - lo || 1;
  const y = (v: number) => t + (1 - (v - lo) / span) * (H - t - b);
  const n = years.length;
  const slot = (W - l - r) / n;
  const x = (i: number) => l + slot * (i + 0.5);
  const bars = series.filter((s) => s.kind === 'bar');
  const bw = Math.min(22, slot * 0.62 / Math.max(1, bars.length));
  return (
    <div className="mct" style={{ padding: '7px 9px' }}>
      <p style={{ fontSize: 11.5, fontWeight: 800, color: '#0f172a' }}>{title}</p>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={title}>
        {[0, 0.5, 1].map((f) => {
          const v = lo + span * f;
          return <g key={f}><line x1={l} y1={y(v)} x2={W - r} y2={y(v)} stroke="#e2e8f0" strokeDasharray="3 3" /><text x={l - 4} y={y(v) + 3} fontSize="9" fill="#64748b" textAnchor="end">{fmt(v)}</text></g>;
        })}
        {lo < 0 && <line x1={l} y1={y(0)} x2={W - r} y2={y(0)} stroke="#94a3b8" />}
        {bars.map((s, si) => s.values.map((v, i) => (
          <rect key={`${s.name}${i}`} x={x(i) - (bw * bars.length) / 2 + si * bw} y={Math.min(y(v), y(0))} width={bw - 1} height={Math.max(1, Math.abs(y(v) - y(0)))} rx="1.5" fill={s.barColors?.[i] ?? s.color} opacity="0.9" />
        )))}
        {refLine && (
          <g>
            <line x1={l} y1={y(refLine.value)} x2={W - r} y2={y(refLine.value)} stroke="#7c3aed" strokeWidth="1.5" strokeDasharray="5 3" />
            <text x={W - r} y={y(refLine.value) - 3} fontSize="9" fontWeight="bold" fill="#6d28d9" textAnchor="end" stroke="#ffffff" strokeWidth="3" paintOrder="stroke">{refLine.label}</text>
          </g>
        )}
        {series.filter((s) => s.kind === 'line').map((s) => (
          <g key={s.name}>
            <path d={s.values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="2.2" strokeLinejoin="round" />
            <circle cx={x(n - 1)} cy={y(s.values[n - 1])} r="3" fill={s.color} />
          </g>
        ))}
        {years.map((yr, i) => (i % 2 === 0 || n <= 6) && <text key={yr + i} x={x(i)} y={H - 7} fontSize="9" fill="#475569" textAnchor="middle">{yr}</text>)}
      </svg>
      <div style={{ display: 'flex', gap: 10, fontSize: 9.5, fontWeight: 700, margin: '2px 0 3px 0', flexWrap: 'wrap' }}>
        {series.map((s) => <span key={s.name} style={{ color: s.color }}>{s.kind === 'bar' ? '■' : '●'} {s.name}</span>)}
      </div>
      <p style={{ fontSize: 10.5, color: '#334155', lineHeight: 1.4 }}>{takeaway}</p>
    </div>
  );
}

/** The three figures that defend the pro forma: does income cover the loan, how thick is the cushion, what does the equity grow to. */
const ProFormaCharts: React.FC<{ m: BriefModel }> = ({ m }) => {
  const rows = m.proj as any[];
  if (rows.length < 2) return null;
  const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const years = rows.map((p, i) => String(p.calendarYear || m.startYear + (p.year || i + 1) - 1));
  const noi = rows.map((p) => num(p.netOperatingIncome));
  const ds = rows.map((p) => num(p.debtService));
  const dscr = rows.map((p) => (p.dscr === null || p.dscr === undefined ? 0 : num(p.dscr)));
  const firstCover = noi.findIndex((v, i) => ds[i] > 0 && v >= ds[i]);
  const covers = ds[0] === 0 ? 'There is no debt, so every dollar of income is the owner\'s.' : firstCover === 0
    ? 'Net operating income covers the loan payment from the first year.'
    : firstCover > 0 ? `Net operating income first covers the loan payment in ${years[firstCover]}; before that the owner tops up the difference.`
      : 'Net operating income does not cover the loan payment in any year of the hold.';
  const best = dscr.reduce((bi, v, i) => (v > dscr[bi] ? i : bi), 0);
  const firstOk = dscr.findIndex((v) => v >= 1.25);
  const cushion = firstOk >= 0 ? `Coverage reaches the 1.25x lender minimum in ${years[firstOk]}.` : `Coverage peaks at ${dscr[best].toFixed(2)}x in ${years[best]}, below the 1.25x lender minimum.`;
  const eq = rows.map((p) => num(p.equity));
  const value = rows.map((p) => num(p.propertyValue));
  const loan = rows.map((p) => num(p.loanBalanceRemaining ?? p.endingLoanBalance));
  const last = rows.length - 1;
  return (
    <div className="mcg" style={{ gridTemplateColumns: 'repeat(3, 1fr)', padding: '10px 10px 2px 10px', marginBottom: 0, breakInside: 'avoid', pageBreakInside: 'avoid' }}>
      <YearChart
        title="Does the income cover the loan?" years={years} fmt={compact}
        series={[{ name: 'Net operating income', color: '#059669', values: noi, kind: 'bar' }, { name: 'Debt service', color: '#0f172a', values: ds, kind: 'line' }]}
        takeaway={covers}
      />
      <YearChart
        title="How thick is the lender's cushion?" years={years} fmt={(v) => `${v.toFixed(1)}x`}
        series={[{ name: 'Debt service coverage', color: '#0284c7', values: dscr, kind: 'bar', barColors: dscr.map((v) => (v >= 1.25 ? '#059669' : v >= 1 ? '#d97706' : '#e11d48')) }]}
        refLine={{ value: 1.25, label: '1.25x minimum' }}
        takeaway={cushion}
      />
      <YearChart
        title="What does the equity grow to?" years={years} fmt={compact}
        series={[{ name: 'Property value', color: '#64748b', values: value, kind: 'line' }, { name: 'Loan balance', color: '#e11d48', values: loan, kind: 'line' }, { name: 'Your equity', color: '#059669', values: eq, kind: 'line' }]}
        takeaway={`Equity grows from ${cur(eq[0])} in ${years[0]} to ${cur(eq[last])} in ${years[last]} as the loan is paid down and the property appreciates.`}
      />
    </div>
  );
};

/** What a reader should know that does not belong in the headline: how the pro forma was built, and what the records show. */
const NotesBox: React.FC<{ m: BriefModel }> = ({ m }) => {
  const notes: Array<{ title: string; text: string }> = [];
  if (m.parcels.length > 1) notes.push({ title: 'Multi-parcel package', text: `${m.parcels.length} county parcels are underwritten together with ${cur(m.parcelTotals.assessed)} of combined assessed value on ${m.parcelTotals.acres.toFixed(2)} acres.` });
  if (m.rentVarianceMonthly !== null && Math.abs(m.rentVarianceMonthly) >= 0.5) notes.push({ title: 'Rent roll against underwriting', text: `The in-place rent roll is ${cur(m.rentRollMonthly)}/mo against ${cur(m.monthlyRent)}/mo underwritten (${m.rentVarianceMonthly >= 0 ? '+' : '-'}${cur(Math.abs(m.rentVarianceMonthly))}/mo).` });
  if (m.isProrated) notes.push({ title: 'Partial first year', text: `Year 1 holds ${Number(m.p0.operatingMonths)} months of operation. Cap rate and coverage on page 1 are read from the first full year.` });
  if (notes.length === 0) return null;
  return (
    <div className="box split">
      <div className="bh"><span>Notes</span><span className="sub">What the records show</span></div>
      {notes.length > 0 && <ul className="notes">{notes.map((n) => <li key={n.title}><strong>{n.title}.</strong> {n.text}</li>)}</ul>}
    </div>
  );
};

/** Where every figure comes from, in two columns so the page stays short. */
const SourcesTable: React.FC<{ m: BriefModel }> = ({ m }) => {
  if (m.figureSources.length === 0) return null;
  const half = Math.ceil(m.figureSources.length / 2);
  const cols = [m.figureSources.slice(0, half), m.figureSources.slice(half)];
  return (
    <div className="box">
      <div className="bh"><span>Where the numbers come from</span><span className="sub">Each figure above, and whether it is a document, your entry, your profile or the county record</span></div>
      <div className="src">
        {cols.map((rows, ci) => (
          <table key={ci}>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td style={{ fontWeight: 700, width: '30%' }}>{r.label}</td>
                  <td style={{ width: '26%' }}>{r.value}</td>
                  <td style={{ color: '#475569' }}>{r.source}{r.reason ? <span style={{ color: '#64748b', fontStyle: 'italic' }}> {'—'} {r.reason}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </div>
  );
};


export const DealBrief: React.FC<{ model: BriefModel; monteCarlo: MonteCarloResult | null; onPrint?: () => void; onClose?: () => void }> = ({ model: m, monteCarlo, onPrint, onClose }) => {
  const multi = m.parcels.length > 1;
  const stab = m.isProrated ? 'Stabilized' : 'Year 1';
  const dscrLabel = m.isProrated ? 'Stabilized DSCR' : 'Senior DSCR';
  const dpLine = m.rehabMode === 'roll_into_loan'
    ? `${cur(m.downPaymentAmt)} Down Payment (${pctShort(m.downPaymentPct)}% LTC); ${cur(m.rehabCosts + m.closingCosts)} rehab & closing financed`
    : `${cur(m.downPaymentAmt)} Down (${pctShort(m.downPaymentPct)}%) + ${cur(m.rehabCosts + m.closingCosts)} rehab & closing`;
  // The headline is the rent the user entered; the model's annual figure is a first-full-year average that includes escalations
  const enteredRent = m.underwritingLeases.reduce((s, l) => s + l.monthlyRent, 0);
  const showEnteredRent = enteredRent > 0 && Math.abs(enteredRent - m.monthlyRent) >= 0.5;

  const rentBuild = (m.proj as any[]).filter((p) => p.methodologyFootnote);

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

      {/* PAGE 1: executive summary. The light, the headline numbers, the key terms, the county record, the flags */}
      <div className="hdr">
        <div>
          <div className="row">
            <span className="logo">MathTree</span>
            <span className={`pill ${m.status === 'owned' ? 'pill-green' : 'pill-blue'}`}>{m.status === 'owned' ? '🏛️ Owned Operating Asset' : '🎯 Pipeline Prospect'}</span>
          </div>
          <h1>{m.title}</h1>
          <div className="row hmeta">
            <span>📍 <strong>{orNP(m.location)}</strong></span>
          </div>
        </div>
        <div className="hside">
          <div>Report Date: <strong style={{ color: '#0f172a' }}>{m.dateStr}</strong></div>
          <div>Target Hold Period: <strong style={{ color: '#0f172a' }}>{m.holdYears} Years</strong></div>
          <div>Settlement Closing: <strong style={{ color: '#059669' }}>{m.closingDate ?? `${m.startYear} Full Calendar Year`}</strong></div>
        </div>
      </div>

      <StoplightBanner m={m} />

      <NapkinMath m={m} />

      <LongRunBar m={m} mc={monteCarlo} />

      <div className="score keyt k5">
        <div className="tile"><p className="tl">{m.holdYears}-Yr IRR, annualized</p><p className="tv" style={{ color: LIGHT_STYLE[m.stoplight.light].fg }}>{pct(m.irr)}</p></div>
        <div className="tile"><p className="tl">Equity Multiplier</p><p className="tv">{m.equityMultiple.toFixed(2)}x</p><div className="meta">{cur(m.equity)} in, over {m.holdYears} years</div></div>
        <div className="tile"><p className="tl">Cash Required</p><p className="tv" style={{ color: '#0284c7' }}>{cur(m.equity)}</p><div className="meta">{dpLine}</div></div>
        <div className="tile"><p className="tl">Financing</p><p className="tv">{cur(m.loanAmt)}</p><div className="meta">{pctShort(m.ltvPct)}% {m.rehabMode === 'roll_into_loan' ? 'LTC' : 'LTV'} • {m.interestRate}% • {m.loanTerm} yrs</div></div>
        <div className="tile"><p className="tl">Hold &amp; Exit</p><p className="tv">{m.holdYears}<small> yrs • {m.exitCapRate}% exit cap</small></p><div className="meta">{m.closingDate ? `Closing ${m.closingDate}` : `Full calendar year ${m.startYear}`}</div></div>
      </div>

      {m.warnings.length > 0 && (
        <div className="warn">
          <p>Deal Risk &amp; Underwriting Audit Flags</p>
          <ul>{m.warnings.map((w, i) => <li key={i}><strong>{w.title}:</strong> {w.description}</li>)}</ul>
        </div>
      )}

      {/* PAGE 2: pro-forma, the figures that defend it, then where every number came from */}
      <div className={`box split pf pg${m.proj.length > 18 ? ' dense' : ''}`}>
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
        <ProFormaCharts m={m} />
      </div>

      {/* PAGE 3: where the numbers come from, and the notes on how the pro forma was built */}
      <div className="pg">
        <SourcesTable m={m} />
        <NotesBox m={m} />
      </div>

      {/* PAGE 3: where cash-on-cash is maximized */}
      <DownPaymentSection m={m} />

      {/* PAGE 4: Monte Carlo */}
      <MonteCarloSection m={m} mc={monteCarlo} />

      {/* LAST PAGES: the records behind the numbers, then the disclosures */}
      <div className="pg">
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
                <td className="k" style={{ width: '12%' }}>Owner of Record</td><td style={{ width: '20%', fontWeight: 700 }}>{orNP(m.owner)}</td>
                <td className="k" style={{ width: '12%' }}>Zoning &amp; Land Use</td><td style={{ width: '24%', fontWeight: 600 }}>{orNP(m.zoning)} • {orNP(m.useCode)}</td>
                <td className="k" style={{ width: '12%' }}>Structural Specs</td>
                <td style={{ fontWeight: 600 }}>
                  {[m.yearBuilt ? `Built ${m.yearBuilt}` : null, m.buildingSqFt > 0 ? `${m.buildingSqFt.toLocaleString()} Sq Ft` : null, m.stories ? `${m.stories} Story` : null, m.construction].filter(Boolean).join(' • ') || NP}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* A prospect has no operating rent roll to show; an owned property does */}
        {(!m.isPipeline || m.rentRoll.length > 0) && (
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
        )}
      </div>

      {/* LAST: methodology and diligence provenance, as fine print */}
      <div className="fine">
        <h3>Methodology, Diligence Provenance &amp; Disclosures</h3>
        <ol>
          {disclosures.map((d) => <li key={d.title}><strong>{d.title}.</strong> {d.text}</li>)}
        </ol>
        {rentBuild.length > 0 && (
          <>
            <h3>How the rent schedule was built, year by year</h3>
            <ul className="cols">{rentBuild.map((p: any, i: number) => <li key={i}><strong>Yr {p.year} ({p.calendarYear || m.startYear + p.year - 1}):</strong> {p.methodologyFootnote}</li>)}</ul>
          </>
        )}
        <h3>How the assumptions work</h3>
        <ul>
          {HOW_ASSUMPTIONS_WORK.map((s) => <li key={s.title}><strong>{s.title}.</strong> {s.points.join(' ')}</li>)}
        </ul>
        <p>Figures in this brief are computed from the deal's recorded inputs, its in-place rent roll and linked county parcels. Provenance statements describe how each figure was derived and are not independently verified.</p>
      </div>

      <div className="foot">
        <span>MathTree Real Estate Underwriting Platform • Computed from live deal data</span>
        <span>Confidential Investment Memo • {dscrLabel}: {m.dscrFormatted} • Generated {m.dateStr}</span>
      </div>
    </div>
  );
};
