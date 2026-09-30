// src/lib/services/gisSyncService.ts
// Just-in-Time (JIT) 30-Day County GIS & Assessor Sync Service
// Evaluates cache freshness once per day when active user accesses a project

import { supabase } from '../supabase/client';
import type { DealRecord } from '../math/types';
import { AddressService } from './addressService';

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
    const county = deal.inputs.county || 'Yakima';

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

    const updatedInputs = {
      ...deal.inputs,
      gisSync: {
        status: 'active',
        syncSource: String(county).toLowerCase().includes('spokane') ? 'spokane_arcgis' : 'yakima_arcgis',
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
