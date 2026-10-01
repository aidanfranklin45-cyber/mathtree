import { describe, it, expect } from 'vitest';
import {
  checkWashingtonRentIncrease, buildRentIncreaseNoticeHtml, isWashingtonProperty, isResidentialAsset, addDays, addMonths,
  WA_RENT_CAP_BY_YEAR, noticeReminderStage, type RentIncreaseCheckInput,
} from '../../../supabase/functions/_shared/rentIncreaseRules';

const base: RentIncreaseCheckInput = {
  today: '2026-10-01', currentRent: 2000, newRent: 2100, effectiveDate: '2027-01-15', termType: 'month_to_month',
  tenancyStartDate: '2024-03-01', lastIncreaseDate: null, noticeServedDate: null,
};
const check = (over: Partial<RentIncreaseCheckInput> = {}) => checkWashingtonRentIncrease({ ...base, ...over });

describe('Washington notice period (RCW 59.18.140)', () => {
  it('an increase with 90 days or more of notice is allowed', () => {
    const r = check({ effectiveDate: '2027-01-02' }); // exactly 93 days from today
    expect(r.ok).toBe(true);
    expect(r.noticeDays).toBe(90);
  });

  it('less than 90 days from today (notice not yet served) is blocked, with the earliest allowed date', () => {
    const r = check({ effectiveDate: '2026-12-15' });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('2026-12-30'); // 2026-10-01 + 90 days
    expect(r.earliestEffectiveDate).toBe('2026-12-30');
  });

  it('counts the 90 days from the date the notice was actually given', () => {
    expect(check({ noticeServedDate: '2026-09-20', effectiveDate: '2026-12-19' }).ok).toBe(true);  // 90 days
    expect(check({ noticeServedDate: '2026-09-20', effectiveDate: '2026-12-18' }).ok).toBe(false); // 89 days
  });

  it('a notice date in the future is rejected', () => {
    expect(check({ noticeServedDate: '2026-10-05' }).errors.join(' ')).toContain('cannot be in the future');
  });

  it('subsidized tenancies need 30 days, and are warned to confirm the program rules', () => {
    const r = check({ subsidized: true, effectiveDate: '2026-11-05' });
    expect(r.noticeDays).toBe(30);
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toContain('Subsidized');
  });

  it('tells the owner the last day to give notice', () => {
    expect(check({ effectiveDate: '2027-02-01' }).latestNoticeDate).toBe('2026-11-03');
    expect(check({ effectiveDate: '2027-02-01' }).warnings.join(' ')).toContain('2026-11-03');
  });
});

describe('Washington cap (RCW 59.18.700)', () => {
  it('uses the published maximum for the year the increase takes effect', () => {
    expect(WA_RENT_CAP_BY_YEAR[2026]).toBe(9.683);
    const ok = check({ currentRent: 2000, newRent: 2193, effectiveDate: '2026-12-31', noticeServedDate: '2026-09-30' }); // +9.65%
    expect(ok.ok).toBe(true);
    expect(ok.maxPct).toBe(9.683);
    const over = check({ currentRent: 2000, newRent: 2194, effectiveDate: '2026-12-31', noticeServedDate: '2026-09-30' }); // +9.7%
    expect(over.ok).toBe(false);
    expect(over.errors.join(' ')).toContain('limit of 9.683%');
    expect(over.errors.join(' ')).toContain('$2,193.66');
  });

  it('2027 is capped at 10%', () => {
    expect(check({ currentRent: 1000, newRent: 1100, effectiveDate: '2027-02-01' }).ok).toBe(true);
    expect(check({ currentRent: 1000, newRent: 1101, effectiveDate: '2027-02-01' }).ok).toBe(false);
  });

  it('a year with no published figure uses the 10% ceiling and says so', () => {
    const r = check({ currentRent: 1000, newRent: 1050, effectiveDate: '2029-02-01' });
    expect(r.maxPct).toBe(10);
    expect(r.warnings.join(' ')).toContain('No Commerce-published maximum');
  });

  it('an exempt property skips the cap and the first-year bar but not the notice period', () => {
    const r = check({ currentRent: 1000, newRent: 1400, effectiveDate: '2026-11-01', stabilizationExempt: true });
    expect(r.maxPct).toBeNull();
    expect(r.ok).toBe(false); // still under 90 days
    expect(r.errors.join(' ')).toContain('90 days');
    expect(check({ currentRent: 1000, newRent: 1400, effectiveDate: '2027-02-01', stabilizationExempt: true }).ok).toBe(true);
  });

  it('the new rent must be higher', () => {
    expect(check({ newRent: 2000 }).ok).toBe(false);
    expect(check({ newRent: 1900 }).errors.join(' ')).toContain('higher');
  });
});

