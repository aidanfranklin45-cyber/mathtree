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

export const BRIEF_CSS = `
@page { size: letter landscape; margin: 7mm 9mm; }
.brief { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; color: #0f172a; background: #ffffff; padding: 14px 18px; max-width: 1180px; margin: 0 auto; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.brief * { box-sizing: border-box; }
.brief .hdr { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2.5px solid #059669; padding-bottom: 6px; margin-bottom: 8px; }
.brief .logo { font-size: 18px; font-weight: 900; color: #059669; letter-spacing: -0.5px; }
.brief .pill { display: inline-block; font-size: 8px; font-weight: 800; padding: 1px 6px; border-radius: 4px; text-transform: uppercase; }
.brief .pill-green { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
.brief .pill-blue { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
.brief .pill-slate { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; }
.brief .row { display: flex; align-items: center; gap: 6px; }
.brief .score { display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; margin-bottom: 8px; }
.brief .tile { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 5px; padding: 5px 7px; }
.brief .tl { font-size: 7px; font-weight: 700; color: #64748b; text-transform: uppercase; margin: 0; }
.brief .tv { font-size: 13px; font-weight: 800; margin: 2px 0 0 0; }
.brief .tv small { font-size: 8px; color: #64748b; font-weight: 400; }
.brief .box { border: 1px solid #cbd5e1; border-radius: 5px; overflow: hidden; margin-bottom: 8px; break-inside: avoid; page-break-inside: avoid; }
.brief .bh { background: #0f172a; color: #fff; padding: 4px 8px; font-size: 8.5px; font-weight: 800; text-transform: uppercase; display: flex; justify-content: space-between; align-items: center; letter-spacing: 0.3px; }
.brief .bh .sub { font-size: 8px; color: #34d399; }
.brief table { width: 100%; font-size: 8px; border-collapse: collapse; line-height: 1.35; }
.brief th { background: #f1f5f9; border-bottom: 1px solid #cbd5e1; font-weight: 800; color: #1e293b; padding: 3px 5px; text-align: left; }
.brief td { padding: 3.5px 5px; border-bottom: 1px solid #f1f5f9; }
.brief .num { text-align: right; }
.brief .k { color: #64748b; font-weight: 700; }
.brief .mono { font-family: monospace; font-weight: 700; color: #047857; }
.brief .tot td { background: #ecfdf5; font-weight: 800; border-top: 1px solid #a7f3d0; }
.brief .lab { font-size: 8px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.3px; }
.brief .big { font-size: 13.5px; font-weight: 900; letter-spacing: -0.3px; }
.brief .meta { font-size: 8px; color: #334155; margin-top: 2px; }
.brief .prov { color: #334155; font-size: 8px; line-height: 1.35; vertical-align: middle; padding: 5px 6px; }
.brief .alt td { background: #f8fafc; }
.brief .mc { padding: 6px 8px; }
.brief .mcg { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; margin-bottom: 5px; }
.brief .mct { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 4px 6px; }
.brief .mct p { margin: 0; }
.brief .mct .l { font-size: 7px; color: #64748b; font-weight: 700; text-transform: uppercase; }
.brief .mct .v { font-size: 11px; font-weight: 800; margin-top: 1px; }
.brief .warn { border: 1px solid #fde68a; background: #fffbeb; border-radius: 5px; padding: 5px 8px; margin-bottom: 8px; }
.brief .warn p { font-size: 8px; font-weight: 800; color: #92400e; text-transform: uppercase; margin: 0 0 2px 0; }
.brief .warn ul { margin: 0; padding-left: 12px; font-size: 7.5px; color: #78350f; line-height: 1.3; }
.brief .foot { border-top: 1px solid #cbd5e1; padding-top: 4px; display: flex; justify-content: space-between; font-size: 7.5px; color: #94a3b8; margin-top: 8px; }
.brief .toolbar { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 8px; }
.brief .btn { background: #059669; color: #fff; border: 0; border-radius: 6px; padding: 7px 14px; font-size: 12px; font-weight: 700; cursor: pointer; }
.brief .btn.alt2 { background: #e2e8f0; color: #0f172a; }
@media print { .brief { padding: 0; max-width: none; } .brief .toolbar { display: none; } }
@media (max-width: 900px) { .brief .score { grid-template-columns: repeat(3, 1fr); } .brief { overflow-x: auto; } }
`;

