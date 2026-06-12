# Termspace — Claude Instructions

## Dependency Map

`docs/dependency-map.md` tracks import relationships across all `src/` files so you know what breaks when something changes.

**REQUIRED: Regenerate the map whenever you:**
- Add a new `.ts` or `.tsx` file to `src/`
- Delete or rename an existing `src/` file
- Move a file to a different directory within `src/`

**How to regenerate:**
```bash
node scripts/gen-dep-map.js
git add docs/dependency-map.md
git commit -m "chore: regenerate dependency map"
```

Do this as part of the same commit that adds/removes the file — never leave the map stale.
