/**
 * A SIMULATED reader answer for the Cowiche Creek text: written by hand the way a competent reader would answer it, slips included, because the
 * live reader could not be reached when this was written. Replace it with a recorded `parse-document` response when one can be captured.
 */
export const box = (value: unknown, confidence = 1, evidence?: string) => ({ value, confidence, ...(evidence ? { evidence } : {}) });
export const line = (label: string, category: string, amount: number) => ({ label: box(label), category: box(category), amount: box(amount) });
export const mix = (type: string, count: number, sf: number, rent: number) => ({ unitType: box(type), unitCount: box(count), avgSqFt: box(sf), currentMonthlyRent: box(rent), marketMonthlyRent: box(null) });

/** What a competent reader returns for pages 4, 5, 9, 11 and 12. The per-type rents come from the comparables row for the property itself (1,850 and 1,950), the only place they are printed. */
export const COWICHE_READER_ANSWER = {
  address: box('5101 W Powerhouse Rd'), city: box('Yakima'), state: box('WA'), zip: box('98908'), apn: box('181309-41011'),
  assetClass: box('multi_family'), askingPrice: box(18_400_000), squareFeet: box(83_628), lotSqFt: box(386_377), yearBuilt: box(2023), unitCount: box(66),
  claimedNoi: box(1_093_745), claimedCapRatePercent: box(5.94), averageCurrentRent: box(1832), averageMarketRent: box(1905),
  unitMix: [mix('2 Bd / 2.5 Bth TH', 30, 1266, 1850), mix('3 Bd / 2.5 Bth TH', 36, 1268, 1950)],
  income: [
    line('Gross Potential Rent', 'rent', 1_450_800), line('Vacancy', 'vacancy_credit_loss', -72_540), line('RUBS', 'recoveries', 103_932),
    line('Pet', 'other_income', 34_686), line('Misc. Income', 'other_income', 19_582),
  ],
  expenses: [
    line('Maint/Repair', 'repairs_maintenance', 33_000), line('Turnover', 'repairs_maintenance', 11_880), line('Payroll', 'payroll', 32_000), line('R&M Payroll', 'payroll', 25_000),
    line('Contract Services', 'other', 8_941), line('Landscaping', 'other', 27_189), line('Marketing', 'marketing', 7_720), line('Admin', 'other', 10_696),
    line('Reserves', 'reserves_capex', 16_500), line('RE Taxes', 'property_tax', 115_670), line('Insurance', 'insurance', 19_962),
    line('Utilities W/S/G/E', 'utilities', 73_382), line('Management', 'management', 53_522),
  ],
};
