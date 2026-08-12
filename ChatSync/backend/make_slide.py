#!/usr/bin/env python3
"""Generate a text slide as a PNG image using Pillow.

Usage: python3 make_slide.py <output.png> <role> <text> <bg_hex> <accent_hex>

Creates a 1920x1080 PNG with the role label (accent color) and wrapped text
(white) on a solid background. Used by the SixBrowse video converter.
"""
import sys
import textwrap
from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1920, 1080


def hex_to_rgb(h):
    h = h.lstrip("0x").lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def make_slide(output_path, role, text, bg_hex, accent_hex):
    bg = hex_to_rgb(bg_hex)
    accent = hex_to_rgb(accent_hex)
    img = Image.new("RGB", (WIDTH, HEIGHT), bg)
    draw = ImageDraw.Draw(img)

    # Try to load a system font.
    try:
        font_role = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 48)
        font_text = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 36)
    except Exception:
        font_role = ImageFont.load_default()
        font_text = ImageFont.load_default()

    y = 180

    # Draw role label.
    if role:
        bbox = draw.textbbox((0, 0), role, font=font_role)
        rw = bbox[2] - bbox[0]
        draw.text(((WIDTH - rw) / 2, y), role, fill=accent, font=font_role,
                  stroke_width=2, stroke_fill=(0, 0, 0))
        y += 100

    # Wrap and draw text.
    wrapped = textwrap.wrap(text, width=45)
    for line in wrapped[:8]:
        bbox = draw.textbbox((0, 0), line, font=font_text)
        lw = bbox[2] - bbox[0]
        draw.text(((WIDTH - lw) / 2, y), line, fill=(228, 228, 231),
                  font=font_text, stroke_width=1, stroke_fill=(0, 0, 0))
        y += 60

    img.save(output_path, "PNG")


if __name__ == "__main__":
    if len(sys.argv) != 6:
        print("Usage: make_slide.py <output.png> <role> <text> <bg_hex> <accent_hex>",
              file=sys.stderr)
        sys.exit(1)
    make_slide(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
