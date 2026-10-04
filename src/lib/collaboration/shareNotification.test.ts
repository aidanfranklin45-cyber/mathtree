import { describe, it, expect, vi } from 'vitest';
import { buildShareEmail, pickRecipients, sendShareEmails } from '../../../supabase/functions/_shared/shareNotification';

describe('buildShareEmail', () => {
  it('names the sharer and property, and escapes markup', () => {
    const { subject, html } = buildShareEmail({ dealTitle: 'Elm <Plaza>', sharerName: 'Ann', permission: 'editor', appUrl: 'https://x.test' });
    expect(subject).toBe('Ann shared Elm <Plaza> with you on MathTree');
    expect(html).toContain('Elm &lt;Plaza&gt;');
    expect(html).toContain('view and edit');
  });
  it('mentions the group when shared through one', () => {
    const { html } = buildShareEmail({ dealTitle: 'A', sharerName: 'Ann', permission: 'viewer', appUrl: 'https://x.test', groupName: 'LPs' });
    expect(html).toContain('LPs');
  });
});

describe('pickRecipients', () => {
  it('dedupes, lowercases, drops invalid and the sharer', () => {
    expect(pickRecipients(['A@x.com', 'a@x.com', 'me@x.com', 'bad', null], 'ME@x.com')).toEqual(['a@x.com']);
  });
});

describe('sendShareEmails', () => {
  it('never throws when sending fails', async () => {
    const f = vi.fn().mockRejectedValue(new Error('down'));
    await expect(sendShareEmails('k', 'f@x.com', ['a@x.com'], { subject: 's', html: 'h' }, f as any)).resolves.toEqual({ sent: 0, failed: 1 });
  });
  it('counts accepted sends', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await expect(sendShareEmails('k', 'f@x.com', ['a@x.com', 'b@x.com'], { subject: 's', html: 'h' }, f as any)).resolves.toEqual({ sent: 2, failed: 0 });
  });
});
