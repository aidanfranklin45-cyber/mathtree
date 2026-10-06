import React, { useEffect, useState } from 'react';
import { downloadDealDocument, listDealDocuments, opensInTab, type StoredDocument } from '../../lib/documents/dealDocuments';

const size = (bytes: number): string => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** The original files kept with this deal, as a plain record of what it was underwritten from. A PDF opens in a new tab; any other file downloads. */
export const DealDocumentsList: React.FC<{ dealId: string; refreshKey?: number; onAdd?: () => void }> = ({ dealId, refreshKey = 0, onAdd }) => {
  const [docs, setDocs] = useState<StoredDocument[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listDealDocuments(dealId).then((d) => { if (live) setDocs(d); });
    return () => { live = false; };
  }, [dealId, refreshKey]);

  const open = async (d: StoredDocument) => {
    setBusy(d.id); setProblem(null);
    // A new tab is opened on the click, before the wait, so the browser does not block it
    const tab = opensInTab(d.mime_type) ? window.open('', '_blank') : null;
    const blob = await downloadDealDocument(d.storage_path);
    setBusy(null);
    if (!blob) { tab?.close(); setProblem(`${d.file_name} could not be opened right now.`); return; }
    const url = URL.createObjectURL(new Blob([blob], { type: d.mime_type ?? blob.type }));
    if (opensInTab(d.mime_type)) { if (tab) tab.location.href = url; else window.location.assign(url); return; }
    const a = document.createElement('a');
    a.href = url; a.download = d.file_name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  if (docs === null) return null;
  return (
    <section aria-label="Source documents" className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-black uppercase tracking-wider text-slate-200">Source documents <span className="text-slate-500 font-semibold normal-case tracking-normal">({docs.length})</span></h4>
        {onAdd && <button type="button" onClick={onAdd} className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20">Add documents</button>}
      </div>
      {docs.length === 0 && <p className="text-[11px] text-slate-500">No original files are stored with this property yet. Add the offering memorandum, rent roll or statements it is underwritten from.</p>}
      <ul className="space-y-1.5">
        {docs.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl bg-slate-950/60 border border-slate-800 text-xs">
            <span className="font-bold text-slate-100 truncate max-w-[18rem]">{d.file_name}</span>
            <span className="text-slate-500">{size(Number(d.size_bytes))} · added {new Date(d.uploaded_at).toLocaleDateString()}</span>
            <button type="button" onClick={() => void open(d)} disabled={busy === d.id} className="ml-auto text-emerald-400 hover:text-emerald-300 underline disabled:opacity-50">{busy === d.id ? 'Opening…' : 'Open'}</button>
          </li>
        ))}
      </ul>
      {problem && <p role="alert" className="text-[11px] text-rose-300">{problem}</p>}
    </section>
  );
};
