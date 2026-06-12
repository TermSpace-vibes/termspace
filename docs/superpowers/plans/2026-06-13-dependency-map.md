# Dependency Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate `docs/dependency-map.md` — a static import graph for all `src/` files — and wire it into `AGENTS.md` so every AI agent has ripple-risk context.

**Architecture:** A single Node.js script (`scripts/gen-dep-map.js`) globs `src/**/*.{ts,tsx}`, regex-extracts local imports, resolves them to real paths, then writes two markdown tables (imports + dependents) plus a high-risk callout section. AGENTS.md gets a new "Dependency Map" section pointing to the output file.

**Tech Stack:** Node.js built-ins only (`fs`, `path`). No extra dependencies. Run with `node scripts/gen-dep-map.js`.

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `scripts/gen-dep-map.js` | Scanner + markdown generator |
| Create | `docs/dependency-map.md` | Generated output (committed) |
| Modify | `AGENTS.md` | Add "Dependency Map" section after Key Components table |

---

### Task 1: Write `scripts/gen-dep-map.js`

**Files:**
- Create: `scripts/gen-dep-map.js`

- [ ] **Step 1: Create the script**

Create `scripts/gen-dep-map.js` with the following content:

```js
#!/usr/bin/env node
// Generates docs/dependency-map.md by scanning local imports in src/

const fs = require('fs');
const path = require('path');

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
    if (fs.existsSync(c) && allFiles.includes(c)) return c;
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
    const resolved = resolve(importDir, spec);
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

fs.writeFileSync(OUT_FILE, lines.join('\n'));
console.log(`Written: ${OUT_FILE}`);
console.log(`Files scanned: ${allFiles.length}`);
console.log(`High-risk (3+ dependents): ${highRisk.length}`);
```

- [ ] **Step 2: Run the script and verify output**

```bash
node scripts/gen-dep-map.js
```

Expected output (exact numbers will vary):
```
Written: /Users/samirkumal/Documents/Personal/Vibecode/termspace/docs/dependency-map.md
Files scanned: ~55
High-risk (3+ dependents): ~4
```

Then spot-check the output:
```bash
grep "src/types/index.ts" docs/dependency-map.md
grep "src/store/useAppStore.ts" docs/dependency-map.md
```

Both should appear in Table 2 with `Dependent Count` ≥ 3.

- [ ] **Step 3: Commit the script and generated map**

```bash
git add scripts/gen-dep-map.js docs/dependency-map.md
git commit -m "feat: add dependency map generator and initial output"
```

---

### Task 2: Add "Dependency Map" section to `AGENTS.md`

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Insert the new section**

Open `AGENTS.md`. Find the end of the "Key Components" table (the `| ContextMenu | ... |` row). Insert a blank line after the closing backtick of that table, then add:

```markdown
---

## Dependency Map

`docs/dependency-map.md` — auto-generated import graph for all `src/` files.

**Use it when:**
- Changing a utility, hook, store, or type — check **Table 2 (Dependents)** to find all affected files
- Adding a new file — check **Table 1 (Imports)** for patterns to follow
- Debugging a regression — trace which consumers could be affected by an upstream change

**High-ripple files** (many dependents — changes here have wide blast radius):
- `src/types/index.ts` — shared TypeScript interfaces
- `src/store/useAppStore.ts` — global Zustand state
- `src/utils/tauri.ts` — Tauri invoke wrapper
- `src/utils/constants.ts` — shared constants

Regenerate after structural changes: `node scripts/gen-dep-map.js`
```

- [ ] **Step 2: Verify AGENTS.md renders correctly**

```bash
grep -n "Dependency Map" AGENTS.md
grep -n "gen-dep-map" AGENTS.md
```

Both lines should appear. No duplicate sections.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): add dependency map section with ripple-risk callouts"
```

---

## Done

After both tasks are committed:
- `node scripts/gen-dep-map.js` regenerates `docs/dependency-map.md` at any time
- Every AI agent reading `AGENTS.md` sees the map location and high-risk files upfront
- Table 2 answers "what breaks if I change X" in O(1) for any file in the project
