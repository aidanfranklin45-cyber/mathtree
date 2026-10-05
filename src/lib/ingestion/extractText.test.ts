import { describe, it, expect } from 'vitest';
import { linesFromPieces } from './extractText';
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
