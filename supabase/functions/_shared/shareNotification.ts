// Email sent to someone when a property (deal) is newly shared with them. Pure builders plus a small Resend sender, so the wording can
// be tested and so a failed send can never be thrown into the share itself: `sendShareEmails` always resolves.

import { escapeHtml } from "./digest.ts";

export interface ShareEmailInput {
  dealTitle: string;
  /** Display name of whoever shared it; falls back to their email, then "A MathTree user". */
  sharerName: string;
  permission: "viewer" | "editor";
  appUrl: string;
  /** Set when the property came through a group, so the email can say why the recipient got it. */
  groupName?: string | null;
}

export function buildShareEmail(i: ShareEmailInput): { subject: string; html: string } {
  const title = i.dealTitle.trim() || "a property";
  const subject = `${i.sharerName} shared ${title} with you on MathTree`;
  const access = i.permission === "editor" ? "view and edit" : "view";
  const via = i.groupName ? ` through the group <strong>${escapeHtml(i.groupName)}</strong>` : "";
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#020617;color:#f8fafc;margin:0;padding:24px;">
  <div style="background:#0f172a;border:1px solid #334155;border-radius:16px;padding:28px;max-width:560px;margin:0 auto;">
    <div style="font-size:12px;font-weight:800;color:#fbbf24;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Property shared with you</div>
    <div style="font-size:19px;font-weight:800;color:#ffffff;margin-bottom:12px;">${escapeHtml(title)}</div>
    <div style="font-size:13px;color:#cbd5e1;margin-bottom:16px;"><strong>${escapeHtml(i.sharerName)}</strong> shared this property with you${via}. You can ${access} it.</div>
    <a href="${escapeHtml(i.appUrl)}" style="display:block;text-align:center;background:#1e293b;color:#e2e8f0;font-weight:700;font-size:13px;padding:12px 20px;border-radius:12px;text-decoration:none;">Open MathTree</a>
    <div style="font-size:11px;color:#475569;text-align:center;margin-top:20px;">MathTree &bull; sign in with this email address to see shared properties</div>
  </div>
</body></html>`;
  return { subject, html };
}

/** Lower-cased, de-duplicated valid recipients, excluding the sharer. */
export function pickRecipients(emails: Array<string | null | undefined>, sharerEmail?: string | null): string[] {
  const skip = (sharerEmail || "").trim().toLowerCase();
  const out = new Set<string>();
  for (const e of emails) {
    const v = (e || "").trim().toLowerCase();
    if (v.includes("@") && v !== skip) out.add(v);
  }
  return Array.from(out);
}

/** Sends one email per recipient through Resend. Never throws; returns how many were accepted. */
export async function sendShareEmails(
  apiKey: string,
  from: string,
  recipients: string[],
  email: { subject: string; html: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  if (!apiKey) return { sent, failed: recipients.length };
  for (const to of recipients) {
    try {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, subject: email.subject, html: email.html }),
      });
      if (res.ok) sent++;
      else {
        failed++;
        console.warn("[share-email] Resend rejected the email:", res.status);
      }
    } catch (e) {
      failed++;
      console.warn("[share-email] send failed:", e);
    }
  }
  return { sent, failed };
}
