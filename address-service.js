/**
 * MathTree Address & County GIS Integration Service
 * Specializes in Yakima County, Washington via official ArcGIS REST Services:
 * - Addressing: https://maps.yakimacounty.us/server/rest/services/Addressing/BuildingAddresses/FeatureServer/0
 * - Assessor: https://maps.yakimacounty.us/server/rest/services/Assessor/Taxlots/FeatureServer/2
 * - Official Assessor Portal: https://yes.co.yakima.wa.us/ascend/
 *
 * Includes nationwide fallback via Photon / OpenStreetMap.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AddressService = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const YAKIMA_GIS_BASE = 'https://maps.yakimacounty.us/server/rest/services';
  const YAKIMA_ADDRESSING_URL = YAKIMA_GIS_BASE + '/Addressing/BuildingAddresses/FeatureServer/0/query';
  const YAKIMA_TAXLOTS_URL = YAKIMA_GIS_BASE + '/Assessor/Taxlots/FeatureServer/2/query';
  const YAKIMA_ASCEND_PORTAL = 'https://yes.co.yakima.wa.us/ascend/';
  const PHOTON_API_URL = 'https://photon.komoot.io/api/';

  // Central Washington coordinates (Yakima, WA) for spatial search bias
  const YAKIMA_LAT = 46.602;
  const YAKIMA_LON = -120.505;

  /**
   * Helper: Normalize search query into SQL LIKE format for ArcGIS
   * e.g. "128 N 2nd" -> "%128%N%2ND%"
   */
  function buildSqlLikeTerm(query) {
    if (!query) return '%';
    const cleaned = query.trim().toUpperCase().replace(/[^A-Z0-9\s]/g, ' ');
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '%';
    return '%' + parts.join('%') + '%';
  }

  /**
   * 1. Search official Yakima County Building Addresses Layer
   */
  async function searchYakimaAddresses(query, limit = 8) {
    if (!query || query.trim().length < 2) return [];

    const likeTerm = buildSqlLikeTerm(query);
    const params = new URLSearchParams({
      where: "Address LIKE '" + likeTerm + "'",
      outFields: 'Address,City,State,ZipCode,ASSESSOR_N,BuildingClass',
      f: 'json',
      resultRecordCount: String(limit)
    });

    try {
      const response = await fetch(YAKIMA_ADDRESSING_URL + '?' + params.toString());
      if (!response.ok) throw new Error('Yakima GIS error: ' + response.status);
      const data = await response.json();

      if (!data || !data.features) return [];

      return data.features.map(f => {
        const attr = f.attributes || {};
        const city = (attr.City || 'Yakima').trim();
        const state = (attr.State || 'WA').trim();
        const zip = attr.ZipCode ? String(attr.ZipCode).trim() : '';
        const street = (attr.Address || '').trim();

        return {
          formattedAddress: street + ', ' + city + ', ' + state + (zip ? ' ' + zip : ''),
          street,
          city,
          state,
          zip,
          county: 'Yakima',
          apn: attr.ASSESSOR_N ? String(attr.ASSESSOR_N).trim() : null,
          buildingClass: attr.BuildingClass,
          source: 'yakima_county_gis',
          isYakimaCounty: true
        };
      });
    } catch (err) {
      console.warn('Yakima County GIS query failed, falling back to nationwide:', err);
      return [];
    }
  }

  /**
   * 2. Search nationwide addresses via Photon (OpenStreetMap) with Central WA bias
   */
  async function searchNationwideAddresses(query, limit = 6) {
    if (!query || query.trim().length < 2) return [];

    const params = new URLSearchParams({
      q: query.trim(),
      lat: String(YAKIMA_LAT),
      lon: String(YAKIMA_LON),
      limit: String(limit)
    });

    try {
      const response = await fetch(PHOTON_API_URL + '?' + params.toString());
      if (!response.ok) throw new Error('Photon error: ' + response.status);
      const data = await response.json();

      if (!data || !data.features) return [];

      return data.features.map(f => {
        const p = f.properties || {};
        const house = p.housenumber ? p.housenumber + ' ' : '';
        const street = (house + (p.street || p.name || '')).trim();
        const city = p.city || p.town || p.village || p.county || '';
        const state = p.state || '';
        const zip = p.postcode || '';
        const county = p.county || '';

        const parts = [street, city, state].filter(Boolean);
        const formatted = parts.join(', ') + (zip ? ' ' + zip : '');

        const isYakima = /yakima/i.test(county) || /yakima/i.test(city);

        return {
          formattedAddress: formatted || p.name || 'Unknown Location',
          street,
          city,
          state,
          zip,
          county: county || (isYakima ? 'Yakima' : ''),
          coordinates: f.geometry ? f.geometry.coordinates : null,
          source: 'openstreetmap',
          isYakimaCounty: isYakima
        };
      });
    } catch (err) {
      console.warn('Nationwide address search failed:', err);
      return [];
    }
  }

  /**
   * 3. Unified Address Search:
   * Prioritizes Yakima County official addresses if query matches or Central WA context,
   * then merges unique results from nationwide OpenStreetMap.
   */
  async function searchAddresses(query, options = {}) {
    if (!query || query.trim().length < 2) return [];

    const yakimaResults = await searchYakimaAddresses(query, options.limit || 8);

    if (yakimaResults.length >= 3) {
      return yakimaResults;
    }

    const nationResults = await searchNationwideAddresses(query, 5);

    const seen = new Set();
    const merged = [];

    yakimaResults.forEach(item => {
      const key = item.formattedAddress.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    });

    nationResults.forEach(item => {
      const key = item.formattedAddress.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    });

    return merged;
  }

  /**
   * 4. Fetch official Yakima County Assessor Taxlot Record by APN
   */
  async function fetchYakimaAssessorData(assessorNumber) {
    if (!assessorNumber) return null;

    const cleanedApn = String(assessorNumber).trim().replace(/[^0-9]/g, '');
    const params = new URLSearchParams({
      where: "ASSESSOR_N = '" + cleanedApn + "'",
      outFields: '*',
      f: 'json'
    });

    try {
      const response = await fetch(YAKIMA_TAXLOTS_URL + '?' + params.toString());
      if (!response.ok) throw new Error('Yakima Taxlot error: ' + response.status);
      const data = await response.json();

      if (!data || !data.features || data.features.length === 0) {
        return null;
      }

      const attr = data.features[0].attributes || {};
      const landVal = parseFloat(attr.MKT_LAND) || 0;
      const impVal = parseFloat(attr.MKT_IMPVT) || 0;
      const totalVal = landVal + impVal;
      const acres = parseFloat(attr.ACRES) || 0;
      const sqft = Math.round(acres * 43560);

      const owner = [attr.FIRST_NAME, attr.LAST_NAME].filter(Boolean).join(' ') +
        (attr.ORG_NAME ? (attr.FIRST_NAME || attr.LAST_NAME ? ' / ' : '') + attr.ORG_NAME : '');

      return {
        apn: cleanedApn,
        formattedApn: cleanedApn.length === 11 ? (cleanedApn.slice(0, 6) + '-' + cleanedApn.slice(6)) : cleanedApn,
        address: [attr.SITUS_ADDR, attr.SITUS_CITY, 'WA', attr.SITUS_ZIP].filter(Boolean).join(', '),
        street: attr.SITUS_ADDR || '',
        city: attr.SITUS_CITY || 'Yakima',
        state: 'WA',
        zip: attr.SITUS_ZIP || '',
        acres: Math.round(acres * 1000) / 1000,
        sqft,
        marketLandValue: landVal,
        marketImprovementValue: impVal,
        totalAssessedValue: totalVal,
        taxYear: attr.TAX_YEAR || new Date().getFullYear(),
        zoning: attr.CNY_ZONE || attr.CYAK_ZONG || attr.UG_ZONING || attr.UAZO_ZONE || 'Standard',
        useCode: attr.USE_CODE || 'General Commercial / Residential',
        owner: owner || 'Owner of Record',
        legalDescription: attr.LEGAL || '',
        waterSource: attr.WATER_SRC || 'Municipal / District',
        sewerSource: attr.SEWER_SRC || 'Public Sewer',
        assessorPortalUrl: YAKIMA_ASCEND_PORTAL + '?mParcelID=' + cleanedApn,
        source: 'yakima_county_assessor'
      };
    } catch (err) {
      console.error('Failed to fetch Yakima assessor data:', err);
      return null;
    }
  }

  /**
   * 5. Generate official Yakima County Ascend Web Search URL
   */
  function getYakimaAssessorPortalUrl(parcelOrAddress) {
    if (!parcelOrAddress) return YAKIMA_ASCEND_PORTAL;
    const clean = String(parcelOrAddress).trim();
    if (/^[0-9-]+$/.test(clean)) {
      return YAKIMA_ASCEND_PORTAL + '?mParcelID=' + encodeURIComponent(clean);
    }
    return YAKIMA_ASCEND_PORTAL;
  }


  /**
   * 6. Detect Nearby Parcels Owned by the Same Entity (Multi-Parcel Package Detection)
   * Searches the same 6-digit section/block (RTS) for companion parcels with matching owner.
   */
  async function detectNearbySameOwnerParcels(primaryApn, ownerName) {
    if (!primaryApn) return [];
    const cleanApn = String(primaryApn).trim().replace(/[^0-9]/g, '');
    if (cleanApn.length < 6) return [];

    const prefix = cleanApn.slice(0, 6);
    let whereClause = "ASSESSOR_N LIKE '" + prefix + "%' AND ASSESSOR_N <> '" + cleanApn + "'";

    if (ownerName && typeof ownerName === 'string' && ownerName.trim().length > 2) {
      const cleanOwner = ownerName.trim().toUpperCase().replace(/'/g, "''").replace(/[^A-Z0-9\s]/g, '');
      const ownerTerms = cleanOwner.split(/\s+/).filter(w => w.length > 2);
      if (ownerTerms.length > 0) {
        // Match either ORG_NAME or LAST_NAME containing primary owner term
        const term = ownerTerms[0];
        whereClause += " AND (UPPER(ORG_NAME) LIKE '%" + term + "%' OR UPPER(LAST_NAME) LIKE '%" + term + "%')";
      }
    }

    const params = new URLSearchParams({
      where: whereClause,
      outFields: 'ASSESSOR_N,SITUS_ADDR,SITUS_CITY,SITUS_ZIP,ACRES,MKT_LAND,MKT_IMPVT,USE_CODE,ORG_NAME,FIRST_NAME,LAST_NAME,LEGAL',
      f: 'json',
      resultRecordCount: '15'
    });

    try {
      const response = await fetch(YAKIMA_TAXLOTS_URL + '?' + params.toString());
      if (!response.ok) return [];
      const data = await response.json();
      if (!data || !data.features) return [];

      return data.features.map(f => {
        const a = f.attributes || {};
        const landVal = parseFloat(a.MKT_LAND) || 0;
        const impVal = parseFloat(a.MKT_IMPVT) || 0;
        const totalVal = landVal + impVal;
        const acres = parseFloat(a.ACRES) || 0;
        const apn = String(a.ASSESSOR_N || '').trim();

        const owner = [a.FIRST_NAME, a.LAST_NAME].filter(Boolean).join(' ') +
          (a.ORG_NAME ? (a.FIRST_NAME || a.LAST_NAME ? ' / ' : '') + a.ORG_NAME : '');

        return {
          apn,
          formattedApn: apn.length === 11 ? (apn.slice(0, 6) + '-' + apn.slice(6)) : apn,
          address: a.SITUS_ADDR ? (a.SITUS_ADDR + ', ' + (a.SITUS_CITY || 'Yakima')) : 'Adjacent Parcel',
          street: a.SITUS_ADDR || 'Adjacent Parcel',
          city: a.SITUS_CITY || 'Yakima',
          state: 'WA',
          zip: a.SITUS_ZIP || '',
          acres: Math.round(acres * 1000) / 1000,
          sqft: Math.round(acres * 43560),
          marketLandValue: landVal,
          marketImprovementValue: impVal,
          totalAssessedValue: totalVal,
          useCode: a.USE_CODE || 'Complementary Parcel',
          owner: owner || 'Same Owner of Record',
          legalDescription: a.LEGAL || '',
          isPrimary: false,
          included: false
        };
      });
    } catch (err) {
      console.warn('Failed to detect nearby same-owner parcels:', err);
      return [];
    }
  }

  /**
   * 7. Aggregate Multiple Parcels into a Combined Acquisition Package
   */
  function aggregateParcelPackage(parcelsList) {
    if (!Array.isArray(parcelsList) || parcelsList.length === 0) {
      return {
        totalParcels: 0,
        totalAcres: 0,
        totalSqFt: 0,
        totalLandValue: 0,
        totalImprovementValue: 0,
        totalAssessedValue: 0,
        parcels: []
      };
    }

    const activeParcels = parcelsList.filter(p => p && p.included !== false);

    let totalAcres = 0;
    let totalLand = 0;
    let totalImp = 0;

    activeParcels.forEach(p => {
      totalAcres += parseFloat(p.acres) || 0;
      totalLand += parseFloat(p.marketLandValue) || 0;
      totalImp += parseFloat(p.marketImprovementValue) || 0;
    });

    const totalVal = totalLand + totalImp;
    const totalSqFt = Math.round(totalAcres * 43560);

    return {
      totalParcels: activeParcels.length,
      totalAcres: Math.round(totalAcres * 1000) / 1000,
      totalSqFt,
      totalLandValue: Math.round(totalLand),
      totalImprovementValue: Math.round(totalImp),
      totalAssessedValue: Math.round(totalVal),
      parcels: activeParcels
    };
  }

  /**
   * 8. 30-Day Cache Freshness Validator
   * Ensures active deals ping the GIS server only once every 30 days.
   */
  function isGisDataStale(lastSyncedAt, daysThreshold = 30) {
    if (!lastSyncedAt) return true;
    const syncedTime = new Date(lastSyncedAt).getTime();
    if (isNaN(syncedTime)) return true;
    const now = Date.now();
    const ageMs = now - syncedTime;
    const maxAgeMs = daysThreshold * 24 * 60 * 60 * 1000;
    return ageMs > maxAgeMs;
  }

  return {
    YAKIMA_GIS_BASE,
    YAKIMA_ADDRESSING_URL,
    YAKIMA_TAXLOTS_URL,
    YAKIMA_ASCEND_PORTAL,
    buildSqlLikeTerm,
    searchYakimaAddresses,
    searchNationwideAddresses,
    searchAddresses,
    fetchYakimaAssessorData,
    getYakimaAssessorPortalUrl,
    detectNearbySameOwnerParcels,
    aggregateParcelPackage,
    isGisDataStale
  };
}));
