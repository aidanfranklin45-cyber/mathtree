import React, { useEffect, useState } from 'react';
import { supabase, SUPABASE_URL } from '../../lib/supabase/client';
import { authJsonHeaders } from '../../lib/supabase/authHeaders';
import { DEFAULT_RECOVERY_LEAD_DAYS, normalizeRecoveryPrefs, RECOVERY_CATEGORY_LABELS, type RecoveryCategory } from '../../lib/operations/recoveries';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type Msg = { kind: 'ok' | 'err' | 'info' | 'warn'; text: React.ReactNode } | null;

const card = 'p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-2';
const field = 'bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono text-xs focus:border-blue-500 focus:outline-none';
const tone = {
  ok: 'text-emerald-400',
  err: 'text-rose-400',
  info: 'text-blue-300',
  warn: 'text-amber-400',
} as const;

export const AlertSettingsModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [userId, setUserId] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState('');
  const [changeOpen, setChangeOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [accountMsg, setAccountMsg] = useState<Msg>(null);

  const [notifEmail, setNotifEmail] = useState('');
  const [notifMsg, setNotifMsg] = useState<Msg>(null);

  const [advance, setAdvance] = useState('0');
  const [escalation, setEscalation] = useState('30');
  const [remindOnDue, setRemindOnDue] = useState(true);
  const [followupGrace, setFollowupGrace] = useState(true);
  const [followupFreq, setFollowupFreq] = useState('3');
  const [followupMax, setFollowupMax] = useState('3');
  const [snoozeDays, setSnoozeDays] = useState(''); // blank = use each lease's grace period
  const [digestMin, setDigestMin] = useState('3'); // combine into one email per property at this many tenants; 0 = never
  const [recLead, setRecLead] = useState<Record<RecoveryCategory, string>>(
    () => Object.fromEntries(Object.entries(DEFAULT_RECOVERY_LEAD_DAYS).map(([k, v]) => [k, String(v)])) as Record<RecoveryCategory, string>,
  ); // days of warning before tenant-paid items (tax, insurance, CAM...) are due
  const [recEmail, setRecEmail] = useState(true);
  const [timingMsg, setTimingMsg] = useState<Msg>(null);

  const [testEmail, setTestEmail] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<Msg>(null);

  useEffect(() => {
    if (!isOpen) return;
    setAccountMsg(null); setNotifMsg(null); setTimingMsg(null); setTestMsg(null); setChangeOpen(false);
    let live = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data?.user;
      if (!live || !user) return;
      setUserId(user.id);
      setAccountEmail(user.email || '');
      setTestEmail((cur) => cur || user.email || '');
      const { data: prof } = await supabase
        .from('profiles')
        .select('notification_email, alert_preferences')
        .eq('id', user.id)
        .maybeSingle();
      if (!live || !prof) return;
      if (prof.notification_email) { setNotifEmail(prof.notification_email); setTestEmail(prof.notification_email); }
      const p = prof.alert_preferences as Record<string, unknown> | null;
      if (p && typeof p === 'object') {
        if (p.advance_notice_days !== undefined) setAdvance(String(p.advance_notice_days));
        if (p.escalation_notice_days !== undefined) setEscalation(String(p.escalation_notice_days));
        if (p.remind_on_due !== undefined) setRemindOnDue(Boolean(p.remind_on_due));
        if (p.followup_grace_period !== undefined) setFollowupGrace(Boolean(p.followup_grace_period));
        if (p.followup_frequency_days !== undefined) setFollowupFreq(String(p.followup_frequency_days));
        if (p.followup_max_count !== undefined) setFollowupMax(String(p.followup_max_count));
        if (p.snooze_days !== undefined && p.snooze_days !== null) setSnoozeDays(String(p.snooze_days));
        if (p.digest_min_tenants !== undefined) setDigestMin(String(p.digest_min_tenants));
        const rp = normalizeRecoveryPrefs(p);
        setRecLead(Object.fromEntries(Object.entries(rp.leadDays).map(([k, v]) => [k, String(v)])) as Record<RecoveryCategory, string>);
        setRecEmail(rp.email);
      }
    })();
    return () => { live = false; };
  }, [isOpen]);

  if (!isOpen) return null;

  const submitChangeEmail = async () => {
    const value = newEmail.trim();
    if (!value || !value.includes('@')) return setAccountMsg({ kind: 'err', text: 'Please enter a valid email address.' });
    const { error } = await supabase.auth.updateUser({ email: value });
    if (error) return setAccountMsg({ kind: 'err', text: `Error changing email: ${error.message}` });
    setAccountMsg({ kind: 'ok', text: `✓ Verification email sent to ${value}! Click the confirmation link in your inbox to complete the change.` });
    setNewEmail('');
  };

  const saveNotifEmail = async () => {
    if (!userId) return;
    const { error } = await supabase
      .from('profiles')
      .update({ notification_email: notifEmail.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', userId);
    setNotifMsg(error
      ? { kind: 'err', text: `Error saving notification email: ${error.message}` }
      : { kind: 'ok', text: '✓ Rent notification email saved successfully!' });
  };

  const saveTiming = async () => {
    if (!userId) return;
    const prefs = {
      advance_notice_days: parseInt(advance || '0', 10),
      escalation_notice_days: parseInt(escalation || '30', 10),
      remind_on_due: remindOnDue,
      followup_grace_period: followupGrace,
      followup_frequency_days: parseInt(followupFreq || '3', 10),
      followup_max_count: parseInt(followupMax || '3', 10),
      snooze_days: snoozeDays === '' ? null : parseInt(snoozeDays, 10),
      digest_min_tenants: parseInt(digestMin || '3', 10),
      recovery_lead_days: normalizeRecoveryPrefs({ recovery_lead_days: recLead }).leadDays,
      recovery_email: recEmail,
    };
    // Keep other keys stored beside the timing prefs (e.g. the inbox's muted items)
    const { data: cur } = await supabase.from('profiles').select('alert_preferences').eq('id', userId).maybeSingle();
    const kept = (cur?.alert_preferences && typeof cur.alert_preferences === 'object' ? cur.alert_preferences : {}) as Record<string, unknown>;
    const { error } = await supabase
      .from('profiles')
      .update({ alert_preferences: { ...kept, ...prefs }, updated_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) return setTimingMsg({ kind: 'err', text: `Error: ${error.message}` });
    // Mirror to auth metadata so the cron function can read it from either place
    await supabase.auth.updateUser({ data: { alert_preferences: prefs } }).catch(() => undefined);
    setTimingMsg({ kind: 'ok', text: '✓ Timing preferences saved to profile & account!' });
    setTimeout(() => setTimingMsg(null), 4000);
  };

  const sendTest = async () => {
    const recipient = testEmail.trim() || accountEmail;
    if (!recipient || !recipient.includes('@')) return setTestMsg({ kind: 'err', text: 'Please enter a valid recipient email address.' });
    setTestBusy(true);
    setTestMsg({ kind: 'info', text: `Dispatching test rent reminder to ${recipient} via cron-daily-lease-monitor...` });
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/cron-daily-lease-monitor`, {
        method: 'POST',
        headers: await authJsonHeaders(),
        body: JSON.stringify({ test: true, recipient_email: recipient }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}: ${res.statusText}`);
      setTestMsg({
        kind: 'ok',
        text: <>✓ <strong>Success!</strong> Test email dispatched to <code>{(data as any).target_email || recipient}</code>. Resend Message ID: <code>{(data as any).email_id || (data as any).resend_id || 'Delivered'}</code></>,
      });
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      if (text.includes('own email address') || text.includes('verify a domain')) {
        setTestMsg({
          kind: 'err',
          text: <>⚠️ <strong>Resend Free Tier Restriction:</strong> Resend only delivers test emails to your own account email until a custom domain is verified at{' '}
            <a href="https://resend.com/domains" target="_blank" rel="noreferrer" className="underline text-blue-400 hover:text-blue-300">resend.com/domains</a>. Provider response: {text}</>,
        });
      } else {
        setTestMsg({ kind: 'err', text: <>❌ <strong>Delivery Failed:</strong> {text}</> });
      }
    } finally {
      setTestBusy(false);
    }
  };

  const msg = (m: Msg) => (m ? <p className={`text-[10px] ${tone[m.kind]}`}>{m.text}</p> : null);

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-sm overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full shadow-2xl flex flex-col max-h-[88vh] my-auto relative overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0 bg-slate-900/95 backdrop-blur z-10">
          <h3 className="text-base font-bold text-white flex items-center space-x-2"><span className="text-blue-400">📧</span><span>Rent Reconciliation &amp; Email Settings</span></h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white hover:bg-slate-800 p-1.5 rounded-lg transition text-base leading-none font-bold" title="Close Settings">✕</button>
        </div>

        <div className="overflow-y-auto px-6 py-4 space-y-4 text-xs flex-1">
          {/* 1. Account login email */}
          <div className={card}>
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-300">Account Login Email</span>
              <span className="text-[10px] text-emerald-400 font-mono bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/40">Supabase Auth</span>
            </div>
            <div className="flex items-center space-x-2">
              <input type="email" disabled value={accountEmail} readOnly className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-300 font-mono text-xs" />
              <button type="button" onClick={() => setChangeOpen((o) => !o)} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition">Change</button>
            </div>
            {changeOpen && (
              <div className="pt-2 border-t border-slate-800/60 space-y-2">
                <label className="block text-slate-400">Enter New Account Email:</label>
                <div className="flex items-center space-x-2">
                  <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="new-email@example.com"
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs" />
                  <button type="button" onClick={submitChangeEmail} className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold transition">Send Verification</button>
                </div>
                {msg(accountMsg)}
              </div>
            )}
          </div>

          {/* 2. Notification email */}
          <div className={card}>
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-300">Default Rent Alert &amp; 1-Click Reminder Email</span>
              <span className="text-[10px] text-blue-400 font-mono bg-blue-950/60 px-2 py-0.5 rounded border border-blue-800/40">Routing</span>
            </div>
            <p className="text-[11px] text-slate-400">Where 1-click rent payment confirmation emails and snooze grace period notices are sent. Defaults to your account email if empty.</p>
            <div className="flex items-center space-x-2">
              <input type="email" value={notifEmail} onChange={(e) => setNotifEmail(e.target.value)} placeholder="e.g. accounting@myfirm.com" className={`flex-1 ${field}`} />
              <button type="button" onClick={saveNotifEmail} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition">Save</button>
            </div>
            {msg(notifMsg)}
          </div>

          {/* 3. Timing */}
          <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-300">Timing &amp; Schedule Preferences</span>
              <span className="text-[10px] text-cyan-400 font-mono bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/40">Cron Schedule</span>
            </div>
            <p className="text-[11px] text-slate-400">Configure how far in advance you receive rent alerts and when follow-up reminders dispatch. Synchronized to your universal user profile.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-slate-300">Rent Due Advance Notice</label>
                <select value={advance} onChange={(e) => setAdvance(e.target.value)} className={`w-full ${field}`}>
                  <option value="0">On Due Date (Default)</option>
                  <option value="1">1 Day in Advance</option>
                  <option value="2">2 Days in Advance</option>
                  <option value="3">3 Days in Advance</option>
                  <option value="5">5 Days in Advance</option>
                  <option value="7">7 Days in Advance (1 Week)</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-slate-300">Rent Increase Warning</label>
                <select value={escalation} onChange={(e) => setEscalation(e.target.value)} className={`w-full ${field}`}>
                  <option value="30">30 Days in Advance (Recommended)</option>
                  <option value="14">14 Days in Advance</option>
                  <option value="7">7 Days in Advance</option>
                  <option value="0">Disabled</option>
                </select>
              </div>
            </div>
            <div className="space-y-2 pt-1 border-t border-slate-800/60">
              <label className="flex items-center space-x-2 text-slate-300 cursor-pointer">
                <input type="checkbox" checked={remindOnDue} onChange={(e) => setRemindOnDue(e.target.checked)} className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0" />
                <span className="text-[11px]">Also send reminder on the due date (if advance notice is configured)</span>
              </label>
              <label className="flex items-center space-x-2 text-slate-300 cursor-pointer">
                <input type="checkbox" checked={followupGrace} onChange={(e) => setFollowupGrace(e.target.checked)} className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0" />
                <span className="text-[11px]">Send follow-up emails on unpaid rent (after the grace period, or when a snooze ends)</span>
              </label>
              <div className={`grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 ${followupGrace ? '' : 'opacity-40 pointer-events-none'}`}>
                <div className="space-y-1">
                  <label className="block text-[11px] font-semibold text-slate-300">Follow up every</label>
                  <select value={followupFreq} onChange={(e) => setFollowupFreq(e.target.value)} className={`w-full ${field}`}>
                    {['1', '2', '3', '5', '7', '14'].map((v) => <option key={v} value={v}>{v === '1' ? 'Day' : `${v} days`}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] font-semibold text-slate-300">Stop after</label>
                  <select value={followupMax} onChange={(e) => setFollowupMax(e.target.value)} className={`w-full ${field}`}>
                    {['1', '2', '3', '5', '10'].map((v) => <option key={v} value={v}>{v} follow-up{v === '1' ? '' : 's'}</option>)}
                    <option value="0">Keep going until paid</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] font-semibold text-slate-300">A snooze lasts</label>
                  <select value={snoozeDays} onChange={(e) => setSnoozeDays(e.target.value)} className={`w-full ${field}`}>
                    <option value="">Lease grace period (default)</option>
                    {['1', '2', '3', '5', '7', '14'].map((v) => <option key={v} value={v}>{v === '1' ? '1 day' : `${v} days`}</option>)}
                  </select>
                </div>
              </div>
              <p className="text-[10px] text-slate-500">Follow-ups are counted per month's rent and pause while a snooze is running. Every email has Confirm and Snooze buttons.</p>
              <div className="space-y-1 pt-1">
                <label className="block text-[11px] font-semibold text-slate-300">Buildings with several tenants</label>
                <select value={digestMin} onChange={(e) => setDigestMin(e.target.value)} className={`w-full ${field}`}>
                  <option value="0">Always one email per tenant</option>
                  {['2', '3', '5', '10'].map((v) => <option key={v} value={v}>One email per property when {v} or more tenants are due</option>)}
                </select>
                <p className="text-[10px] text-slate-500">The combined email lists every tenant with its own Paid and Missing buttons, so a 12-unit building sends one email instead of twelve.</p>
              </div>
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <label className="block text-[11px] font-semibold text-slate-300">Tenant-paid costs (NNN): warn me this many days before</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(Object.keys(DEFAULT_RECOVERY_LEAD_DAYS) as RecoveryCategory[]).map((c) => (
                    <div key={c} className="space-y-1">
                      <span className="block text-[10px] text-slate-400">{RECOVERY_CATEGORY_LABELS[c]}</span>
                      <input type="number" min="0" max="180" value={recLead[c]} onChange={(e) => setRecLead((cur) => ({ ...cur, [c]: e.target.value }))} className={`w-full ${field}`} />
                    </div>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={recEmail} onChange={(e) => setRecEmail(e.target.checked)} className="accent-cyan-500" />
                  Also email me when one of these is overdue or coming due
                </label>
                <p className="text-[10px] text-slate-500">Only leases with tracking turned on are included. You get one email per day at most, listing what is new.</p>
              </div>
            </div>
            <div className="flex items-center justify-between pt-1">
              <button type="button" onClick={saveTiming} className="px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition flex items-center space-x-1.5 text-xs shadow-md shadow-cyan-900/30">
                <span>Save Timing Preferences</span>
              </button>
              {msg(timingMsg)}
            </div>
          </div>

          {/* 4. Test delivery */}
          <div className={card}>
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-300">Test Rent Reminder Delivery</span>
              <span className="text-[10px] text-amber-400 font-mono bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/40">Resend Live Test</span>
            </div>
            <p className="text-[11px] text-slate-400">Dispatch a live test email through the Supabase <code>cron-daily-lease-monitor</code> Edge Function to verify your Resend integration and deliverability.</p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="Recipient email" className={`flex-1 ${field}`} />
              <button type="button" onClick={sendTest} disabled={testBusy}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold transition flex items-center justify-center space-x-1.5 shrink-0 shadow-md shadow-blue-900/30 disabled:opacity-60">
                <span>{testBusy ? 'Sending...' : 'Send Test Email'}</span>
              </button>
            </div>
            {testMsg && (
              <div className={`text-[11px] p-2.5 rounded-lg border ${
                testMsg.kind === 'ok' ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                : testMsg.kind === 'err' ? 'bg-rose-950/60 border-rose-800 text-rose-300'
                : 'bg-blue-950/60 border-blue-800 text-blue-300'}`}>{testMsg.text}</div>
            )}
          </div>

          {/* 5. Explainer */}
          <div className="p-3 bg-slate-900/50 rounded-xl border border-slate-800/80 space-y-1.5 text-[11px] text-slate-400">
            <div className="font-bold text-slate-300 flex items-center space-x-1.5"><span>ℹ️</span><span>How Email Delivery Works</span></div>
            <ul className="list-disc pl-4 space-y-1 text-[10px] text-slate-400">
              <li><strong>Lease-Level Override:</strong> If a lease has a specific manager email, reminders send directly to that manager.</li>
              <li><strong>Default Alert Email:</strong> If specified above, all other rent alerts send here.</li>
              <li><strong>Account Fallback:</strong> If no notification email is specified, alerts send directly to your Supabase login email.</li>
              <li><strong>Resend API:</strong> Delivered securely via your configured <code>RESEND_API_KEY</code> secret.</li>
            </ul>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-slate-800 text-right bg-slate-900/95 backdrop-blur shrink-0">
          <button type="button" onClick={onClose} className="py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition">Close</button>
        </div>
      </div>
    </div>
  );
};
