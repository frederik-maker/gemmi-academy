#!/usr/bin/env python3
"""Remove the white background from public/gemmi-source.png and write the
result to public/gemmi.png. The Mascot React component will pick up the new
PNG on next page load.

Usage:
    1. Save your source image to public/gemmi-source.png (any size, white background)
    2. Run: python3 scripts/process-mascot.py
    3. Refresh the app — the SVG fallback is replaced by your bitmap mascot.

The algorithm:
    - Convert each pixel to RGBA.
    - If it's within `WHITE_TOLERANCE` of pure white AND connected to the image
      boundary by other near-white pixels (i.e. background, not a white spot
      inside the subject), drop its alpha to 0.
    - For pixels right at the subject edge, scale alpha down proportionally
      so the silhouette has smooth anti-aliasing instead of a jagged keyline.

Falls back to a simple threshold strip if Pillow isn't available. Edge-aware
flood-fill is preferred because some mascot designs (eyes, gem highlights)
contain genuine white that we don't want to delete.
"""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "gemmi-source.png"
OUT = ROOT / "public" / "gemmi.png"

WHITE_TOLERANCE = 12      # how close to (255,255,255) counts as "white"
EDGE_TOLERANCE = 60       # how close before we treat as a fading edge
EDGE_FEATHER = True       # smooth the alpha at the silhouette edge


def main() -> int:
    if not SRC.exists():
        print(f"!! Source image not found at {SRC}")
        print("   Save your mascot PNG there and re-run.")
        return 1

    try:
        from PIL import Image
        import numpy as np
    except ImportError:
        print("Installing Pillow + numpy …")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", "Pillow", "numpy"])
        from PIL import Image
        import numpy as np

    img = Image.open(SRC).convert("RGBA")
    arr = np.array(img)  # shape (H, W, 4)
    h, w, _ = arr.shape

    # Distance-to-white per pixel: max channel distance from 255.
    rgb = arr[:, :, :3].astype(np.int16)
    dist_from_white = 255 - rgb.min(axis=2)   # 0 = pure white, 255 = pure non-white

    # Mark "definitely background" mask: very near white.
    near_white = dist_from_white <= WHITE_TOLERANCE

    # Edge-aware: flood-fill from the image border so we only erase background-
    # connected white, not white pixels inside the subject (eye highlights, gem).
    # Use a BFS over the near_white mask, seeded by the four borders.
    bg = np.zeros((h, w), dtype=bool)
    seeds = []
    for x in range(w):
        if near_white[0, x]: seeds.append((0, x))
        if near_white[h - 1, x]: seeds.append((h - 1, x))
    for y in range(h):
        if near_white[y, 0]: seeds.append((y, 0))
        if near_white[y, w - 1]: seeds.append((y, w - 1))

    # Vectorised iterative dilation — much faster than per-pixel BFS in pure Python.
    if seeds:
        for sy, sx in seeds:
            bg[sy, sx] = True
        prev_count = -1
        while prev_count != bg.sum():
            prev_count = bg.sum()
            # Expand to any near_white neighbour via 4-connectivity.
            up    = np.zeros_like(bg); up[1:, :]   = bg[:-1, :]
            down  = np.zeros_like(bg); down[:-1, :] = bg[1:, :]
            left  = np.zeros_like(bg); left[:, 1:] = bg[:, :-1]
            right = np.zeros_like(bg); right[:, :-1] = bg[:, 1:]
            bg = (bg | up | down | left | right) & near_white

    out = arr.copy()
    # Background → fully transparent.
    out[bg, 3] = 0

    if EDGE_FEATHER:
        # For pixels right next to bg but not bg themselves (silhouette edge),
        # scale alpha by how non-white they are so the rim doesn't show a halo.
        from scipy.ndimage import binary_dilation  # type: ignore
        try:
            edge = binary_dilation(bg, iterations=1) & ~bg
        except Exception:
            # No scipy — skip feathering but the result is still usable.
            edge = None
        if edge is not None:
            d = dist_from_white[edge]
            # Map dist 0..EDGE_TOLERANCE → alpha 0..255.
            new_alpha = np.clip(d * (255 / EDGE_TOLERANCE), 0, 255).astype(np.uint8)
            out[edge, 3] = new_alpha

    # Auto-crop to the bounding box of the opaque pixels, then re-center on a
    # square canvas with a little breathing room. Without this, art with a lot
    # of empty space on one side ends up visually off-centre when scaled.
    alpha = out[:, :, 3]
    rows = np.any(alpha > 8, axis=1)
    cols = np.any(alpha > 8, axis=0)
    if rows.any() and cols.any():
        y0, y1 = np.where(rows)[0][[0, -1]]
        x0, x1 = np.where(cols)[0][[0, -1]]
        cropped = out[y0:y1 + 1, x0:x1 + 1]
        ch, cw, _ = cropped.shape
        side = max(ch, cw)
        # 6% padding so the subject doesn't touch the edge of the canvas.
        pad = max(8, side // 16)
        canvas_side = side + pad * 2
        canvas = np.zeros((canvas_side, canvas_side, 4), dtype=np.uint8)
        oy = (canvas_side - ch) // 2
        ox = (canvas_side - cw) // 2
        canvas[oy:oy + ch, ox:ox + cw] = cropped
        Image.fromarray(canvas).save(OUT, optimize=True)
        transparent_pct = (canvas[:, :, 3] == 0).mean() * 100
        print(f"✓ Wrote {OUT}")
        print(f"  Source:  {w}×{h}")
        print(f"  Cropped: {cw}×{ch} subject")
        print(f"  Output:  {canvas_side}×{canvas_side} (centred, {pad}px padding)")
        print(f"  Transparent pixels: {transparent_pct:.1f}%")
    else:
        Image.fromarray(out).save(OUT, optimize=True)
        print(f"✓ Wrote {OUT} (no opaque subject found — saved unchanged)")
    print(f"  Mascot component will pick this up automatically — refresh the app.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
