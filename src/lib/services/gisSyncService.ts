// src/lib/services/gisSyncService.ts
// Just-in-Time (JIT) 30-Day County GIS & Assessor Sync Service
// Evaluates cache freshness once per day when active user accesses a project

import { supabase } from '../supabase/client';
import type { DealRecord } from '../math/types';
import { AddressService } from './addressService';
import { countyFromText, isRealParcel } from './parcelLookup';

const GIS_STALE_DAYS_THRESHOLD = 30;

function getTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Check if GIS sync is needed just-in-time.
 * Strictly avoids redundant calls: only checks once per day per session.
 */
export function isGisSyncNeeded(deal: DealRecord | Record<string, any>): boolean {
  if (!deal || !deal.id || !deal.inputs) return false;

  const today = getTodayKey();
  const sessionCheckKey = `gis_checked_${deal.id}_${today}`;

  // If already checked in this browser session today, no-op
  if (typeof window !== 'undefined' && window.sessionStorage?.getItem(sessionCheckKey)) {
    return false;
  }

  // A county record saved before the building figures covered every building on the parcel is read again, whatever its age
  const saved = deal.inputs.assessorData;
  if (saved && saved.source === 'yakima_county_assessor' && (Number(saved.recordVersion) || 0) < 2) return true;

  const lastSyncedAt = deal.inputs.gisSync?.lastSyncedAt;
  if (!lastSyncedAt) return true;

  const syncedTime = new Date(lastSyncedAt).getTime();
  if (isNaN(syncedTime)) return true;

  const ageMs = Date.now() - syncedTime;
  const maxAgeMs = GIS_STALE_DAYS_THRESHOLD * 24 * 60 * 60 * 1000;
  const isStale = ageMs > maxAgeMs;

  if (!isStale && typeof window !== 'undefined') {
    // Record that we verified freshness today
    window.sessionStorage?.setItem(sessionCheckKey, 'fresh');
  }

  return isStale;
}

/**
 * Execute just-in-time county GIS sync in the background without blocking the UI.
 */
export async function syncDealCountyGisInBackground(
  deal: DealRecord | Record<string, any>,
  onUpdateOrForce?: ((updatedDeal: any) => void) | boolean
): Promise<boolean> {
  const isForce = typeof onUpdateOrForce === 'boolean' ? onUpdateOrForce : false;
  const onUpdate = typeof onUpdateOrForce === 'function' ? onUpdateOrForce : undefined;

  if (!deal || !deal.id || (deal as any)._isAutoGisSyncing) return false;
  if (!isForce && !isGisSyncNeeded(deal)) return false;

  (deal as any)._isAutoGisSyncing = true;
  const today = getTodayKey();
  const sessionCheckKey = `gis_checked_${deal.id}_${today}`;

  try {
    const apn = deal.inputs.primaryApn || deal.inputs.apn || deal.inputs.assessorData?.apn;
    // The county comes from the deal or its address. It is never assumed: an unknown county is not looked up in Yakima's records.
    const county = deal.inputs.county
      ? String(deal.inputs.county).replace(/\s*county\s*$/i, '').trim()
      : countyFromText([deal.inputs.propertyAddress, deal.inputs.address, (deal as any).location].filter(Boolean).join(' '));

    // If AddressService exists globally (from window or script)
    const addressService: any = AddressService;
    let freshAssessor = null;

    if (addressService && apn) {
      try {
        freshAssessor = await addressService.resolveParcelDetails({
          apn: String(apn).replace(/\D/g, ''),
          county,
        });
      } catch (svcErr) {
        console.warn('[gisSyncService] AddressService query failed:', svcErr);
      }
    }

    // No real county record: leave the deal alone (no "synced" stamp, no placeholder data), and do not ask again this session
    if (!isRealParcel(freshAssessor)) {
      if (typeof window !== 'undefined') window.sessionStorage?.setItem(sessionCheckKey, 'no-record');
      return false;
    }

    const updatedInputs = {
      ...deal.inputs,
      gisSync: {
        status: 'active',
        syncSource: freshAssessor?.source || (String(county ?? '').toLowerCase().includes('spokane')
          ? 'spokane_arcgis'
          : String(county ?? '').toLowerCase().includes('king')
            ? 'king_arcgis'
            : String(county ?? '').toLowerCase().includes('pierce')
              ? 'pierce_arcgis'
              : 'yakima_arcgis'),
        lastSyncedAt: new Date().toISOString(),
        manualRefresh: false,
      },
    };

    if (freshAssessor) {
      updatedInputs.assessorData = {
        ...(deal.inputs.assessorData || {}),
        ...freshAssessor,
      };
      if (freshAssessor.totalAssessedValue) {
        updatedInputs.totalAssessedValue = freshAssessor.totalAssessedValue;
      }
      if (freshAssessor.marketLandValue) {
        updatedInputs.marketLandValue = freshAssessor.marketLandValue;
      }
      if (freshAssessor.marketImprovementValue) {
        updatedInputs.marketImprovementValue = freshAssessor.marketImprovementValue;
      }
      // The building facts too: the engine reads the building area (for carrying costs), so an out-of-date one must not stay behind
      if (freshAssessor.buildingSqFt) updatedInputs.buildingSqFt = freshAssessor.buildingSqFt;
      if (freshAssessor.stories) updatedInputs.stories = freshAssessor.stories;
      if (freshAssessor.yearBuilt) updatedInputs.yearBuilt = freshAssessor.yearBuilt;
    }

    // Persist to Supabase deals table
    if (supabase) {
      await supabase
        .from('deals')
        .update({
          inputs: updatedInputs,
          updated_at: new Date().toISOString(),
        })
        .eq('id', deal.id);
    }

    if (typeof window !== 'undefined') {
      window.sessionStorage?.setItem(sessionCheckKey, 'synced');
    }

    if (onUpdate) {
      onUpdate({
        ...deal,
        inputs: updatedInputs,
      });
    }

    return true;
  } catch (err) {
    console.error('[gisSyncService] JIT GIS background sync failed:', err);
    return false;
  } finally {
    (deal as any)._isAutoGisSyncing = false;
  }
}
