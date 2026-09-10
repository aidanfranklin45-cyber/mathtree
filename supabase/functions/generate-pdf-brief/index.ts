// generate-pdf-brief/index.ts
// Institutional PDF & Executive Brief Serverless Generator for MathTree

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

function fmtCurr(num: any): string {
  const n = parseFloat(num) || 0;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtPct(num: any): string {
  const n = parseFloat(num) || 0;
  return n.toFixed(2) + '%';
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    let deal: any = {};
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      deal = body.deal || body;
    } else {
      const url = new URL(req.url);
      const title = url.searchParams.get('title') || 'Investment Underwriting Brief';
      deal = { title, inputs: {}, metrics: {} };
    }

    const title = deal.title || deal.name || 'Commercial Asset Underwriting';
    const location = deal.location || deal.address || 'Yakima, WA';
    const assetType = (deal.asset_type || deal.assetClass || 'commercial').toUpperCase();
    const status = (deal.status || 'prospect').toUpperCase();
    const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const inputs = deal.inputs || {};
    const metrics = deal.metrics || {};
    const proj: any[] = metrics.projections || [];

    const price = deal.purchase_price || inputs.purchasePrice || 0;
    const equity = deal.total_equity || metrics.initialEquity || (price * 0.25);
    const loanAmt = Math.max(0, price - equity);
    const noi = metrics.noi || (deal.year1_cashflow ? deal.year1_cashflow * 1.5 : 0);
    const debtService = metrics.annualDebtService || (deal.year1_cashflow ? Math.max(0, noi - deal.year1_cashflow) : 0);
    const cashFlow = deal.year1_cashflow || metrics.year1Cashflow || (noi - debtService);
    const coc = deal.cash_on_cash || metrics.cashOnCash || (equity > 0 ? (cashFlow / equity) * 100 : 0);
    const irr = deal.irr || metrics.irr || 0;
    const em = deal.equity_multiple || metrics.equityMultiple || 1.0;
    const dscr = metrics.dscr || (debtService > 0 ? (noi / debtService).toFixed(2) : 'N/A');

    // Build Projections Rows
    let tableRows = '';
    if (proj.length > 0) {
      tableRows = proj.map(p => `
        <tr style="border-bottom: 1px solid #e2e8f0; font-size: 11px;">
          <td style="padding: 6px 8px; font-weight: bold; text-align: left;">Year ${p.year}</td>
          <td style="padding: 6px 8px; text-align: right;">${fmtCurr(p.propertyValue)}</td>
          <td style="padding: 6px 8px; text-align: right;">${fmtCurr(p.grossPotentialIncome || p.effectiveGrossIncome)}</td>
          <td style="padding: 6px 8px; text-align: right; color: #047857; font-weight: 600;">${fmtCurr(p.netOperatingIncome)}</td>
          <td style="padding: 6px 8px; text-align: right;">${fmtCurr(p.debtService)}</td>
          <td style="padding: 6px 8px; text-align: right; color: #0284c7; font-weight: 700;">${fmtCurr(p.netCashFlow || p.cashFlow)}</td>
          <td style="padding: 6px 8px; text-align: right;">${fmtPct(p.cashOnCash)}</td>
          <td style="padding: 6px 8px; text-align: right; font-weight: 600;">${fmtCurr(p.equity)}</td>
        </tr>
      `).join('');
    } else {
      tableRows = `
        <tr style="border-bottom: 1px solid #e2e8f0; font-size: 11px;">
          <td style="padding: 6px 8px; font-weight: bold; text-align: left;">Year 1</td>
          <td style="padding: 6px 8px; text-align: right;">${fmtCurr(price)}</td>
          <td style="padding: 6px 8px; text-align: right;">${fmtCurr(noi * 1.5)}</td>
          <td style="padding: 6px 8px; text-align: right; color: #047857; font-weight: 600;">${fmtCurr(noi)}</td>
          <td style="padding: 6px 8px; text-align: right;">${fmtCurr(debtService)}</td>
          <td style="padding: 6px 8px; text-align: right; color: #0284c7; font-weight: 700;">${fmtCurr(cashFlow)}</td>
          <td style="padding: 6px 8px; text-align: right;">${fmtPct(coc)}</td>
          <td style="padding: 6px 8px; text-align: right; font-weight: 600;">${fmtCurr(equity)}</td>
        </tr>
      `;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MathTree Brief - ${title}</title>
  <style>
    @page { size: letter portrait; margin: 12mm 15mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 0; padding: 20px; background: #fff; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #10b981; padding-bottom: 14px; margin-bottom: 16px; }
    .logo { font-size: 20px; font-weight: 900; color: #047857; letter-spacing: -0.5px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 10px; font-weight: 800; background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; }
    .card-label { font-size: 9px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 4px; }
    .card-val { font-size: 16px; font-weight: 800; color: #0f172a; }
    .table-box { width: 100%; border-collapse: collapse; margin-top: 14px; margin-bottom: 18px; }
    .table-box th { background: #0f172a; color: #fff; font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 7px 8px; }
    .footer { border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 9px; color: #64748b; display: flex; justify-content: space-between; margin-top: 20px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">🌿 MATHTREE REAL ESTATE CAPITAL</div>
      <div style="font-size: 15px; font-weight: 800; margin-top: 4px;">${title}</div>
      <div style="font-size: 11px; color: #64748b; margin-top: 2px;">📍 ${location} • Asset Class: <strong>${assetType}</strong> • Status: <strong>${status}</strong></div>
    </div>
    <div style="text-align: right;">
      <span class="badge">INSTITUTIONAL UNDERWRITING</span>
      <div style="font-size: 10px; color: #64748b; margin-top: 6px;">Generated: ${dateStr}</div>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <div class="card-label">Purchase Price</div>
      <div class="card-val">${fmtCurr(price)}</div>
    </div>
    <div class="card">
      <div class="card-label">Required Equity</div>
      <div class="card-val">${fmtCurr(equity)}</div>
    </div>
    <div class="card">
      <div class="card-label">Debt Financing</div>
      <div class="card-val">${fmtCurr(loanAmt)}</div>
    </div>
    <div class="card">
      <div class="card-label">Year 1 NOI</div>
      <div class="card-val" style="color: #047857;">${fmtCurr(noi)}</div>
    </div>
    <div class="card">
      <div class="card-label">Annual Debt Service</div>
      <div class="card-val">${fmtCurr(debtService)}</div>
    </div>
    <div class="card">
      <div class="card-label">Year 1 Cash Flow</div>
      <div class="card-val" style="color: #0284c7;">${fmtCurr(cashFlow)}</div>
    </div>
    <div class="card">
      <div class="card-label">Cash-on-Cash Return</div>
      <div class="card-val">${fmtPct(coc)}</div>
    </div>
    <div class="card">
      <div class="card-label">10-Year Target IRR</div>
      <div class="card-val" style="color: #047857;">${fmtPct(irr)} (${em}x EM)</div>
    </div>
  </div>

  <div style="font-size: 12px; font-weight: 800; text-transform: uppercase; color: #0f172a; margin-top: 10px;">
    10-Year Pro-Forma Cash Flow Waterfall
  </div>
  <table class="table-box">
    <thead>
      <tr>
        <th style="text-align: left;">Period</th>
        <th style="text-align: right;">Asset Value</th>
        <th style="text-align: right;">Gross Income</th>
        <th style="text-align: right;">Net Operating Inc (NOI)</th>
        <th style="text-align: right;">Debt Service</th>
        <th style="text-align: right;">Net Cash Flow</th>
        <th style="text-align: right;">CoC Return</th>
        <th style="text-align: right;">Ending Equity</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>

  <div class="footer">
    <span>MathTree Platform • Direct Postgres & Serverless Underwriting Engine</span>
    <span>Confidential Institutional Investment Memo • DSCR: ${dscr}</span>
  </div>
  <script>
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => { window.print(); }, 250);
    });
  </script>
</body>
</html>`;

    return new Response(html, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8'
      }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
