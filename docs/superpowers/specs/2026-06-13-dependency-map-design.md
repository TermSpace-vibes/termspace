# Dependency Map — Design Spec

**Date:** 2026-06-13  
**Status:** Approved

---

## Goal

Produce a static `docs/dependency-map.md` that gives any AI agent (or developer) an instant answer to:
- "If I change file X, what else might break?"
- "What does file Y depend on?"

The map is referenced from `AGENTS.md` so it lands in every AI agent's context automatically.

---

## Scope

- **In:** All `.ts` and `.tsx` files under `src/`
- **Out:** Third-party packages, `src-tauri/` Rust files, test files (`*.test.ts`, `*.test.tsx`), type declaration files (`*.d.ts`)
- **Import types captured:** static `import` statements only (no dynamic `import()` — not used in this codebase)

---

## Artifacts

### `scripts/gen-dep-map.js`

Node.js script (no extra dependencies, uses built-in `fs` + regex). Responsibilities:

1. Glob all `src/**/*.{ts,tsx}` excluding test and declaration files
2. For each file, extract local imports (lines matching `from '\.` or `from "\.`) and resolve them to real file paths
3. Build two maps:
   - `imports`: file → list of files it imports
   - `dependents`: file → list of files that import it
4. Write `docs/dependency-map.md` with:
   - A preamble explaining what the file is and how to regenerate it
   - **Table 1 — Imports**: each row is a file and its direct local imports
   - **Table 2 — Dependents (Ripple Risk)**: each row is a file and what imports it, sorted descending by dependent count — highest-risk files first
   - A **High-Risk callout section** listing files with 3+ dependents

Run with: `node scripts/gen-dep-map.js`

### `docs/dependency-map.md`

Generated output. Committed to the repo. Regenerate after any significant refactor or file addition.

### `AGENTS.md` addition

New section inserted after the existing "Key Components" table:

```
## Dependency Map

`docs/dependency-map.md` — auto-generated import graph for all `src/` files.

**Use it when:**
- Changing a utility, hook, store, or type — check the Dependents table to find all affected files
- Adding a new file — check the Imports table for patterns to follow
- Debugging a regression — trace which consumers could be affected by an upstream change

**High-ripple files** (many dependents — changes here have wide blast radius):
- `src/types/index.ts` — shared TypeScript interfaces
- `src/store/useAppStore.ts` — global Zustand state
- `src/utils/tauri.ts` — Tauri invoke wrapper
- `src/utils/constants.ts` — shared constants

Regenerate after structural changes: `node scripts/gen-dep-map.js`
```

---

## Import Resolution Rules

| Import written | Resolved as |
|---|---|
| `./foo` | `./foo.ts` or `./foo.tsx` (try both) |
| `./foo/index` | `./foo/index.ts` or `./foo/index.tsx` |
| `../utils/layout` | resolved relative to importer |
| `@/...` path aliases | skip (not used in this project) |
| `react`, `zustand`, etc. | skip (third-party) |

---

## Non-Goals

- No watch mode / live regeneration
- No circular dependency detection (future work)
- No dynamic import tracking
- No Rust/Tauri backend dependency tracking
