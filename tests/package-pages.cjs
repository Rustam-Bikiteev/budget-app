// Explicit public runtime allowlist: never upload the repository or local data.
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, '_site');
const files = ['index.html', 'app.js', 'app.css', 'shared', 'storage', 'ui', 'free', 'design',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

(async () => {
  // _site is a fixed child of root; force avoids stale files in repeat packaging.
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target);
  for (const file of files) {
    await fs.cp(path.join(root, file), path.join(target, file), {
      recursive: true,
      filter: source => !source.endsWith('.md'),
    });
  }
  await fs.writeFile(path.join(target, '.nojekyll'), '');
})().catch(error => { console.error(error); process.exitCode = 1; });
