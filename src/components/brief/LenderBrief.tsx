import React from 'react';
import { BRIEF_CSS, NP, NapkinMath, cur, pct } from './DealBrief';
import type { LenderModel } from '../../lib/export/buildLenderModel';
import type { LenderMetrics } from '../../lib/engine';

const orNP = (v: string | null | undefined): string => (v && v.trim() ? v : NP);
const curOrNP = (v: number | null): string => (v === null ? NP : cur(v));
const x2 = (v: number | null): string => (v === null ? 'N/A' : `${v.toFixed(2)}x`);
const pctOrNA = (v: number | null, d = 1): string => (v === null ? 'N/A' : `${v.toFixed(d)}%`);

const LENDER_CSS = `
.brief .lv-verdict { display: flex; align-items: center; gap: 12px; border: 2px solid; border-radius: 8px; padding: 5px 14px; margin-bottom: 10px; break-inside: avoid; }
.brief .lv-verdict .ico { font-size: 26px; font-weight: 900; width: 34px; text-align: center; }
.brief .lv-verdict .v { font-size: 17px; font-weight: 900; }
.brief .lv-verdict .t { font-size: 12.5px; color: #0f172a; margin-top: 2px; }
.brief .lv-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
.brief .lv-grid2 .box { margin-bottom: 0; }
.brief .lv-kv td { padding: 4px 8px; }
.brief .lv-flag { padding: 6px 10px; border-bottom: 1px solid #f1f5f9; font-size: 11.5px; line-height: 1.45; }
.brief .lv-flag strong { color: #92400e; }
`;

const covColor = (d: number | null, min: number): string => (d === null ? '#475569' : Math.round(d * 100) / 100 >= min ? '#059669' : d >= 1 ? '#d97706' : '#e11d48');

const Tile: React.FC<{ label: string; value: string; sub?: string; color?: string }> = ({ label, value, sub, color }) => (
  <div className="tile"><p className="tl">{label}</p><p className="tv" style={{ color }}>{value}</p>{sub && <div className="meta" style={{ fontSize: 10, marginTop: 2 }}>{sub}</div>}</div>
);

const CoverageStrip: React.FC<{ lm: LenderModel }> = ({ lm }) => {
  const m = lm.metrics;
  const b = lm.brief;
  return (
    <div className="score">
      <Tile label={`DSCR (${m.basisYear})`} value={x2(m.dscr)} color={covColor(m.dscr, lm.minDscr)} sub={`Minimum ${lm.minDscr.toFixed(2)}x`} />
      <Tile label="Debt Yield" value={pctOrNA(m.debtYield, 2)} sub="NOI ÷ loan" />
      <Tile label="Break-Even Occupancy" value={pctOrNA(m.breakEvenOccupancyPct, 0)} sub="Of potential rent" />
      <Tile label={`${lm.request.basis} (price)`} value={pctOrNA(lm.request.leveragePct, 1)} sub={lm.request.basis === 'LTC' ? 'Loan ÷ total cost' : 'Loan ÷ price'} />
      <Tile label="Loan ÷ County Assessed" value={pctOrNA(lm.ltvAssessedPct, 1)} sub={b.parcelTotals.assessed > 0 ? `Assessed ${cur(b.parcelTotals.assessed)}` : 'No county value'} />
      <Tile label={`NOI (${m.basisYear})`} value={cur(m.netOperatingIncome)} sub={`Debt service ${cur(m.debtService)}`} />
    </div>
  );
};

const StressTable: React.FC<{ rows: LenderMetrics['stress']; min: number }> = ({ rows, min }) => (
  <table>
    <thead><tr><th>Scenario</th><th className="num">NOI</th><th className="num">Debt Service</th><th className="num">DSCR</th><th>Against the {min.toFixed(2)}x minimum</th></tr></thead>
    <tbody>
      {rows.map((r) => {
        const ok = r.dscr !== null && Math.round(r.dscr * 100) / 100 >= min;
        return (
          <tr key={r.id}>
            <td style={{ fontWeight: 700 }}>{r.label}</td>
            <td className="num">{cur(r.netOperatingIncome)}</td>
            <td className="num">{cur(r.debtService)}</td>
            <td className="num" style={{ fontWeight: 800, color: covColor(r.dscr, min) }}>{x2(r.dscr)}</td>
            <td style={{ color: r.dscr === null ? '#64748b' : ok ? '#047857' : '#b45309', fontWeight: 700 }}>{r.dscr === null ? 'No debt' : ok ? 'Meets' : r.dscr >= 1 ? 'Covers the loan, below the minimum' : 'Does not cover the loan'}</td>
          </tr>
        );
      })}
    </tbody>
  </table>
);

