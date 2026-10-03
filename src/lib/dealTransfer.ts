import { invokeCollaboration } from './collaborationEdge';

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

/** Hands a deal to another existing user by email, through the manage-collaboration edge function. */
export async function transferDealOwnership(dealId: string, recipientEmail: string): Promise<TransferResult> {
  const res = await invokeCollaboration<{ success?: boolean; new_owner_id?: string; error?: string; code?: string }>(
    'transfer_ownership',
    { deal_id: dealId, recipient_email: recipientEmail.trim() },
  );
  if (res?.success) return { ok: true, newOwnerId: String(res.new_owner_id || '') };
  // No response at all, or the function is not deployed yet (unknown action): report unavailable, not a transfer failure.
  const code: TransferErrorCode = !res || /Unknown action/i.test(res.error || '')
    ? 'unavailable'
    : parseTransferError({ message: res.error, code: res.code });
  return { ok: false, code, message: transferErrorMessage(code) };
}
