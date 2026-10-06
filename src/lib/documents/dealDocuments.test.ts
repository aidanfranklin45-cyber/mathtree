import { describe, it, expect } from 'vitest';
import { documentMimeType, documentPath, safeFileName } from './dealDocuments';

describe('stored document names and types', () => {
  it('keeps PDF, CSV, Excel, Word and text, and refuses the rest', () => {
    expect(documentMimeType('Quail Ridge OM.pdf')).toBe('application/pdf');
    expect(documentMimeType('rent roll.CSV')).toBe('text/csv');
    expect(documentMimeType('t12.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(documentMimeType('notes.exe')).toBeNull();
    expect(documentMimeType('noextension')).toBeNull();
  });
  it('makes a file name safe for a storage path', () => {
    expect(safeFileName('Quail Ridge OM (final) #2.pdf')).toBe('Quail Ridge OM _final_ _2.pdf');
    expect(safeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(safeFileName('...')).toBe('document');
  });
  it('puts the owner first, then the deal, so the bucket rule can check who owns the file', () => {
    expect(documentPath('user-1', 'deal-9', 'OM.pdf', 123)).toBe('user-1/deal-9/123-OM.pdf');
  });
});
