/**
 * THE TEST BENCH'S DOCUMENTS. Every property, address, name and figure here is invented: these are made-up documents written to look like the
 * ones an owner would add, each with traps a careful underwriter would catch, so the engine can be tried on every kind of property and not only
 * the one real memorandum. A real document is added the same way: the text exactly as the app's PDF reader returns it (with `--- Page N ---`
 * markers, a tab between table columns), contact details and tenant names removed, and what a competent reader would answer for it.
 *
 * The text and the reader's answer for each document are kept together so a figure the reader returns can be checked against the text.
 */

import type { DocumentType } from '../../intake';

export interface BenchDocument {
  name: string;
  type: Exclude<DocumentType, 'unknown'>;
  text: string;
  /** What a competent reader returns for this text (plain values and a short list of doubts). Simulated: replace with a recorded response. */
  answer: Record<string, unknown>;
}

const page = (n: number, ...lines: string[]): string => [`--- Page ${n} ---`, ...lines].join('\n');
const row = (...cells: Array<string | number>): string => cells.join('\t');

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 1. A single-family rental house. Traps: the in-place and pro forma columns sit side by side; the maintenance figure is an estimate; the
//    seller charges a management fee; the printed NOI is after the reserve.
// ---------------------------------------------------------------------------------------------------------------------------------------------

export const SFR_HOUSE: BenchDocument = {
  name: 'Sunnyside house summary.pdf',
  type: 'offering_memorandum',
  text: [
    page(1, 'INVESTMENT SUMMARY', '4417 E Sunnyside Ave, Spokane Valley, WA 99212', 'Single-family rental house'),
    page(2,
      'PROPERTY',
      row('Asking price', '$415,000'),
      row('Year built', '1998'),
      row('Living area', '1,860 SF'),
      row('Lot', '0.21 acres'),
      row('Bedrooms / baths', '4 / 2.5'),
      row('Parcel number', '45123.0917'),
      'LEASE',
      row('Current rent', '$2,650 per month (lease through 8/31/2027)'),
      row('Market rent', '$2,800 per month'),
    ),
    page(3,
      row('ANNUAL INCOME AND EXPENSES', 'In place', 'Pro forma'),
      row('Gross rent', '$31,800', '$33,600'),
      row('Vacancy (none, leased)', '$0', '($1,680)'),
      row('Total income', '$31,800', '$31,920'),
      row('Property taxes', '$3,980', '$4,100'),
      row('Insurance', '$1,420', '$1,500'),
      row('Maintenance (estimated)', '$1,800', '$1,800'),
      row('Property management (8%)', '$2,544', '$2,554'),
      row('Reserves', '$1,200', '$1,200'),
      row('Total expenses', '$10,944', '$11,154'),
      row('Net operating income', '$20,856', '$20,766'),
      row('Cap rate', '5.03%', '5.00%'),
    ),
  ].join('\n'),
  answer: {
    address: '4417 E Sunnyside Ave', city: 'Spokane Valley', state: 'WA', zip: '99212', apn: '45123.0917', assetClass: 'residential',
    askingPrice: 415_000, squareFeet: 1860, lotAcres: 0.21, yearBuilt: 1998, unitCount: 1, averageCurrentRent: 2650, averageMarketRent: 2800,
    claimedNoi: 20_856, claimedCapRatePercent: 5.03,
    unitMix: [],
    income: [{ label: 'Gross rent', category: 'rent', amount: 31_800 }],
    expenses: [
      { label: 'Property taxes', category: 'property_tax', amount: 3_980 },
      { label: 'Insurance', category: 'insurance', amount: 1_420 },
      { label: 'Maintenance (estimated)', category: 'repairs_maintenance', amount: 1_800 },
      { label: 'Property management (8%)', category: 'management', amount: 2_544 },
      { label: 'Reserves', category: 'reserves_capex', amount: 1_200 },
    ],
    doubts: [{ field: 'expenses[2].amount', why: 'Marked as an estimate' }],
  },
};

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 2. A triple-net retail center. Traps: tenant reimbursements are income lines the engine nets off the costs; an in-place and a pro forma
//    column; management is a percent of income; the vacant suite; the printed NOI is after the reserve.
// ---------------------------------------------------------------------------------------------------------------------------------------------

