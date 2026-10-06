import React, { useMemo, useState } from 'react';
import { ConnectedHeader } from '../components/layout/ConnectedHeader';
import { BANK_PREP_NOTE, CONVERSATION, GLOSSARY, LENDER_NUMBERS, LOAN_OFFICER_QUESTIONS, WHAT_TO_BRING } from '../lib/education/bankPrep';

const card = 'bg-slate-900/40 border border-slate-900 p-5 rounded-2xl shadow-xl space-y-3';
const h2 = 'text-sm font-extrabold text-white';

/** A plain-English page to prepare for a conversation with a lender: how it works, what they look at, the terms, and the questions to expect. */
export const BankPrepPage: React.FC = () => {
  const [find, setFind] = useState('');
  const terms = useMemo(() => {
    const q = find.trim().toLowerCase();
    return q ? GLOSSARY.filter((t) => t.term.toLowerCase().includes(q) || t.plain.toLowerCase().includes(q)) : GLOSSARY;
  }, [find]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <ConnectedHeader active="bank" />

      <main className="flex-1 max-w-4xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-5 sm:py-7 space-y-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">Prepare for the bank</h1>
          <p className="text-xs text-slate-400 mt-0.5">Understand your relationship with the lender, and what you need in hand to be successful.</p>
        </div>

        <section className={card} aria-label="How the conversation works">
          <h2 className={h2}>How the conversation works</h2>
          <div className="grid grid-cols-1 gap-3">
            {CONVERSATION.map((p) => (
              <div key={p.heading} className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 space-y-1">
                <h3 className="text-[11px] font-black uppercase tracking-wider text-emerald-300">{p.heading}</h3>
                <p className="text-xs text-slate-300 leading-relaxed">{p.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={card} aria-label="What to bring">
          <h2 className={h2}>What to bring</h2>
          <p className="text-xs text-slate-400">Lenders differ, so ask yours for their list. Here is a good starting point.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {WHAT_TO_BRING.map((g) => (
              <div key={g.heading} className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 space-y-2">
                <div>
                  <h3 className="text-[11px] font-black uppercase tracking-wider text-emerald-300">{g.heading}</h3>
                  <p className="text-[11px] text-slate-500">{g.note}</p>
                </div>
                <ul className="space-y-1.5 list-disc pl-4">
                  {g.items.map((i) => <li key={i} className="text-xs text-slate-300 leading-relaxed">{i}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className={card} aria-label="The numbers a lender looks at first">
          <h2 className={h2}>The numbers a lender looks at first</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {LENDER_NUMBERS.map((t) => (
              <div key={t.term} className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 space-y-1">
                <h3 className="text-xs font-bold text-white">{t.term}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{t.plain}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={card} aria-label="Questions a loan officer is likely to ask">
          <h2 className={h2}>Questions a loan officer is likely to ask</h2>
          <p className="text-xs text-slate-400">Answer each with the figure, where it came from, and why it is reasonable. Here is where MathTree holds the answer.</p>
          <ul className="space-y-2">
            {LOAN_OFFICER_QUESTIONS.map((q) => (
              <li key={q.question} className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 space-y-1">
                <p className="text-xs font-bold text-white">{q.question}</p>
                <p className="text-[11px] text-slate-400 leading-relaxed"><span className="font-bold text-slate-300">How to answer: </span>{q.tip}</p>
                <p className="text-[11px] text-emerald-300/90"><span className="font-bold">Where to find it: </span>{q.where}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={card} aria-label="Terms you will hear">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className={h2}>Terms you will hear</h2>
            <input
              type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a term"
              aria-label="Find a term" className="w-48 bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
            />
          </div>
          {terms.length === 0 ? (
            <p className="text-xs text-slate-500">No term matches that. Try a shorter word.</p>
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              {terms.map((t) => (
                <div key={t.term}>
                  <dt className="text-xs font-bold text-white">{t.term}</dt>
                  <dd className="text-xs text-slate-400 leading-relaxed">{t.plain}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <p className="text-[11px] text-slate-500 leading-relaxed pb-6">{BANK_PREP_NOTE}</p>
      </main>
    </div>
  );
};
