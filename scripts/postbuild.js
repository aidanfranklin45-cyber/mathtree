import fs from 'fs';
import path from 'path';

const STATIC_RUNTIME_FILES = [
  'index.html',
  'terms.html',
  'privacy.html',
  'session.js',
  'address-service.js',
  'favicon.ico',
  'favicon.png',
  'favicon.svg',
];

const LEGACY_ARCHIVE_FILES = [
  { src: 'dashboard.html', dest: 'legacy-dashboard.html' },
  { src: 'project.html', dest: 'legacy-project.html' },
  { src: 'operations.html', dest: 'legacy-operations.html' },
  { src: 'project-debt.html', dest: 'legacy-project-debt.html' },
  { src: 'project-diligence.html', dest: 'legacy-project-diligence.html' },
  { src: 'project-proforma.html', dest: 'legacy-project-proforma.html' },
  { src: 'project-property.html', dest: 'legacy-project-property.html' },
  { src: 'project-sensitivity.html', dest: 'legacy-project-sensitivity.html' },
  { src: 'project-tax.html', dest: 'legacy-project-tax.html' },
  { src: 'reconcile.html', dest: 'legacy-reconcile.html' },
];

if (!fs.existsSync('dist')) {
  fs.mkdirSync('dist', { recursive: true });
}

let copiedCount = 0;

// 1. Copy static landing & asset files
for (const file of STATIC_RUNTIME_FILES) {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join('dist', file));
    copiedCount++;
  } else {
    console.warn(`[postbuild] Warning: Static file not found: ${file}`);
  }
}

// 2. Archive legacy monolith HTML files under legacy-* prefix
for (const item of LEGACY_ARCHIVE_FILES) {
  if (fs.existsSync(item.src)) {
    fs.copyFileSync(item.src, path.join('dist', item.dest));
    copiedCount++;
  }
}

// 3. Promote React SPA (dist/app.html) to serve /dashboard.html, /project.html, /operations.html
const reactAppEntry = path.join('dist', 'app.html');
if (fs.existsSync(reactAppEntry)) {
  const spaTargets = ['dashboard.html', 'project.html', 'operations.html'];
  for (const target of spaTargets) {
    fs.copyFileSync(reactAppEntry, path.join('dist', target));
    copiedCount++;
  }
  console.log('✓ Promoted React 18 SPA (app.html) to serve /dashboard.html, /project.html, and /operations.html');
}

console.log(`✓ Assembled ${copiedCount} production client runtime files into dist/`);