describe('first 12 months, fixed terms and repeat increases', () => {
  it('no increase in the first 12 months of a tenancy', () => {
    const r = check({ tenancyStartDate: '2026-06-01', effectiveDate: '2027-02-01' });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('2027-06-01');
  });

  it('a fixed-term lease cannot be raised before its term ends', () => {
    const r = check({ termType: 'fixed', leaseEndDate: '2027-06-30', effectiveDate: '2027-02-01' });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('2027-07-01');
    expect(check({ termType: 'fixed', leaseEndDate: '2027-06-30', effectiveDate: '2027-07-01' }).ok).toBe(true);
  });

  it('month-to-month tenancies are not held to a term end', () => {
    expect(check({ termType: 'month_to_month', leaseEndDate: '2027-06-30' }).ok).toBe(true);
  });

  it('a second increase within 12 months is a warning to confirm, not a block', () => {
    const r = check({ lastIncreaseDate: '2026-06-01', effectiveDate: '2027-02-01' });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toContain('only one increase');
  });
});

describe('dates and detection', () => {
  it('adds days and months without drifting (month ends clamp)', () => {
    expect(addDays('2026-10-01', 90)).toBe('2026-12-30');
    expect(addMonths('2025-01-31', 1)).toBe('2025-02-28');
    expect(addMonths('2024-03-01', 12)).toBe('2025-03-01');
  });

  it('finds Washington properties from the assessor state or the address', () => {
    expect(isWashingtonProperty({ inputs: { assessorData: { state: 'WA' } } })).toBe(true);
    expect(isWashingtonProperty({ location: '9202 OCCIDENTAL RD, YAKIMA, WA 98908' })).toBe(true);
    expect(isWashingtonProperty({ location: '12 Main St, Boise, ID 83702' })).toBe(false);
    expect(isWashingtonProperty({ location: '1 Elm, Portland, OR', inputs: { assessorData: { state: 'OR' } } })).toBe(false);
  });

  it('residential means houses and apartments, not commercial or storage', () => {
    expect(isResidentialAsset('single-family')).toBe(true);
    expect(isResidentialAsset('multi-unit')).toBe(true);
    expect(isResidentialAsset('commercial')).toBe(false);
    expect(isResidentialAsset('storage')).toBe(false);
  });
});

describe('the notice document', () => {
  const html = buildRentIncreaseNoticeHtml({
    landlordName: 'Valley Holdings LLC', tenantName: 'Jane <Doe>', propertyAddress: '9202 Occidental Rd, Yakima, WA 98908', unit: 'Unit 2',
    currentRent: 2000, newRent: 2150, effectiveDate: '2027-02-01', noticeDate: '2026-10-01',
  });

  it('states the rents, the effective date and the date of the notice', () => {
    expect(html).toContain('Notice of Rent Increase');
    expect(html).toContain('$2,000.00');
    expect(html).toContain('$2,150.00');
    expect(html).toContain('7.50%');
    expect(html).toContain('February 1, 2027');
    expect(html).toContain('October 1, 2026');
    expect(html).toContain('Unit 2');
  });

  it('escapes names so they cannot inject markup, and is clear that it is a template', () => {
    expect(html).not.toContain('<Doe>');
    expect(html).toContain('Jane &lt;Doe&gt;');
    expect(html).toContain('Washington attorney');
  });
});

describe('when the owner is reminded to give the tenant notice', () => {
  it('two reminders before the deadline, one the day after it passes, nothing otherwise', () => {
    // 90-day notice: the last day to give notice is 90 days before the effective date
    expect(noticeReminderStage(104, 90)).toBe('heads_up'); // 14 days before the last day
    expect(noticeReminderStage(93, 90)).toBe('final');     // 3 days before the last day
    expect(noticeReminderStage(89, 90)).toBe('missed');     // the day after the deadline
    for (const d of [200, 100, 91, 90, 88, 60, 0]) expect(noticeReminderStage(d, 90)).toBeNull();
  });

  it('uses the 30-day period for subsidized tenancies', () => {
    expect(noticeReminderStage(44, 30)).toBe('heads_up');
    expect(noticeReminderStage(33, 30)).toBe('final');
    expect(noticeReminderStage(29, 30)).toBe('missed');
  });
});
