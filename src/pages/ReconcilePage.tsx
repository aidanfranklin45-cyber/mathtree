import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase, SUPABASE_URL } from '../lib/supabase/client';

/**
 * Public, zero-login landing page for the one-click buttons in rent-alert emails
 * (Confirm payment received / Snooze / Undo). Port of the legacy reconcile.html: the
 * reconcile-action edge function validates the one-time token and redirects here with the result.
 */

type Tone = 'success' | 'notice' | 'error' | 'loading';

interface View {
  tone: Tone;
  badge: string;
  title: string;
  subtitle: string;
  rows: { label: string; value: string; highlight?: boolean }[];
  primary: string;
  undoToken?: string;
}

const toneStyle: Record<Tone, { bg: string; border: string; color: string; shadow: string }> = {
  success: { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)', color: '#10b981', shadow: '0 0 20px -3px rgba(16,185,129,0.2)' },
  notice: { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)', color: '#f59e0b', shadow: '0 0 20px -3px rgba(245,158,11,0.2)' },
  error: { bg: 'rgba(244,63,94,0.12)', border: 'rgba(244,63,94,0.3)', color: '#f43f5e', shadow: '0 0 20px -3px rgba(244,63,94,0.2)' },
  loading: { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)', color: '#10b981', shadow: '0 0 20px -3px rgba(16,185,129,0.2)' },
};

const money = (v: unknown) => {
  const s = String(v ?? '');
  return s.startsWith('$') ? s : `$${Math.round(Number(v || 0)).toLocaleString('en-US')}`;
};

function confirmView(d: any): View {
  const rows: View['rows'] = [];
  if (d.deal_title) rows.push({ label: 'Property / Asset', value: String(d.deal_title) });
  if (d.tenant_name) rows.push({ label: 'Tenant', value: String(d.tenant_name) });
  if (d.period_month) rows.push({ label: 'Period', value: String(d.period_month) });
  if (d.amount_paid) rows.push({ label: 'Amount Paid', value: money(d.amount_paid), highlight: true });
  if (d.paid_date) rows.push({ label: 'Reconciled Date', value: String(d.paid_date) });
  return {
    tone: 'success', badge: '✓', title: 'Payment Reconciled ✓',
    subtitle: 'Rent collection has been confirmed and recorded directly to the PostgreSQL ledger.',
    rows, primary: 'View in Operations', undoToken: d.undo_token || undefined,
  };
}

function snoozeView(d: any): View {
  const rows: View['rows'] = [];
  if (d.deal_title) rows.push({ label: 'Property / Asset', value: String(d.deal_title) });
  if (d.tenant_name) rows.push({ label: 'Tenant', value: String(d.tenant_name) });
  if (d.grace_period_days) rows.push({ label: 'Grace Policy', value: `${d.grace_period_days} Days`, highlight: true });
  if (d.snooze_until) rows.push({ label: 'Next Alert Date', value: String(d.snooze_until) });
  return {
    tone: 'notice', badge: '⏳', title: 'Alert Snoozed ⏳',
    subtitle: 'Dynamic late policy activated. Rent reminder has been snoozed according to lease terms.',
    rows, primary: 'Open Operations', undoToken: d.undo_token || undefined,
  };
}

const noticeView = (message: string, title = 'Reconciliation Notice'): View => ({
  tone: 'notice', badge: '⚠️', title, subtitle: message || 'This action has already been completed or processed.', rows: [], primary: 'Open Operations',
});

const errorView = (message: string): View => ({
  tone: 'error', badge: '✕', title: 'Action Error',
  subtitle: message || 'An unexpected error occurred while processing this request.', rows: [], primary: 'Return to Operations',
});