function Histogram({ bins, label, tone }: { bins: MonteCarloHistogramBin[]; label: (b: MonteCarloHistogramBin) => string; tone: (b: MonteCarloHistogramBin) => string }) {
  const W = 540, H = 65, gap = 3;
  const n = Math.max(1, bins.length);
  const bw = (W - (n - 1) * gap) / n;
  const max = Math.max(1, ...bins.map((b) => b.count));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, overflow: 'visible' }}>
      {bins.map((b, i) => {
        const h = (b.count / max) * 40;
        const x = i * (bw + gap);
        const y = 46 - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={h} rx={2} fill={tone(b)} opacity={0.9} />
            <text x={x + bw / 2} y={57} fontSize={6} fill="#64748b" textAnchor="middle">{i % 2 === 0 ? label(b) : ''}</text>
            <text x={x + bw / 2} y={Math.max(7, y - 2)} fontSize={5.5} fontWeight="bold" fill="#334155" textAnchor="middle">{b.count}</text>
          </g>
        );
      })}
    </svg>
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
      <div className="box">
        <div className="bh" style={{ background: '#064e3b' }}><span>🎲 Stochastic Monte Carlo Simulation &amp; Risk Distribution</span><span className="sub">Running 1,000 trials…</span></div>
        <div className="mc"><p style={{ fontSize: 9, color: '#64748b', margin: 0 }}>Simulating…</p></div>
      </div>
    );
  }
  const hurdle = m.discountRate;
  const td = mc.tenantDefault;
  const tenantText = td.applies ? `a ${td.probabilityPct}% chance that a tenant stops paying for ${td.downtimeMonths} months (it occurred in ${td.runsAffectedPct}% of runs)` : 'no tenant-default risk applied';
  return (
    <div className="box">
      <div className="bh" style={{ background: '#064e3b' }}>
        <span>🎲 Stochastic Monte Carlo Simulation &amp; Risk Distribution ({mc.runs.toLocaleString()} Runs)</span>
        <span className="sub" style={{ color: '#a7f3d0' }}>Value-at-Risk (VaR) &amp; Volatility Stress Audit</span>
      </div>
      <div className="mc">
        <div className="mcg">
          <div className="mct"><p className="l">P10 (Downside Floor)</p><p className="v" style={{ color: mc.p10Irr >= 0 ? '#d97706' : '#e11d48' }}>{mc.p10Irr.toFixed(1)}% IRR</p></div>
          <div className="mct"><p className="l">P50 (Median Expected)</p><p className="v">{mc.p50Irr.toFixed(1)}% IRR</p></div>
          <div className="mct"><p className="l">P90 (Upside Scenario)</p><p className="v" style={{ color: '#059669' }}>{mc.p90Irr.toFixed(1)}% IRR</p></div>
          <div className="mct"><p className="l">Hurdle Beat Probability</p><p className="v" style={{ color: '#047857' }}>{mc.probAboveHurdle}% (≥{hurdle.toFixed(1)}%)</p></div>
          <div className="mct"><p className="l">Capital Loss Risk</p><p className="v" style={{ color: mc.probNegativeIrr > 0 ? '#e11d48' : '#059669' }}>{mc.probNegativeIrr}% (&lt;0% IRR)</p></div>
        </div>
        <div className="mcg">
          <div className="mct"><p className="l">Net Profit P10 (Downside)</p><p className="v" style={{ color: mc.profit.p10 >= 0 ? '#d97706' : '#e11d48' }}>{compact(mc.profit.p10)}</p></div>
          <div className="mct"><p className="l">Net Profit P50 (Median)</p><p className="v">{compact(mc.profit.median)}</p></div>
          <div className="mct"><p className="l">Net Profit P90 (Upside)</p><p className="v" style={{ color: '#059669' }}>{compact(mc.profit.p90)}</p></div>
          <div className="mct"><p className="l">Chance of Losing Money</p><p className="v" style={{ color: mc.profit.probLoss > 0 ? '#e11d48' : '#059669' }}>{mc.profit.probLoss}% (profit &lt; $0)</p></div>
          <div className="mct"><p className="l">Tenant Default Risk</p><p className="v" style={{ color: '#475569' }}>{td.applies ? 'Included' : 'None applied'}</p></div>
        </div>
        <div className="mct" style={{ marginBottom: 5 }}>
          <p className="l" style={{ marginBottom: 2 }}>IRR distribution</p>
          <Histogram bins={mc.histogramBins} label={(b) => `${Math.round(b.binStart)}%`} tone={(b) => (b.binEnd < 0 ? '#e11d48' : b.binEnd < hurdle ? '#d97706' : '#059669')} />
        </div>
        <div className="mct" style={{ marginBottom: 5 }}>
          <p className="l" style={{ marginBottom: 2 }}>Net profit distribution ($)</p>
          <Histogram bins={mc.profit.histogramBins} label={(b) => compact(b.binStart)} tone={(b) => (b.binEnd < 0 ? '#e11d48' : '#059669')} />
        </div>
        <p style={{ fontSize: 7.5, color: '#334155', lineHeight: 1.4, margin: 0 }}>
          Simulation of {mc.runs.toLocaleString()} randomized economic runs, the same model used in the app. Contractual lease rent and its escalations are held fixed; market rent after a lease ends, exit cap rate, vacancy, appreciation and cost inflation vary, with {tenantText}.
          The asset clears your <strong>{hurdle.toFixed(1)}% hurdle rate</strong> in <strong>{mc.probAboveHurdle}%</strong> of runs, with a downside (P10) IRR of <strong>{mc.p10Irr.toFixed(1)}%</strong>, a median of <strong>{mc.p50Irr.toFixed(1)}%</strong> and an upside (P90) of <strong>{mc.p90Irr.toFixed(1)}%</strong>.
          Net profit over the hold has a P10 of <strong>{compact(mc.profit.p10)}</strong>, a median of <strong>{compact(mc.profit.median)}</strong> and a P90 of <strong>{compact(mc.profit.p90)}</strong>; the chance of losing money is <strong>{mc.profit.probLoss}%</strong>.
          {mc.equity.thin ? ` Only ${mc.equity.pctOfPrice.toFixed(1)}% of the price is the investor's own cash, so IRR is an unstable yardstick here and dollar profit is the steadier measure.` : ''}
        </p>
      </div>
    </div>
  );
};

