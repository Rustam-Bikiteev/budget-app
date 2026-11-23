const { readFileSync } = require('node:fs');
const { join } = require('node:path');
function plain(source) { return source.replace(/^import .*;\r?\n/gm, '').replace(/^export \{[^}]+\};?\r?\n/gm, '').replace(/\bexport (?=(?:function|const|let))/g, ''); }
const domain = plain(readFileSync(join(__dirname, '../shared/domain.mjs'), 'utf8'));
const names = [...domain.matchAll(/^function (\w+)|^const (\w+)/gm)].map(match => match[1] || match[2]);
function runtimeSource(path) {
  let source = plain(readFileSync(join(__dirname, '..', path), 'utf8'));
  if (path.endsWith('shared/core.js')) source = 'const finance = (() => {\n' + domain + '\nreturn { ' + names.join(', ') + ' }; })();\n' + source;
  if (path === 'app.js') source += '\ninstallCloudView();';
  return source;
}
module.exports = { runtimeSource };
