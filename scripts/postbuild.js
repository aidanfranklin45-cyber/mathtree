import fs from 'fs';
import path from 'path';

const RUNTIME_FILES = [
  // Primary HTML pages & entrypoints
  'index.html',
  'dashboard.html',
  'project.html',
  'operations.html',
  'project-debt.html',
  'project-diligence.html',
  'project-proforma.html',
  'project-property.html',
  'project-sensitivity.html',
  'project-tax.html',
  // Client scripts & engines
  'session.js',
  'math.js',
  'mathtree-client.js',
  'profile.js',
  'address-service.js',
  // Favicons & icons
  'favicon.ico',
  'favicon.png',
  'favicon.svg',
];

if (!fs.existsSync('dist')) {
  fs.mkdirSync('dist', { recursive: true });
}

let copiedCount = 0;
for (const file of RUNTIME_FILES) {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join('dist', file));
    copiedCount++;
  } else {
    console.warn(`[postbuild] Warning: Runtime file not found: ${file}`);
  }
}

console.log(`✓ Assembled ${copiedCount} production client runtime files into dist/`);
