/**
 * MathTree Global Investor Profile & Underwriting Settings
 * Manages investor identity, required hurdle rate (opportunity cost / discount rate),
 * and global underwriting defaults across the platform.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MathTreeProfile = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STORAGE_KEY_PROFILE = 'mathtree_investor_profile';

  var DEFAULT_PROFILE = {
    fullName: 'Investor',
    companyName: 'MathTree Capital',
    discountRate: 8.0,         // Target Hurdle Rate (% / yr opportunity cost)
    exitYear: 10,              // Default Hold Period (Years)
    exitCapTiming: 'amortized',// 'amortized' | 'day1'
    marketTier: 'Tier 2',      // 'Tier 1' | 'Tier 2' | 'Tier 3'
    propertyClass: 'Class B'   // 'Class A' | 'Class B' | 'Class C'
  };

  function getStorage() {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage;
      }
    } catch (e) {}
    return null;
  }

  /**
   * Get current investor profile from localStorage, falling back to defaults or user metadata.
   * @param {Object} [currentUser] Optional Supabase user object
   * @returns {Object} Full sanitized investor profile
   */
  function getProfile(currentUser) {
    var profile = Object.assign({}, DEFAULT_PROFILE);
    var storage = getStorage();

    if (storage) {
      try {
        var raw = storage.getItem(STORAGE_KEY_PROFILE);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            Object.assign(profile, parsed);
          }
        }
      } catch (e) {}
    }

    // Merge in user metadata if available and not set in local storage
    if (currentUser) {
      var meta = currentUser.user_metadata || {};
      if (meta.full_name && profile.fullName === DEFAULT_PROFILE.fullName) {
        profile.fullName = meta.full_name;
      }
      if (meta.company_name && profile.companyName === DEFAULT_PROFILE.companyName) {
        profile.companyName = meta.company_name;
      }
      if (meta.investor_profile && typeof meta.investor_profile === 'object') {
        Object.assign(profile, meta.investor_profile);
      }
    }

    // Sanitize numerical fields
    profile.discountRate = isNaN(parseFloat(profile.discountRate)) ? DEFAULT_PROFILE.discountRate : parseFloat(profile.discountRate);
    profile.exitYear = isNaN(parseInt(profile.exitYear, 10)) ? DEFAULT_PROFILE.exitYear : Math.max(1, Math.min(50, parseInt(profile.exitYear, 10)));
    profile.exitCapTiming = (profile.exitCapTiming === 'day1' || profile.exitCapTiming === 'immediate') ? 'day1' : 'amortized';
    profile.marketTier = profile.marketTier || DEFAULT_PROFILE.marketTier;
    profile.propertyClass = profile.propertyClass || DEFAULT_PROFILE.propertyClass;

    return profile;
  }

  /**
   * Save investor profile to localStorage and sync to Supabase if authenticated.
   * @param {Object} updates Updated profile fields
   * @param {Object} [supabaseClient] Supabase client
   * @param {Object} [currentUser] Supabase user object
   * @returns {Promise<Object>} Saved profile
   */
  async function saveProfile(updates, supabaseClient, currentUser) {
    var current = getProfile(currentUser);
    var updated = Object.assign({}, current, updates || {});

    // Sanitize inputs
    if (updated.discountRate !== undefined) {
      var dr = parseFloat(updated.discountRate);
      updated.discountRate = isNaN(dr) ? DEFAULT_PROFILE.discountRate : Math.max(0, Math.min(100, dr));
    }
    if (updated.exitYear !== undefined) {
      var ey = parseInt(updated.exitYear, 10);
      updated.exitYear = isNaN(ey) ? DEFAULT_PROFILE.exitYear : Math.max(1, Math.min(50, ey));
    }
    if (updated.exitCapTiming !== undefined) {
      updated.exitCapTiming = (updated.exitCapTiming === 'day1' || updated.exitCapTiming === 'immediate') ? 'day1' : 'amortized';
    }
    if (updated.fullName) updated.fullName = String(updated.fullName).trim();
    if (updated.companyName) updated.companyName = String(updated.companyName).trim();

    var storage = getStorage();
    if (storage) {
      try {
        storage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(updated));
      } catch (e) {}
    }

    // Bidirectional sync to Supabase Auth & public.profiles
    if (supabaseClient && currentUser && !currentUser.demo) {
      try {
        // 1. Update Auth User Metadata
        await supabaseClient.auth.updateUser({
          data: {
            full_name: updated.fullName,
            company_name: updated.companyName,
            investor_profile: {
              discountRate: updated.discountRate,
              exitYear: updated.exitYear,
              exitCapTiming: updated.exitCapTiming,
              marketTier: updated.marketTier,
              propertyClass: updated.propertyClass
            }
          }
        });

        // 2. Update public.profiles row
        await supabaseClient.from('profiles').update({
          full_name: updated.fullName,
          company_name: updated.companyName,
          preferences: {
            discountRate: updated.discountRate,
            exitYear: updated.exitYear,
            exitCapTiming: updated.exitCapTiming,
            marketTier: updated.marketTier,
            propertyClass: updated.propertyClass
          },
          updated_at: new Date().toISOString()
        }).eq('id', currentUser.id);
      } catch (err) {
        console.warn('Could not sync profile to cloud database:', err);
      }
    }

    return updated;
  }

  /**
   * Resolve discount rate (opportunity cost hurdle rate) using hierarchy:
   * Deal Specific Input -> Profile Global Setting -> Default (8.0%)
   * @param {number|string} [dealDiscountRate] Deal-specific discount rate
   * @param {Object} [profile] Investor profile
   * @returns {number} Resolved discount rate
   */
  function resolveHurdleRate(dealDiscountRate, profile) {
    if (dealDiscountRate !== undefined && dealDiscountRate !== null && dealDiscountRate !== '') {
      var n = parseFloat(dealDiscountRate);
      if (!isNaN(n)) return n;
    }
    var prof = profile || getProfile();
    if (prof && prof.discountRate !== undefined && !isNaN(parseFloat(prof.discountRate))) {
      return parseFloat(prof.discountRate);
    }
    return DEFAULT_PROFILE.discountRate;
  }

  return {
    DEFAULT_PROFILE: DEFAULT_PROFILE,
    getProfile: getProfile,
    saveProfile: saveProfile,
    resolveHurdleRate: resolveHurdleRate
  };
}));
