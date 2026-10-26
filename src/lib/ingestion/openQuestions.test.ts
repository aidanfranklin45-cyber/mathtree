import { describe, expect, it } from 'vitest';
import { openQuestions } from './openQuestions';

const keys = (asset: string, inputs: Record<string, unknown>) => openQuestions({ asset_class: asset, inputs }).map((m) => m.key);

describe('unit count is asked, never assumed', () => {
  it('asks for it on apartments and storage when it is blank', () => {
    expect(keys('multi-unit', {})).toContain('unitCount');
    expect(keys('storage', {})).toContain('unitCount');
  });
  it('does not ask once it is stated', () => {
    expect(keys('multi-unit', { unitCount: 12 })).not.toContain('unitCount');
    expect(keys('storage', { storageUnitCount: 312 })).not.toContain('unitCount');
  });
  it('treats zero as not stated', () => {
    expect(keys('multi-unit', { unitCount: 0 })).toContain('unitCount');
  });
  it('does not ask for single-family or commercial', () => {
    expect(keys('single-family', {})).not.toContain('unitCount');
    expect(keys('commercial', {})).not.toContain('unitCount');
  });
});
