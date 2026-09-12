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
}(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this)), function () {

  const YAKIMA_GIS_BASE = 'https://maps.yakimacounty.us/server/rest/services';
  const YAKIMA_ADDRESSING_URL = YAKIMA_GIS_BASE + '/Addressing/BuildingAddresses/FeatureServer/0/query';
  const YAKIMA_TAXLOTS_URL = YAKIMA_GIS_BASE + '/Assessor/Taxlots/FeatureServer/2/query';
  const YAKIMA_CHAR_URL = YAKIMA_GIS_BASE + '/Assessor/Taxlots/FeatureServer/50/query';
  const YAKIMA_COMM_URL = YAKIMA_GIS_BASE + '/Assessor/Taxlots/FeatureServer/70/query';
  const YAKIMA_ASCEND_PORTAL = 'https://yes.co.yakima.wa.us/ascend/';
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

    // 3. Extract and isolate known Yakima County City
    let detectedCity = '';
    for (const c of YAKIMA_CITIES) {
      const regex = new RegExp('\\b' + c + '\\b', 'i');
      if (regex.test(text)) {
        detectedCity = c;
        text = text.replace(regex, ' ');
        break;
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
   * Prioritizes Yakima County official addresses with verified APNs,
   * then falls back to nationwide OpenStreetMap if no county parcels match.
   */
  async function searchAddresses(query, options = {}) {
    if (!query || query.trim().length < 2) return [];

    const yakimaResults = await searchYakimaAddresses(query, options.limit || 8);

    // If official Yakima GIS matches with real APNs are found, return them directly
    if (yakimaResults.length > 0) {
      const hasRealApn = yakimaResults.some(r => r.apn);
      if (hasRealApn) {
        return yakimaResults;
      }
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
        return null;
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
    buildSqlLikeTerm,
    parseAddressInput,
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