export const LenderBrief: React.FC<{ model: LenderModel; onPrint?: () => void; onClose?: () => void }> = ({ model: lm, onPrint, onClose }) => {
  const b = lm.brief;
  const primary = b.parcels[0];
  const m = lm.metrics;
  const verdictColor = lm.coverage.status === 'meets' ? { fg: '#059669', bg: '#ecfdf5', bd: '#a7f3d0', ico: '✓', word: 'Meets the coverage test' }
    : lm.coverage.status === 'below' ? { fg: '#e11d48', bg: '#fff1f2', bd: '#fecdd3', ico: '!', word: 'Below the coverage minimum' }
      : { fg: '#475569', bg: '#f8fafc', bd: '#cbd5e1', ico: '–', word: 'No senior debt' };
  const projRows = b.proj as any[];

  return (
    <div className="brief" id="printable-brief">
      <style>{BRIEF_CSS}{LENDER_CSS}</style>
      {(onPrint || onClose) && (
        <div className="toolbar">
          {onClose && <button type="button" className="btn alt2" onClick={onClose}>Close</button>}
          {onPrint && <button type="button" className="btn" onClick={onPrint}>Print / Save as PDF</button>}
        </div>
      )}

      {/* PAGE 1: the request, the coverage test, the borrower, the collateral */}
      <div className="hdr">
        <div>
          <div className="row"><span className="logo">MathTree</span><span className="pill pill-blue">Lender Summary</span></div>
          <h1>{b.title}</h1>
          <div className="row hmeta">
            <span>📍 <strong>{orNP(b.location)}</strong></span><span>•</span>
            <span className="mono">APN: {primary ? primary.apn : 'Pending Link'}</span>
          </div>
        </div>
        <div className="hside">
          <div>Report Date: <strong style={{ color: '#0f172a' }}>{b.dateStr}</strong></div>
          <div>Requested Loan: <strong style={{ color: '#0f172a' }}>{cur(lm.request.amount)}</strong></div>
          <div>Purpose: <strong style={{ color: '#0f172a' }}>{lm.request.purpose}</strong></div>
        </div>
      </div>

      <div className="lv-verdict" style={{ background: verdictColor.bg, borderColor: verdictColor.bd }}>
        <div className="ico" style={{ color: verdictColor.fg }}>{verdictColor.ico}</div>
        <div><div className="v" style={{ color: verdictColor.fg }}>{verdictColor.word}</div><div className="t">{lm.coverage.text}</div></div>
      </div>

      <CoverageStrip lm={lm} />

      <div className="lv-grid2">
        <div className="box">
          <div className="bh"><span>Loan request</span><span className="sub">As underwritten, not a lender quote</span></div>
          <table className="lv-kv"><tbody>
            <tr><td className="k">Amount</td><td style={{ fontWeight: 800 }}>{cur(lm.request.amount)}</td><td className="k">Purpose</td><td style={{ fontWeight: 700 }}>{lm.request.purpose}</td></tr>
            <tr><td className="k">Interest rate</td><td style={{ fontWeight: 700 }}>{lm.request.rate}%</td><td className="k">Term and amortization</td><td style={{ fontWeight: 700 }}>{lm.request.termYears} years</td></tr>
            <tr><td className="k">Monthly payment</td><td style={{ fontWeight: 700 }}>{cur(b.monthlyDebtService)}/mo</td><td className="k">Hold to sale or refinance</td><td style={{ fontWeight: 700 }}>{b.holdYears} years</td></tr>
          </tbody></table>
        </div>
        <div className="box">
          <div className="bh"><span>Borrower &amp; sponsor</span><span className="sub">From the investor profile</span></div>
          <table className="lv-kv"><tbody>
            <tr><td className="k">Borrowing entity</td><td style={{ fontWeight: 700 }}>{orNP(lm.borrower.entity)}</td><td className="k">Principal</td><td style={{ fontWeight: 700 }}>{orNP(lm.borrower.principal)}</td></tr>
            <tr><td className="k">Liquid assets</td><td style={{ fontWeight: 700 }}>{curOrNP(lm.borrower.liquidity)}</td><td className="k">Net worth</td><td style={{ fontWeight: 700 }}>{curOrNP(lm.borrower.netWorth)}</td></tr>
            <tr><td className="k">Experience</td><td colSpan={3} style={{ fontWeight: 600 }}>{orNP(lm.borrower.experience)}</td></tr>
          </tbody></table>
        </div>
      </div>

      <div className="box">
        <div className="bh"><span>🏛️ Collateral: official county record</span><span className="sub">{b.gisBadge}</span></div>
        {b.parcels.length > 0 ? (
          <table>
            <thead><tr><th style={{ width: '16%' }}>APN / Parcel</th><th style={{ width: '30%' }}>Address</th><th className="num">Assessed</th><th className="num">Land</th><th className="num">Improvements</th><th className="num">Acres</th><th className="num">Sq Ft</th></tr></thead>
            <tbody>
              {b.parcels.map((p) => (
                <tr key={p.apn}>
                  <td className="mono">{p.apn}</td><td>{orNP(p.address)}</td>
                  <td className="num">{p.assessed > 0 ? cur(p.assessed) : 'Pending'}</td><td className="num">{cur(p.land)}</td><td className="num">{cur(p.improvement)}</td>
                  <td className="num">{p.acres.toFixed(2)}</td><td className="num">{Math.round(p.sqft).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div style={{ padding: '8px 10px', fontSize: 11.5, color: '#64748b' }}>No county parcel is linked to this deal. Assessment and boundary data: {NP}.</div>}
        <table><tbody><tr>
          <td className="k" style={{ width: '12%' }}>Owner of record</td><td style={{ width: '22%', fontWeight: 700 }}>{orNP(b.owner)}</td>
          <td className="k" style={{ width: '12%' }}>Zoning &amp; use</td><td style={{ width: '24%', fontWeight: 600 }}>{orNP(b.zoning)} • {orNP(b.useCode)}</td>
          <td className="k" style={{ width: '10%' }}>Structure</td><td style={{ fontWeight: 600 }}>{[b.yearBuilt ? `Built ${b.yearBuilt}` : null, b.buildingSqFt > 0 ? `${b.buildingSqFt.toLocaleString()} sq ft` : null, b.stories ? `${b.stories} story` : null].filter(Boolean).join(' • ') || NP}</td>
        </tr></tbody></table>
      </div>

      <div className="box">
        <div className="bh"><span>Sources &amp; uses at closing</span><span className="sub">{b.closingDate ? `Closing ${b.closingDate}` : `${b.startYear} underwriting year`}</span></div>
        <div className="lv-grid2" style={{ padding: 10, marginBottom: 0 }}>
          <table>
            <thead><tr><th>Uses</th><th className="num">Amount</th><th className="num">% of total</th></tr></thead>
            <tbody>
              {lm.uses.map((u) => <tr key={u.label}><td>{u.label}</td><td className="num">{cur(u.amount)}</td><td className="num">{u.pct.toFixed(1)}%</td></tr>)}
              <tr className="tot"><td>Total uses</td><td className="num">{cur(lm.totalUses)}</td><td className="num">100.0%</td></tr>
            </tbody>
          </table>
          <table>
            <thead><tr><th>Sources</th><th className="num">Amount</th><th className="num">% of total</th></tr></thead>
            <tbody>
              {lm.sources.map((u) => <tr key={u.label}><td>{u.label}</td><td className="num">{cur(u.amount)}</td><td className="num">{u.pct.toFixed(1)}%</td></tr>)}
              <tr className="tot"><td>Total sources</td><td className="num">{cur(lm.sources.reduce((t, s) => t + s.amount, 0))}</td><td className="num">{Math.abs(lm.unreconciled) < 1 ? '100.0%' : `Differs by ${cur(lm.unreconciled)}`}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* PAGE 2: the debt over the hold, the stress, repayment */}
      <div className="box split pf pg">
        <div className="bh"><span>The loan over the hold</span><span className="sub">Coverage and balance by year</span></div>
        <table>
          <thead><tr><th style={{ textAlign: 'center' }}>Year</th><th className="num">NOI</th><th className="num">Debt Service</th><th className="num">DSCR</th><th className="num">Debt Yield</th><th className="num">Loan Balance</th><th className="num">Property Value</th><th className="num">Balance ÷ Value</th></tr></thead>
          <tbody>
            {projRows.map((p, i) => {
              const bal = Number(p.loanBalanceRemaining ?? p.endingLoanBalance ?? 0);
              const val = Number(p.propertyValue ?? 0);
              const d = p.dscr === null || p.dscr === undefined || p.dscr === '' || Number.isNaN(Number(p.dscr)) ? null : Number(p.dscr);
              // A partial first year's NOI over the whole loan would understate the yield, so it is not shown
              const dy = (i === 0 && b.isProrated) || p.debtYield === null || p.debtYield === undefined ? null : Number(p.debtYield);
              return (
                <tr key={i} className={i % 2 ? 'alt' : ''}>
                  <td style={{ textAlign: 'center', fontWeight: 700 }}>{p.calendarYear || b.startYear + i} <span style={{ fontSize: 9.5, color: '#64748b', fontWeight: 400 }}>(Yr {p.year || i + 1})</span></td>
                  <td className="num">{cur(Number(p.netOperatingIncome ?? 0))}</td>
                  <td className="num" style={{ color: '#64748b' }}>{cur(Number(p.debtService ?? 0))}</td>
                  <td className="num" style={{ fontWeight: 800, color: covColor(d, lm.minDscr) }}>{x2(d)}</td>
                  <td className="num">{pctOrNA(dy, 2)}</td>
                  <td className="num" style={{ color: '#64748b' }}>{cur(bal)}</td>
                  <td className="num">{cur(val)}</td>
                  <td className="num">{val > 0 ? `${((bal / val) * 100).toFixed(0)}%` : 'N/A'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {b.isProrated && <div style={{ fontSize: 9.5, color: '#475569', padding: '5px 10px', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>The first row is a partial year ({Number(b.p0.operatingMonths)} months). Coverage and yield headlines use the first full year, {m.basisYear}.</div>}
      </div>

      <div className="lv-grid2">
        <div className="box">
          <div className="bh"><span>DSCR stress</span><span className="sub">First full year, {m.basisYear}</span></div>
          <StressTable rows={m.stress} min={lm.minDscr} />
        </div>
        <div className="box">
          <div className="bh"><span>Repayment at the end of the hold</span><span className="sub">Sale or refinance, year {m.atExit.year}</span></div>
          <table className="lv-kv"><tbody>
            <tr><td className="k">Projected value ({m.atExit.calendarYear})</td><td style={{ fontWeight: 800 }}>{cur(m.atExit.propertyValue)}</td></tr>
            <tr><td className="k">Loan balance then</td><td style={{ fontWeight: 800 }}>{cur(m.atExit.loanBalance)}</td></tr>
            <tr><td className="k">Balance ÷ value</td><td style={{ fontWeight: 800, color: m.atExit.ltvPct !== null && m.atExit.ltvPct <= 65 ? '#059669' : '#d97706' }}>{pctOrNA(m.atExit.ltvPct, 1)}</td></tr>
            <tr><td className="k">Exit cap rate</td><td style={{ fontWeight: 700 }}>{b.exitCapRate}% (going in {pct(b.capRate)})</td></tr>
          </tbody></table>
          <div style={{ fontSize: 10, color: '#475569', padding: '4px 10px 8px', lineHeight: 1.45 }}>
            The value is the pro forma's projection at the exit cap rate, not an appraisal. Operating costs are held at their underwritten dollars in the break-even occupancy.
          </div>
        </div>
      </div>

      {/* PAGE 3: how the income is built, what would worry a lender, and the tenancy behind it */}
      <div className="pg"><NapkinMath m={b} lender /></div>

      <div className="box">
        <div className="bh"><span>Risks &amp; underwriting flags</span><span className="sub">Stated, not hidden</span></div>
        {lm.flags.length > 0
          ? lm.flags.map((f, i) => <div key={i} className="lv-flag"><strong>{f.title}:</strong> {f.description}</div>)
          : <div className="lv-flag">No underwriting flags were raised for this structure.</div>}
      </div>

      <div className="box">
        <div className="bh"><span>Tenancy behind the income</span><span className="sub">{lm.tenancy.leaseCount > 0 ? `${lm.tenancy.leaseCount} lease${lm.tenancy.leaseCount === 1 ? '' : 's'}` : 'No lease schedule'}</span></div>
        {(b.rentRoll.length > 0 || b.underwritingLeases.length > 0) ? (
          <table>
            <thead><tr><th>Tenant</th><th>Type</th><th className="num">Monthly Rent</th><th>Lease Start</th><th>Lease End</th><th>Escalation</th></tr></thead>
            <tbody>
              {(b.underwritingLeases.length > 0 ? b.underwritingLeases : b.rentRoll).map((l, i) => (
                <tr key={i}><td style={{ fontWeight: 700 }}>{orNP(l.tenant)}</td><td>{orNP(l.type)}</td><td className="num">{cur(l.monthlyRent)}</td><td>{orNP(l.start)}</td><td>{l.end ?? 'No end date'}</td><td>{orNP(l.escalation)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <div style={{ padding: '8px 10px', fontSize: 11.5, color: '#64748b' }}>Rent is underwritten from the deal's rent inputs, with no lease schedule: {cur(b.monthlyRent)}/mo, {cur(b.annualRent)}/yr gross potential income in the first full year.</div>}
      </div>

      <div className="fine">
        <h3>Basis of preparation</h3>
        <p style={{ fontSize: 9.5, color: '#475569' }}>
          Every figure is computed from the property's recorded underwriting inputs with the same engine as the investor brief; coverage, debt yield and break-even occupancy
          are read from the first full operating year ({m.basisYear}). The stress rows re-score that year with net operating income down 10% and the interest rate up 100 basis points.
          Loan terms are as underwritten and are not a quote or commitment. County figures are public records and the value shown for the end of the hold is a projection; neither is an appraisal.
          Sponsor information is as entered by the borrower and has not been verified. Figures are not independently audited.
        </p>
      </div>

      <div className="foot">
        <span>MathTree Real Estate Underwriting Platform • Lender summary</span>
        <span>Confidential • DSCR {x2(m.dscr)} • Generated {b.dateStr}</span>
      </div>
    </div>
  );
};