export const NNN_RETAIL: BenchDocument = {
  name: 'Parkside Retail Center OM.pdf',
  type: 'offering_memorandum',
  text: [
    page(1, 'PARKSIDE RETAIL CENTER', 'OFFERING MEMORANDUM', '2210 N Argonne Rd, Spokane Valley, WA 99212'),
    page(2,
      'PROPERTY SUMMARY',
      row('Asking price', '$6,850,000'),
      row('Gross leasable area', '28,400 SF'),
      row('Year built', '2004'),
      row('Land area', '2.6 acres'),
      row('Occupancy', '88% (one vacant suite, 3,400 SF)'),
      row('Lease structure', 'Triple net (NNN) with annual 3% increases'),
      row('Parcel number', '36274.2201'),
      'TENANTS',
      '[TENANT_1], [TENANT_2], [TENANT_3] and two local tenants, remaining term averaging 4.6 years',
    ),
    page(3,
      row('ANNUAL INCOME AND EXPENSES', 'In place', 'Pro forma (leased up)'),
      row('Base rent', '$412,600', '$455,000'),
      row('Expense reimbursements (CAM, taxes, insurance)', '$108,900', '$124,000'),
      row('Percentage rent and other', '$6,200', '$6,200'),
      row('Vacancy and credit loss', '($24,700)', '($13,650)'),
      row('Effective gross income', '$503,000', '$571,550'),
      row('Real estate taxes', '$58,100', '$59,800'),
      row('Insurance', '$12,600', '$13,000'),
      row('Common area maintenance', '$41,300', '$42,500'),
      row('Common area utilities', '$9,800', '$10,000'),
      row('Management (3.4% of income)', '$17,200', '$19,400'),
      row('Reserves', '$8,500', '$8,500'),
      row('Total expenses', '$147,500', '$153,200'),
      row('Net operating income', '$355,500', '$418,350'),
      row('Cap rate', '5.19%', '6.11%'),
    ),
  ].join('\n'),
  answer: {
    address: '2210 N Argonne Rd', city: 'Spokane Valley', state: 'WA', zip: '99212', apn: '36274.2201', assetClass: 'commercial',
    askingPrice: 6_850_000, squareFeet: 28_400, lotAcres: 2.6, yearBuilt: 2004, occupancyPercent: 88, expenseStructure: 'NNN', claimedNoi: 355_500, claimedCapRatePercent: 5.19,
    tenantSummaries: '[TENANT_1], [TENANT_2], [TENANT_3] and two local tenants, remaining term averaging 4.6 years',
    unitMix: [],
    income: [
      { label: 'Base rent', category: 'rent', amount: 412_600 },
      { label: 'Expense reimbursements (CAM, taxes, insurance)', category: 'recoveries', amount: 108_900 },
      { label: 'Percentage rent and other', category: 'other_income', amount: 6_200 },
      { label: 'Vacancy and credit loss', category: 'vacancy_credit_loss', amount: -24_700 },
    ],
    expenses: [
      { label: 'Real estate taxes', category: 'property_tax', amount: 58_100 },
      { label: 'Insurance', category: 'insurance', amount: 12_600 },
      { label: 'Common area maintenance', category: 'repairs_maintenance', amount: 41_300 },
      { label: 'Common area utilities', category: 'utilities', amount: 9_800 },
      { label: 'Management (3.4% of income)', category: 'management', amount: 17_200 },
      { label: 'Reserves', category: 'reserves_capex', amount: 8_500 },
    ],
    doubts: [],
  },
};

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 3. A self-storage facility. Traps: the unit mix adds up to 308 units while the memorandum says 312; the average in-place rent is below the
//    street rate; fees and merchandise are income beside rent; payroll and marketing are charged separately for storage; off-site management.
// ---------------------------------------------------------------------------------------------------------------------------------------------

