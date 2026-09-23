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
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.AddressService = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this)), function () {

  const YAKIMA_GIS_BASE = 'https://maps.yakimacounty.us/server/rest/services';
  const YAKIMA_ADDRESSING_URL = YAKIMA_GIS_BASE + '/Addressing/BuildingAddresses/FeatureServer/0/query';
  const YAKIMA_TAXLOTS_URL = YAKIMA_GIS_BASE + '/Assessor/Taxlots/FeatureServer/2/query';
  const YAKIMA_CHAR_URL = YAKIMA_GIS_BASE + '/Assessor/Taxlots/FeatureServer/50/query';
  const YAKIMA_COMM_URL = YAKIMA_GIS_BASE + '/Assessor/Taxlots/FeatureServer/70/query';
  const YAKIMA_ASCEND_PORTAL = 'https://yes.co.yakima.wa.us/ascend/';
  const SPOKANE_PARCELS_URL = 'https://services1.arcgis.com/ozNll27nt9ZtPWOn/arcgis/rest/services/Parcels/FeatureServer/0/query';
  const WA_CADASTRE_URL = 'https://gis.dnr.wa.gov/site3/rest/services/Public_Boundaries/WADNR_PUBLIC_Cadastre_OpenData/MapServer/2/query';
  const WA_CADASTRE_FALLBACK_URL = 'https://services.arcgis.com/Ie0K5n4UyLAfvdiX/arcgis/rest/services/Washington_2024_DOR_Parcels/FeatureServer/0/query';
  const PHOTON_API_URL = 'https://photon.komoot.io/api/';

  // Central Washington coordinates (Yakima, WA) for spatial search bias
  const YAKIMA_LAT = 46.602;
  const YAKIMA_LON = -120.505;

  const YAKIMA_CITIES = [
    'YAKIMA', 'SELAH', 'UNION GAP', 'SUNNYSIDE', 'GRANDVIEW',
    'TOPPENISH', 'WAPATO', 'ZILLAH', 'MOXEE', 'TIETON',
    'NACHES', 'GRANGER', 'HARRAH', 'WHITE SWAN', 'COWICHE',
    'BUENA', 'TERRACE HEIGHTS', 'AHTANUM'
  ];

  const SPOKANE_CITIES = [
    'SPOKANE', 'SPOKANE VALLEY', 'LIBERTY LAKE', 'CHENEY',
    'AIRWAY HEIGHTS', 'DEER PARK', 'MEDICAL LAKE', 'MILLWOOD'
  ];

  const DIR_MAP = {
    'SOUTH': 'S', 'NORTH': 'N', 'EAST': 'E', 'WEST': 'W',
    'SOUTHEAST': 'SE', 'SOUTHWEST': 'SW', 'NORTHEAST': 'NE', 'NORTHWEST': 'NW',
    'SO': 'S', 'NO': 'N', 'EA': 'E', 'WE': 'W'
  };

  const SUFFIX_MAP = {
    'STREET': 'ST', 'STREETS': 'ST', 'AVENUE': 'AVE', 'AV': 'AVE',
    'BOULEVARD': 'BLVD', 'BOUL': 'BLVD', 'ROAD': 'RD', 'DRIVE': 'DR',
    'LANE': 'LN', 'COURT': 'CT', 'CIRCLE': 'CIR', 'PLACE': 'PL',
    'HIGHWAY': 'HWY', 'WAY': 'WAY', 'LOOP': 'LOOP', 'PARKWAY': 'PKWY'
  };

  const ORDINAL_MAP = {
    'FIRST': '1ST', 'SECOND': '2ND', 'THIRD': '3RD', 'FOURTH': '4TH', 'FIFTH': '5TH',
    'SIXTH': '6TH', 'SEVENTH': '7TH', 'EIGHTH': '8TH', 'NINTH': '9TH', 'TENTH': '10TH',
    'ELEVENTH': '11TH', 'TWELFTH': '12TH', 'THIRTEENTH': '13TH', 'FOURTEENTH': '14TH',
    'FIFTEENTH': '15TH', 'SIXTEENTH': '16TH'
  };

  function toOrdinal(numStr) {
    const n = parseInt(numStr, 10);
    if (isNaN(n) || n <= 0 || n > 150) return numStr;
    const j = n % 10, k = n % 100;
    if (j === 1 && k !== 11) return n + 'ST';
    if (j === 2 && k !== 12) return n + 'ND';
    if (j === 3 && k !== 13) return n + 'RD';
    return n + 'TH';
  }

  /**
   * Helper: Intelligently parse raw address strings into components
   * Decouples street line from City, State, and Zip code, strips unit/apt,
   * normalizes ordinals (Third -> 3RD), directionals, and suffixes.
   */
  function parseAddressInput(raw) {
    if (!raw) return { houseNumber: '', city: '', state: 'WA', zip: '', streetTokens: [], coreTokens: [], normalizedStreet: '' };
    let text = raw.trim();

    // 1. Extract and clean Zip Code if present (e.g. 98942, 98901)
    let zip = '';
    const zipMatch = text.match(/\b(98\d{3})\b/);
    if (zipMatch) {
      zip = zipMatch[1];
      text = text.replace(zipMatch[0], ' ');
    }

    // 2. Extract and clean State if present
    let state = 'WA';
    if (/\b(WA|WASHINGTON)\b/i.test(text)) {
      text = text.replace(/\b(WA|WASHINGTON)\b/gi, ' ');
    }

    // 3. Extract and isolate known County City
    let detectedCity = '';
    let detectedCounty = '';
    for (const c of YAKIMA_CITIES) {
      const regex = new RegExp('\\b' + c + '\\b', 'i');
      if (regex.test(text)) {
        detectedCity = c;
        detectedCounty = 'Yakima';
        text = text.replace(regex, ' ');
        break;
      }
    }
    if (!detectedCity) {
      for (const c of SPOKANE_CITIES) {
        const regex = new RegExp('\\b' + c + '\\b', 'i');
        if (regex.test(text)) {
          detectedCity = c;
          detectedCounty = 'Spokane';
          text = text.replace(regex, ' ');
          break;
        }
      }
    }

    // 4. Strip unit / apartment / suite prefixes and numbers
    text = text.replace(/\b(APT|APARTMENT|SUITE|STE|UNIT|BLDG|BUILDING|DEPT|SPACE|SPC|RM|ROOM|LOT|NO)\b\s*#?\s*[A-Z0-9-]+\b/gi, ' ');
    text = text.replace(/#\s*[A-Z0-9-]+\b/gi, ' ');

    // 5. Remove punctuation
    text = text.replace(/[,#.]/g, ' ').replace(/\s+/g, ' ').trim();

    // 6. Tokenize words
    const rawTokens = text.toUpperCase().split(/\s+/).filter(Boolean);

    // Locate house number (the first pure-digit token or digit with letter, e.g. 411 or 411A)
    let houseNumber = '';
    let houseIdx = -1;
    for (let i = 0; i < rawTokens.length; i++) {
      const tok = rawTokens[i];
      if (/^\d+[A-Z]?$/.test(tok) && !ORDINAL_MAP[tok]) {
        houseNumber = tok;
        houseIdx = i;
        break;
      }
    }

    // Normalize remaining tokens
    const normalizedTokens = [];
    const coreTokens = [];

    for (let i = 0; i < rawTokens.length; i++) {
      const tok = rawTokens[i];
      if (i === houseIdx) {
        normalizedTokens.push(tok);
        continue;
      }

      let norm = DIR_MAP[tok] || SUFFIX_MAP[tok] || ORDINAL_MAP[tok] || tok;

      // If a single or small number appears as a street token (e.g. '3' in '411 3 Selah'), convert to ordinal
      if (/^\d{1,2}$/.test(norm)) {
        norm = toOrdinal(norm);
      }

      normalizedTokens.push(norm);

      // Core tokens are street tokens excluding house number and directionals (e.g. ['3RD', 'ST'])
      if (!DIR_MAP[tok] && !Object.values(DIR_MAP).includes(norm)) {
        coreTokens.push(norm);
      }
    }

    return {
      raw,
      houseNumber,
      city: detectedCity,
      county: detectedCounty,
      state,
      zip,
      streetTokens: normalizedTokens,
      coreTokens,
      normalizedStreet: normalizedTokens.join(' ')
    };
  }

  function mapArcGisFeatures(features) {
    if (!features || !Array.isArray(features)) return [];
    return features.map(f => {
      const attr = f.attributes || {};
      const city = (attr.City || attr.SITUS_CITY || 'Yakima').trim();
      const state = (attr.State || 'WA').trim();
      const zip = attr.ZipCode ? String(attr.ZipCode).trim() : (attr.SITUS_ZIP ? String(attr.SITUS_ZIP).trim() : '');
      const street = (attr.Address || attr.SITUS_ADDR || '').trim();

      const rawApn = attr.ASSESSOR_N ? String(attr.ASSESSOR_N).trim() : null;
      const cleanApn = (rawApn && rawApn !== '0' && !/^0+$/.test(rawApn)) ? rawApn : null;

      return {
        formattedAddress: street + ', ' + city + ', ' + state + (zip ? ' ' + zip : ''),
        street,
        city,
        state,
        zip,
        county: 'Yakima',
        apn: cleanApn,
        buildingClass: attr.BuildingClass || 1,
        source: 'yakima_county_gis',
        isYakimaCounty: true
      };
    });
  }

  /**
   * Helper: Map raw ESRI attributes from Spokane County GIS FeatureServer
   */
  function mapSpokaneFeature(f) {
    if (!f) return null;
    const attr = f.attributes || {};
    const rawApn = attr.parcel || attr.PID_NUM || '';
    const apn = String(rawApn).trim();
    const cleanApn = (apn && apn !== '0' && !/^0+$/.test(apn)) ? apn : null;

    const street = (attr.site_address || '').trim();
    const city = (attr.site_city || 'Spokane').trim();
    const state = (attr.site_state || 'WA').trim();
    const zip = (attr.site_zip || '').trim();
    const formattedAddress = street ? (street + ', ' + city + ', ' + state + (zip ? ' ' + zip : '')) : ('Parcel ' + apn + ', Spokane, WA');

    const acres = parseFloat(attr.acreage) || 0;
    const sqft = Math.round(acres * 43560);
    const totalVal = parseFloat(attr.assessed_amt || attr.taxable_amt) || 0;
    const landVal = parseFloat(attr.land_value) || 0;
    const impVal = Math.max(0, totalVal - landVal);
    const useDesc = (attr.prop_use_desc || '').trim();
    const useCode = (attr.prop_use_code || '').trim();
    const zoning = useDesc ? (useDesc + (useCode ? ' (' + useCode + ')' : '')) : 'Spokane County GIS';

    return {
      apn: cleanApn,
      formattedApn: cleanApn,
      address: formattedAddress,
      formattedAddress: formattedAddress,
      street,
      city,
      state,
      zip,
      county: 'Spokane',
      acres: Math.round(acres * 1000) / 1000,
      sqft,
      lotSqft: sqft,
      marketLandValue: landVal,
      marketImprovementValue: impVal,
      totalAssessedValue: totalVal,
      taxYear: attr.tax_year || new Date().getFullYear(),
      zoning,
      useCode: useDesc || (attr.res_com_flag === 'C' ? 'Commercial' : 'Residential'),
      owner: 'Spokane County Parcel of Record',
      source: 'spokane_county_gis',
      isYakimaCounty: false,
      isSpokaneCounty: true,
      assessorPortalUrl: cleanApn ? ('https://cp.spokanecounty.org/scout/SCOUTDashboard/?ParcelNumber=' + cleanApn.replace(/[^0-9]/g, '')) : 'https://cp.spokanecounty.org/scout/'
    };
  }

  /**
   * Helper: Map raw ESRI attributes from WA State Statewide Cadastre into standardized parcel entity
   */
  function mapWaCadastreFeature(f) {
    if (!f) return null;
    const attr = f.attributes || {};

    const rawApn = attr.PARCEL_ID || attr.COUNTY_PARCEL_NO || attr.APN || attr.PIN || attr.PARCEL_NUMBER || attr.PRCL_REVW_NORMALIZED_PRCL_ID || attr.ASSESSOR_N || '';
    const apn = String(rawApn).trim();

    const county = String(attr.COUNTY || attr.COUNTY_NAME || attr.COUNTY_LABEL_NM || attr.COUNTY_DESC_TXT || (attr.CO_NO ? ('County ' + attr.CO_NO) : '') || '').trim();

    let acres = parseFloat(attr.ACRES || attr.ACREAGE || attr.CALC_ACRES || attr.PRCL_REVW_TOTAL_ACRES || attr.GIS_ACRES) || 0;
    if (!acres && attr.Shape__Area) {
      acres = parseFloat(attr.Shape__Area) / 43560;
    }
    if (!acres && attr.SHAPE_Area) {
      acres = parseFloat(attr.SHAPE_Area) / 43560;
    }
    acres = Math.round(acres * 1000) / 1000;
    const sqft = Math.round(acres * 43560);

    const owner = (attr.OWN_NAME || attr.OWNER || attr.OWNER_NAME || attr.LANDOWNERS || attr.PRIMARY_OWNER || attr.ORG_NAME ||
      [attr.FIRST_NAME, attr.LAST_NAME].filter(Boolean).join(' ') || 'Owner of Record').toString().trim();

    const street = (attr.SITUS_ADDR || attr.SITUS_ADDRESS || attr.PHY_ADDR1 || attr.FFPA_PRCL_ADDR || attr.ADDRESS || '').toString().trim();
    const city = (attr.SITUS_CITY || attr.PHY_CITY || attr.CITY || '').toString().trim();
    const zip = (attr.SITUS_ZIP || attr.PHY_ZIPCD || attr.ZIP || attr.ZIPCODE || '').toString().trim();
    const state = 'WA';

    let formattedAddress = '';
    if (street) {
      formattedAddress = street + (city ? ', ' + city : '') + ', WA' + (zip ? ' ' + zip : '');
    } else if (apn) {
      formattedAddress = 'Parcel ' + apn + (county ? ' (' + county + ' County)' : '') + ', WA';
    } else {
      formattedAddress = (county || 'Washington') + ' Parcel, WA';
    }

    const landVal = parseFloat(attr.LND_VAL || attr.MKT_LAND || attr.LAND_VALUE) || 0;
    const impVal = parseFloat(attr.IMP_VAL || attr.MKT_IMPVT || attr.IMPROVEMENT_VALUE) || 0;
    const totalVal = parseFloat(attr.TOTAL_VAL || attr.TV_SD || attr.TOTAL_ASSESSED_VALUE || attr.JV) || (landVal + impVal);

    const useCode = (attr.DOR_UC || attr.DOR_LAND_USE_CD || attr.USE_CODE || attr.LAND_USE || 'Cadastral Parcel').toString().trim();
    const legal = (attr.S_LEGAL || attr.LEGAL || attr.LEGAL_DESC || attr.PARCEL_DESC_TXT || '').toString().trim();

    return {
      apn,
      formattedApn: apn,
      address: formattedAddress,
      formattedAddress: formattedAddress,
      street,
      city,
      state,
      zip,
      county: county || 'Washington',
      acres,
      sqft,
      lotSqft: sqft,
      marketLandValue: landVal,
      marketImprovementValue: impVal,
      totalAssessedValue: totalVal,
      taxYear: attr.ASMNT_YR || attr.TAX_YEAR || new Date().getFullYear(),
      zoning: attr.ZONING || attr.ZONE || 'WA State Cadastre',
      useCode,
      owner,
      legalDescription: legal,
      source: 'wa_state_cadastre',
      isYakimaCounty: /yakima/i.test(county),
      isWaStatewideBackup: true
    };
  }

  /**
   * Helper: Normalize search query into SQL LIKE format for ArcGIS fallback
   */
  function buildSqlLikeTerm(query) {
    if (!query) return '%';
    const cleaned = query.trim().toUpperCase().replace(/[^A-Z0-9\s]/g, ' ');
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '%';
    return '%' + parts.join('%') + '%';
  }

  /**
   * 1. Search official Yakima County GIS (Addressing + Assessor Taxlots Layers)
   * Multi-tier query strategies:
   * - Direct 11-digit APN lookup against Addressing & Taxlots layers
   * - Parsed exact normalized street with city
   * - House number + core street tokens (handles missing/mistaken directionals like omitting 'South')
   * - Ordinal variations (Third -> 3RD)
   * - Multi-token wildcards across both Addressing and Taxlot layers
   */
  async function searchYakimaAddresses(query, limit = 8) {
    if (!query || query.trim().length < 2) return [];

    const parsed = parseAddressInput(query);
    const cleanDigits = query.replace(/[^0-9]/g, '');

    // APN direct lookup: If query contains an 11-digit parcel number (e.g. 18130211474 or 181302-11474)
    if (cleanDigits.length === 11) {
      try {
        const apnWhere = "ASSESSOR_N = '" + cleanDigits + "'";
        const apnRes = await fetch(YAKIMA_ADDRESSING_URL + '?' + new URLSearchParams({
          where: apnWhere,
          outFields: 'Address,City,State,ZipCode,ASSESSOR_N,BuildingClass',
          f: 'json',
          resultRecordCount: '5'
        }));
        if (apnRes.ok) {
          const apnData = await apnRes.json();
          if (apnData && apnData.features && apnData.features.length > 0) {
            return mapArcGisFeatures(apnData.features);
          }
        }
        // If not in BuildingAddresses (e.g. vacant land/taxlot), query Taxlots layer directly
        const taxlotApnRes = await fetch(YAKIMA_TAXLOTS_URL + '?' + new URLSearchParams({
          where: apnWhere,
          outFields: 'ASSESSOR_N,SITUS_ADDR,SITUS_CITY,SITUS_ZIP,ORG_NAME,MKT_LAND,MKT_IMPVT',
          f: 'json',
          resultRecordCount: '5'
        }));
        if (taxlotApnRes.ok) {
          const taxlotData = await taxlotApnRes.json();
          if (taxlotData && taxlotData.features && taxlotData.features.length > 0) {
            return mapArcGisFeatures(taxlotData.features);
          }
        }
      } catch (e) {
        console.warn('APN direct lookup error:', e);
      }
    }

    // Build candidate WHERE clauses for Building Addresses layer
    const candidates = [];
    const coreJoin = parsed.coreTokens.join('%');

    // Priority 1: Full normalized street + City (e.g. "411 S 3RD ST" in "SELAH")
    if (parsed.normalizedStreet && parsed.city) {
      candidates.push("Address LIKE '" + parsed.normalizedStreet + "%' AND City = '" + parsed.city + "'");
    }

    // Priority 2: House number + core street tokens + City (handles missing directionals, e.g. "411 3rd Selah" -> "411 %3RD% in SELAH")
    if (parsed.houseNumber && coreJoin && parsed.city) {
      candidates.push("Address LIKE '" + parsed.houseNumber + " %" + coreJoin + "%' AND City = '" + parsed.city + "'");
    }

    // Priority 3: Full normalized street without city constraint
    if (parsed.normalizedStreet) {
      candidates.push("Address LIKE '" + parsed.normalizedStreet + "%'");
    }

    // Priority 4: House number + core street tokens without city constraint
    if (parsed.houseNumber && coreJoin) {
      candidates.push("Address LIKE '" + parsed.houseNumber + " %" + coreJoin + "%'");
    }

    // Priority 5: Wildcard with all normalized tokens
    if (parsed.streetTokens.length > 0) {
      candidates.push("Address LIKE '%" + parsed.streetTokens.join('%') + "%'" + (parsed.city ? " AND City = '" + parsed.city + "'" : ""));
    }

    // Priority 6: Legacy wildcard fallback
    const legacyLike = buildSqlLikeTerm(query.replace(/washington|wa|98\d{3}/gi, ''));
    if (legacyLike !== '%') {
      candidates.push("Address LIKE '" + legacyLike + "'");
    }

    const uniqueCandidates = Array.from(new Set(candidates)).filter(Boolean);

    // 1. Query BuildingAddresses layer
    for (const whereClause of uniqueCandidates) {
      try {
        const params = new URLSearchParams({
          where: whereClause,
          outFields: 'Address,City,State,ZipCode,ASSESSOR_N,BuildingClass',
          f: 'json',
          resultRecordCount: String(limit)
        });
        const response = await fetch(YAKIMA_ADDRESSING_URL + '?' + params.toString());
        if (response.ok) {
          const data = await response.json();
          if (data && data.features && data.features.length > 0) {
            const mapped = mapArcGisFeatures(data.features);
            if (mapped.length > 0) {
              if (parsed.city) {
                mapped.sort((a, b) => (b.city.toUpperCase() === parsed.city ? 1 : 0) - (a.city.toUpperCase() === parsed.city ? 1 : 0));
              }
              return mapped;
            }
          }
        }
      } catch (err) {
        console.warn('Yakima Addressing query failed for:', whereClause, err);
      }
    }

    // 2. Query Assessor Taxlots Layer (SITUS_ADDR) using matching candidate queries
    const taxCandidates = [];
    if (parsed.normalizedStreet && parsed.city) {
      taxCandidates.push("SITUS_ADDR LIKE '" + parsed.normalizedStreet + "%' AND SITUS_CITY = '" + parsed.city + "'");
    }
    if (parsed.houseNumber && coreJoin && parsed.city) {
      taxCandidates.push("SITUS_ADDR LIKE '" + parsed.houseNumber + " %" + coreJoin + "%' AND SITUS_CITY = '" + parsed.city + "'");
    }
    if (parsed.normalizedStreet) {
      taxCandidates.push("SITUS_ADDR LIKE '" + parsed.normalizedStreet + "%'");
    }
    if (parsed.houseNumber && coreJoin) {
      taxCandidates.push("SITUS_ADDR LIKE '" + parsed.houseNumber + " %" + coreJoin + "%'");
    }

    const uniqueTaxCandidates = Array.from(new Set(taxCandidates)).filter(Boolean);

    for (const taxWhere of uniqueTaxCandidates) {
      try {
        const taxParams = new URLSearchParams({
          where: taxWhere,
          outFields: 'ASSESSOR_N,SITUS_ADDR,SITUS_CITY,SITUS_ZIP,ORG_NAME,MKT_LAND,MKT_IMPVT',
          f: 'json',
          resultRecordCount: String(limit)
        });
        const taxRes = await fetch(YAKIMA_TAXLOTS_URL + '?' + taxParams.toString());
        if (taxRes.ok) {
          const taxData = await taxRes.json();
          if (taxData && taxData.features && taxData.features.length > 0) {
            return mapArcGisFeatures(taxData.features);
          }
        }
      } catch (err) {
        console.warn('Yakima Taxlots query failed for:', taxWhere, err);
      }
    }

    return [];
  }

  /**
   * 2. Search official Spokane County GIS (Parcels Layer)
   */
  async function searchSpokaneAddresses(query, limit = 8) {
    if (!query || query.trim().length < 2) return [];

    const parsed = parseAddressInput(query);
    const cleanDigits = query.replace(/[^0-9]/g, '');

    // APN direct lookup
    if (cleanDigits.length >= 6) {
      try {
        const apnWhere = "parcel LIKE '%" + cleanDigits + "%' OR PID_NUM LIKE '%" + cleanDigits + "%'";
        const params = new URLSearchParams({
          where: apnWhere,
          outFields: '*',
          f: 'json',
          resultRecordCount: String(limit)
        });
        const res = await fetch(SPOKANE_PARCELS_URL + '?' + params.toString());
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.features) && data.features.length > 0) {
            return data.features.map(mapSpokaneFeature).filter(Boolean);
          }
        }
      } catch (e) {
        console.warn('Spokane APN direct lookup error:', e);
      }
    }

    const candidates = [];
    if (parsed.houseNumber && parsed.coreTokens.length > 0) {
      const streetPart = parsed.coreTokens[0];
      candidates.push("site_str_nbr = " + parsed.houseNumber + " AND site_str_name LIKE '%" + streetPart + "%'");
      if (parsed.coreTokens.length > 1) {
        candidates.push("site_str_nbr = " + parsed.houseNumber + " AND site_str_name LIKE '%" + parsed.coreTokens.join('%') + "%'");
      }
    }
    if (parsed.houseNumber) {
      candidates.push("site_str_nbr = " + parsed.houseNumber);
    }
    if (parsed.coreTokens.length > 0) {
      candidates.push("site_str_name LIKE '%" + parsed.coreTokens[0] + "%'");
    }

    const uniqueCandidates = Array.from(new Set(candidates)).filter(Boolean);

    for (const where of uniqueCandidates) {
      try {
        const params = new URLSearchParams({
          where,
          outFields: '*',
          f: 'json',
          resultRecordCount: String(limit)
        });
        const res = await fetch(SPOKANE_PARCELS_URL + '?' + params.toString());
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.features) && data.features.length > 0) {
            return data.features.map(mapSpokaneFeature).filter(Boolean);
          }
        }
      } catch (err) {
        console.warn('Spokane parcel query error:', where, err);
      }
    }

    return [];
  }

  /**
   * 3. Search nationwide addresses via Photon (OpenStreetMap) with Central WA bias
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
        const isSpokane = /spokane/i.test(county) || /spokane/i.test(city);

        return {
          formattedAddress: formatted || p.name || 'Unknown Location',
          street,
          city,
          state,
          zip,
          county: county || (isYakima ? 'Yakima' : (isSpokane ? 'Spokane' : '')),
          coordinates: f.geometry ? f.geometry.coordinates : null,
          source: 'openstreetmap',
          isYakimaCounty: isYakima,
          isSpokaneCounty: isSpokane
        };
      });
    } catch (err) {
      console.warn('Nationwide address search failed:', err);
      return [];
    }
  }

  /**
   * Search Washington State Statewide Cadastre (MapServer / FeatureServer)
   * Retrieves parcel APN, acreage, owner, and county information as backup coverage
   * when Yakima or Spokane returns no features.
   */
  async function searchWaCadastreAddresses(query, limit = 6) {
    if (!query || query.trim().length < 2) return [];

    const cleanDigits = query.replace(/[^0-9]/g, '');
    const cleanTerm = query.trim().toUpperCase().replace(/'/g, "''").replace(/[^A-Z0-9\s]/g, ' ');
    const tokens = cleanTerm.split(/\s+/).filter(Boolean);

    const endpoints = [WA_CADASTRE_FALLBACK_URL];

    for (const url of endpoints) {
      try {
        const candidates = [];
        if (cleanDigits.length >= 6) {
          candidates.push("PARCEL_ID LIKE '%" + cleanDigits + "%' OR COUNTY_PARCEL_NO LIKE '%" + cleanDigits + "%' OR APN LIKE '%" + cleanDigits + "%'");
        }
        if (tokens.length > 0) {
          const joined = tokens.slice(0, 3).join('%');
          candidates.push("SITUS_ADDR LIKE '%" + joined + "%' OR PHY_ADDR1 LIKE '%" + joined + "%'");
        }

        for (const where of candidates) {
          const params = new URLSearchParams({
            where,
            outFields: '*',
            f: 'json',
            resultRecordCount: String(limit)
          });
          const res = await fetch(url + '?' + params.toString());
          if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.features) && data.features.length > 0) {
              const mapped = data.features.map(mapWaCadastreFeature).filter(Boolean);
              if (mapped.length > 0) return mapped;
            }
          }
        }
      } catch (err) {
        console.warn('WA State Cadastre search failed on endpoint:', url, err);
      }
    }
    return [];
  }

  /**
   * Fetch parcel record from Washington State Statewide Cadastre by APN
   */
  async function fetchWaCadastreData(assessorNumber) {
    if (!assessorNumber) return null;
    const clean = String(assessorNumber).trim().replace(/[^0-9A-Za-z-]/g, '');
    const cleanDigits = clean.replace(/[^0-9]/g, '');

    const endpoints = [WA_CADASTRE_FALLBACK_URL];

    for (const baseUrl of endpoints) {
      try {
        const whereClauses = [
          "PARCEL_ID = '" + clean + "'",
          "COUNTY_PARCEL_NO = '" + clean + "'",
          "APN = '" + clean + "'",
          "PIN = '" + clean + "'"
        ];
        if (cleanDigits && cleanDigits !== clean) {
          whereClauses.push("PARCEL_ID = '" + cleanDigits + "'");
          whereClauses.push("COUNTY_PARCEL_NO = '" + cleanDigits + "'");
        }
        whereClauses.push("PARCEL_ID LIKE '%" + clean + "%'");

        for (const where of whereClauses) {
          const params = new URLSearchParams({
            where,
            outFields: '*',
            f: 'json',
            resultRecordCount: '1'
          });

          const res = await fetch(baseUrl + '?' + params.toString());
          if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.features) && data.features.length > 0) {
              return mapWaCadastreFeature(data.features[0]);
            }
          }
        }
      } catch (err) {
        console.warn('WA Cadastre APN query failed on endpoint:', baseUrl, err);
      }
    }

    return null;
  }

  /**
   * Fetch official Spokane County Assessor Taxlot Record by APN
   */
  async function fetchSpokaneAssessorData(assessorNumber) {
    if (!assessorNumber) return null;
    const clean = String(assessorNumber).trim();
    const cleanDigits = clean.replace(/[^0-9]/g, '');

    try {
      const where = "parcel = '" + clean + "' OR parcel = '" + cleanDigits + "' OR PID_NUM = '" + clean + "' OR PID_NUM LIKE '%" + cleanDigits + "%'";
      const params = new URLSearchParams({
        where,
        outFields: '*',
        f: 'json',
        resultRecordCount: '1'
      });
      const res = await fetch(SPOKANE_PARCELS_URL + '?' + params.toString());
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.features) && data.features.length > 0) {
          return mapSpokaneFeature(data.features[0]);
        }
      }
    } catch (e) {
      console.warn('fetchSpokaneAssessorData error:', e);
    }
    return null;
  }

  /**
   * Fetch parcel record via ESRI Point-in-Polygon spatial query (WGS84 Lat/Lon)
   */
  async function fetchParcelByCoordinates(lat, lon) {
    if (!lat || !lon) return null;
    const pointGeom = JSON.stringify({
      x: lon,
      y: lat,
      spatialReference: { wkid: 4326 }
    });
    const spatialParams = new URLSearchParams({
      geometry: pointGeom,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      f: 'json',
      resultRecordCount: '1'
    }).toString();

    // 1. If in Yakima County bounding box (~lat 46.0-47.0, lon -121.5 - -119.5)
    if (lat >= 46.0 && lat <= 47.0 && lon >= -121.5 && lon <= -119.5) {
      try {
        const yakimaRes = await fetch(YAKIMA_TAXLOTS_URL + '?' + spatialParams);
        if (yakimaRes.ok) {
          const data = await yakimaRes.json();
          if (data?.features?.[0]?.attributes?.ASSESSOR_N) {
            return await fetchYakimaAssessorData(data.features[0].attributes.ASSESSOR_N);
          }
        }
      } catch (e) {
        console.warn('Yakima spatial lookup error:', e);
      }
    }

    // 2. Spokane County GIS FeatureServer
    try {
      const spokaneRes = await fetch(SPOKANE_PARCELS_URL + '?' + spatialParams);
      if (spokaneRes.ok) {
        const data = await spokaneRes.json();
        if (data && Array.isArray(data.features) && data.features.length > 0) {
          return mapSpokaneFeature(data.features[0]);
        }
      }
    } catch (e) {
      console.warn('Spokane spatial lookup error:', e);
    }

    // 3. Fallback to WA DOR Statewide Parcels
    try {
      const waDorRes = await fetch(WA_CADASTRE_FALLBACK_URL + '?' + spatialParams);
      if (waDorRes.ok) {
        const data = await waDorRes.json();
        if (data && Array.isArray(data.features) && data.features.length > 0) {
          return mapWaCadastreFeature(data.features[0]);
        }
      }
    } catch (e) {
      console.warn('WA DOR spatial lookup error:', e);
    }

    return null;
  }

  /**
   * 4. Unified Address Search:
   * Prioritizes Yakima and Spokane County official GIS addresses with verified APNs.
   * If not found, falls back to statewide cadastre and nationwide OpenStreetMap geocoding.
   */
  async function searchAddresses(query, options = {}) {
    if (!query || query.trim().length < 2) return [];

    const parsed = parseAddressInput(query);
    const isSpokaneQuery = parsed.county === 'Spokane' || /spokane/i.test(query);
    const isYakimaQuery = parsed.county === 'Yakima' || /yakima|selah|union gap|sunnyside|grandview|toppenish|wapato|zillah|moxee|naches/i.test(query);

    let yakimaResults = [];
    let spokaneResults = [];

    if (isYakimaQuery) {
      yakimaResults = await searchYakimaAddresses(query, options.limit || 8);
    } else if (isSpokaneQuery) {
      spokaneResults = await searchSpokaneAddresses(query, options.limit || 8);
    } else {
      [yakimaResults, spokaneResults] = await Promise.all([
        searchYakimaAddresses(query, 5),
        searchSpokaneAddresses(query, 5)
      ]);
    }

    // If official Yakima GIS matches with real APNs are found, return them directly
    if (yakimaResults.length > 0 && yakimaResults.some(r => r.apn)) {
      return yakimaResults;
    }
    // If official Spokane GIS matches with real APNs are found, return them directly
    if (spokaneResults.length > 0 && spokaneResults.some(r => r.apn)) {
      return spokaneResults;
    }

    // WA Statewide Cadastre backup
    const waCadastreResults = await searchWaCadastreAddresses(query, options.limit || 6);

    // Nationwide OpenStreetMap fallback
    const nationResults = await searchNationwideAddresses(query, 6);

    const seen = new Set();
    const merged = [];

    const addItems = (list) => {
      list.forEach(item => {
        const key = (item.formattedAddress || item.street || item.apn || '').toLowerCase().trim();
        if (key && !seen.has(key)) {
          seen.add(key);
          merged.push(item);
        }
      });
    };

    addItems(spokaneResults);
    addItems(yakimaResults);
    addItems(waCadastreResults);
    addItems(nationResults);

    return merged;
  }

  /**
   * Unified Resolver: Resolves rich parcel & assessor details for any selected address item
   * (Direct APN, Yakima 3-layer GIS, Spokane GIS, or spatial point-in-polygon coordinates)
   */
  async function resolveParcelDetails(addressItem) {
    if (!addressItem) return null;

    // 1. If item has APN and is from Yakima
    if (addressItem.apn && (addressItem.isYakimaCounty || /yakima/i.test(addressItem.county || ''))) {
      const data = await fetchYakimaAssessorData(addressItem.apn);
      if (data) return data;
    }

    // 2. If item has APN and is Spokane
    if (addressItem.apn && (/spokane/i.test(addressItem.county || '') || addressItem.source === 'spokane_county_gis')) {
      const data = await fetchSpokaneAssessorData(addressItem.apn);
      if (data) return data;
    }

    // 3. If item has an APN from another WA county
    if (addressItem.apn) {
      const data = await fetchWaCadastreData(addressItem.apn);
      if (data) return data;
    }

    // 4. If coordinates are available [lon, lat]
    let lat = null, lon = null;
    if (Array.isArray(addressItem.coordinates) && addressItem.coordinates.length >= 2) {
      lon = addressItem.coordinates[0];
      lat = addressItem.coordinates[1];
    } else if (addressItem.lat && addressItem.lon) {
      lat = parseFloat(addressItem.lat);
      lon = parseFloat(addressItem.lon);
    }

    if (lat && lon) {
      const spatial = await fetchParcelByCoordinates(lat, lon);
      if (spatial) {
        if (addressItem.formattedAddress && (!spatial.street || spatial.street === 'Adjacent Parcel')) {
          spatial.formattedAddress = addressItem.formattedAddress;
        }
        return spatial;
      }
    }

    // 5. Baseline fallback representation
    const county = addressItem.county || 'Washington';
    const isYakima = /yakima/i.test(county);
    const isSpokane = /spokane/i.test(county);
    const apn = addressItem.apn || null;

    let portalUrl = YAKIMA_ASCEND_PORTAL;
    if (isSpokane) {
      portalUrl = 'https://cp.spokanecounty.org/scout/' + (apn ? ('SCOUTDashboard/?ParcelNumber=' + apn.replace(/[^0-9]/g, '')) : '');
    } else if (isYakima && apn) {
      portalUrl = YAKIMA_ASCEND_PORTAL + '?mParcelID=' + apn;
    } else if (/king/i.test(county)) {
      portalUrl = 'https://blue.kingcounty.com/Assessor/eRealProperty/' + (apn ? ('Detail.aspx?ParcelNbr=' + apn.replace(/[^0-9]/g, '')) : '');
    } else if (/pierce/i.test(county)) {
      portalUrl = 'https://atip.piercecountywa.gov/app/parcelInfo' + (apn ? ('?parcelNumber=' + apn.replace(/[^0-9]/g, '')) : '');
    }

    return {
      apn,
      formattedApn: apn || 'Geocoded Address',
      address: addressItem.formattedAddress || addressItem.street || 'Property Address',
      street: addressItem.street || '',
      city: addressItem.city || '',
      state: addressItem.state || 'WA',
      zip: addressItem.zip || '',
      county: county,
      acres: 0,
      sqft: 0,
      lotSqft: 0,
      marketLandValue: 0,
      marketImprovementValue: 0,
      totalAssessedValue: 0,
      taxYear: new Date().getFullYear(),
      zoning: 'Standard Municipal / Commercial',
      useCode: 'Real Property',
      owner: 'Owner of Record',
      source: addressItem.source || 'openstreetmap',
      isYakimaCounty: isYakima,
      isSpokaneCounty: isSpokane,
      assessorPortalUrl: portalUrl
    };
  }

  /**
   * Helper: Generate official Assessor Web Search URL for any county
   */
  function getAssessorPortalUrl(countyOrAddress, apn) {
    const cleanApn = apn ? String(apn).trim() : '';
    const digits = cleanApn.replace(/[^0-9]/g, '');
    const countyStr = String(countyOrAddress || '').toLowerCase();

    if (countyStr.includes('spokane')) {
      return 'https://cp.spokanecounty.org/scout/' + (digits ? ('SCOUTDashboard/?ParcelNumber=' + digits) : '');
    }
    if (countyStr.includes('yakima')) {
      return YAKIMA_ASCEND_PORTAL + (cleanApn ? ('?mParcelID=' + encodeURIComponent(cleanApn)) : '');
    }
    if (countyStr.includes('king')) {
      return 'https://blue.kingcounty.com/Assessor/eRealProperty/' + (digits ? ('Detail.aspx?ParcelNbr=' + digits) : '');
    }
    if (countyStr.includes('pierce')) {
      return 'https://atip.piercecountywa.gov/app/parcelInfo' + (digits ? ('?parcelNumber=' + digits) : '');
    }
    if (countyStr.includes('snohomish')) {
      return 'https://www.snoco.org/proptax/default.aspx' + (digits ? ('?parcel=' + digits) : '');
    }
    return YAKIMA_ASCEND_PORTAL;
  }

  /**
   * 4. Fetch official Yakima County Assessor Taxlot Record by APN
   * Yakima County GIS remains the primary high-detail source for Yakima properties.
   * If Yakima returns no features or the APN is outside Yakima County,
   * queries Washington State Statewide Cadastre FeatureServer as backup coverage.
   */
  async function fetchYakimaAssessorData(assessorNumber) {
    if (!assessorNumber) return null;

    const cleanedApn = String(assessorNumber).trim().replace(/[^0-9]/g, '');
    const queryParams = new URLSearchParams({
      where: "ASSESSOR_N = '" + cleanedApn + "'",
      outFields: '*',
      f: 'json'
    }).toString();

    try {
      const [taxlotRes, commRes, charRes] = await Promise.allSettled([
        fetch(YAKIMA_TAXLOTS_URL + '?' + queryParams).then(r => r.ok ? r.json() : null),
        fetch(YAKIMA_COMM_URL + '?' + queryParams).then(r => r.ok ? r.json() : null),
        fetch(YAKIMA_CHAR_URL + '?' + queryParams).then(r => r.ok ? r.json() : null)
      ]);

      const data = taxlotRes.status === 'fulfilled' ? taxlotRes.value : null;
      if (!data || !data.features || data.features.length === 0) {
        // Issue #13: If Yakima returns no features, query WA State Cadastre as backup coverage
        return await fetchWaCadastreData(assessorNumber);
      }

      const commData = commRes.status === 'fulfilled' ? commRes.value : null;
      const charData = charRes.status === 'fulfilled' ? charRes.value : null;

      const attr = data.features[0].attributes || {};
      const commAttr = (commData && commData.features && commData.features[0] && commData.features[0].attributes) || {};
      const charAttr = (charData && charData.features && charData.features[0] && charData.features[0].attributes) || {};

      const landVal = parseFloat(attr.MKT_LAND) || 0;
      const impVal = parseFloat(attr.MKT_IMPVT) || 0;
      const totalVal = landVal + impVal;
      const acres = parseFloat(attr.ACRES) || 0;
      const lotSqft = Math.round(acres * 43560);

      const names = [attr.FIRST_NAME, attr.LAST_NAME].map(s => s ? String(s).trim() : '').filter(Boolean);
      const org = attr.ORG_NAME ? String(attr.ORG_NAME).trim() : '';
      const owner = names.length > 0 ? (names.join(' ') + (org ? ' / ' + org : '')) : (org || 'Owner of Record');

      // Building specifications & architecture characteristics
      const rawYearBuilt = commAttr.YEAR_BUILT || (charAttr.YEAR_BLT ? parseInt(charAttr.YEAR_BLT, 10) : null) || null;
      const rawEffYear = commAttr.EFF_YEAR_B || (charAttr.EFF_YEAR ? parseInt(charAttr.EFF_YEAR, 10) : null) || null;
      
      const charFloorSqFt = (parseFloat(charAttr.MAIN_SQFT) || 0) + (parseFloat(charAttr.UPPR_SQFT) || 0) + (parseFloat(charAttr.FN_BSMT_SQ) || 0);
      const buildingSqFt = parseFloat(commAttr.GROUND_FL_) || (charFloorSqFt > 0 ? charFloorSqFt : null) || null;
      
      const stories = commAttr.NUM_STORIE || (charAttr.STORIES ? parseFloat(charAttr.STORIES) : null) || null;
      const constructionType = commAttr.CONSTRUCTI || (charAttr.BLD_STYLE ? 'Wood Frame / ' + charAttr.BLD_STYLE : null) || 'Standard Frame';
      const exteriorWall = commAttr.EXT_WALL_T || null;
      const foundation = commAttr.FOUNDATION || null;
      const buildingStyle = charAttr.BLD_STYLE || commAttr.BUILDING_T || 'Commercial / Mixed';
      const hvac = commAttr.HEAT_COOL_ || (commAttr.PCT_HEATED ? `${commAttr.PCT_HEATED}% Heated` : null) || null;
      const condition = commAttr.CONDITION || charAttr.CONDITION || 'Average';
      const quality = commAttr.QUALITY || charAttr.QUALITY || 'Average';
      const bedrooms = charAttr.BEDROOMS ? parseInt(charAttr.BEDROOMS, 10) : null;
      const bathrooms = charAttr.FULL_BATH ? (parseFloat(charAttr.FULL_BATH) + (parseFloat(charAttr.HALF_BATH || 0) * 0.5)) : null;

      const cleanZone = (s) => (s && typeof s === 'string' && s.trim() && s.trim() !== 'N/A') ? s.trim() : null;
      const resolvedZoning = cleanZone(attr.CYAK_ZONG) || cleanZone(attr.CNY_ZONE) || cleanZone(attr.CNYZONE) || cleanZone(attr.UG_ZONING) || cleanZone(attr.UAZO_ZONE) || 'Commercial / Mixed';

      const situsStreet = attr.SITUS_ADDR ? String(attr.SITUS_ADDR).trim() : '';
      const situsCity = attr.SITUS_CITY ? String(attr.SITUS_CITY).trim() : 'Yakima';
      const situsZip = attr.SITUS_ZIP ? String(attr.SITUS_ZIP).trim() : '';
      const cleanAddress = situsStreet ? `${situsStreet}, ${situsCity}, WA${situsZip ? ' ' + situsZip : ''}` : 'Yakima, WA';

      return {
        apn: cleanedApn,
        formattedApn: cleanedApn.length === 11 ? (cleanedApn.slice(0, 6) + '-' + cleanedApn.slice(6)) : cleanedApn,
        address: cleanAddress,
        street: situsStreet,
        city: situsCity,
        state: 'WA',
        zip: situsZip,
        county: 'Yakima',
        isYakimaCounty: true,
        acres: Math.round(acres * 1000) / 1000,
        sqft: lotSqft,
        lotSqft,
        marketLandValue: landVal,
        marketImprovementValue: impVal,
        totalAssessedValue: totalVal,
        taxYear: attr.TAX_YEAR || new Date().getFullYear(),
        zoning: resolvedZoning,
        useCode: attr.USE_CODE ? String(attr.USE_CODE).trim() : 'General Commercial / Residential',
        owner: owner,
        legalDescription: attr.LEGAL ? String(attr.LEGAL).trim() : '',
        waterSource: attr.WATER_SRC || 'Municipal / District',
        sewerSource: attr.SEWER_SRC || 'Public Sewer',
        assessorPortalUrl: YAKIMA_ASCEND_PORTAL + '?mParcelID=' + cleanedApn,
        source: 'yakima_county_assessor',

        // Building Structural Specs
        yearBuilt: rawYearBuilt,
        effectiveYearBuilt: rawEffYear,
        buildingSqFt: buildingSqFt,
        grossLivingArea: buildingSqFt,
        stories: stories,
        constructionType: constructionType,
        exteriorWall: exteriorWall,
        foundation: foundation,
        buildingStyle: buildingStyle,
        hvac: hvac,
        condition: condition,
        quality: quality,
        bedrooms: bedrooms,
        bathrooms: bathrooms
      };
    } catch (err) {
      console.warn('Failed to fetch Yakima assessor data, falling back to WA State Cadastre:', err);
      return await fetchWaCadastreData(assessorNumber);
    }
  }

  function formatYakimaApn(apn) {
    if (!apn) return '';
    const clean = String(apn).trim();
    if (clean.length === 11) {
      return clean.slice(0, 6) + '-' + clean.slice(6);
    }
    return clean;
  }

  function getAssessorPortalUrl(parcelOrApn, county = '') {
    if (!parcelOrApn) return '';
    const clean = String(parcelOrApn).trim();
    const cleanNumeric = clean.replace(/[^0-9]/g, '');
    const c = String(county || '').toLowerCase();

    if (c.includes('spokane') || /^\d{5}\.\d{4}$/.test(clean)) {
      return 'https://cp.spokanecounty.org/scout/SCOUTDashboard/?ParcelNumber=' + encodeURIComponent(cleanNumeric || clean);
    }
    if (c.includes('king')) {
      return 'https://blue.kingcounty.com/Assessor/eRealProperty/Detail.aspx?ParcelNbr=' + encodeURIComponent(cleanNumeric || clean);
    }
    if (c.includes('pierce')) {
      return 'https://epip.co.pierce.wa.us/cfapps/atr/epip/search.cfm';
    }
    if (c.includes('snohomish')) {
      return 'https://snohomishcountywa.gov/Assessor';
    }
    if (c.includes('yakima') || cleanNumeric.length >= 10) {
      return YAKIMA_ASCEND_PORTAL + '?mParcelID=' + encodeURIComponent(cleanNumeric || clean);
    }
    return YAKIMA_ASCEND_PORTAL;
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
   * Helper: Map companion parcel features into standard package parcel model
   */
  function mapCompanionFeatures(features) {
    if (!Array.isArray(features)) return [];
    return features.map(f => {
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
  }

  function mapYakimaCompanionFeatures(features) {
    if (!Array.isArray(features)) return [];
    return features.map(f => {
      const a = f.attributes || {};
      const apn = a.ASSESSOR_N ? String(a.ASSESSOR_N).trim() : '';
      const acres = Number(a.ACRES) || 0;
      const mktLand = Number(a.MKT_LAND) || 0;
      const mktImp = Number(a.MKT_IMPVT) || 0;
      const totalVal = mktLand + mktImp;
      const ownerParts = [a.ORG_NAME, [a.FIRST_NAME, a.LAST_NAME].filter(Boolean).join(' ')].filter(Boolean);
      const owner = ownerParts[0] || 'Owner of Record';

      return {
        apn: apn,
        formattedApn: formatYakimaApn(apn),
        address: [a.SITUS_ADDR, a.SITUS_CITY, 'WA', a.SITUS_ZIP].filter(Boolean).join(', '),
        street: a.SITUS_ADDR || '',
        city: a.SITUS_CITY || '',
        state: 'WA',
        zip: a.SITUS_ZIP || '',
        county: 'Yakima',
        acres: Number(acres.toFixed(3)),
        sqft: Math.round(acres * 43560),
        lotSqft: Math.round(acres * 43560),
        marketLandValue: mktLand,
        marketImprovementValue: mktImp,
        totalAssessedValue: totalVal,
        zoning: a.USE_CODE || 'Standard',
        useCode: a.USE_CODE || '',
        owner: owner,
        legalDescription: a.LEGAL || '',
        source: 'yakima_county_assessor',
        isYakimaCounty: true,
        assessorPortalUrl: getYakimaAssessorPortalUrl(apn)
      };
    }).filter(p => p.apn);
  }

  function mapSpokaneCompanionFeatures(features) {
    if (!Array.isArray(features)) return [];
    return features.map(f => {
      const a = f.attributes || {};
      const apn = a.parcel ? String(a.parcel).trim() : (a.PID_NUM ? String(a.PID_NUM).trim() : '');
      const acres = Number(a.acreage) || 0;
      const totalVal = Number(a.assessed_amt) || 0;
      const landVal = Number(a.land_value) || 0;
      const impVal = Math.max(0, totalVal - landVal);
      const addr = a.site_address ? (a.site_address + (a.site_city ? ', ' + a.site_city : '') + ', WA') : 'Spokane Property';

      return {
        apn: apn,
        formattedApn: apn,
        address: addr,
        street: a.site_address || '',
        city: a.site_city || 'SPOKANE',
        state: 'WA',
        zip: '',
        county: 'Spokane',
        acres: Number(acres.toFixed(3)),
        sqft: Math.round(acres * 43560),
        lotSqft: Math.round(acres * 43560),
        marketLandValue: landVal,
        marketImprovementValue: impVal,
        totalAssessedValue: totalVal,
        taxYear: a.tax_year || 2026,
        zoning: (a.prop_use_desc || 'Commercial') + (a.prop_use_code ? ' (' + a.prop_use_code + ')' : ''),
        useCode: a.prop_use_desc || '',
        owner: 'Spokane County Parcel of Record',
        source: 'spokane_county_gis',
        isSpokaneCounty: true,
        assessorPortalUrl: getAssessorPortalUrl(apn, 'Spokane')
      };
    }).filter(p => p.apn);
  }

  /**
   * 6. Detect Nearby Parcels Owned by the Same Entity (Multi-Parcel Package Detection)
   * Issue #12: Fetches primary parcel bounding geometry/envelope from county GIS (returnGeometry=true),
   * and queries adjacent parcels using ESRI spatial envelope intersection (geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects),
   * while falling back to owner matching within the section/block if spatial queries return empty.
   */
  async function detectNearbySameOwnerParcels(primaryApn, ownerName, parcelContext) {
    if (!primaryApn) return [];
    const isSpokane = parcelContext?.isSpokaneCounty || (parcelContext?.county && /spokane/i.test(parcelContext.county));

    // Handle Spokane County
    if (isSpokane) {
      const cleanApn = String(primaryApn).trim();
      const dotIndex = cleanApn.indexOf('.');
      const prefix = dotIndex > 0 ? cleanApn.slice(0, dotIndex) : cleanApn.slice(0, 5);
      if (prefix.length >= 3) {
        try {
          const spokaneParams = new URLSearchParams({
            where: "parcel LIKE '" + prefix + ".%' AND parcel <> '" + cleanApn + "'",
            outFields: 'parcel,PID_NUM,site_address,site_city,acreage,assessed_amt,land_value,prop_use_desc,prop_use_code,tax_year',
            f: 'json',
            resultRecordCount: '10'
          });
          const res = await fetch(SPOKANE_PARCELS_URL + '?' + spokaneParams.toString());
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data?.features) && data.features.length > 0) {
              return mapSpokaneCompanionFeatures(data.features);
            }
          }
        } catch (e) {
          console.warn('Spokane companion parcel search failed:', e);
        }
      }
      return [];
    }

    // Default to Yakima County ArcGIS Taxlots
    const cleanApn = String(primaryApn).trim().replace(/[^0-9]/g, '');
    if (cleanApn.length < 6) return [];

    const prefix = cleanApn.slice(0, 6);
    const outFields = 'ASSESSOR_N,SITUS_ADDR,SITUS_CITY,SITUS_ZIP,ACRES,MKT_LAND,MKT_IMPVT,USE_CODE,ORG_NAME,FIRST_NAME,LAST_NAME,LEGAL';

    // Parse owner name filter if available
    let ownerFilter = '';
    if (ownerName && typeof ownerName === 'string' && ownerName.trim().length > 2) {
      const cleanOwner = ownerName.trim().toUpperCase().replace(/'/g, "''").replace(/[^A-Z0-9\s]/g, '');
      const ownerTerms = cleanOwner.split(/\s+/).filter(w => w.length > 2 && !['LLC', 'INC', 'CORP', 'CO', 'THE', 'AND', 'OF'].includes(w));
      const term = ownerTerms[0] || cleanOwner.split(/\s+/)[0];
      if (term) {
        ownerFilter = "(UPPER(ORG_NAME) LIKE '%" + term + "%' OR UPPER(LAST_NAME) LIKE '%" + term + "%')";
      }
    }

    // Strategy 1: Spatial Envelope Intersection via Yakima GIS
    try {
      const primaryGeomParams = new URLSearchParams({
        where: "ASSESSOR_N = '" + cleanApn + "'",
        outFields: 'ASSESSOR_N',
        returnGeometry: 'true',
        f: 'json'
      });
      const primaryRes = await fetch(YAKIMA_TAXLOTS_URL + '?' + primaryGeomParams.toString());
      if (primaryRes.ok) {
        const primaryData = await primaryRes.json();
        const primaryFeature = primaryData?.features?.[0];
        const rings = primaryFeature?.geometry?.rings;

        if (Array.isArray(rings) && rings.length > 0) {
          let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
          for (const ring of rings) {
            for (const [x, y] of ring) {
              if (x < xmin) xmin = x;
              if (x > xmax) xmax = x;
              if (y < ymin) ymin = y;
              if (y > ymax) ymax = y;
            }
          }

          if (xmin !== Infinity && ymin !== Infinity) {
            // Buffer envelope by 50 feet (State Plane South WKID 2286 / 102749) to capture adjacent/touching parcels
            const buffer = 50;
            const envelope = {
              xmin: xmin - buffer,
              ymin: ymin - buffer,
              xmax: xmax + buffer,
              ymax: ymax + buffer,
              spatialReference: primaryFeature.geometry.spatialReference || primaryData.spatialReference || { wkid: 102749, latestWkid: 2286 }
            };

            let spatialWhere = "ASSESSOR_N <> '" + cleanApn + "'";
            if (ownerFilter) {
              spatialWhere += " AND " + ownerFilter;
            }

            const spatialParams = new URLSearchParams({
              geometry: JSON.stringify(envelope),
              geometryType: 'esriGeometryEnvelope',
              spatialRel: 'esriSpatialRelIntersects',
              where: spatialWhere,
              outFields: outFields,
              f: 'json',
              resultRecordCount: '15'
            });

            const spatialRes = await fetch(YAKIMA_TAXLOTS_URL + '?' + spatialParams.toString());
            if (spatialRes.ok) {
              const spatialData = await spatialRes.json();
              if (Array.isArray(spatialData?.features) && spatialData.features.length > 0) {
                return mapYakimaCompanionFeatures(spatialData.features);
              }
            }
          }
        }
      }
    } catch (spatialErr) {
      console.warn('Spatial envelope query failed, falling back to owner matching:', spatialErr);
    }

    // Strategy 2: Fallback to owner matching within section/block (RTS prefix)
    try {
      let fallbackWhere = "ASSESSOR_N LIKE '" + prefix + "%' AND ASSESSOR_N <> '" + cleanApn + "'";
      if (ownerFilter) {
        fallbackWhere += " AND " + ownerFilter;
      }

      const fallbackParams = new URLSearchParams({
        where: fallbackWhere,
        outFields: outFields,
        f: 'json',
        resultRecordCount: '15'
      });

      const fallbackRes = await fetch(YAKIMA_TAXLOTS_URL + '?' + fallbackParams.toString());
      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json();
        if (Array.isArray(fallbackData?.features) && fallbackData.features.length > 0) {
          return mapYakimaCompanionFeatures(fallbackData.features);
        }
      }
    } catch (fallbackErr) {
      console.warn('Fallback owner matching query failed:', fallbackErr);
    }

    return [];
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
      acres: Math.round(totalAcres * 1000) / 1000,
      totalSqFt,
      sqft: totalSqFt,
      totalLandValue: Math.round(totalLand),
      marketLandValue: Math.round(totalLand),
      totalImprovementValue: Math.round(totalImp),
      marketImprovementValue: Math.round(totalImp),
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
    YAKIMA_CHAR_URL,
    YAKIMA_COMM_URL,
    YAKIMA_ASCEND_PORTAL,
    SPOKANE_PARCELS_URL,
    WA_CADASTRE_URL,
    buildSqlLikeTerm,
    parseAddressInput,
    searchYakimaAddresses,
    searchSpokaneAddresses,
    searchNationwideAddresses,
    searchWaCadastreAddresses,
    searchAddresses,
    fetchYakimaAssessorData,
    fetchSpokaneAssessorData,
    fetchWaCadastreData,
    fetchParcelByCoordinates,
    resolveParcelDetails,
    getYakimaAssessorPortalUrl,
    getAssessorPortalUrl,
    detectNearbySameOwnerParcels,
    aggregateParcelPackage,
    isGisDataStale
  };
}));
