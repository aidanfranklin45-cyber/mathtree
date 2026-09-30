import fs from 'fs';
import path from 'path';

// The authenticated app is the React build (dist/app.html). Only these static files ship beside it:
// the marketing/login page, legal pages, the shared session (inactivity logout) script and icons.
// The pre-React pages live in legacy/ and are intentionally not deployed.
const RUNTIME_FILES = [
  'index.html',
  'terms.html',
  'privacy.html',
  'session.js',
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

console.log(`✓ Assembled ${copiedCount} static runtime files into dist/ (React app: dist/app.html)`);
