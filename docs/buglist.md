# Found Bugs

## 1. [FIXED] Global Keybindings Swallowed by xterm.js
**Issue:** `useGlobalKeybindings` attaches the keydown listener to the `window` without using `{ capture: true }`. Because `xterm.js` prevents event propagation (`e.stopPropagation()`) for keystrokes when the terminal is focused, pressing shortcuts like `Cmd+K` or `Cmd+T` will not trigger if the user's cursor is active inside the terminal.
**Fix:** Pass `{ capture: true }` to the event listener in `useGlobalKeybindings.ts` so React/the window catches it before xterm intercepts it.

## 2. [FIXED] Command Palette NaN Bug
**Issue:** In `CommandPalette.tsx`, the keyboard navigation for `ArrowDown` and `ArrowUp` uses modulo math `(i + 1) % filteredActions.length`. If the user types a search query that yields 0 results, `filteredActions.length` is 0, which results in `NaN`, causing a crash or invalid state for `selectedIndex`.
**Fix:** Add an `if (filteredActions.length === 0) return` check before performing the modulo arithmetic.

## 3. [FIXED] Terminal Process Initialization Bug (in Dev Mode / Chrome)
**Issue:** If the frontend is loaded outside of the Tauri shell (e.g., standard browser), Tauri APIs like `invoke('spawn_terminal')` throw unhandled rejections that may silently fail or leave the UI in a broken state (black terminal pane with no shell).
**Fix:** Fallback error boundaries or a mock `invoke` can be used for web development to simulate a terminal environment when not in Tauri.
