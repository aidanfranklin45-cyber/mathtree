import { describe, it, expect } from 'vitest';
import { titleCase } from './titleCase';

describe('titleCase', () => {
  it.each([
    ['storage mikes', 'Storage Mikes'],
    ['2239 longfibre rd logistics center', '2239 Longfibre Rd Logistics Center'],
    ['house of the rising sun', 'House of the Rising Sun'],
    ['the burger pad', 'The Burger Pad'],
    ['mixed-use building on main', 'Mixed-Use Building on Main'],
    ['  extra   spaces  ', 'Extra Spaces'],
  ])('%s -> %s', (input, expected) => expect(titleCase(input)).toBe(expected));

  it('leaves names that already carry deliberate capitals as written', () => {
    expect(titleCase('Valley Storage LLC')).toBe('Valley Storage LLC');
    expect(titleCase('McAllister NNN retail')).toBe('McAllister NNN Retail');
    expect(titleCase('Burger Pad #2')).toBe('Burger Pad #2');
  });
});