/** Direct RPC first (same as the legacy page); fall back to the edge function's JSON mode. */
async function runAction(rpc: string, params: Record<string, unknown>, action: string, token: string): Promise<any> {
  try {
    const { data, error } = await supabase.rpc(rpc as any, params as any);
    if (!error && data && !(data as any).error) return data;
    if (data && (data as any).success !== undefined) return data;
    throw new Error(error?.message || (data as any)?.error || 'Direct RPC call failed');
  } catch {
    const url = `${SUPABASE_URL}/functions/v1/reconcile-action?action=${encodeURIComponent(action)}&token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    return res.json();
  }
}

export const ReconcilePage: React.FC = () => {
  const [params] = useSearchParams();
  const [view, setView] = useState<View>({
    tone: 'loading', badge: '', title: 'Processing Action', subtitle: 'Connecting to MathTree ledger...', rows: [], primary: 'Open Operations',
  });
  const [undoing, setUndoing] = useState(false);

  useEffect(() => { document.title = `${view.title} | MathTree Operations`; }, [view.title]);

  useEffect(() => {
    let live = true;
    const status = (params.get('status') || '').toLowerCase().trim();
    const action = (params.get('action') || '').toLowerCase().trim();
    const token = (params.get('token') || '').trim();
    const undoToken = (params.get('undo_token') || '').trim();
    const set = (v: View) => { if (live) setView(v); };

    (async () => {
      // Redirected here by the edge function with the outcome already decided
      if (status === 'success') {
        const payload = {
          deal_title: params.get('deal'), tenant_name: params.get('tenant'), period_month: params.get('period'),
          amount_paid: params.get('amount'), paid_date: params.get('date'), grace_period_days: params.get('grace_days'),
          snooze_until: params.get('snooze_until'), undo_token: undoToken,
        };
        return set(action === 'snooze' ? snoozeView(payload) : confirmView(payload));
      }
      if (status === 'notice') return set(noticeView(params.get('message') || 'This payment has already been reconciled.'));
      if (status === 'error') return set(errorView(params.get('message') || 'Invalid or expired reconciliation link.'));

      // Direct visit with a token
      if (token) {
        try {
          const reqAction = action || 'confirm';
          const data = reqAction === 'snooze'
            ? await runAction('snooze_rent_payment_by_token', { p_token: token }, 'snooze', token)
            : await runAction('confirm_rent_payment_by_token', { p_token: token, p_payment_method: '1-Click Direct Email' }, 'confirm', token);
          if (data && data.success) return set(reqAction === 'snooze' ? snoozeView(data) : confirmView(data));
          return set(noticeView(data?.error || data?.message || 'Could not reconcile payment.'));
        } catch (err) {
          console.error('Reconciliation error:', err);
          return set(errorView('Network connection issue. Please verify in Operations.'));
        }
      }

      set(noticeView('No active reconciliation token found. Please use the button inside your notification email.', 'MathTree Reconciliation'));
    })();
    return () => { live = false; };
  }, [params]);

  const undo = useCallback(async () => {
    if (!view.undoToken) return;
    setUndoing(true);
    try {
      const json = await runAction('undo_rent_reconciliation', { p_token: view.undoToken }, 'undo', view.undoToken);
      if (json && json.success) {
        setView({
          tone: 'notice', badge: '↩', title: 'Action Reverted',
          subtitle: 'The previous reconciliation or snooze has been reverted. Lease status is now pending.', rows: [], primary: 'Open Operations',
        });
      } else {
        window.alert('Undo Notice: ' + ((json && (json.error || json.message)) || 'Could not revert this action.'));
        setUndoing(false);
      }
    } catch {
      window.alert('Network error while reverting action.');
      setUndoing(false);
    }
  }, [view.undoToken]);

  const t = toneStyle[view.tone];

  return (
    <div style={{ minHeight: '100vh', background: '#020617', color: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'fixed', width: 500, height: 500, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none', background: 'radial-gradient(circle, rgba(16,185,129,0.08) 0%, rgba(2,6,23,0) 70%)' }} />
      <div style={{ position: 'relative', zIndex: 1, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 20, padding: '40px 32px', maxWidth: 480, width: '100%', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03)', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 60, height: 60, borderRadius: 18, background: t.bg, border: `1px solid ${t.border}`, color: t.color, boxShadow: t.shadow, fontSize: 28, fontWeight: 800, marginBottom: 20 }}>
          {view.tone === 'loading'
            ? <div className="animate-spin" style={{ width: 24, height: 24, border: '3px solid rgba(16,185,129,0.2)', borderTopColor: '#10b981', borderRadius: '50%' }} />
            : view.badge}
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 8, letterSpacing: '-0.02em' }}>{view.title}</h1>
        <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.55, marginBottom: 24 }}>{view.subtitle}</p>

        {view.rows.length > 0 && (
          <div style={{ background: '#020617', border: '1px solid #1e293b', borderRadius: 14, padding: 16, marginBottom: 24, textAlign: 'left' }}>
            {view.rows.map((r, i) => (
              <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', fontSize: 12, borderBottom: i === view.rows.length - 1 ? 'none' : '1px solid rgba(30,41,59,0.6)' }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>{r.label}</span>
                <span style={{ color: r.highlight ? '#34d399' : '#f8fafc', fontSize: r.highlight ? 15 : 12, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", textAlign: 'right' }}>{r.value}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Link to="/operations" style={{ display: 'inline-block', width: '100%', padding: '12px 18px', borderRadius: 12, fontSize: 13, fontWeight: 700, textDecoration: 'none', textAlign: 'center', background: '#10b981', color: '#022c22', boxShadow: '0 4px 14px -2px rgba(16,185,129,0.35)' }}>
            {view.primary}
          </Link>
          {view.undoToken && (
            <button type="button" onClick={undo} disabled={undoing}
              style={{ width: '100%', padding: '12px 18px', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: undoing ? 'not-allowed' : 'pointer', opacity: undoing ? 0.6 : 1, background: 'rgba(30,41,59,0.7)', color: '#94a3b8', border: '1px solid #334155', fontFamily: 'inherit' }}>
              {undoing ? 'Reverting action...' : 'Undo This Action'}
            </button>
          )}
        </div>

        <div style={{ marginTop: 24, fontSize: 11, color: '#475569', letterSpacing: '0.02em' }}>
          MathTree Institutional Asset Management &bull; Zero-Login Secure Action
        </div>
      </div>
    </div>
  );
};
