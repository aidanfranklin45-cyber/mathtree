import { describe, it, expect } from 'vitest';
import { joinPages, linesFromPieces, needsReading, piecesFromWords } from './extractText';
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

describe('needsReading', () => {
  const prose = 'This offering is for the purchase of a fully occupied leased multi-tenant investment property in downtown Yakima with four tenants on triple net leases and a stable rent roll. '.repeat(3);

  it('leaves a page with ordinary text alone', () => {
    expect(needsReading(prose)).toBeNull();
    expect(needsReading(prose + ' It’s “NNN” – 5% • 2%/year')).toBeNull();
  });

  it('flags a page with only a footer and a title (a table pasted in as a picture)', () => {
    expect(needsReading('811 W Yakima Ave | 3\nRent Roll & NOI Calcs')).toBe('empty');
  });

  it('flags a page whose font came out as symbols', () => {
    expect(needsReading('THIS OFFERING i¨ fz ¶he zz ¶¾oi¶Ý ¶z ¾ cha¨e a f¾llÝ zcc¾ied oe¶ lea¨ed m¾l¶i-¶eoao¶ ioÖe¨¶meo¶ in Yakima AÖe '.repeat(4))).toBe('garbled');
  });
});

describe('piecesFromWords', () => {
  const w = (text: string, x0: number, y0: number, x1: number, y1: number, confidence = 90) => ({ text, confidence, bbox: { x0, y0, x1, y1 } });

  it('rebuilds a picture table into rows and tab-separated columns, top to bottom', () => {
    const text = linesFromPieces(piecesFromWords([
      w('Suite', 100, 100, 180, 120), w('Rent', 700, 102, 780, 122),
      w('101', 100, 160, 150, 180), w('$1,206.64', 700, 161, 840, 181),
    ]));
    expect(text).toBe('Suite\tRent\n101\t$1,206.64');
  });

  it('drops low-confidence words, which are what OCR makes of a photograph', () => {
    const text = linesFromPieces(piecesFromWords([w('Rent', 100, 100, 180, 120), w('xq~', 300, 100, 360, 120, 20)]));
    expect(text).toBe('Rent');
  });
});
