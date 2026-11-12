#!/usr/bin/env node
// Dependency-rule gate. The repo has three packages and one rule set:
//   shared  -> imports nothing from the repo (it must run in a browser, a Worker and a test)
//   client  -> may import shared; may not touch server code or node builtins
//   server  -> may import shared; may not touch client code, three, or the DOM
// It is deliberately a 100-line script instead of a linter config: the rule is small,
// exact, and cannot be silently widened by a plugin update.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PACKAGES = ['shared', 'client', 'server'];

const FORBIDDEN = {
  shared: [/^@eurasia\//, /^three$/, /^node:/, /^wrangler/],
  client: [/^@eurasia\/server/, /^node:/, /^wrangler/],
  server: [/^@eurasia\/client/, /^three($|\/)/, /^node:(?!fs|path|crypto)/],
};

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      out.push(...walk(full));
    } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

const IMPORT_RE = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g;

let violations = 0;
let checked = 0;

for (const pkg of PACKAGES) {
  const dir = join(ROOT, 'packages', pkg, 'src');
  for (const file of walk(dir)) {
    checked++;
    const src = readFileSync(file, 'utf8');
    for (const match of src.matchAll(IMPORT_RE)) {
      const spec = match[1];
      const bad = FORBIDDEN[pkg].some((re) => re.test(spec));
      if (bad) {
        violations++;
        console.error(`${relative(ROOT, file)}: "${pkg}" may not import "${spec}"`);
      }
      // A relative import may climb out of the package, but not into a sibling
      // package's source: `data/` is shared input, `packages/*/src` is not.
      if (spec.startsWith('.')) {
        const resolved = resolve(dirname(file), spec);
        const packageRoot = join(ROOT, 'packages', pkg);
        if (resolved.startsWith(join(ROOT, 'packages')) && !resolved.startsWith(packageRoot)) {
          violations++;
          console.error(
            `${relative(ROOT, file)}: "${spec}" crosses into another package (${relative(ROOT, resolved)})`,
          );
        }
      }
    }
  }
}

if (violations > 0) {
  console.error(`\n${violations} import boundary violation(s).`);
  process.exit(1);
}
console.log(`import boundaries ok (${checked} files checked)`);

// --------------------------------------------------------------- locale gate
// The interface is English. Russian is not deleted — it lives in i18n/ru.ts and
// is type-checked against the English dictionary — but a stray Cyrillic string
// anywhere else means a translation was missed, and that is a build failure.
const CYRILLIC = /[\u0400-\u04FF]/;
const LOCALE_FILE = join(ROOT, 'packages', 'client', 'src', 'i18n', 'ru.ts');
let leaked = 0;

for (const file of walk(join(ROOT, 'packages', 'client', 'src'))) {
  if (file === LOCALE_FILE) continue;
  if (CYRILLIC.test(readFileSync(file, 'utf8'))) {
    leaked++;
    console.error(`${relative(ROOT, file)}: Cyrillic text outside the locale file`);
  }
}

for (const file of ['index.html']) {
  const path = join(ROOT, 'packages', 'client', file);
  if (CYRILLIC.test(readFileSync(path, 'utf8'))) {
    leaked++;
    console.error(`${relative(ROOT, path)}: Cyrillic text outside the locale file`);
  }
}

if (leaked > 0) {
  console.error(`\n${leaked} untranslated string file(s).`);
  process.exit(1);
}
console.log('locale ok (English only, outside i18n/ru.ts)');
