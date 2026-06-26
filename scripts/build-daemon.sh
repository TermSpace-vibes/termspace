#!/usr/bin/env bash
# Build the termspace-daemon sidecar and place it in src-tauri/resources/
# so that tauri bundle picks it up via bundle.resources.
#
# tauri-build validates all resources before compilation, so we touch a
# placeholder first, then overwrite it with the real binary.
#
# Usage: bash scripts/build-daemon.sh          # release build
#        bash scripts/build-daemon.sh --debug   # debug build
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
TAURI_DIR="$REPO_ROOT/src-tauri"
RESOURCES_DIR="$TAURI_DIR/resources"
DEST="$RESOURCES_DIR/termspace-daemon"

PROFILE="release"
CARGO_FLAGS="--release"

if [[ "${1:-}" == "--debug" ]]; then
    PROFILE="debug"
    CARGO_FLAGS=""
fi

mkdir -p "$RESOURCES_DIR"

# Create placeholder so tauri-build validation passes
if [[ ! -f "$DEST" ]]; then
    touch "$DEST"
    chmod +x "$DEST"
fi

echo "[build-daemon] Building termspace-daemon ($PROFILE)..."
cd "$TAURI_DIR"
cargo build $CARGO_FLAGS --bin termspace-daemon

BINARY="$TAURI_DIR/target/$PROFILE/termspace-daemon"
if [[ ! -f "$BINARY" ]]; then
    echo "[build-daemon] ERROR: binary not found at $BINARY" >&2
    exit 1
fi

cp "$BINARY" "$DEST"
chmod +x "$DEST"

echo "[build-daemon] Done — $DEST ($(du -sh "$DEST" | cut -f1))"
