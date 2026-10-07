const YAKIMA_ASCEND_PORTAL = 'https://yes.co.yakima.wa.us/ascend/';

/** Deep link to the county assessor's public record for a parcel (same rules the legacy AddressService used). */
export function getAssessorPortalUrl(county: string | undefined | null, apn: string | undefined | null): string {
  const cleanApn = apn ? String(apn).trim() : '';
  const digits = cleanApn.replace(/[^0-9]/g, '');
  const c = String(county || '').toLowerCase();

  if (c.includes('spokane')) return 'https://cp.spokanecounty.org/scout/' + (digits ? `SCOUTDashboard/?ParcelNumber=${digits}` : '');
  if (c.includes('yakima')) return YAKIMA_ASCEND_PORTAL + (cleanApn ? `?mParcelID=${encodeURIComponent(cleanApn)}` : '');
  if (c.includes('king')) return 'https://blue.kingcounty.com/Assessor/eRealProperty/' + (digits ? `Detail.aspx?ParcelNbr=${digits}` : '');
  if (c.includes('pierce')) return 'https://atip.piercecountywa.gov/app/parcelInfo' + (digits ? `?parcelNumber=${digits}` : '');
  if (c.includes('snohomish')) return 'https://www.snoco.org/proptax/default.aspx' + (digits ? `?parcel=${digits}` : '');
  return YAKIMA_ASCEND_PORTAL;
}

/** "Yakima APN: 181302-14439 (2 Parcels)" style label for the header badge. */
export function apnBadgeLabel(county: string | undefined | null, apn: string, parcelCount: number): string {
  const prefix = /spokane/i.test(String(county))
    ? 'Spokane APN: '
    : /yakima/i.test(String(county))
      ? 'Yakima APN: '
      : /king/i.test(String(county))
        ? 'King APN: '
        : /pierce/i.test(String(county))
          ? 'Pierce APN: '
          : 'APN: ';
  return prefix + apn + (parcelCount > 1 ? ` (${parcelCount} Parcels)` : '');
}
