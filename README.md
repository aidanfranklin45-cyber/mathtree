# MathTree

Real-estate underwriting and property operations for an owner-investor. Underwrite a deal, track it through the pipeline, run it once
it is owned, and compare it with what was expected. Every number on screen is either a fact the owner stated or an assumption the
owner can explain to a lender; the app never invents an input.

Live app: [mathtree-app.web.app](https://mathtree-app.web.app)

## What it does

- **Dashboard.** Owned holdings and the acquisition pipeline, with portfolio totals for what is owned.
- **Deal studio.** One page per property. Prospects show the underwriting (overview, pro-forma, property, debt, diligence, sensitivity);
  owned properties open on performance and add an Operate tab (rent roll, payments, recoveries, CAM).
- **Engine.** One shared calculator: projections, debt, taxes and depreciation, IRR and NPV, sensitivity, Monte Carlo, remodel plans,
  refinance. The database stores facts only; results are computed on demand.
- **Investor profile.** Your underwriting standards (vacancy, expenses, reserves, utilities, property tax rate, appreciation, exit cap,
  selling costs, closing time) by asset class. They are starting points for screening, copied into a deal only where it is silent. Nothing is fixed: a new profile starts with common
  conventions (a six-week closing, for example), you can change any of them globally in your profile, or individually on any single property. A property's own figure always wins; the rest keep following your profile.
- **Inputs needed.** When a deal lacks something the engine requires, the app lists exactly what, instead of guessing.
- **Compare.** Side-by-side boards of deals and scenarios, with charts and saved views.
- **Operations.** Rent roll, payments, escalations, NNN recoveries and daily reminders across owned properties.
- **Briefs.** Printable deal and portfolio PDFs computed from the same engine.

Asset classes: single-family, multi-unit, commercial (gross and NNN), and storage.

## Stack

React 18, Vite, TypeScript, Tailwind, Chart.js. Supabase (Postgres with row-level security, Deno edge functions). Firebase Hosting;
GitHub Actions build every pull request and deploy on merge to `main`.

## Working on it

```bash
npm install
npm run dev        # local app
npx tsc --noEmit   # type-check
npx vitest run <file> --reporter=dot   # one test file at a time
```

Read `ARCHITECTURE.md` for how it fits together and `AGENTS.md` for how changes are made (branches and pull requests only, no
full-suite test runs, no plan documents in the repo).
