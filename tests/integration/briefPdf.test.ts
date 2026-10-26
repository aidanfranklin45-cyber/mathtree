import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBriefModel } from '../../src/lib/export/buildBriefModel';
import { withLegacyDefaults } from '../../src/lib/engine/testInputs';

/**
 * Renders the investor brief and the lender summary to real PDFs in headless Chromium and checks that they print as intended.
 * It reads the public sample deal (`is_demo`) through the app's own demo routes: nothing is written anywhere and no sign-in is used.
 *
 * Run on demand: `npm run test:brief`. The PDFs are written to a temp folder (path printed) so they can be opened and looked at.
 * Needs a Chromium for Playwright (`npx playwright install chromium`) and network access to the sample deal.
 */

// Letter landscape with 8 mm margins top and bottom, in CSS pixels at 96 dpi. A block taller than this cannot share a sheet.
const PRINTABLE_HEIGHT = 755;
// The printed width of the same sheet less 10 mm margins each side
const PRINT_WIDTH = 979;

let server: ViteDevServer;
let browser: Browser;
let base = '';
const outDir = mkdtempSync(join(tmpdir(), 'mathtree-brief-'));

beforeAll(async () => {
  server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  const addr = server.httpServer!.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 5173}`;
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

/** Heights of each printed page's blocks at the sheet's own width. A page starts at the first block and at each block marked `.pg`; the fine print flows and is not measured. */
async function measureGroups(page: Page): Promise<number[]> {
  return page.evaluate((w) => {
    const el = document.querySelector('#printable-brief') as HTMLElement;
    el.style.width = `${w}px`; el.style.maxWidth = `${w}px`; el.style.padding = '0';
    const out: number[] = [];
    let cur = 0;
    for (const c of Array.from(el.children) as HTMLElement[]) {
      if (c.tagName === 'STYLE' || c.classList.contains('toolbar') || c.classList.contains('foot') || c.classList.contains('fine')) continue;
      if (c.classList.contains('pg') && cur > 0) { out.push(cur); cur = 0; }
      cur += c.getBoundingClientRect().height + 10;
    }
    out.push(cur);
    return out;
  }, PRINT_WIDTH);
}

/** A sheet with a few stray lines on it is a layout failure: every sheet but the last must carry real content. */
function expectNoOrphanSheets(pages: string[]) {
  pages.slice(0, -1).forEach((t, i) => expect(t.replace(/\s+/g, ' ').trim().length, `sheet ${i + 1} is almost empty`).toBeGreaterThan(350));
}

/** Opens a brief, waits until it is fully drawn, prints it to PDF and measures its blocks at print width. */
async function render(path: string, ready: string, name: string) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  try {
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#printable-brief', { timeout: 60_000 });
    await page.waitForFunction((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), ready, { timeout: 90_000 });
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ format: 'Letter', landscape: true, printBackground: true, preferCSSPageSize: true });
    writeFileSync(join(outDir, `${name}.pdf`), pdf);
    // Sheets in the PDF: Chromium writes each as a "/Type /Page" object
    const sheets = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

    const groups = await measureGroups(page);
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    const text = (await page.innerText('#printable-brief')).toLowerCase();
    return { sheets, groups, overflowX, text, pdf };
  } finally {
    await page.close();
  }
}

describe('printed briefs (public sample deal)', () => {
  it('the investor brief tells the story in order and every page fits one sheet', async () => {
    const r = await render('/demo-brief', 'What the simulation varied', 'investor');
    console.log(`investor brief PDF: ${join(outDir, 'investor.pdf')} (${r.sheets} sheets)`);
    // The story, in the order a lender reads it
    const order = ['projected to be profitable|projected to be marginal|not projected to be profitable', '10-year pro-forma forecast', 'where the numbers come from', 'down payment & leverage sensitivity', 'monte carlo simulation'];
    let at = -1;
    for (const alt of order) {
      const i = Math.min(...alt.split('|').map((t) => { const k = r.text.indexOf(t); return k < 0 ? Infinity : k; }));
      expect(i, `"${alt}" is missing`).toBeLessThan(Infinity);
      expect(i, `"${alt}" is out of order`).toBeGreaterThan(at);
      at = i;
    }
    expect(r.overflowX).toBe(false);
    // Every structured page (overview, pro forma, sources, leverage, Monte Carlo, records) fits one sheet; only the fine print flows
    r.groups.forEach((h, i) => expect(h, `page ${i + 1} is ${Math.round(h)}px tall`).toBeLessThanOrEqual(PRINTABLE_HEIGHT));
    expectNoOrphanSheets(await pageTexts(r.pdf));
    // The county parcel table is a record at the back, behind the Monte Carlo and ahead of the disclosures
    expect(r.text.indexOf('official county assessor')).toBeGreaterThan(r.text.indexOf('monte carlo simulation'));
    expect(r.text.indexOf('official county assessor')).toBeLessThan(r.text.indexOf('methodology, diligence'));
    expect(r.sheets).toBeGreaterThanOrEqual(5);
    expect(r.sheets).toBeLessThanOrEqual(7);
  }, 180_000);

  it('the lender summary is three pages and the request, coverage and stress are all on them', async () => {
    const r = await render('/demo-lender-brief', 'Basis of preparation', 'lender');
    console.log(`lender summary PDF: ${join(outDir, 'lender.pdf')} (${r.sheets} sheets)`);
    for (const t of ['loan request', 'sources & uses at closing', 'debt yield', 'break-even occupancy', 'dscr stress', 'repayment at the end of the hold', 'risks & underwriting flags']) {
      expect(r.text, `"${t}" is missing`).toContain(t);
    }
    expect(r.text).not.toContain('opportunity cost');
    expect(r.overflowX).toBe(false);
    r.groups.forEach((h, i) => expect(h, `page ${i + 1} is ${Math.round(h)}px tall`).toBeLessThanOrEqual(PRINTABLE_HEIGHT));
    expectNoOrphanSheets(await pageTexts(r.pdf));
    expect(r.sheets).toBe(3);
  }, 180_000);
});

/** Text of each page of a PDF, in order, read with the same pdf.js the app uses for documents. */
async function pageTexts(pdf: Buffer): Promise<string[]> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true, verbosity: 0 }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out.push(tc.items.map((it: any) => it.str).join(' '));
  }
  return out;
}

describe('a long pipeline deal (15-year hold, partial first year, two parcels)', () => {
  it('keeps the overview on page one, the chart titles with their charts, and the parcels behind the pro forma', async () => {
    const React = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { DealBrief } = await import('../../src/components/brief/DealBrief');
    const deal: any = {
      id: 'long', title: 'Burger Pad', asset_class: 'commercial', status: 'prospect', purchase_price: 300_000,
      inputs: withLegacyDefaults('commercial', {
        purchasePrice: 300_000, downPaymentPercent: 0, interestRate: 4.53, loanTerm: 20, exitYear: 15, closingDate: '2025-07-15', closingCosts: 12_000,
        vacancyRate: 1, expenseRatio: 1, targetCapRate: 7.5, leaseType: 'NNN', discountRate: 6,
        leases: [{ tenantName: 'Tenant', monthlyRent: 2600, leaseType: 'NNN', leaseStartDate: '2025-07-15', leaseEndDate: '2040-07-31', escalationRate: 3, escalationFrequency: 'Annual' }],
      }),
    };
    const parcels = [
      { apn: '1', formatted_apn: '18-1', is_primary: true, included: true, market_land_val: 49800, market_imp_val: 199700, acres: 0.28 },
      { apn: '2', formatted_apn: '18-2', is_primary: false, included: true, market_land_val: 38350, market_imp_val: 6800, acres: 0.22 },
    ];
    const m = buildBriefModel(deal, [], parcels as any);
    expect(m.proj.filter((p: any) => p.methodologyFootnote).length).toBeGreaterThan(5);
    const { runMonteCarlo } = await import('../../src/lib/engine');
    const mc = runMonteCarlo('commercial', m.monteCarloInputs, { runs: 200, seed: 7 });
    const html = renderToStaticMarkup(React.createElement(DealBrief, { model: m, monteCarlo: mc }));
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    try {
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body style="margin:0">${html}</body></html>`);
      await page.emulateMedia({ media: 'print' });
      const pdf = await page.pdf({ format: 'Letter', landscape: true, printBackground: true, preferCSSPageSize: true });
      writeFileSync(join(outDir, 'long-pipeline.pdf'), pdf);
      console.log(`long pipeline PDF: ${join(outDir, 'long-pipeline.pdf')}`);
      (await measureGroups(page)).forEach((h, i) => expect(h, `page ${i + 1} is ${Math.round(h)}px tall`).toBeLessThanOrEqual(PRINTABLE_HEIGHT));
      expectNoOrphanSheets(await pageTexts(pdf));
      const pages = (await pageTexts(pdf)).map((t) => t.toLowerCase());
      const where = (needle: string) => pages.findIndex((t) => t.includes(needle));
      // The three chart titles and the first chart's takeaway share one page
      const titles = ['does the income cover the loan?', 'how thick is the lender', 'what does the equity grow to?'].map(where);
      expect(titles.every((i) => i >= 0)).toBe(true);
      expect(new Set(titles).size, 'chart titles are split across pages').toBe(1);
      expect(where('net operating income covers the loan payment') === titles[0] || where('net operating income first covers') === titles[0], 'a chart is on a different page from its title').toBe(true);
      // The overview comes first, with the stoplight; the parcel table and rent roll come after the pro forma
      expect(where('opportunity cost')).toBe(0);
      expect(where('official county assessor')).toBeGreaterThan(where('monte carlo simulation'));
      expect(pages[0]).not.toContain('official county assessor');
      // The header carries the name, status and closing: no memo-type label, county or GIS badge
      expect(pages[0]).not.toContain('underwriting memo');
      expect(pages[0]).not.toContain('verified county parcel');
      expect(pages[0]).toContain('Burger Pad'.toLowerCase());
      // Pipeline prospect with no rent roll: that box is not printed at all
      expect(pages.join(' ')).not.toContain('no rent roll on file');
    } finally {
      await page.close();
    }
  }, 120_000);
});

