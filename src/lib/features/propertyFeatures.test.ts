import { describe, it, expect } from 'vitest';
import {
  computeWalt,
  computeTenantConcentration,
  computeTrailingCollectionRate,
  computeLtv,
  computeDscr,
  computeDebtYield,
  computePricePerSqFt,
  computeBreakEvenOccupancy,
  computePropertyFeatureVector,
} from './propertyFeatures';

describe('PropertyFeatureVector pure functions', () => {
  const asOf = new Date('2026-10-01T00:00:00Z');

  describe('computeWalt', () => {
    it('returns null with clear reason when no leases exist', () => {
      const res = computeWalt([], asOf);
      expect(res.value).toBeNull();
      expect(res.reason).toMatch(/No active leases/);
    });

    it('returns null when leases are month-to-month or have no end date', () => {
      const leases = [
        { tenant_name: 'Acme Corp', monthly_rent: 5000, term_type: 'month_to_month', is_active: true },
        { tenant_name: 'Beta LLC', monthly_rent: 4000, is_active: true },
      ];
      const res = computeWalt(leases, asOf);
      expect(res.value).toBeNull();
      expect(res.reason).toMatch(/No active fixed-term leases/);
    });

    it('calculates rent-weighted average lease term accurately', () => {
      // Lease 1: $10,000/mo, ends 2028-10-01 (2.0 years remaining)
      // Lease 2: $5,000/mo, ends 2031-10-01 (5.0 years remaining)
      // WALT = (10000 * 2 + 5000 * 5) / 15000 = (20000 + 25000) / 15000 = 45000 / 15000 = 3.0 years
      const leases = [
        { tenant_name: 'Major Tenant', monthly_rent: 10000, lease_start_date: '2023-10-01', lease_end_date: '2028-10-01', is_active: true },
        { tenant_name: 'Minor Tenant', monthly_rent: 5000, lease_start_date: '2023-10-01', lease_end_date: '2031-10-01', is_active: true },
      ];
      const res = computeWalt(leases, asOf);
      expect(res.value).toBe(3);
      expect(res.reason).toContain('Weighted across 2 fixed-term leases');
    });
  });

  describe('computeTenantConcentration', () => {
    it('returns null with reason when no active leases exist', () => {
      const res = computeTenantConcentration([], asOf);
      expect(res.largestTenantShare.value).toBeNull();
      expect(res.hhi.value).toBeNull();
    });

    it('computes 100% share and 10,000 HHI for single tenant', () => {
      const leases = [
        { tenant_name: 'Solo Tenant', monthly_rent: 12000, is_active: true },
      ];
      const res = computeTenantConcentration(leases, asOf);
      expect(res.largestTenantShare.value).toBe(100);
      expect(res.hhi.value).toBe(10000);
    });

    it('computes multi-tenant shares and HHI correctly', () => {
      // Tenant A: $6,000 (60%) -> 60^2 = 3600
      // Tenant B: $4,000 (40%) -> 40^2 = 1600
      // Total HHI = 5200
      const leases = [
        { tenant_name: 'Tenant A', monthly_rent: 6000, is_active: true },
        { tenant_name: 'Tenant B', monthly_rent: 4000, is_active: true },
      ];
      const res = computeTenantConcentration(leases, asOf);
      expect(res.largestTenantShare.value).toBe(60);
      expect(res.hhi.value).toBe(5200);
    });

    it('groups multiple leases from the same tenant', () => {
      const leases = [
        { tenant_name: 'Retail Chain', monthly_rent: 4000, is_active: true },
        { tenant_name: 'Retail Chain', monthly_rent: 2000, is_active: true },
        { tenant_name: 'Boutique', monthly_rent: 4000, is_active: true },
      ];
      // Retail Chain = 6000 (60%), Boutique = 4000 (40%) -> HHI = 5200
      const res = computeTenantConcentration(leases, asOf);
      expect(res.largestTenantShare.value).toBe(60);
      expect(res.hhi.value).toBe(5200);
    });
  });

  describe('computeTrailingCollectionRate', () => {
    it('returns null with reason when no payment records exist', () => {
      const res = computeTrailingCollectionRate([], asOf);
      expect(res.value).toBeNull();
      expect(res.reason).toMatch(/No payment records/);
    });

    it('returns null with reason when fewer than 3 months of records exist', () => {
      const payments = [
        { due_date: '2026-09-01', amount_due: 1000, amount_paid: 1000 },
        { due_date: '2026-08-01', amount_due: 1000, amount_paid: 1000 },
      ];
      const res = computeTrailingCollectionRate(payments, asOf);
      expect(res.value).toBeNull();
      expect(res.reason).toMatch(/Fewer than 3 months/);
    });

    it('calculates collection percentage over trailing 12 months', () => {
      const payments = [
        { due_date: '2026-09-01', amount_due: 10000, amount_paid: 10000 },
        { due_date: '2026-08-01', amount_due: 10000, amount_paid: 10000 },
        { due_date: '2026-07-01', amount_due: 10000, amount_paid: 8000 },
        { due_date: '2026-06-01', amount_due: 10000, amount_paid: 10000 },
      ];
      // Total due = 40,000, Total paid = 38,000 -> 95.0%
      const res = computeTrailingCollectionRate(payments, asOf);
      expect(res.value).toBe(95);
      expect(res.reason).toMatch(/95% collected over 4 observed months/);
    });
  });

  describe('computeLtv', () => {
    it('returns null when purchase price or value is missing', () => {
      const deal = { purchase_price: null, inputs: {} };
      const res = computeLtv(deal, null);
      expect(res.value).toBeNull();
      expect(res.reason).toMatch(/Purchase price or property value not stated/);
    });

    it('returns 0 with reason when property is unencumbered', () => {
      const deal = { purchase_price: 1000000, inputs: { downPaymentPercent: 100, loanAmount: 0 } };
      const res = computeLtv(deal, { baseLoanAmount: 0 });
      expect(res.value).toBe(0);
      expect(res.reason).toMatch(/100% equity/);
    });

    it('calculates LTV percentage accurately', () => {
      const deal = { purchase_price: 2000000, inputs: { downPaymentPercent: 25 } };
      const res = computeLtv(deal, { baseLoanAmount: 1500000 });
      expect(res.value).toBe(75);
      expect(res.reason).toMatch(/75% loan-to-value/);
    });
  });

  describe('computeDscr', () => {
    it('returns null when metrics are null', () => {
      const res = computeDscr(null);
      expect(res.value).toBeNull();
      expect(res.reason).toMatch(/metrics not computed/);
    });

    it('returns null when property has no debt service', () => {
      const res = computeDscr({ dscr: null, annualDebtService: 0 });
      expect(res.value).toBeNull();
      expect(res.reason).toMatch(/no annual debt service/);
    });

    it('extracts and formats valid DSCR', () => {
      const res = computeDscr({ dscr: 1.354, annualDebtService: 50000 });
      expect(res.value).toBe(1.35);
      expect(res.reason).toMatch(/1.35x/);
    });
  });

  describe('computeDebtYield', () => {
    it('returns null when property has no debt', () => {
      const deal = { inputs: { loanAmount: 0 } };
      const res = computeDebtYield(deal, { baseLoanAmount: 0 });
      expect(res.value).toBeNull();
      expect(res.reason).toMatch(/no outstanding debt/);
    });

    it('returns null when NOI is not available', () => {
      const deal = { inputs: { loanAmount: 800000 } };
      const res = computeDebtYield(deal, { baseLoanAmount: 800000, year1NOI: 0, projections: [] });
      expect(res.value).toBeNull();
      expect(res.reason).toMatch(/NOI is zero, negative, or not available/);
    });

    it('computes debt yield percentage correctly', () => {
      // NOI = $100,000, Loan = $1,000,000 -> Debt yield = 10.0%
      const deal = { inputs: { loanAmount: 1000000 } };
      const res = computeDebtYield(deal, { baseLoanAmount: 1000000, year1NOI: 100000 });
      expect(res.value).toBe(10);
      expect(res.reason).toMatch(/10% debt yield/);
    });
  });

  describe('computePricePerSqFt', () => {
    it('returns null when square footage is missing', () => {
      const deal = { purchase_price: 1500000, inputs: {} };
      const res = computePricePerSqFt(deal);
      expect(res.value).toBeNull();
      expect(res.reason).toMatch(/square footage not stated/);
    });

    it('computes price per sq ft accurately', () => {
      const deal = { purchase_price: 1500000, inputs: { buildingSqft: 10000 } };
      const res = computePricePerSqFt(deal);
      expect(res.value).toBe(150);
      expect(res.reason).toMatch(/\$150.00\/sqft/);
    });
  });

  describe('computeBreakEvenOccupancy', () => {
    it('returns null when potential gross rent is unstated', () => {
      const deal = { inputs: {} };
      const res = computeBreakEvenOccupancy(deal, null);
      expect(res.value).toBeNull();
      expect(res.reason).toMatch(/Gross potential rent is zero or unstated/);
    });

    it('computes break even occupancy percentage', () => {
      // Gross Potential Rent = $100,000
      // OpEx = $30,000, Debt Service = $40,000 -> Total required = $70,000 -> Break-even = 70.0%
      const deal = { inputs: { grossRentAnnual: 100000 } };
      const metrics = {
        projections: [{ potentialGrossRevenue: 100000, operatingExpenses: 30000, debtService: 40000 }],
      };
      const res = computeBreakEvenOccupancy(deal, metrics);
      expect(res.value).toBe(70);
      expect(res.reason).toMatch(/70% occupancy required/);
    });
  });

  describe('computePropertyFeatureVector assembler', () => {
    it('assembles complete vector with all safety guarantees met', () => {
      const deal = {
        id: 'deal-test-123',
        purchase_price: 1200000,
        inputs: {
          purchasePrice: 1200000,
          loanAmount: 900000,
          buildingSqft: 6000,
        },
      };
      const leases = [
        {
          tenant_name: 'Anchor Grocery',
          monthly_rent: 8000,
          lease_start_date: '2024-01-01',
          lease_end_date: '2034-01-01',
          is_active: true,
        },
      ];
      const metrics = {
        dscr: 1.45,
        baseLoanAmount: 900000,
        year1NOI: 90000,
        projections: [
          {
            potentialGrossRevenue: 120000,
            operatingExpenses: 30000,
            debtService: 62000,
          },
        ],
      };

      const vector = computePropertyFeatureVector({ deal, leases, metrics, asOf });
      expect(vector.dealId).toBe('deal-test-123');
      expect(vector.walt.value).toBeGreaterThan(7);
      expect(vector.tenantConcentration.largestTenantShare.value).toBe(100);
      expect(vector.tenantConcentration.hhi.value).toBe(10000);
      expect(vector.ltv.value).toBe(75);
      expect(vector.dscr.value).toBe(1.45);
      expect(vector.debtYield.value).toBe(10);
      expect(vector.pricePerSqFt.value).toBe(200);
      expect(vector.breakEvenOccupancy.value).toBe(76.7);
      // Payments were empty, so trailing collection rate is null with safe explanation
      expect(vector.trailingCollectionRate.value).toBeNull();
      expect(vector.trailingCollectionRate.reason).toMatch(/No payment records/);
    });
  });
});
