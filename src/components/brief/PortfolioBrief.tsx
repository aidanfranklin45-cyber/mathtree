import React from 'react';
import type { PortfolioModel, PortfolioDealRow } from '../../lib/export/buildPortfolioModel';
import { BRIEF_CSS, NP, cur, pct } from './DealBrief';

const orNP = (v: string | null | undefined): string => (v && v.trim() ? v : NP);
const pctOrNA = (v: number | null, d = 2): string => (v === null ? 'N/M' : pct(v, d));
const curOrNP = (v: number | null): string => (v === null ? NP : cur(v));
const cfColor = (v: number | null): string => (v !== null && v < 0 ? '#e11d48' : '#059669');

const NameCell: React.FC<{ r: PortfolioDealRow }> = ({ r }) => (
  <td>
    <strong style={{ fontSize: 12, display: 'block' }}>{r.name}</strong>
    <span style={{ color: '#64748b', fontSize: 10.5 }}>{orNP(r.location)}</span>
  </td>
);
const ApnCell: React.FC<{ r: PortfolioDealRow }> = ({ r }) => <td className="mono" style={{ textAlign: 'center' }}>{r.apn ?? 'Pending Link'}</td>;

const PORTFOLIO_CSS = `
.brief .sc6 { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 12px; }
.brief .tile .sub { font-size: 10.5px; color: #64748b; margin: 2px 0 0 0; }
.brief .gov { border: 1px solid #cbd5e1; border-radius: 6px; background: #f8fafc; padding: 8px 10px; margin-bottom: 12px; break-inside: avoid; }
.brief .gov .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; font-size: 10.5px; }
.brief .gov .cell { background: #fff; border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px 8px; }
.brief .gov .cell strong { color: #047857; display: block; }
.brief .gov .cell p { color: #475569; margin: 1px 0 0 0; }
.brief .empty { padding: 10px; font-size: 12px; color: #64748b; text-align: center; }
@media screen and (max-width: 900px) { .brief .sc6 { grid-template-columns: repeat(3, 1fr); } .brief .gov .grid { grid-template-columns: 1fr 1fr; } }
`;

