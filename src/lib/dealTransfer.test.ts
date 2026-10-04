import { describe, it, expect } from 'vitest';
import { parseTransferError, transferErrorMessage } from './dealTransfer';

describe('deal transfer errors', () => {
  it('maps the codes the database function raises', () => {
    expect(parseTransferError({ message: 'recipient_not_found' })).toBe('recipient_not_found');
    expect(parseTransferError({ message: 'deal_not_found_or_not_owner' })).toBe('deal_not_found_or_not_owner');
    expect(parseTransferError({ message: 'cannot_transfer_to_self' })).toBe('cannot_transfer_to_self');
  });

  it('reports a missing function as unavailable and anything else as unknown', () => {
    expect(parseTransferError({ message: 'Could not find the function', code: 'PGRST202' })).toBe('unavailable');
    expect(parseTransferError({ message: 'boom' })).toBe('unknown');
    expect(parseTransferError(null)).toBe('unknown');
  });

  it('has a plain-language message for every code', () => {
    expect(transferErrorMessage('recipient_not_found')).toMatch(/sign up/);
  });
});
