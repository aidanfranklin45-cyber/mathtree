import { describe, it, expect } from 'vitest';
import { joinPages, linesFromPieces } from './extractText';
import { redactForModel } from '@engine/redact';

const p = (str: string, x: number, y: number) => ({ str, x, y, width: str.length * 5 });

describe('linesFromPieces', () => {
  it('rebuilds rows and columns so a PDF rent roll keeps its tenant column', () => {
    const text = linesFromPieces([
      p('Rent', 300, 700), p('Unit', 50, 700.5), p('Tenant', 120, 700), p('Phone', 400, 700),
      p('101', 50, 680), p('Jane Doe', 120, 680), p('1500', 300, 680), p('509-555-1234', 400, 680),
      p('102', 50, 660), p('Vacant', 120, 660), p('0', 300, 660),
    ]);
    expect(text.split('\n')).toHaveLength(3);
    expect(text.split('\n')[1]).toBe('101\tJane Doe\t1500\t509-555-1234');
    const r = redactForModel(text);
    expect(r.text).not.toMatch(/Jane|555-1234/);
    expect(r.text).toContain('Vacant');
  });
});

describe('joinPages', () => {
  it('drops a footer repeated on every page but keeps repeated table headers and rows', () => {
    const header = 'Unit\tTenant\tRent';
    const pages = ['Acme Brokerage Confidential\n' + header + '\n101\tJane Doe\t1500', 'Acme Brokerage Confidential\n' + header + '\n102\tBob Roe\t1600', 'Acme Brokerage Confidential\n' + header + '\n103\tAnn Poe\t1700'];
    const text = joinPages(pages);
    expect(text).not.toContain('Confidential');
    expect(text.split(header).length - 1).toBe(3);
    expect(text).toContain('103\tAnn Poe\t1700');
    expect(redactForModel(text).text).not.toMatch(/Jane|Bob|Ann/);
  });

  it('starts every page with a marker, so a figure can be traced to its page', () => {
    const text = joinPages(['Page one line', 'Page two line']);
    expect(text.split('\n')).toEqual(['--- Page 1 ---', 'Page one line', '--- Page 2 ---', 'Page two line']);
  });
});
