import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://bgexwcepwbxvhxbpblhd.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJnZXh3Y2Vwd2J4dmh4YnBibGhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzMTI0NTUsImV4cCI6MjEwMzg4ODQ1NX0._izBzyCJgxsH4ncZ9gaX2KonJsGj5_3v_7R5I9Jxa-U';

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export const BENCHMARK_DEAL = {
  id: 'd8c7075e-c3eb-4606-bd5b-014ecda7bb49',
  title: '2239 Longfibre Rd Distribution Center',
  location: 'Union Gap, WA',
  address: '2239 Longfibre Rd',
  city: 'Union Gap',
  state: 'WA',
  zip: '98903',
  asset_class: 'commercial' as const,
  status: 'owned' as const,
  purchase_price: 3850000,
  total_equity: 962500,
  loan_amount: 2887500,
  irr: 18.4,
  cash_on_cash: 9.8,
  equity_multiple: 2.1,
  year1_cashflow: 94325,
  cap_rate: 7.2,
  is_demo: true,
  inputs: {
    purchasePrice: 3850000,
    downPaymentPercent: 25,
    interestRate: 6.5,
    loanTermYears: 30,
    holdingPeriod: 10,
    grossRentAnnual: 345000,
    monthlyRent: 28750,
    operatingExpensesAnnual: 68000,
    vacancyRatePercent: 5.0,
    rentGrowthPercent: 3.0,
    expenseGrowthPercent: 2.5,
    exitCapRatePercent: 6.75,
    primaryApn: '181216-13002',
    county: 'Yakima County, WA',
    squareFeet: 42000,
    leases: [
      {
        tenantName: 'Cascade Cold Logistics LLC',
        monthlyRent: 15500,
        annualRent: 186000,
        leaseStartDate: '2024-01-01',
        leaseEndDate: '2029-12-31',
        leaseType: 'NNN' as const,
        escalationType: 'Percentage Bump (%)',
        escalationRate: 3.0,
        escalationFrequency: 'Annual on Anniversary',
      },
      {
        tenantName: 'Pacific Freight Systems',
        monthlyRent: 13250,
        annualRent: 159000,
        leaseStartDate: '2023-06-01',
        leaseEndDate: '2028-05-31',
        leaseType: 'NNN' as const,
        escalationType: 'Percentage Bump (%)',
        escalationRate: 3.5,
        escalationFrequency: 'Annual on Anniversary',
      },
    ],
  },
};
