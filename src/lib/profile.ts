// src/lib/profile.ts
// Secure investor profile and hurdle rate management powered directly by Supabase backend
// and the manage-profile Edge Function. Zero dependency on client localStorage caching.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase/client';

export interface InvestorProfile {
  id?: string | null;
  email?: string | null;
  fullName: string;
  companyName: string;
  formationState?: string;
  ein?: string;
  bankName?: string;
  discountRate: number;         // Hurdle Rate (%/yr opportunity cost)
  exitYear: number;             // Default Hold Period (Years)
  exitCapTiming: 'amortized' | 'day1';
  marketTier: string;
  propertyClass: string;
  notification_email?: string | null;
  alert_preferences?: Record<string, unknown> | null;
}

export const DEFAULT_PROFILE: InvestorProfile = {
  fullName: 'Investor',
  companyName: 'MathTree Capital',
  discountRate: 8.0,          // Target Hurdle Rate (%/yr opportunity cost)
  exitYear: 10,               // Default Hold Period (Years)
  exitCapTiming: 'amortized', // 'amortized' | 'day1'
  marketTier: 'Tier 2',       // 'Tier 1' | 'Tier 2' | 'Tier 3'
  propertyClass: 'Class B',   // 'Class A' | 'Class B' | 'Class C'
};

// In-memory runtime cache for the active session (not stored in localStorage)
let cachedProfile: InvestorProfile = { ...DEFAULT_PROFILE };
let hasFetchedFromBackend = false;

function sanitizeProfile(raw: Partial<InvestorProfile>): InvestorProfile {
  const discountRateRaw = parseFloat(String(raw.discountRate ?? ''));
  const discountRate = isNaN(discountRateRaw) ? DEFAULT_PROFILE.discountRate : Math.max(0, Math.min(100, discountRateRaw));

  const exitYearRaw = parseInt(String(raw.exitYear ?? ''), 10);
  const exitYear = isNaN(exitYearRaw) ? DEFAULT_PROFILE.exitYear : Math.max(1, Math.min(50, exitYearRaw));

  const exitCapTiming = (raw.exitCapTiming === 'day1' || (raw.exitCapTiming as string) === 'immediate') ? 'day1' : 'amortized';

  return {
    id: raw.id ?? null,
    email: raw.email ?? null,
    fullName: (raw.fullName || (raw as any).full_name || DEFAULT_PROFILE.fullName).trim(),
    companyName: (raw.companyName || (raw as any).company_name || DEFAULT_PROFILE.companyName).trim(),
    formationState: raw.formationState ? String(raw.formationState).trim() : undefined,
    ein: raw.ein ? String(raw.ein).trim() : undefined,
    bankName: raw.bankName ? String(raw.bankName).trim() : undefined,
    discountRate,
    exitYear,
    exitCapTiming,
    marketTier: String(raw.marketTier || DEFAULT_PROFILE.marketTier).trim(),
    propertyClass: String(raw.propertyClass || DEFAULT_PROFILE.propertyClass).trim(),
    notification_email: raw.notification_email ?? null,
    alert_preferences: raw.alert_preferences ?? null,
  };
}

/**
 * Get current in-memory investor profile synchronously.
 * Prefills from user session metadata if available.
 */
export function getProfile(currentUser?: any): InvestorProfile {
  if (currentUser) {
    const meta = currentUser.user_metadata || {};
    if (meta.full_name && cachedProfile.fullName === DEFAULT_PROFILE.fullName) {
      cachedProfile.fullName = meta.full_name;
    }
    if (meta.company_name && cachedProfile.companyName === DEFAULT_PROFILE.companyName) {
      cachedProfile.companyName = meta.company_name;
    }
    if (meta.investor_profile && typeof meta.investor_profile === 'object') {
      cachedProfile = sanitizeProfile({ ...cachedProfile, ...meta.investor_profile });
    }
  }
  return { ...cachedProfile };
}

/**
 * Fetch profile from the backend manage-profile Edge Function or database.
 */
