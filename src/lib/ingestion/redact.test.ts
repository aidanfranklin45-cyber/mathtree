import { describe, it, expect } from 'vitest';
import { redactForModel } from '@engine/redact';

const ROLL = [
  'Unit,Tenant,Sq Ft,Rent,Phone,Email',
  '101,Jane Doe,900,1500,509-555-1234,jane@example.com',
  '102,"Acme Dental, LLC",1200,2400,(509) 555-9876,billing@acme.com',
  '103,Vacant,800,0,,',
].join('\n');

describe('redactForModel', () => {
  it('hides names under a tenant column, phones and emails, and restores names', () => {
    const r = redactForModel(ROLL);
    expect(r.text).not.toMatch(/Jane|Doe|Acme|example\.com|555-1234|555-9876/);
    expect(r.text).toContain('Vacant');
    expect(r.text).toContain('1500');
    expect(r.report).toMatchObject({ emails: 2, phones: 2, names: 2 });
    expect(r.restore('[TENANT_1] pays')).toMatch(/Acme Dental|Jane Doe/);
  });

  it('hides labelled names and names the caller already knows', () => {
    const r = redactForModel('Tenant: Bob Smith\nBob Smith signs below. Contact Mary Jones about the roof. Phone 5095551234', { knownNames: ['Mary Jones'] });
    expect(r.text).not.toMatch(/Bob|Smith|Mary|Jones|5095551234/);
    expect(r.report.names).toBe(2);
  });

  it('leaves a bare ten-digit parcel number and dollar amounts alone', () => {
    const r = redactForModel('APN 3555012345 assessed $1,250,000.00 rent 1,200.00');
    expect(r.text).toBe('APN 3555012345 assessed $1,250,000.00 rent 1,200.00');
  });
});
