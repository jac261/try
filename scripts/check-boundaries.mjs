/* Enforce the one-way layer dependency rule (see docs/ARCHITECTURE.md):
 *
 *     lib, utils (core)  →  components  →  features  →  app
 *
 * A module may import its own layer or a lower one. Features may not import
 * other features, EXCEPT features/wellness (the shared readiness UI consumed by
 * both today and progress). Bare imports (react, etc.) and CSS are ignored.
 *
 * A lightweight stand-in for an ESLint import-boundary rule — zero extra deps.
 * Run: npm run lint:boundaries
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const LAYER = { lib: 0, utils: 0, components: 1, features: 2, app: 3 };

function layerOf(rel) {
  const parts = rel.split('/');
  const top = parts[0];
  if (!(top in LAYER)) return null;
  return { layer: LAYER[top], top, feature: top === 'features' ? parts[1] : null };
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.jsx?$/.test(e) && !/\.test\.jsx?$/.test(e)) out.push(p);
  }
  return out;
}

const importRe = /\bfrom\s+['"]([^'"]+)['"]/g;
const violations = [];

for (const file of walk(SRC)) {
  const rel = relative(SRC, file).split('\\').join('/');
  const from = layerOf(rel);
  if (!from) continue;
  const code = readFileSync(file, 'utf8');
  let m;
  while ((m = importRe.exec(code))) {
    let spec = m[1];
    if (spec.startsWith('@/')) spec = spec.slice(2);
    else if (spec.startsWith('.')) spec = relative(SRC, resolve(dirname(file), spec)).split('\\').join('/');
    else continue; // bare package
    const to = layerOf(spec);
    if (!to) continue; // e.g. styles.css
    if (to.layer > from.layer) {
      violations.push(`${rel} → ${spec}  (illegal UP: ${from.top} may not import ${to.top})`);
    } else if (from.top === 'features' && to.top === 'features' && from.feature !== to.feature && to.feature !== 'wellness') {
      violations.push(`${rel} → ${spec}  (feature→feature: only features/wellness is shared)`);
    }
  }
}

if (violations.length) {
  console.error('✗ import-boundary violations:\n' + violations.map(v => '  ' + v).join('\n'));
  process.exit(1);
}
console.log('✓ import boundaries OK');
