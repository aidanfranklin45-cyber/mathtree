import fs from 'fs';
if (fs.existsSync('dist/app.html')) {
  fs.copyFileSync('dist/app.html', 'dist/index.html');
  console.log('✓ Copied dist/app.html to dist/index.html');
}