export const STORAGE_FACILITY: BenchDocument = {
  name: 'Selah Self Storage OM.pdf',
  type: 'offering_memorandum',
  text: [
    page(1, 'SELAH SELF STORAGE', 'OFFERING MEMORANDUM', '812 S 1st St, Selah, WA 98942'),
    page(2,
      'FACILITY SUMMARY',
      row('Asking price', '$3,900,000'),
      row('Total units', '312'),
      row('Rentable area', '41,500 SF'),
      row('Year built', '2006'),
      row('Physical occupancy', '88%'),
      row('Average in-place rent', '$118 per unit per month'),
      row('Current street rate (average)', '$131 per unit per month'),
      row('Climate-controlled units', '40'),
      row('Management', 'Off-site, third party'),
    ),
    page(3,
      row('UNIT MIX', 'Units', 'In-place rent'),
      row('5x5', '48', '$62'),
      row('5x10', '96', '$88'),
      row('10x10', '88', '$135'),
      row('10x15', '44', '$178'),
      row('10x20', '32', '$215'),
    ),
    page(4,
      row('ANNUAL INCOME AND EXPENSES', 'Trailing 12 months'),
      row('Gross potential rent', '$441,800'),
      row('Vacancy (12%)', '($53,000)'),
      row('Fees (administration, late, tenant insurance)', '$31,200'),
      row('Merchandise and retail', '$6,400'),
      row('Effective gross income', '$426,400'),
      row('Real estate taxes', '$27,400'),
      row('Insurance', '$9,100'),
      row('Utilities', '$14,800'),
      row('Repairs and maintenance', '$12,600'),
      row('Payroll (on-site manager)', '$58,000'),
      row('Marketing', '$12,000'),
      row('Management (off-site, 5%)', '$21,300'),
      row('Software and card fees', '$9,700'),
      row('Reserves', '$6,200'),
      row('Total expenses', '$171,100'),
      row('Net operating income', '$255,300'),
      row('Cap rate', '6.55%'),
    ),
  ].join('\n'),
  answer: {
    address: '812 S 1st St', city: 'Selah', state: 'WA', zip: '98942', assetClass: 'storage',
    askingPrice: 3_900_000, squareFeet: 41_500, yearBuilt: 2006, unitCount: 312, occupancyPercent: 88, averageCurrentRent: 118, averageMarketRent: 131,
    claimedNoi: 255_300, claimedCapRatePercent: 6.55,
    unitMix: [
      { unitType: '5x5', unitCount: 48, currentMonthlyRent: 62 },
      { unitType: '5x10', unitCount: 96, currentMonthlyRent: 88 },
      { unitType: '10x10', unitCount: 88, currentMonthlyRent: 135 },
      { unitType: '10x15', unitCount: 44, currentMonthlyRent: 178 },
      { unitType: '10x20', unitCount: 32, currentMonthlyRent: 215 },
    ],
    income: [
      { label: 'Gross potential rent', category: 'rent', amount: 441_800 },
      { label: 'Vacancy (12%)', category: 'vacancy_credit_loss', amount: -53_000 },
      { label: 'Fees (administration, late, tenant insurance)', category: 'other_income', amount: 31_200 },
      { label: 'Merchandise and retail', category: 'other_income', amount: 6_400 },
    ],
    expenses: [
      { label: 'Real estate taxes', category: 'property_tax', amount: 27_400 },
      { label: 'Insurance', category: 'insurance', amount: 9_100 },
      { label: 'Utilities', category: 'utilities', amount: 14_800 },
      { label: 'Repairs and maintenance', category: 'repairs_maintenance', amount: 12_600 },
      { label: 'Payroll (on-site manager)', category: 'payroll', amount: 58_000 },
      { label: 'Marketing', category: 'marketing', amount: 12_000 },
      { label: 'Management (off-site, 5%)', category: 'management', amount: 21_300 },
      { label: 'Software and card fees', category: 'other', amount: 9_700 },
      { label: 'Reserves', category: 'reserves_capex', amount: 6_200 },
    ],
    doubts: [],
  },
};

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 4. A 24-unit apartment building with three documents. Traps: the memorandum's costs and the operating statement's differ (the statement's are
//    higher, and it covers ten months, not twelve); the statement lists debt service and depreciation below its NOI; the rent roll's total is not the
//    memorandum's; three units are vacant. Two documents carry the costs: only one may be counted.
// ---------------------------------------------------------------------------------------------------------------------------------------------

const RENTS = [1240, 1260, 1280, 1300, 1320, 1340, 1360, 1380];
const UNITS = Array.from({ length: 24 }, (_, i) => `${Math.floor(i / 8) + 1}${String((i % 8) + 1).padStart(2, '0')}`);
const VACANT = new Set([4, 13, 21]);
const rentOf = (i: number) => RENTS[i % 8];
const occupiedRent = UNITS.reduce((s, _, i) => s + (VACANT.has(i) ? 0 : rentOf(i)), 0); // 21 units
const dollars = (n: number) => '$' + n.toLocaleString('en-US');

export const MAPLE_OM: BenchDocument = {
  name: 'Maple Court OM.pdf',
  type: 'offering_memorandum',
  text: [
    page(1, 'MAPLE COURT APARTMENTS', 'OFFERING MEMORANDUM', '902 W Maple St, Yakima, WA 98902'),
    page(2,
      row('Asking price', '$3,150,000'),
      row('Units', '24'),
      row('Net rentable area', '18,600 SF'),
      row('Year built', '1987'),
      row('Average in-place rent', '$1,290 per unit per month'),
      row('Parcel number', '181312-22014'),
    ),
    page(3,
      row('ANNUAL INCOME AND EXPENSES', 'Seller pro forma'),
      row('Gross potential rent', '$371,500'),
      row('Vacancy (5%)', '($18,600)'),
      row('Other income', '$14,400'),
      row('Effective gross income', '$367,300'),
      row('Real estate taxes', '$33,800'),
      row('Insurance', '$11,200'),
      row('Utilities', '$36,500'),
      row('Repairs and maintenance', '$24,000'),
      row('Payroll', '$18,000'),
      row('Management (5%)', '$18,400'),
      row('Reserves', '$6,000'),
      row('Total expenses', '$147,900'),
      row('Net operating income', '$219,400'),
      row('Cap rate', '6.97%'),
    ),
  ].join('\n'),
  answer: {
    address: '902 W Maple St', city: 'Yakima', state: 'WA', zip: '98902', apn: '181312-22014', assetClass: 'multi_family',
    askingPrice: 3_150_000, squareFeet: 18_600, yearBuilt: 1987, unitCount: 24, averageCurrentRent: 1290, claimedNoi: 219_400, claimedCapRatePercent: 6.97,
    unitMix: [],
    income: [
      { label: 'Gross potential rent', category: 'rent', amount: 371_500 },
      { label: 'Vacancy (5%)', category: 'vacancy_credit_loss', amount: -18_600 },
      { label: 'Other income', category: 'other_income', amount: 14_400 },
    ],
    expenses: [
      { label: 'Real estate taxes', category: 'property_tax', amount: 33_800 },
      { label: 'Insurance', category: 'insurance', amount: 11_200 },
      { label: 'Utilities', category: 'utilities', amount: 36_500 },
      { label: 'Repairs and maintenance', category: 'repairs_maintenance', amount: 24_000 },
      { label: 'Payroll', category: 'payroll', amount: 18_000 },
      { label: 'Management (5%)', category: 'management', amount: 18_400 },
      { label: 'Reserves', category: 'reserves_capex', amount: 6_000 },
    ],
    doubts: [],
  },
};

export const MAPLE_T10: BenchDocument = {
  name: 'Maple Court operating statement.pdf',
  type: 'operating_statement',
  text: [
    page(1, 'MAPLE COURT APARTMENTS', 'OPERATING STATEMENT', 'Ten months, November 1, 2025 to August 31, 2026'),
    page(2,
      row('INCOME', 'Ten months'),
      row('Gross potential rent', '$296,300'),
      row('Vacancy', '($21,400)'),
      row('Other income', '$10,900'),
      row('Effective gross income', '$285,800'),
      row('OPERATING EXPENSES'),
      row('Real estate taxes', '$28,200'),
      row('Insurance', '$10,300'),
      row('Utilities', '$33,100'),
      row('Repairs and maintenance', '$26,800'),
      row('Payroll', '$15,000'),
      row('Management', '$14,800'),
      row('Total operating expenses', '$128,200'),
      row('Net operating income', '$157,600'),
      row('BELOW THE LINE'),
      row('Mortgage interest', '$41,500'),
      row('Depreciation', '$22,000'),
      row('Net income', '$94,100'),
    ),
  ].join('\n'),
  answer: {
    periodStart: '2025-11-01', periodEnd: '2026-08-31', reportedEffectiveGrossIncome: 285_800, reportedTotalExpenses: 128_200, reportedNoi: 157_600,
    income: [
      { label: 'Gross potential rent', category: 'rent', amount: 296_300 },
      { label: 'Vacancy', category: 'vacancy_credit_loss', amount: -21_400 },
      { label: 'Other income', category: 'other_income', amount: 10_900 },
    ],
    expenses: [
      { label: 'Real estate taxes', category: 'property_tax', amount: 28_200 },
      { label: 'Insurance', category: 'insurance', amount: 10_300 },
      { label: 'Utilities', category: 'utilities', amount: 33_100 },
      { label: 'Repairs and maintenance', category: 'repairs_maintenance', amount: 26_800 },
      { label: 'Payroll', category: 'payroll', amount: 15_000 },
      { label: 'Management', category: 'management', amount: 14_800 },
      { label: 'Mortgage interest', category: 'debt_service', amount: 41_500 },
      { label: 'Depreciation', category: 'depreciation_amortization', amount: 22_000 },
    ],
    doubts: [],
  },
};

export const MAPLE_ROLL: BenchDocument = {
  name: 'Maple Court rent roll.pdf',
  type: 'rent_roll',
  text: [
    page(1, 'MAPLE COURT APARTMENTS', 'RENT ROLL as of September 1, 2026'),
    page(2,
      row('Unit', 'Tenant', 'Monthly rent', 'Status'),
      ...UNITS.map((u, i) => (VACANT.has(i) ? row(u, '(vacant)', '', 'Vacant') : row(u, `[TENANT_${i + 1}]`, dollars(rentOf(i)), 'Occupied'))),
      row('Total', '', dollars(occupiedRent), '21 of 24 occupied'),
    ),
  ].join('\n'),
  answer: {
    asOfDate: '2026-09-01', rentPeriod: 'monthly', reportedTotalRent: occupiedRent, reportedUnitCount: 24,
    rows: UNITS.map((u, i) => (VACANT.has(i)
      ? { unit: u, tenantName: null, monthlyRent: null, status: 'vacant' }
      : { unit: u, tenantName: `[TENANT_${i + 1}]`, monthlyRent: rentOf(i), status: 'occupied' })),
    doubts: [],
  },
};

/** The monthly rent the rent roll's occupied units pay, for the answer key. */
export const MAPLE_OCCUPIED_RENT = occupiedRent;

/** Every document of the bench, with what identifies it in a pasted text (its title line), for the development stand-in reader and the text files. */
export const BENCH_DOCUMENTS: Array<BenchDocument & { signature: RegExp; file: string }> = [
  { ...SFR_HOUSE, signature: /4417 E Sunnyside/i, file: 'sunnyside-house.txt' },
  { ...NNN_RETAIL, signature: /PARKSIDE RETAIL CENTER/, file: 'parkside-retail.txt' },
  { ...STORAGE_FACILITY, signature: /SELAH SELF STORAGE/, file: 'selah-storage.txt' },
  { ...MAPLE_OM, signature: /MAPLE COURT APARTMENTS[\s\S]*OFFERING MEMORANDUM/, file: 'maple-court-om.txt' },
  { ...MAPLE_T10, signature: /MAPLE COURT APARTMENTS[\s\S]*OPERATING STATEMENT/, file: 'maple-court-statement.txt' },
  { ...MAPLE_ROLL, signature: /MAPLE COURT APARTMENTS[\s\S]*RENT ROLL/, file: 'maple-court-rent-roll.txt' },
];
