import { supabase } from './supabase/client';

/** Error codes raised by `rpc_transfer_deal_ownership` (supabase/migrations_draft/10_transfer_deal_ownership.sql). */
export type TransferErrorCode =
  | 'invalid_email'
  | 'deal_not_found_or_not_owner'
  | 'demo_deal'
  | 'recipient_not_found'
  | 'cannot_transfer_to_self'
  | 'not_authenticated'
  | 'unavailable'
  | 'unknown';

const MESSAGES: Record<TransferErrorCode, string> = {
  invalid_email: 'Enter a valid email address.',
  deal_not_found_or_not_owner: 'Only the current owner can transfer this property.',
  demo_deal: 'Demo properties cannot be transferred.',
  recipient_not_found: 'No MathTree account uses that email. They need to sign up first.',
  cannot_transfer_to_self: 'That is your own email. Enter the other person’s email.',
  not_authenticated: 'Sign in again to transfer this property.',
  unavailable: 'Transfers are not available yet. Please try again later.',
  unknown: 'The transfer failed. Nothing was changed.',
};

export function transferErrorMessage(code: TransferErrorCode): string {
  return MESSAGES[code];
}

/** Maps a Postgres/PostgREST error message to one of our codes (the function raises the code as the message). */
export function parseTransferError(err: { message?: string; code?: string } | null | undefined): TransferErrorCode {
  const text = `${err?.message || ''}`;
  const known = (Object.keys(MESSAGES) as TransferErrorCode[]).find((c) => c !== 'unknown' && c !== 'unavailable' && text.includes(c));
  if (known) return known;
  // PGRST202 / 42883: the function has not been created in this database yet.
  if (err?.code === 'PGRST202' || err?.code === '42883') return 'unavailable';
  return 'unknown';
}

export type TransferResult = { ok: true; newOwnerId: string } | { ok: false; code: TransferErrorCode; message: string };

/** Hands a deal to another existing user by email. The database function enforces owner-only and recipient rules. */
export async function transferDealOwnership(dealId: string, recipientEmail: string): Promise<TransferResult> {
  const { data, error } = await supabase.rpc('rpc_transfer_deal_ownership' as never, {
    p_deal_id: dealId,
    p_recipient_email: recipientEmail.trim(),
  } as never);
  if (error) {
    const code = parseTransferError(error);
    return { ok: false, code, message: transferErrorMessage(code) };
  }
  const newOwnerId = String((data as { new_owner_id?: string } | null)?.new_owner_id || '');
  return { ok: true, newOwnerId };
}
