#!/usr/bin/env python3
"""Generate placeholder macOS tray icon PNGs (no external deps)."""
import struct
import zlib
import os

SIZE = 22
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons", "tray")


def write_png(path, pixels):
    """pixels: list of SIZE*SIZE (r, g, b, a) tuples, row-major."""
    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = bytearray()
    for y in range(SIZE):
        raw.append(0)  # filter type 0 (none) per scanline
        for x in range(SIZE):
            r, g, b, a = pixels[y * SIZE + x]
            raw.extend((r, g, b, a))

    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", idat))
        f.write(chunk(b"IEND", b""))


def circle_pixels(filled, ring_width=2, dot=False):
    cx = cy = SIZE / 2 - 0.5
    r_outer = SIZE / 2 - 2
    r_inner = r_outer - ring_width
    pixels = []
    for y in range(SIZE):
        for x in range(SIZE):
            dx, dy = x - cx, y - cy
            dist = (dx * dx + dy * dy) ** 0.5
            on = dist <= r_outer and (filled or dist >= r_inner)
            if on:
                pixels.append((20, 20, 20, 255))
            else:
                pixels.append((0, 0, 0, 0))
    if dot:
        dot_r = 2.2
        for y in range(SIZE):
            for x in range(SIZE):
                dx, dy = x - cx, y - cy
                if (dx * dx + dy * dy) ** 0.5 <= dot_r:
                    idx = y * SIZE + x
                    pixels[idx] = (255, 255, 255, 255)
    return pixels


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    write_png(os.path.join(OUT_DIR, "idle.png"), circle_pixels(filled=False))
    write_png(os.path.join(OUT_DIR, "listening.png"), circle_pixels(filled=True))
    write_png(os.path.join(OUT_DIR, "processing.png"), circle_pixels(filled=True, dot=True))
    print("Wrote idle.png, listening.png, processing.png to", OUT_DIR)


if __name__ == "__main__":
    main()
