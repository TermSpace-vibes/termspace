# Browser Media Widget Dedupe And YouTube Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show one media card per browser tab and expose previous/next media controls for YouTube even when Media Session track handlers are not reported.

**Architecture:** Keep raw media events in `useBrowserMediaStore`, but derive the sidebar carousel entries in `MediaWidget` by collapsing sessions by `browserTabId`. Prefer active sessions, then newest sessions, for the representative card. Add a YouTube page fallback in the widget that renders previous/next controls and sends the existing `previoustrack`/`nexttrack` command path.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Testing Library, Tauri invoke wrapper.

## Global Constraints

- Preserve existing raw session tracking so multiple media elements can still be controlled by play/pause through their selected representative session.
- Keep the fix local to the browser media widget unless tests prove the store or bridge needs a source-level change.
- Use failing tests before production code.
- Do not touch unrelated dirty `.swarm` files.

---

### Task 1: Widget Session Collapsing And YouTube Controls

**Files:**
- Modify: `src/components/WorkspaceSidebar/MediaWidget.test.tsx`
- Modify: `src/components/WorkspaceSidebar/MediaWidget.tsx`

**Interfaces:**
- Consumes: `BrowserMediaSession` fields: `id`, `browserTabId`, `pageUrl`, `isPlaying`, `lastActiveAt`, `canPrev`, `canNext`.
- Produces: One rendered carousel card per `browserTabId`; YouTube URLs render previous/next track buttons even when `canPrev`/`canNext` are false.

- [ ] **Step 1: Write failing tests**

Add tests that seed two sessions with the same `browserTabId` and assert no session chevrons render, then seed a YouTube session without reported track support and assert previous/next track buttons render and invoke existing actions.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- src/components/WorkspaceSidebar/MediaWidget.test.tsx`

Expected: FAIL because duplicate same-tab sessions still render carousel chevrons and YouTube fallback track buttons do not render.

- [ ] **Step 3: Implement minimal widget derivation**

In `MediaWidget.tsx`, derive `rawSessions` from the store and use a memoized helper to collapse sessions by `browserTabId`. For each tab, choose a playing session over a paused one, otherwise choose the newest `lastActiveAt`. Sort the collapsed sessions by `lastActiveAt`.

- [ ] **Step 4: Implement YouTube fallback visibility**

In `MediaWidget.tsx`, detect YouTube page URLs or media URLs with `new URL(...)` fallback-safe parsing. Render previous/next track buttons when `current.canPrev/current.canNext` is true or the current representative session is YouTube.

- [ ] **Step 5: Run tests to verify pass**

Run: `npm test -- src/components/WorkspaceSidebar/MediaWidget.test.tsx`

Expected: PASS.

- [ ] **Step 6: Run related store/bridge tests**

Run: `npm test -- src/store/useBrowserMediaStore.test.ts src/hooks/useBrowserMediaBridge.test.tsx src/components/WorkspaceSidebar/WorkspaceSidebar.test.tsx`

Expected: PASS.
