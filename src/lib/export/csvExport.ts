import { DealRecord, DealMetrics } from '../math/types';
import { tryComputeDealMetrics } from '../engine/compute';

export function exportDealProformaCSV(deal: DealRecord, metrics: DealMetrics): void {
  const p0 = metrics.projections[0] || {};
  let csv = `MathTree Pro-Forma Export - ${deal.title || 'Deal'}\n`;
  csv += `Asset Class,${deal.asset_class}\n`;
  csv += `Purchase Price,${metrics.purchasePrice}\n`;
  csv += `Initial Equity,${metrics.initialEquity}\n`;
  csv += `Loan Amount,${metrics.loanAmount}\n`;
  csv += `Underwritten IRR,${metrics.irr.toFixed(2)}%\n`;
  csv += `NPV,${metrics.npv.toFixed(0)}\n`;
  csv += `Equity Multiplier,${metrics.equityMultiplier.toFixed(2)}x\n\n`;

  const startYear = deal.inputs?.closingDate ? new Date(deal.inputs.closingDate).getFullYear() : new Date().getFullYear();
  csv += `Date,Year,Property Value,Gross Revenue,Vacancy Loss,Operating Expenses,NOI,Debt Service,Cash Flow,Cash-on-Cash %,Cap Rate %,Remaining Loan Balance,Equity\n`;

  metrics.projections.forEach((p) => {
    const calYear = startYear + p.year - 1;
    const grossRev = p.effectiveGrossIncome || p.grossPotentialRent || (p.netOperatingIncome + p.operatingExpenses);
    const vacLoss = p.vacancyLoss || 0;
    const opex = p.operatingExpenses || 0;
    const noi = p.netOperatingIncome || 0;
    const debt = p.debtService || 0;
    const cf = p.netCashFlow ?? p.cashFlow ?? 0;
    const coc = (p.cashOnCash || 0).toFixed(2);
    const cap = p.propertyValue > 0 ? ((noi / p.propertyValue) * 100).toFixed(2) : '0.00';
    const loanBal = p.endingLoanBalance || 0;
    const eq = Math.max(0, p.propertyValue - loanBal);

    csv += `${calYear},Year ${p.year},${Math.round(p.propertyValue)},${Math.round(grossRev)},${Math.round(vacLoss)},${Math.round(opex)},${Math.round(noi)},${Math.round(debt)},${Math.round(cf)},${coc}%,${cap}%,${Math.round(loanBal)},${Math.round(eq)}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = (deal.title || 'deal').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  a.download = `${safeName}-proforma-${startYear}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportPortfolioCSV(deals: DealRecord[]): void {
  let csv = `MathTree Portfolio Deals Export\n`;
  csv += `Title,Status,Asset Class,Purchase Price,Hold Period,IRR %,Cash-on-Cash %,Gross Annual Rent,Annual Debt Service,Holding Entity\n`;

  deals.forEach((d) => {
    const price = d.purchase_price || d.inputs?.purchasePrice || 0;
    const hold = d.inputs?.holdingPeriod || d.inputs?.exitYear || 10;
    const em = tryComputeDealMetrics(d);
    const irr = em?.irr || 0;
    const coc = em?.cashOnCash || 0;
    const rent = d.inputs?.grossRentAnnual || (d.inputs?.monthlyRent ? d.inputs.monthlyRent * 12 : 0);
    const debt = em?.projections?.[0]?.debtService || 0;
    const entity = d.holding_entity || d.entity_id || 'Direct';

    csv += `"${(d.title || '').replace(/"/g, '""')}",${d.status},${d.asset_class},${price},${hold},${Number(irr).toFixed(2)}%,${Number(coc).toFixed(2)}%,${rent},${debt},"${entity}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mathtree-portfolio-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
