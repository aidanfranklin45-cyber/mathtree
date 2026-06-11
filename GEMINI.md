# Multi-Asset PropTech Modeling App

A lightweight, single-page client-side PropTech modeling application that lets users calculate and project 10-year ROI for four property asset classes:
- Single-Family Residential
- Multi-Unit Residential
- Commercial Real Estate
- Storage Facilities

## Architecture & Constraints
- **Core Technology**: Single-page HTML/JS/CSS application.
- **Styling**: Modern, premium UI utilizing native CSS variables/Tailwind CSS.
- **Storage**: Browser `localStorage` to save and load inputs per asset class automatically.
- **Visualization**: Chart.js (via CDN) or lightweight plotting library for the 10-year ROI projections.
- **No Database**: Purely client-side calculations and persistence to avoid database overhead.
- **No Build Step**: If simple HTML/JS is sufficient, run it directly to ensure instant loading and zero configuration.
