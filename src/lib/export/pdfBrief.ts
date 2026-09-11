import { supabase, SUPABASE_ANON_KEY } from '../supabase/client';

export async function openPdfBrief(url: string): Promise<void> {
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Preparing MathTree PDF Brief...</title>
  <style>
    body { background: #020617; color: #94a3b8; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { text-align: center; padding: 24px; max-width: 420px; }
    .brand { font-size: 24px; font-weight: 900; color: #10b981; letter-spacing: -0.5px; margin-bottom: 12px; }
    .spinner { display: inline-block; width: 28px; height: 28px; border: 3px solid rgba(16,185,129,0.2); border-radius: 50%; border-top-color: #10b981; animation: spin 0.8s linear infinite; margin-bottom: 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <div class="brand">🌿 MATHTREE</div>
    <div style="font-size: 15px; font-weight: 700; color: #f8fafc; margin-bottom: 6px;">Generating Institutional PDF Brief...</div>
    <div style="font-size: 12px; color: #64748b; line-height: 1.5;">Preparing print-optimized pro-forma schedule, debt breakdown, and executive memorandum</div>
  </div>
</body>
</html>`);
    win.document.close();
  }

  try {
    const sessionRes = await supabase.auth.getSession();
    const token = sessionRes.data?.session?.access_token || SUPABASE_ANON_KEY;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Server returned ' + res.status }));
      throw new Error(err.error || 'Failed to generate brief');
    }

    const html = await res.text();
    if (win) {
      win.document.open();
      win.document.write(html);
      win.document.close();
    } else {
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      }, 5000);
    }
  } catch (err: any) {
    console.error('PDF Brief generation error:', err);
    if (win) {
      win.document.body.innerHTML = `<div style="text-align:center;padding:40px;color:#f43f5e;font-family:sans-serif;"><h3>Failed to generate PDF brief</h3><p>${err.message}</p></div>`;
    } else {
      alert('Failed to generate PDF brief: ' + err.message);
    }
  }
}

export function exportDealBriefPDF(dealId: string): Promise<void> {
  return openPdfBrief(`https://bgexwcepwbxvhxbpblhd.supabase.co/functions/v1/generate-pdf-brief?dealId=${encodeURIComponent(dealId)}`);
}

export function exportPortfolioBriefPDF(): Promise<void> {
  return openPdfBrief('https://bgexwcepwbxvhxbpblhd.supabase.co/functions/v1/generate-pdf-brief?mode=portfolio');
}
