/* Stamp every reference to /assets/js/* and /assets/css/* with a content hash
 * (e.g. /assets/js/portal-shell.js?v=1a2b3c4d).
 *
 * netlify.toml serves those folders with a one-year immutable cache, so a
 * returning visitor loads the portal's scripts and styles from disk instead of
 * re-checking each one with the server (~0.5s apiece from our nearest Netlify
 * edge). When a file changes its hash changes, so browsers fetch the new copy.
 *
 * Runs as the Netlify build command on every deploy, and can be run locally:
 *     node scripts/version-assets.cjs           rewrite references in place
 *     node scripts/version-assets.cjs --check   exit 1 if any reference is stale
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'qa', '.netlify', '.claude', 'netlify', 'scripts']);
const CHECK = process.argv.includes('--check');

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (/\.html$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const assetFiles = ['js', 'css'].flatMap(kind =>
  fs.readdirSync(path.join(ROOT, 'assets', kind))
    .filter(name => name.endsWith('.' + kind))
    .map(name => path.join(ROOT, 'assets', kind, name)));
const files = walk(ROOT, []).concat(assetFiles);

const text = new Map(files.map(f => [f, fs.readFileSync(f, 'utf8')]));
// Ignore line endings so Windows checkouts (CRLF) and Netlify (LF) agree.
const hashOf = f => crypto.createHash('sha256').update(text.get(f).replace(/\r\n/g, '\n')).digest('hex').slice(0, 8);

// Quoted "/assets/js/x.js", "../assets/css/y.css" and, inside assets/js, "./z.js".
const ABS = /(["'])((?:\.\.\/)*\/?assets\/(js|css)\/([\w.-]+\.(?:js|css)))(?:\?v=[0-9a-f]{8})?\1/g;
const REL = /(["'])(\.\/([\w.-]+\.js))(?:\?v=[0-9a-f]{8})?\1/g;

function rewrite(file) {
  // A file never stamps itself (firebase-config.js names itself in a comment).
  const target = (kind, name) => {
    const f = path.join(ROOT, 'assets', kind, name);
    return text.has(f) && f !== file ? f : null;
  };
  let src = text.get(file).replace(ABS, (m, q, ref, kind, name) => {
    const f = target(kind, name);
    return f ? `${q}${ref}?v=${hashOf(f)}${q}` : m;
  });
  if (path.dirname(file) === path.join(ROOT, 'assets', 'js')) {
    src = src.replace(REL, (m, q, ref, name) => {
      const f = target('js', name);
      return f ? `${q}${ref}?v=${hashOf(f)}${q}` : m;
    });
  }
  return src;
}

// Scripts import each other, so a file's hash depends on the stamps inside it.
// Repeat until nothing changes (the import graph is shallow and acyclic).
const original = new Map(text);
for (let pass = 0; ; pass++) {
  if (pass > 20) throw new Error('version-assets: references did not settle (import cycle?)');
  let changed = false;
  for (const f of files) {
    const next = rewrite(f);
    if (next !== text.get(f)) { text.set(f, next); changed = true; }
  }
  if (!changed) break;
}

const stale = files.filter(f => text.get(f) !== original.get(f));
if (CHECK) {
  if (stale.length) {
    console.error('Stale asset versions in:\n  ' + stale.map(f => path.relative(ROOT, f)).join('\n  ') +
      '\nRun: node scripts/version-assets.cjs');
    process.exit(1);
  }
  console.log('Asset versions are up to date.');
} else {
  for (const f of stale) fs.writeFileSync(f, text.get(f));
  console.log(`Versioned asset references in ${stale.length} file(s).`);
}
