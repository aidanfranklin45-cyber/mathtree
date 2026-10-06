import { describe, it, expect } from 'vitest';
import { documentMimeType, documentPath, isSpreadsheet, opensInTab, safeFileName } from './dealDocuments';

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
  it('puts the deal first, so the bucket rule can check who owns the deal now', () => {
    expect(documentPath('deal-9', 'OM.pdf', 123)).toBe('deal-9/123-OM.pdf');
  });
  it('opens a PDF or text file in a tab, and sends spreadsheets and Word files to the owner\'s own programs', () => {
    expect(opensInTab('application/pdf')).toBe(true);
    expect(opensInTab('text/csv')).toBe(false);
    expect(isSpreadsheet('text/csv')).toBe(true);
    expect(isSpreadsheet('application/pdf')).toBe(false);
  });
});
