import { supabase } from './client';

/**
 * JSON headers carrying the signed-in user's access token. Edge functions decide what a caller may do from this token;
 * the public anon key identifies nobody and is rejected by the functions that can send email or change data.
 */
export async function authJsonHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
