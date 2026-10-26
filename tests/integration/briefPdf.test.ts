import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
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

    // Heights of each printed page's blocks at the sheet's own width: a page starts at the first block and at each block marked `.pg`
    const groups: number[] = await page.evaluate((w) => {
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
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    const text = (await page.innerText('#printable-brief')).toLowerCase();
    return { sheets, groups, overflowX, text };
  } finally {
    await page.close();
  }
}

describe('printed briefs (public sample deal)', () => {
  it('the investor brief tells the story in order and every page fits one sheet', async () => {
    const r = await render('/demo-brief', 'What the simulation varied', 'investor');
    console.log(`investor brief PDF: ${join(outDir, 'investor.pdf')} (${r.sheets} sheets)`);
    // The story, in the order a lender reads it
    const order = ['beats your opportunity cost|close to your opportunity cost|below your opportunity cost', '10-year pro-forma forecast', 'where the numbers come from', 'down payment & leverage sensitivity', 'monte carlo simulation'];
    let at = -1;
    for (const alt of order) {
      const i = Math.min(...alt.split('|').map((t) => { const k = r.text.indexOf(t); return k < 0 ? Infinity : k; }));
      expect(i, `"${alt}" is missing`).toBeLessThan(Infinity);
      expect(i, `"${alt}" is out of order`).toBeGreaterThan(at);
      at = i;
    }
    expect(r.overflowX).toBe(false);
    // The overview, the pro forma with its charts, leverage and the Monte Carlo must each fit one sheet. The sources-and-notes page and
    // the county-records page grow with the deal and may run on.
    r.groups.forEach((h, i) => { if (i !== 2 && i !== r.groups.length - 1) expect(h, `page ${i + 1} is ${Math.round(h)}px tall`).toBeLessThanOrEqual(PRINTABLE_HEIGHT); });
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
    const html = renderToStaticMarkup(React.createElement(DealBrief, { model: m, monteCarlo: null }));
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    try {
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body style="margin:0">${html}</body></html>`);
      await page.emulateMedia({ media: 'print' });
      const pdf = await page.pdf({ format: 'Letter', landscape: true, printBackground: true, preferCSSPageSize: true });
      writeFileSync(join(outDir, 'long-pipeline.pdf'), pdf);
      console.log(`long pipeline PDF: ${join(outDir, 'long-pipeline.pdf')}`);
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
