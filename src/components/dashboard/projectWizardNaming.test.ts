import { describe, it, expect } from 'vitest';
import { deriveProjectName, ASSET_NAME_PLACEHOLDERS } from './ProjectWizardModal';
import { resolveDealDisplayName } from '../../lib/math/pointInTime';

describe('ProjectWizardModal naming behavior', () => {
  it('preserves user custom project name', () => {
    expect(deriveProjectName('Selah BRRRR Investment', '808 W FREMONT AVE, SELAH, WA 98942', 'single-family')).toBe('Selah BRRRR Investment');
    expect(deriveProjectName('  Custom Logistics Hub  ', '128 N 2nd St, Yakima, WA', 'commercial')).toBe('Custom Logistics Hub');
  });

  it('automatically derives project name from property street address when name is not provided', () => {
    expect(deriveProjectName('', '808 W FREMONT AVE, SELAH, WA 98942', 'single-family')).toBe('808 W FREMONT AVE');
    expect(deriveProjectName('   ', '128 N 2nd St, Yakima, WA 98901', 'commercial')).toBe('128 N 2nd St');
    expect(deriveProjectName('', '414 S 8th St', 'multi-unit')).toBe('414 S 8th St');
  });

  it('falls back to asset-class-specific underwriting project title when neither name nor real address is provided', () => {
    expect(deriveProjectName('', '', 'single-family')).toBe('Single-Family Underwriting Project');
    expect(deriveProjectName('', 'Synthetic Model • Generic Metro', 'multi-unit')).toBe('Multi-Unit Multifamily Underwriting Project');
    expect(deriveProjectName('', 'United States', 'commercial')).toBe('Commercial Real Estate Underwriting Project');
    expect(deriveProjectName('', '', 'storage')).toBe('Self-Storage Facility Underwriting Project');
  });

  it('provides sensible, asset-specific placeholders for every asset class', () => {
    expect(ASSET_NAME_PLACEHOLDERS['single-family']).toContain('808 W Fremont Ave');
    expect(ASSET_NAME_PLACEHOLDERS['multi-unit']).toContain('12-Unit Multifamily');
    expect(ASSET_NAME_PLACEHOLDERS['commercial']).toContain('Industrial Logistics');
    expect(ASSET_NAME_PLACEHOLDERS['storage']).toContain('Self-Storage Facility');
  });

  it('integrates seamlessly with resolveDealDisplayName on the dashboard', () => {
    const derived = deriveProjectName('', '808 W FREMONT AVE, SELAH, WA 98942', 'single-family');
    const deal = {
      title: derived,
      location: '808 W FREMONT AVE, SELAH, WA 98942',
      inputs: { propertyAddress: '808 W FREMONT AVE, SELAH, WA 98942' },
    };
    expect(resolveDealDisplayName(deal)).toBe('808 W FREMONT AVE');
  });
});
