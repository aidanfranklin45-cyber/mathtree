# MathTree - Premium PropTech Modeling Studio

A high-performance, client-side real estate investment analysis and 10-year financial modeling platform.

## Features
- **Institutional Landing Page**: Comprehensive institutional introduction detailing MathTree's mission, mathematical precision, 4 asset class models, serverless edge engine, and pitch deck generation with live demo and sign-in triggers.
- **Account Dashboard First Flow**: Investor dashboard greeting users by name (*"Hey, [Name] 👋"*), tracking portfolio KPIs (Total Value, Weighted IRR, Equity Deployed), and organizing previous underwriting projects with category filtering.
- **Guided 4-Step Project Creation Wizard**: Intuitive step-by-step project setup (Asset Class & Identity, Capital & Valuation, Income & Operations, Debt & Exit Strategy) replacing 30 raw spreadsheet inputs with smart asset defaults and real-time upfront cash calculation.
- **Serverless Supabase Edge Function (`create-project`)**: Deno-based backend engine executing 10-year pro-forma calculations, risk auditing, and automated presentation-ready Executive Pitch Deck synthesis.
- **4 Real Estate Asset Classes**: Single-Family Residential (with ARV), Multi-Unit Residential, Commercial Real Estate (Gross & NNN Leases with Gradual Cap Rate Valuation), and Storage Facilities (Automated vs Manned).
- **Multi-Asset Portfolio Aggregator Studio**: Roll up multiple properties into a blended fund model with customized door/unit scaling, blended 10-Yr IRR, Cash-on-Cash yield, equity multiples, cash flow waterfall charts, and 10-year pro-forma statements.
- **Executive Pitch Deck Presentation Mode**: Distraction-free, presentation-ready investor brief with hero KPI spotlights, investment highlights, risk auditor checks, 10-year equity trajectory charts, and direct 1-click jump into the deep modeler.
- **Underwriting Scenario Manager**: 1-click toggles between Base (Target), Bull (+8% Rent, -1.5% Vacancy), and Bear (-8% Rent, +3% Vacancy, +50bps Rate) cases, plus custom named scenario presets.
- **Dynamic "What-If" Range Scrubbers**: Real-time slider scrubbers linked to Purchase Price, Down Payment %, Interest Rate, Monthly Rent, and Vacancy Rate for instant sensitivity exploration.
- **Command Palette (`Ctrl+K` / `Cmd+K`)**: Rapid keyboard command search to switch asset classes, toggle workspaces, run Monte Carlo simulations, solve target prices, or trigger exports.
- **Supabase Cloud Sync & Accounts**: Seamless client account authentication, cloud deal saving, and fund portfolio sync with zero-breaking offline `localStorage` fallback.
- **2D Sensitivity Heatmap**: Real-time matrix of returns (IRR and NPV) across variable Interest Rates, Exit Cap Rates, Purchase Prices, and Vacancy Rates.
- **Monte Carlo 1,000-Run Risk Simulation**: Stochastic market volatility simulation modeling Mean IRR, P5 Downside Risk, P95 Upside Potential, and Probability of Negative Cash Flow with frequency histograms.
- **Tax Depreciation (MACRS) & BRRRR Refinance**: 27.5/39-year MACRS depreciation schedule, Cost Segregation (80% bonus year 1), tax liability/shield tracking, capital gains tax at exit, and mid-hold cash-out refinance simulations.
- **4-Deal Comparison Matrix**: Side-by-side comparison across all 4 asset classes with winner highlight badges.
- **Institutional Reporting**: 1-click CSV pro-forma download, print-optimized PDF investment brief, JSON state backups, and shareable URL hash links.

## Live Application
Access MathTree online: [https://aidanfranklin45-cyber.github.io/mathtree/](https://aidanfranklin45-cyber.github.io/mathtree/)
