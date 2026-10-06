import React, { useEffect, useState } from 'react';
import { documentLink, listDealDocuments, type StoredDocument } from '../../lib/documents/dealDocuments';

const TYPE_LABEL: Record<string, string> = {
  offering_memorandum: 'Offering memorandum', operating_statement: 'Operating statement', rent_roll: 'Rent roll', t12: 'Operating statement', other: 'Document',
};
const size = (bytes: number): string => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** The original documents kept with this deal. Private to the owner; a file opens through a link that works for a few minutes. */
export const DealDocumentsList: React.FC<{ dealId: string }> = ({ dealId }) => {
  const [docs, setDocs] = useState<StoredDocument[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listDealDocuments(dealId).then((d) => { if (live) setDocs(d); });
    return () => { live = false; };
  }, [dealId]);

  const open = async (d: StoredDocument) => {
    setOpening(d.id); setProblem(null);
    const url = await documentLink(d.storage_path);
    setOpening(null);
    if (url) window.open(url, '_blank', 'noopener,noreferrer'); else setProblem(`${d.file_name} could not be opened right now.`);
  };

  if (docs === null) return null;
  return (
    <section aria-label="Source documents" className="space-y-2">
      <h4 className="text-xs font-black uppercase tracking-wider text-slate-200">Source documents <span className="text-slate-500 font-semibold normal-case tracking-normal">({docs.length})</span></h4>
      <p className="text-[11px] text-slate-400">The original files this property was underwritten from, kept privately with it. Only you can open them.</p>
      {docs.length === 0 ? (
        <p className="text-[11px] text-slate-500 italic">No original files are stored with this property.</p>
      ) : (
        <ul className="space-y-1.5">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl bg-slate-950/60 border border-slate-800 text-xs">
              <span className="font-bold text-slate-100 truncate max-w-[18rem]">{d.file_name}</span>
              <span className="text-slate-500">{d.doc_type ? `${TYPE_LABEL[d.doc_type] ?? 'Document'} · ` : ''}{size(Number(d.size_bytes))} · added {new Date(d.uploaded_at).toLocaleDateString()}</span>
              <button type="button" onClick={() => void open(d)} disabled={opening === d.id} className="ml-auto text-emerald-400 hover:text-emerald-300 underline disabled:opacity-50">{opening === d.id ? 'Opening…' : 'Open'}</button>
            </li>
          ))}
        </ul>
      )}
      {problem && <p role="alert" className="text-[11px] text-rose-300">{problem}</p>}
    </section>
  );
};
