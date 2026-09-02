# Browser Pane Optimization & Fixes

Currently, the Termspace browser pane relies on `WKWebView`, which provides native Safari speeds for rendering and JavaScript execution. However, the implementation of certain features introduces performance bottlenecks. This document outlines the roadmap to optimize the browser pane.

## 1. Native Rust Content Blocking (Replace JS Hack)
**The Problem:** The current adblocker injects a massive JavaScript polyfill into every page (overriding `fetch`, `XMLHttpRequest`, and using `MutationObserver`). This runs on the main thread and significantly slows down page loads.
**The Fix:** Use a native Rust crate (like Brave's `adblock` crate) hooked into Tauri's request interceptors. This blocks ad requests at the network layer in C++/Rust before they reach WebKit, completely freeing up the JavaScript main thread.

## 2. Pre-connect & Pre-fetch via Rust
**The Problem:** The browser only initiates a TCP/TLS handshake after the user hits Enter in the Omnibox.
**The Fix:** When a user types a URL, use Rust to instantly open a TCP/TLS connection to the server in the background. By the time they hit Enter, the network handshake is already complete, making the navigation feel instant.

## 3. Dedicated `WKWebsiteDataStore` & Caching
**The Problem:** Tabs might be sharing transient or unoptimized data stores, preventing proper caching of heavy assets.
**The Fix:** Explicitly configure `WKWebView` to use a persistent, highly-optimized `WKWebsiteDataStore`. This allows WebKit to aggressively cache disk assets, service workers, and IndexedDB data between Termspace reboots, mirroring standalone Safari's behavior.

## 4. Local Asset Caching (Custom Protocol Interception)
**The Problem:** Developers repeatedly download the same heavy libraries (React, Tailwind, jQuery) from CDNs while testing local apps.
**The Fix:** Intercept network requests for common CDN libraries and serve them instantly from the local macOS hard drive using Tauri's custom protocol handlers (`termspace://`).