export const PortfolioBrief: React.FC<{ model: PortfolioModel; onPrint?: () => void; onClose?: () => void }> = ({ model: m, onPrint, onClose }) => {
  const k = m.kpis;
  return (
    <div className="brief" id="printable-brief">
      <style>{BRIEF_CSS}{PORTFOLIO_CSS}</style>

      {(onPrint || onClose) && (
        <div className="toolbar">
          {onClose && <button type="button" className="btn alt2" onClick={onClose}>Close</button>}
          {onPrint && <button type="button" className="btn" onClick={onPrint}>Print / Save as PDF</button>}
        </div>
      )}

      <div className="hdr">
        <div>
          <div className="row"><span className="logo" style={{ fontSize: 22 }}>MathTree</span><span className="pill pill-green">Portfolio &amp; Pipeline Command Center</span></div>
          <h1>Executive Portfolio &amp; Acquisition Pipeline Underwriting Brief</h1>
          <div className="row hmeta">
            <span>👤 Sponsor / Investor: <strong style={{ color: '#0f172a' }}>{orNP(m.investorName)}</strong></span><span>•</span>
            <span>🏢 Entity: <strong style={{ color: '#0f172a' }}>{orNP(m.companyName)}</strong></span><span>•</span>
            <span>🎯 Hurdle Rate: <strong style={{ color: '#059669' }}>{m.hurdleRate !== null ? `${m.hurdleRate.toFixed(1)}% / yr` : NP}</strong></span>
          </div>
        </div>
        <div className="hside">
          <p style={{ margin: 0, fontWeight: 600 }}>Report Date: <strong style={{ color: '#0f172a' }}>{m.dateStr}</strong></p>
          <p style={{ margin: '2px 0 0 0' }}>Underwritten Assets: <strong style={{ color: '#0f172a' }}>{m.totalDeals} ({m.owned.length} Owned, {m.pipeline.length} Pipeline)</strong></p>
          <p style={{ margin: '2px 0 0 0' }}>Total Real Estate Capital: <strong style={{ color: '#059669' }}>{cur(m.totalVolume)}</strong></p>
        </div>
      </div>

      <div className="sc6">
        <div className="tile"><p className="tl">Owned Gross Value (GAV)</p><p className="tv" style={{ color: '#059669' }}>{cur(k.ownedVal)}</p><p className="sub">Net Equity: <strong>{cur(k.ownedEquity)}</strong></p></div>
        <div className="tile"><p className="tl">Owned Debt &amp; Leverage</p><p className="tv">{cur(k.ownedDebt)}</p><p className="sub">Blended LTV: <strong>{k.ownedLtv}%</strong></p></div>
        <div className="tile"><p className="tl">Owned Net Cash Flow</p><p className="tv" style={{ color: cfColor(k.ownedCashflow) }}>{cur(k.ownedCashflow)}/yr</p><p className="sub">CoC Yield: <strong>{k.ownedEquity > 0 ? `${k.avgCoc}%` : 'N/M'}</strong></p></div>
        <div className="tile"><p className="tl">Pipeline Deal Volume</p><p className="tv" style={{ color: '#0284c7' }}>{cur(k.pipelineVal)}</p><p className="sub">Active Prospects: <strong>{k.pipelineCount} Deals</strong></p></div>
        <div className="tile"><p className="tl">Target Pipeline Return</p><p className="tv" style={{ color: '#0284c7' }}>{k.blendedIrr > 0 ? `${k.blendedIrr}%` : 'N/A'}</p><p className="sub">Average 10-Yr IRR</p></div>
        <div className="tile"><p className="tl">Physical Footprint</p><p className="tv">{m.footprintAcres > 0 ? `${m.footprintAcres.toFixed(2)} Ac` : NP}</p><p className="sub">{m.footprintSqFt > 0 ? `${Math.round(m.footprintSqFt).toLocaleString()} Sq Ft` : `Sq Ft: ${NP}`}</p></div>
      </div>

      <div className="box">
        <div className="bh" style={{ background: '#334155' }}><span>Sector Diversification &amp; Asset Allocation Matrix</span><span className="sub" style={{ color: '#fff' }}>Capital Allocation</span></div>
        <table>
          <thead><tr><th>Asset Class / Sector</th><th className="num">Deals</th><th className="num">Aggregate Valuation</th><th className="num">Portfolio Weight</th><th className="num">Annual Cash Flow</th><th className="num">Avg Target IRR</th></tr></thead>
          <tbody>
            {m.sectors.map((s, i) => (
              <tr key={s.id} className={i % 2 ? 'alt' : ''}>
                <td style={{ fontWeight: 700 }}>{s.icon} {s.label}</td>
                <td className="num">{s.count}</td><td className="num" style={{ fontWeight: 700 }}>{cur(s.value)}</td>
                <td className="num">{s.weightPct.toFixed(1)}%</td>
                <td className="num" style={{ fontWeight: 700, color: cfColor(s.cashFlow) }}>{cur(s.cashFlow)}/yr</td>
                <td className="num" style={{ fontWeight: 700, color: '#059669' }}>{s.avgIrr !== null ? pct(s.avgIrr, 1) : 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="box split pg">
        <div className="bh" style={{ background: '#064e3b' }}><span>🏛️ Owned Operating Holdings — Performance &amp; Equity Register ({m.owned.length} Assets)</span><span className="sub" style={{ color: '#fff' }}>In-Place GAV: {cur(k.ownedVal)}</span></div>
        {m.owned.length > 0 ? (
          <table>
            <thead><tr><th>Property Name &amp; Location</th><th style={{ textAlign: 'center' }}>Assessor APN</th><th>Strategy / Class</th><th className="num">Current Value</th><th className="num">Annual NOI</th><th className="num">Debt Service</th><th className="num" style={{ color: '#059669' }}>Net Cash Flow</th><th className="num">CoC Yield</th><th className="num">Cap Rate</th><th className="num">Debt Balance</th><th className="num" style={{ color: '#059669' }}>Net Equity</th></tr></thead>
            <tbody>
              {m.owned.map((r, i) => (
                <tr key={r.id} className={i % 2 ? 'alt' : ''}>
                  <NameCell r={r} /><ApnCell r={r} /><td>{r.classLabel}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{cur(r.price)}</td>
                  <td className="num">{curOrNP(r.noi)}</td><td className="num" style={{ color: '#64748b' }}>{curOrNP(r.debtService)}</td>
                  <td className="num" style={{ fontWeight: 800, color: cfColor(r.cashFlow) }}>{curOrNP(r.cashFlow)}</td>
                  <td className="num" style={{ fontWeight: 700, color: '#059669' }}>{pctOrNA(r.coc, 1)}</td>
                  <td className="num">{pctOrNA(r.capRate)}</td>
                  <td className="num" style={{ color: '#64748b' }}>{curOrNP(r.debt)}</td>
                  <td className="num" style={{ fontWeight: 800, color: '#059669' }}>{curOrNP(r.equity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">No active properties currently recorded in owned portfolio.</div>}
      </div>

      <div className="box split pg">
        <div className="bh" style={{ background: '#0369a1' }}><span>🎯 Acquisition Pipeline — Prospect Underwriting Register ({m.pipeline.length} Opportunities)</span><span className="sub" style={{ color: '#fff' }}>Pipeline Volume: {cur(k.pipelineVal)}</span></div>
        {m.pipeline.length > 0 ? (
          <table>
            <thead><tr><th>Opportunity Name &amp; Address</th><th style={{ textAlign: 'center' }}>Assessor APN</th><th>Facility / Strategy</th><th className="num">Target Price</th><th className="num" style={{ color: '#0284c7' }}>10-Yr IRR</th><th className="num">Yr 1 Cash Flow</th><th className="num">Yr 1 CoC</th><th className="num">Projected NOI</th><th className="num">Debt &amp; LTV</th><th style={{ textAlign: 'center' }}>Stage</th></tr></thead>
            <tbody>
              {m.pipeline.map((r, i) => (
                <tr key={r.id} className={i % 2 ? 'alt' : ''}>
                  <NameCell r={r} /><ApnCell r={r} /><td>{r.classLabel}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{cur(r.price)}</td>
                  <td className="num" style={{ fontWeight: 800, color: '#0284c7' }}>{pctOrNA(r.irr, 1)}</td>
                  <td className="num" style={{ fontWeight: 700, color: cfColor(r.cashFlow) }}>{curOrNP(r.cashFlow)}</td>
                  <td className="num" style={{ fontWeight: 700, color: cfColor(r.coc) }}>{pctOrNA(r.coc, 1)}</td>
                  <td className="num">{curOrNP(r.noi)}</td>
                  <td className="num" style={{ color: '#475569' }}>{r.debt === null ? NP : `${cur(r.debt)} (${r.ltv !== null ? `${Math.round(r.ltv)}%` : NP})`}</td>
                  <td style={{ textAlign: 'center' }}><span className="pill" style={{ background: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd' }}>{orNP(r.stage)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty">No prospective acquisition opportunities currently in pipeline.</div>}
      </div>

      <div className="box split pg">
        <div className="bh" style={{ background: '#1e293b' }}><span>🏛️ County Assessor &amp; Structural Characteristics Cross-Verification Audit</span><span className="sub" style={{ color: '#fff' }}>Tax Roll Audit</span></div>
        <table>
          <thead><tr><th style={{ width: '22%' }}>Property &amp; Location</th><th style={{ width: '15%' }}>Assessor APN</th><th style={{ width: '18%' }}>Owner of Record</th><th style={{ width: '15%' }}>Assessed Value</th><th style={{ width: '12%' }}>Parcel Area</th><th style={{ width: '18%' }}>Structural Specs &amp; Zoning</th></tr></thead>
          <tbody>
            {m.audit.map((r, i) => (
              <tr key={r.id} className={i % 2 ? 'alt' : ''}>
                <NameCell r={r} />
                <td className="mono">{r.apn ?? 'Pending Link'}</td>
                <td style={{ fontWeight: 700 }}>{orNP(r.owner)}</td>
                <td style={{ fontWeight: 700, color: '#059669' }}>{r.assessed !== null ? cur(r.assessed) : NP}</td>
                <td>{r.acres > 0 ? `${r.acres.toFixed(2)} Acres` : NP}</td>
                <td>
                  <span>{[r.yearBuilt ? `Built ${r.yearBuilt}` : null, r.buildingSqFt > 0 ? `${Math.round(r.buildingSqFt).toLocaleString()} Sq Ft` : null].filter(Boolean).join(' • ') || NP}</span><br />
                  <span style={{ fontSize: 10, color: '#64748b' }}>Zoning: {orNP(r.zoning)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="gov">
        <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', marginBottom: 6 }}>Portfolio Governance Standards &amp; Diligence Policy</div>
        <div className="grid">
          <div className="cell"><strong>Closing Proration Policy</strong><p>Underwritten based on verified closing timelines; applies calendar proration only when elected.</p></div>
          <div className="cell"><strong>Occupancy &amp; Vacancy Policy</strong><p>Underwriting vacancy calibrated to in-place tenant leases, lease stability, and market comps.</p></div>
          <div className="cell"><strong>Debt Stress Coverage</strong><p>Commercial notes stress-tested against +100 bps rate shifts; min Year 1 DSCR covenant floor of 1.25x.</p></div>
          <div className="cell"><strong>Operating Liquidity Reserve</strong><p>Pipeline deals require min 6-month P&amp;I operating buffer to absorb transitional rollover or rehab lags.</p></div>
        </div>
      </div>

      {m.flags.length > 0 && (
        <div className="warn">
          <p>Portfolio Risk &amp; Audit Flags</p>
          <ul>{m.flags.map((f, i) => <li key={i}><strong>{f.title}:</strong> {f.description}</li>)}</ul>
        </div>
      )}

      <div className="foot">
        <span>MathTree Real Estate Portfolio &amp; Pipeline Studio • Computed from live deal data</span>
        <span>Confidential Underwriting Report • Generated for {orNP(m.investorName)} ({orNP(m.companyName)}) • {m.dateStr}</span>
      </div>
    </div>
  );
};