describe('page 1 tells the napkin story for each kind of deal', () => {
  const common = { downPaymentPercent: 25, interestRate: 6.5, loanTerm: 30, exitYear: 10, closingDate: '2026-12-02', vacancyRate: 5, rentGrowth: 3, discountRate: 6, targetCapRate: 6.5, closingCosts: 5000 };
  const cases: Array<{ name: string; asset: string; inputs: Record<string, any>; verdict: string; mustHave: string[]; mustNot?: string[] }> = [
    {
      name: 'a 12-unit storage deal whose income does not cover its loan', asset: 'storage',
      inputs: { ...common, purchasePrice: 200_000, downPaymentPercent: 10, interestRate: 6.53, closingCosts: 2500, rehabCosts: 2500, expenseRatio: 35, payrollMarketingPercent: 8, unitCount: 12, storageRentPerUnit: 150, storageUnitCount: 12 },
      verdict: 'not projected to be profitable', mustHave: ['units', 'average rent per unit', 'what the loan costs', 'not projected to pay for itself'],
    },
    {
      name: 'a 10-unit apartment building that clears the bar', asset: 'multi-unit',
      inputs: { ...common, purchasePrice: 900_000, expenseRatio: 38, unitCount: 10, monthlyRentPerUnit: 1700 },
      verdict: 'projected to be profitable', mustHave: ['units', 'yield on cost', 'covers the loan at'], mustNot: ['not projected'],
    },
    {
      name: 'a single-family house', asset: 'single-family',
      inputs: { ...common, purchasePrice: 300_000, expenseRatio: 30, monthlyRent: 2600, appreciationRate: 3 },
      verdict: '', mustHave: ['monthly rent', 'net operating income'],
    },
    {
      name: 'a lease-built deal states the engine\'s rent, not a reading of its lease records', asset: 'commercial',
      inputs: { ...common, downPaymentPercent: 0, purchasePrice: 300_000, closingDate: '2025-07-15', leaseType: 'NNN', expenseRatio: 1, leases: [{ tenantName: 'Stop and Go Burgers Operating LLC', monthlyRent: 2600, leaseType: 'NNN', leaseStartDate: '2025-07-15', leaseEndDate: '2036-08-03', escalationRate: 3 }] },
      verdict: '', mustHave: ['rent for the year', 'on average'], mustNot: ['stop and go burgers', 'as signed', 'tenant', 'average rent per unit'],
    },
    {
      name: 'extra lease records, such as a pre-lease or intercompany one, never change the story', asset: 'commercial',
      inputs: { ...common, downPaymentPercent: 0, purchasePrice: 300_000, closingDate: '2025-07-15', leaseType: 'NNN', expenseRatio: 1, leases: [
        { tenantName: 'Stop and Go Burgers Operating LLC', monthlyRent: 2600, leaseType: 'NNN', leaseStartDate: '2025-08-03', leaseEndDate: '2036-08-03', escalationRate: 3 },
        { tenantName: 'Stop and Go Burgers Operating LLC (intercompany rent before the lease)', monthlyRent: 2600, leaseType: 'NNN', leaseStartDate: '2025-07-15', leaseEndDate: '2036-08-03', escalationRate: 3 },
      ] },
      verdict: '', mustHave: ['rent for the year'], mustNot: ['2 tenants', 'tenant', 'as signed', 'intercompany'],
    },
  ];
  it.each(cases)('$name', async ({ asset, inputs, verdict, mustHave, mustNot }) => {
    const React = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { DealBrief } = await import('../../src/components/brief/DealBrief');
    const deal: any = { id: 'f', title: 'fixture deal', asset_class: asset, status: 'prospect', inputs: withLegacyDefaults(asset as any, inputs) };
    const m = buildBriefModel(deal, [], []);
    const html = renderToStaticMarkup(React.createElement(DealBrief, { model: m, monteCarlo: null }));
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    try {
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body style="margin:0">${html}</body></html>`);
      await page.emulateMedia({ media: 'print' });
      const pdf = await page.pdf({ format: 'Letter', landscape: true, printBackground: true, preferCSSPageSize: true });
      writeFileSync(join(outDir, `napkin-${asset}.pdf`), pdf);
      const pages = (await pageTexts(pdf)).map((t) => t.toLowerCase());
      // Page 1 is the overview and fits one sheet: the pro forma starts on page 2
      expect(pages[0]).toContain('the back-of-the-napkin math');
      expect(pages[0]).not.toContain('10-year pro-forma forecast');
      expect(pages[1]).toContain('pro-forma forecast');
      if (verdict) expect(pages[0]).toContain(verdict);
      for (const t of mustHave) expect(pages[0], `page 1 is missing "${t}"`).toContain(t);
      for (const t of mustNot ?? []) expect(pages[0], `page 1 must not say "${t}"`).not.toContain(t);
      expect(pages[0]).not.toContain(' tenants');
      // The header carries no parcel number
      expect(pages[0]).not.toContain('apn');
      // The story reads in order: earns, then the yield, then whether it pays for itself
      const at = ['1. what it earns', '2. what it cost, and the yield', '3. whether it pays for itself'].map((t) => pages[0].indexOf(t));
      expect(at.every((i) => i >= 0) && at[0] < at[1] && at[1] < at[2]).toBe(true);
    } finally {
      await page.close();
    }
  }, 120_000);
});
