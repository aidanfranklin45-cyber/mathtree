/**
 * Where to go after sign-in, from the `next` value in the address. Only an in-app path is accepted: it must start with a single `/` that
 * is not followed by `/` or `\`, and it must hold no control characters (browsers drop tabs and line breaks inside an address, so
 * `/<tab>/evil.com` would otherwise become `//evil.com`). Anything else goes to the dashboard.
 */
export function sanitizeNextUrl(raw: string | null): string {
  if (!raw) return '/dashboard';
  const trimmed = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return '/dashboard';
  return /^\/[^/\\]/.test(trimmed) ? trimmed : '/dashboard';
}
