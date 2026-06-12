#!/usr/bin/env node
// Generates docs/dependency-map.md by scanning local imports in src/

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SRC_ROOT = path.resolve(__dirname, '../src');
const OUT_FILE = path.resolve(__dirname, '../docs/dependency-map.md');

// --- 1. Collect all source files ---

function walkDir(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, results);
    } else if (/\.(tsx?)$/.test(entry.name) && !/\.(test|spec)\.(tsx?)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      results.push(full);
    }
  }
  return results;
}

const allFiles = walkDir(SRC_ROOT);
const allFilesSet = new Set(allFiles);

// Normalize to relative paths like "src/components/App.tsx"
const rel = (abs) => path.relative(path.resolve(__dirname, '..'), abs);

// --- 2. Resolve an import specifier to an absolute path ---

function resolve(importerDir, spec) {
  if (!spec.startsWith('.')) return null; // third-party
  const candidates = [
    path.resolve(importerDir, spec),
    path.resolve(importerDir, spec + '.ts'),
    path.resolve(importerDir, spec + '.tsx'),
    path.resolve(importerDir, spec, 'index.ts'),
    path.resolve(importerDir, spec, 'index.tsx'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && allFilesSet.has(c)) return c;
  }
  return null;
}

// --- 3. Extract imports for each file ---

const imports = {}; // file -> Set<file>
const dependents = {}; // file -> Set<file>

for (const f of allFiles) {
  imports[f] = new Set();
  if (!dependents[f]) dependents[f] = new Set();
}

for (const f of allFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const importDir = path.dirname(f);
  const matches = src.matchAll(/from\s+['"](\.[^'"]+)['"]/g);
  for (const [, spec] of matches) {
    const cleanSpec = spec.replace(/\?.*$/, '');
    const resolved = resolve(importDir, cleanSpec);
    if (resolved) {
      imports[f].add(resolved);
      if (!dependents[resolved]) dependents[resolved] = new Set();
      dependents[resolved].add(f);
    }
  }
}

// --- 4. Build markdown ---

const lines = [];
const now = new Date().toISOString().slice(0, 10);

lines.push(`# Dependency Map`);
lines.push(``);
lines.push(`> Auto-generated ${now} by \`node scripts/gen-dep-map.js\`. Re-run after structural changes.`);
lines.push(``);
lines.push(`## How to use`);
lines.push(``);
lines.push(`- **Changing a file?** Find it in Table 2 (Dependents) to see what could break.`);
lines.push(`- **Adding a file?** Find similar files in Table 1 (Imports) for patterns.`);
lines.push(`- **Debugging a regression?** Trace upstream changes through the Dependents table.`);
lines.push(``);

// --- Table 1: Imports ---
lines.push(`## Table 1 — Imports (what each file depends on)`);
lines.push(``);
lines.push(`| File | Imports |`);
lines.push(`|------|---------|`);

for (const f of allFiles.sort()) {
  const deps = [...imports[f]].map(rel).sort();
  lines.push(`| \`${rel(f)}\` | ${deps.length ? deps.map(d => `\`${d}\``).join(', ') : '—'} |`);
}

lines.push(``);

// --- Table 2: Dependents, sorted by count desc ---
lines.push(`## Table 2 — Dependents / Ripple Risk (sorted by blast radius)`);
lines.push(``);
lines.push(`| File | Dependent Count | Imported By |`);
lines.push(`|------|----------------|-------------|`);

const sorted = allFiles.slice().sort((a, b) => dependents[b].size - dependents[a].size);

for (const f of sorted) {
  const deps = [...dependents[f]].map(rel).sort();
  const count = deps.length;
  lines.push(`| \`${rel(f)}\` | ${count} | ${count ? deps.map(d => `\`${d}\``).join(', ') : '—'} |`);
}

lines.push(``);

// --- High-risk callout ---
const highRisk = sorted.filter(f => dependents[f].size >= 3);
if (highRisk.length) {
  lines.push(`## High-Risk Files (3+ dependents)`);
  lines.push(``);
  lines.push(`Changes here have a wide blast radius — check all dependents before editing.`);
  lines.push(``);
  for (const f of highRisk) {
    lines.push(`- \`${rel(f)}\` — **${dependents[f].size} dependents**`);
  }
  lines.push(``);
}

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, lines.join('\n'));
console.log(`Written: ${OUT_FILE}`);
console.log(`Files scanned: ${allFiles.length}`);
console.log(`High-risk (3+ dependents): ${highRisk.length}`);
