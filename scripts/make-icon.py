"""Tạo logo assets (tách tagline), brand.ts base64 và icon Windows từ logo gốc."""

import base64
import io
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "evergrow-logo-source.png"
OUT = ROOT / "assets"
BUILD = ROOT / "build"
SHARED = ROOT / "src" / "shared"

OUT.mkdir(exist_ok=True)
BUILD.mkdir(exist_ok=True)
SHARED.mkdir(parents=True, exist_ok=True)

# --- Tách nền trắng, giữ khử răng cưa mềm ---
image = Image.open(SOURCE).convert("RGBA")
pixels = image.load()
width, height = image.size
for y in range(height):
    for x in range(width):
        r, g, b, a = pixels[x, y]
        minimum = min(r, g, b)
        if minimum >= 247:
            alpha = 0
        elif minimum >= 220:
            alpha = int((247 - minimum) / 27 * 90)
        else:
            alpha = min(255, int((247 - minimum) * 2.4))
        pixels[x, y] = (r, g, b, min(a, alpha))

leaf = image.crop((290, 95, 735, 630))
wordmark = image.crop((112, 640, 930, 779))


def trimmed(img: Image.Image) -> Image.Image:
    bounds = img.getbbox()
    return img.crop(bounds) if bounds else img


leaf = trimmed(leaf)
wordmark = trimmed(wordmark)
leaf.save(OUT / "logo-leaf.png")
wordmark.save(OUT / "logo-wordmark.png")

# --- Lockup ngang: lá + EVERGROW ---
leaf_h = 128
leaf_small = leaf.resize((round(leaf.width * leaf_h / leaf.height), leaf_h), Image.LANCZOS)
word_h = 34
word_small = wordmark.resize((round(wordmark.width * word_h / wordmark.height), word_h), Image.LANCZOS)
gap = 18
lockup = Image.new(
    "RGBA",
    (leaf_small.width + gap + word_small.width, max(leaf_small.height, word_small.height)),
    (0, 0, 0, 0),
)
lockup.alpha_composite(leaf_small, (0, (lockup.height - leaf_small.height) // 2))
lockup.alpha_composite(word_small, (leaf_small.width + gap, (lockup.height - word_small.height) // 2))
lockup.save(OUT / "logo-lockup.png")

# --- Base64 cho app ---
def data_uri(img: Image.Image, resize_height: int) -> str:
    ratio = resize_height / img.height
    resized = img.resize((max(1, round(img.width * ratio)), resize_height), Image.LANCZOS)
    buffer = io.BytesIO()
    resized.save(buffer, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


leaf_uri = data_uri(leaf, 160)
word_uri = data_uri(wordmark, 64)
lockup_uri = data_uri(lockup, 176)

brand_ts = f"""// Tệp sinh tự động bởi scripts/make-icon.py — không sửa tay.
export const LOGO_LEAF = '{leaf_uri}';
export const LOGO_WORDMARK = '{word_uri}';
export const LOGO_LOCKUP = '{lockup_uri}';
"""
(SHARED / "brand.ts").write_text(brand_ts, encoding="utf-8")

# --- Icon ứng dụng: lá trên nền giấy ---
size = 1024
icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(icon)
draw.rounded_rectangle([16, 16, size - 16, size - 16], radius=232, fill=(247, 246, 242, 255))
target_h = 620
resized = leaf.resize((round(leaf.width * target_h / leaf.height), target_h), Image.LANCZOS)
icon.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2 - 8))
icon.save(BUILD / "icon.png")
icon.save(BUILD / "icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])

print("Wrote brand assets, brand.ts and Windows icon")
print("Lockup:", lockup.size, "Leaf:", leaf.size, "Wordmark:", wordmark.size)