export const DealBrief: React.FC<{ model: BriefModel; monteCarlo: MonteCarloResult | null; onPrint?: () => void; onClose?: () => void }> = ({ model: m, monteCarlo, onPrint, onClose }) => {
  const multi = m.parcels.length > 1;
  const primary = m.parcels[0];
  const dscrLabel = m.isProrated ? 'Stabilized DSCR' : 'Senior DSCR';
  const dpLine = m.rehabMode === 'roll_into_loan'
    ? `${cur(m.downPaymentAmt)} Down Payment (${pctShort(m.downPaymentPct)}% LTC) • ${cur(m.rehabCosts)} Rehab + ${cur(m.closingCosts)} Closing Financed`
    : `${cur(m.downPaymentAmt)} Down (${pctShort(m.downPaymentPct)}%) + ${cur(m.rehabCosts)} Rehab + ${cur(m.closingCosts)} Closing (Funded Out-of-Pocket)`;

  return (
    <div className="brief" id="printable-brief">
      <style>{BRIEF_CSS}</style>

      {(onPrint || onClose) && (
        <div className="toolbar">
          {onClose && <button type="button" className="btn alt2" onClick={onClose}>Close</button>}
          {onPrint && <button type="button" className="btn" onClick={onPrint}>Print / Save as PDF</button>}
        </div>
      )}

      <div className="hdr">
        <div>
          <div className="row">
            <span className="logo">MathTree</span>
            <span className="pill pill-green">{m.memoTypeLabel}</span>
            <span className={`pill ${m.status === 'owned' ? 'pill-green' : 'pill-blue'}`}>{m.status === 'owned' ? '🏛️ Owned Operating Asset' : '🎯 Pipeline Prospect'}</span>
          </div>
          <h1 style={{ fontSize: 15, fontWeight: 800, margin: '3px 0 0 0' }}>{m.title}</h1>
          <div className="row" style={{ fontSize: 9, color: '#475569', fontWeight: 600, marginTop: 2, flexWrap: 'wrap' }}>
            <span>📍 <strong>{orNP(m.location)}</strong></span><span>•</span>
            <span className="mono">APN: {primary ? primary.apn : 'Pending Link'}{multi ? ` (+${m.parcels.length - 1} Adjacent)` : ''}</span><span>•</span>
            <span>🏛️ {orNP(m.county)}</span><span>•</span>
            <span className="pill pill-slate">{m.gisBadge}</span>
            {multi && <span className="pill pill-green">📦 {m.parcels.length}-Parcel Package</span>}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 9, color: '#64748b' }}>
          <p style={{ margin: 0, fontWeight: 600 }}>Report Date: <strong style={{ color: '#0f172a' }}>{m.dateStr}</strong></p>
          <p style={{ margin: '1.5px 0 0 0' }}>Target Hold Period: <strong style={{ color: '#0f172a' }}>{m.holdYears} Years</strong></p>
          <p style={{ margin: '1.5px 0 0 0' }}>Settlement Closing: <strong style={{ color: '#059669' }}>{m.closingDate ?? `${m.startYear} Full Calendar Year`}</strong></p>
        </div>
      </div>

      <div className="score">
        <div className="tile"><p className="tl">{m.holdYears}-Yr Levered IRR</p><p className="tv" style={{ color: '#059669' }}>{pct(m.irr)}</p></div>
        <div className="tile"><p className="tl">Gross Monthly Rent</p><p className="tv">{cur(m.monthlyRent)}<small>/mo</small></p></div>
        <div className="tile"><p className="tl">Year 1 Net Cash Flow</p><p className="tv" style={{ color: m.cashFlow >= 0 ? '#059669' : '#e11d48' }}>{cur(m.cashFlow)}<small> ({cur(m.monthlyCashFlow)}/mo)</small></p></div>
        <div className="tile"><p className="tl">Equity Multiplier</p><p className="tv">{m.equityMultiple.toFixed(2)}x</p></div>
        <div className="tile"><p className="tl">Year 1 Cap Rate</p><p className="tv">{pct(m.capRate)}</p></div>
        <div className="tile"><p className="tl">{dscrLabel}</p><p className="tv" style={{ color: dscrColor(m.dscr) }}>{m.dscrFormatted}</p></div>
      </div>

      {/* 1. Official County Assessor & Parcel Records: every included parcel */}
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
                  <td className="mono">{p.apn}{p.isPrimary && <span style={{ color: '#64748b', fontSize: 7, marginLeft: 3 }}>(PRIMARY)</span>}</td>
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
          <div style={{ padding: '6px 8px', fontSize: 8, color: '#64748b' }}>No county parcel is linked to this deal. Assessment and boundary data: {NP}.</div>
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

      {/* 2. Rent roll: every active lease */}
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
          <div style={{ padding: '6px 8px', fontSize: 8, color: '#64748b' }}>
            No active leases are recorded in Operations. Underwritten rent of {cur(m.monthlyRent)}/mo comes from the deal's underwriting inputs.
          </div>
        )}
      </div>

      {/* 3. Core underwriting assumptions */}
      <div className="box">
        <div className="bh">
          <span>⚖️ Core Underwriting Assumptions &amp; Capital Structure (High-Level Overview)</span>
          <span className="sub" style={{ background: '#047857', color: '#fff', padding: '1.5px 7px', borderRadius: 3 }}>Strategic Inputs &amp; Provenance</span>
        </div>
        <table>
          <thead><tr><th style={{ width: '42%', borderRight: '1px solid #e2e8f0' }}>Underwriting Metric &amp; Strategic Value</th><th style={{ width: '58%' }}>Methodology &amp; Diligence Provenance (How Reached)</th></tr></thead>
          <tbody>
            <tr>
              <td style={{ borderRight: '1px solid #e2e8f0' }}>
                <div className="lab">1. Acquisition Price &amp; Basis</div>
                <div><span className="big" style={{ color: '#059669' }}>{cur(m.price)}</span>{m.buildingSqFt > 0 && <span className="meta" style={{ marginLeft: 4 }}>(${(m.price / m.buildingSqFt).toFixed(0)}/sq ft)</span>}</div>
              </td>
              <td className="prov">
                Reconciled against official {m.county ?? 'county'} assessed valuation ({m.parcelTotals.assessed > 0 ? `${cur(m.parcelTotals.assessed)} total assessed basis` : 'county tax roll'}) and purchase contract terms.
              </td>
            </tr>
            <tr className="alt">
              <td style={{ borderRight: '1px solid #e2e8f0' }}>
                <div className="lab">2. Total Initial Capital Outlay (Equity, Rehab &amp; Closing)</div>
                <div><span className="big" style={{ color: '#0284c7' }}>{cur(m.equity)}</span> <span className="pill" style={{ background: '#e0f2fe', color: '#0369a1' }}>Total Upfront Cash Required</span></div>
                <div className="meta" style={{ fontWeight: 600 }}>{dpLine}</div>
              </td>
              <td className="prov">
                Represents total Day 1 sponsor equity required to capitalize the acquisition, fund closing costs ({cur(m.closingCosts)}), and execute renovation scope ({cur(m.rehabCosts)}){m.arv ? ` to capture After-Repair Value (${cur(m.arv)})` : ''}. {m.rehabMode === 'roll_into_loan' ? 'Rehab and closing costs are rolled directly into the senior loan facility.' : 'Rehab and closing settlements are funded 100% upfront out of sponsor equity.'}{m.capexReservePct !== null ? ` Ongoing replacement reserves: ${m.capexReservePct}%/yr.` : ''}
              </td>
            </tr>
            <tr>
              <td style={{ borderRight: '1px solid #e2e8f0' }}>
                <div className="lab">3. Vacancy &amp; Economic Downtime</div>
                <div><span className="big">{pctShort(m.vacancyPct)}% of Gross</span> <span className="meta">({cur(m.vacancyLossAnnual)}/yr reserve)</span></div>
              </td>
              <td className="prov">
                {m.vacancyPct <= 0.001
                  ? 'Models 100% economic occupancy with zero vacancy friction.'
                  : `Underwriting allowance of ${pctShort(m.vacancyPct)}% buffers tenant rollover friction, collection delay, and physical downtime.`}
              </td>
            </tr>
            <tr className="alt">
              <td style={{ borderRight: '1px solid #e2e8f0' }}>
                <div className="lab">4. Loan-to-Value &amp; Leverage Structure</div>
                <div><span className="big">{pctShort(m.ltvPct)}% {m.rehabMode === 'roll_into_loan' ? 'LTC' : 'LTV'}</span> <span style={{ fontSize: 11.5, fontWeight: 800, color: '#047857' }}>{cur(m.loanAmt)} Senior Debt</span></div>
                <div className="meta">Required Sponsor Equity: {cur(m.equity)} ({m.rehabMode === 'roll_into_loan' ? `${pctShort(m.downPaymentPct)}% LTC Down Payment` : `${cur(m.downPaymentAmt)} Down + ${cur(m.rehabCosts + m.closingCosts)} Outlay`})</div>
              </td>
              <td className="prov">{m.debtProvenance}</td>
            </tr>
            <tr>
              <td style={{ borderRight: '1px solid #e2e8f0' }}>
                <div className="lab">5. Financing Terms &amp; Debt Service</div>
                <div><span style={{ fontSize: 13, fontWeight: 900 }}>{m.interestRate}% • {m.loanTerm} Yrs</span> <span style={{ fontSize: 11, fontWeight: 800, color: '#0284c7' }}>{cur(m.monthlyDebtService)}/mo P&amp;I</span></div>
                <div className="meta">
                  {cur(m.debtService)}{m.isProrated ? ` Stub Yr 1 Debt (${m.p0.operatingMonths} mos)` : '/yr Annual Debt'} ({cur(m.principalPerMonth)}/mo Prin • {cur(m.interestPerMonth)}/mo Int) • DSCR: <strong style={{ color: dscrColor(m.dscr) }}>{m.dscrFormatted}</strong>
                </div>
              </td>
              <td className="prov">{m.dscrEvaluation}</td>
            </tr>
            <tr className="alt">
              <td style={{ borderRight: '1px solid #e2e8f0' }}>
                <div className="lab">6. Gross In-Place Revenue &amp; Tenancy</div>
                <div><span className="big" style={{ color: '#059669' }}>{cur(m.monthlyRent)}/mo</span> <span className="meta">({cur(m.annualRent)}/yr)</span></div>
                <div className="meta">
                  {m.underwritingLeases.length > 0
                    ? m.underwritingLeases.map((l) => `${l.tenant ?? 'Tenant'} ${cur(l.monthlyRent)}/mo${l.start ? ` (${l.start}${l.end ? ` to ${l.end}` : ''})` : ''}`).join(' • ')
                    : 'Underwritten from deal rent inputs (no underwriting lease schedule)'}
                </div>
              </td>
              <td className="prov">{m.revenueProvenance}</td>
            </tr>
            <tr>
              <td style={{ borderRight: '1px solid #e2e8f0' }}>
                <div className="lab">7. Operating Expenses &amp; Management</div>
                <div><span className="big">{pctShort(m.expenseRatioPct)}% of GPI</span> <span className="meta">({cur(m.opExAnnual)}/yr)</span></div>
                <div className="meta">{cur(m.opExAnnual / 12)}/mo OpEx</div>
              </td>
              <td className="prov">{m.opexProvenance}</td>
            </tr>
            <tr className="alt">
              <td style={{ borderRight: '1px solid #e2e8f0' }}>
                <div className="lab">8. Hold Horizon &amp; Terminal Exit Cap Rate</div>
                <div><span className="big">{m.holdYears}-Year Hold</span> <span style={{ fontSize: 11, fontWeight: 800, color: '#059669' }}>{m.exitCapRate}% Exit Cap</span></div>
                <div className="meta" style={{ color: '#047857', fontWeight: 700 }}>
                  {m.closingDate ? `Closing Settlement: ${m.closingDate}${m.isProrated ? ` (${m.p0.operatingMonths} Mos Stub Prorated)` : ''}` : `Underwriting Period: Full Calendar Year (${m.startYear})`}
                </div>
              </td>
              <td className="prov">Exit value is capitalized at the {m.exitCapRate}% terminal cap rate over the {m.holdYears}-year investment horizon.</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 4. Pro-forma */}
      <div className="box">
        <div className="bh"><span>📊 {m.holdYears}-Year Institutional Pro-Forma Forecast</span><span className="sub">Calendar-Year Cash Flow Waterfall</span></div>
        <table className="num">
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
                  <td style={{ textAlign: 'center', fontWeight: 700 }}>{p.calendarYear || m.startYear + (p.year || i + 1) - 1} <span style={{ fontSize: 7.5, color: '#64748b', fontWeight: 400 }}>(Yr {p.year || i + 1})</span></td>
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
          <div style={{ fontSize: 7.5, color: '#334155', padding: '4px 8px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', lineHeight: 1.4 }}>
            <span style={{ fontWeight: 800, color: '#047857', textTransform: 'uppercase' }}>📌 Contractual Lease &amp; Calendar Provenance Footnotes:</span>
            <ul style={{ margin: '2px 0 0 0', paddingLeft: 14 }}>
              {m.proj.filter((p: any) => p.methodologyFootnote).map((p: any, i) => (
                <li key={i}><strong>Yr {p.year} ({p.calendarYear || m.startYear + p.year - 1}):</strong> {p.methodologyFootnote}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <MonteCarloSection m={m} mc={monteCarlo} />

      {m.warnings.length > 0 && (
        <div className="warn">
          <p>Deal Risk &amp; Underwriting Audit Flags</p>
          <ul>{m.warnings.map((w, i) => <li key={i}><strong>{w.title}:</strong> {w.description}</li>)}</ul>
        </div>
      )}

      <div className="foot">
        <span>MathTree Real Estate Underwriting Platform • Computed from live deal data</span>
        <span>Confidential Institutional Investment Memo • {dscrLabel}: {m.dscrFormatted} • Generated {m.dateStr}</span>
      </div>
    </div>
  );
};
