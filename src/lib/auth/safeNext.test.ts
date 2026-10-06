import { describe, it, expect } from 'vitest';
import { sanitizeNextUrl } from './safeNext';

describe('sanitizeNextUrl', () => {
  it('keeps in-app paths', () => {
    expect(sanitizeNextUrl('/project?id=abc&tab=debt')).toBe('/project?id=abc&tab=debt');
    expect(sanitizeNextUrl(' /compare ')).toBe('/compare');
  });

  it('sends everything else to the dashboard', () => {
    for (const bad of [null, '', 'https://evil.com', '//evil.com', '/\\evil.com', '/\t/evil.com', '/\n/evil.com', '/%09/x\u0000', 'javascript:alert(1)', 'evil.com']) {
      expect(sanitizeNextUrl(bad)).toBe('/dashboard');
    }
  });
});