export async function fetchProfile(supabaseClient?: any, currentUser?: any): Promise<InvestorProfile> {
  const edgeUrl = `${SUPABASE_URL}/functions/v1/manage-profile`;

  let token = SUPABASE_ANON_KEY;
  if (supabaseClient) {
    try {
      const { data: sessionData } = await supabaseClient.auth.getSession();
      if (sessionData?.session?.access_token) {
        token = sessionData.session.access_token;
      }
    } catch (e) {
      console.warn('[profile] Could not extract session token:', e);
    }
  }

  try {
    const res = await fetch(edgeUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
    });

    if (res.ok) {
      const data = await res.json();
      if (data?.profile) {
        cachedProfile = sanitizeProfile(data.profile);
        hasFetchedFromBackend = true;
        return { ...cachedProfile };
      }
    }
  } catch (err) {
    console.warn('[profile] Failed to fetch profile from edge function, falling back to direct db:', err);
  }

  // Fallback: Direct DB query via supabase client if edge function unreachable
  if (supabaseClient && currentUser && currentUser.id) {
    try {
      const { data: row } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .maybeSingle();

      if (row) {
        const prefs = (row.preferences && typeof row.preferences === 'object') ? row.preferences : {};
        cachedProfile = sanitizeProfile({
          id: row.id,
          email: row.email,
          fullName: row.full_name,
          companyName: row.company_name,
          discountRate: row.discount_rate !== null && row.discount_rate !== undefined ? Number(row.discount_rate) : prefs.discountRate,
          exitYear: row.exit_year !== null && row.exit_year !== undefined ? Number(row.exit_year) : prefs.exitYear,
          exitCapTiming: row.exit_cap_timing || prefs.exitCapTiming,
          marketTier: row.market_tier || prefs.marketTier,
          propertyClass: row.property_class || prefs.propertyClass,
          ...prefs,
        });
        hasFetchedFromBackend = true;
        return { ...cachedProfile };
      }
    } catch (dbErr) {
      console.warn('[profile] Fallback db fetch failed:', dbErr);
    }
  }

  return getProfile(currentUser);
}

/**
 * Save updated profile to backend Edge function and Supabase database.
 */
export async function saveProfile(
  updates: Partial<InvestorProfile>,
  supabaseClient?: any,
  currentUser?: any
): Promise<InvestorProfile> {
  const merged = sanitizeProfile({ ...cachedProfile, ...updates });
  cachedProfile = merged;

  const edgeUrl = `${SUPABASE_URL}/functions/v1/manage-profile`;

  let token = SUPABASE_ANON_KEY;
  if (supabaseClient) {
    try {
      const { data: sessionData } = await supabaseClient.auth.getSession();
      if (sessionData?.session?.access_token) {
        token = sessionData.session.access_token;
      }
    } catch (e) {
      console.warn('[profile] Could not extract session token for save:', e);
    }
  }

  let savedSuccessfully = false;

  try {
    const res = await fetch(edgeUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(merged),
    });

    if (res.ok) {
      const data = await res.json();
      if (data?.profile) {
        cachedProfile = sanitizeProfile(data.profile);
        savedSuccessfully = true;
      }
    }
  } catch (err) {
    console.warn('[profile] Edge function save warning:', err);
  }

  // Fallback: If edge function wasn't reached, update public.profiles directly
  if (!savedSuccessfully && supabaseClient && currentUser && currentUser.id) {
    try {
      await supabaseClient.from('profiles').upsert({
        id: currentUser.id,
        full_name: merged.fullName,
        company_name: merged.companyName,
        discount_rate: merged.discountRate,
        exit_year: merged.exitYear,
        exit_cap_timing: merged.exitCapTiming,
        market_tier: merged.marketTier,
        property_class: merged.propertyClass,
        preferences: {
          discountRate: merged.discountRate,
          exitYear: merged.exitYear,
          exitCapTiming: merged.exitCapTiming,
          marketTier: merged.marketTier,
          propertyClass: merged.propertyClass,
        },
        updated_at: new Date().toISOString(),
      });
    } catch (dbErr) {
      console.error('[profile] Direct database fallback save failed:', dbErr);
    }
  }

  return { ...cachedProfile };
}

/**
 * Resolve discount rate (opportunity cost hurdle rate) using hierarchy:
 * Deal Specific Input -> Profile Global Setting -> Default (8.0%)
 */
export function resolveHurdleRate(dealDiscountRate?: number | string | null, profile?: Partial<InvestorProfile>): number {
  if (dealDiscountRate !== undefined && dealDiscountRate !== null && dealDiscountRate !== '') {
    const n = parseFloat(String(dealDiscountRate));
    if (!isNaN(n)) return n;
  }
  const prof = profile || cachedProfile;
  if (prof && prof.discountRate !== undefined && !isNaN(parseFloat(String(prof.discountRate)))) {
    return parseFloat(String(prof.discountRate));
  }
  return DEFAULT_PROFILE.discountRate;
}

// Bind to window.MathTreeProfile for seamless interop with HTML pages without legacy script tags
if (typeof window !== 'undefined') {
  (window as any).MathTreeProfile = {
    DEFAULT_PROFILE,
    getProfile,
    fetchProfile,
    saveProfile,
    resolveHurdleRate,
  };
}
