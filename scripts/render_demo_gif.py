#!/usr/bin/env python3
"""
Render a captured `argus run --mock` into an animated GIF for the README.

Reads docs/run-capture.json (produced by scripts/capture-run.ts), which holds
the real stdout chunks and the millisecond offset each one arrived at. Replays
them onto a terminal-styled canvas, so the animation's pacing is the actual
run's pacing.

Long waits (the Playwright execution stage) are compressed rather than
faked -- the on-screen elapsed clock keeps showing true wall-clock time, so the
GIF never claims the run was faster than it was.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
CAPTURE = ROOT / "docs" / "run-capture.json"
OUT = ROOT / "docs" / "demo.gif"

# --- terminal styling -------------------------------------------------------
BG = (13, 15, 20)
CHROME = (26, 31, 43)
FG = (232, 235, 242)
FONT_SIZE = 15
LINE_H = 21
PAD_X, PAD_TOP = 18, 40
COLS, ROWS = 104, 30

ANSI = {
    30: (90, 96, 110), 31: (255, 107, 107), 32: (61, 220, 151), 33: (255, 199, 89),
    34: (91, 140, 255), 35: (199, 125, 255), 36: (94, 214, 226), 37: FG,
    90: (136, 145, 165), 91: (255, 138, 138), 92: (122, 232, 180), 93: (255, 216, 138),
    94: (138, 176, 255), 95: (216, 164, 255), 96: (150, 231, 240), 97: (255, 255, 255),
}
DIM = (136, 145, 165)

TOKEN = re.compile(r"\x1b\[([0-9;]*)m")


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for name in ("cascadiamono.ttf", "CascadiaMono.ttf", "consola.ttf", "DejaVuSansMono.ttf"):
        for base in (Path("C:/Windows/Fonts"), Path("/usr/share/fonts/truetype/dejavu")):
            p = base / name
            if p.exists():
                return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def parse(text: str) -> list[list[tuple[str, tuple[int, int, int], bool]]]:
    """ANSI stream -> list of lines; each line is [(text, colour, bold)]."""
    lines: list[list[tuple[str, tuple[int, int, int], bool]]] = [[]]
    colour, bold, dim = FG, False, False
    pos = 0
    for m in TOKEN.finditer(text):
        chunk = text[pos:m.start()]
        if chunk:
            for i, seg in enumerate(chunk.split("\n")):
                if i:
                    lines.append([])
                if seg:
                    lines[-1].append((seg, DIM if dim else colour, bold))
        for raw in (m.group(1) or "0").split(";"):
            code = int(raw or 0)
            if code == 0:
                colour, bold, dim = FG, False, False
            elif code == 1:
                bold = True
            elif code == 2:
                dim = True
            elif code in (22, 39):
                if code == 22:
                    bold = dim = False
                else:
                    colour = FG
            elif code in ANSI:
                colour = ANSI[code]
        pos = m.end()
    tail = text[pos:]
    if tail:
        for i, seg in enumerate(tail.split("\n")):
            if i:
                lines.append([])
            if seg:
                lines[-1].append((seg, DIM if dim else colour, bold))
    return lines


def wrap(lines, cols: int):
    """Soft-wrap at the terminal width, preserving colour runs and indentation.

    The triage reasoning lines run to ~270 characters. A real terminal wraps
    them; without this they would simply be clipped at the right edge and the
    summary line would lose its tail.
    """
    out = []
    for line in lines:
        if sum(len(s) for s, _, _ in line) <= cols:
            out.append(line)
            continue
        text = "".join(s for s, _, _ in line)
        indent = len(text) - len(text.lstrip())
        hang = " " * min(indent + 2, cols - 20)
        cur, used, first = [], 0, True
        for seg, colour, bold in line:
            words = re.split(r"(\s+)", seg)
            for w in words:
                if not w:
                    continue
                limit = cols if first else cols - len(hang)
                if used + len(w) > limit and used > 0:
                    out.append(cur)
                    cur, used, first = [(hang, colour, False)], len(hang), False
                    if w.isspace():
                        continue
                cur.append((w, colour, bold))
                used += len(w)
        if cur:
            out.append(cur)
    return out


def render(lines, font, bold_font, elapsed_ms: int) -> Image.Image:
    w = PAD_X * 2 + int(font.getlength("M")) * COLS
    h = PAD_TOP + LINE_H * ROWS + 14
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)

    # window chrome
    d.rectangle([0, 0, w, 30], fill=CHROME)
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse([14 + i * 18, 11, 24 + i * 18, 21], fill=c)
    title = "argus run --mock"
    d.text(((w - font.getlength(title)) / 2, 8), title, font=font, fill=(150, 158, 175))
    clock = f"{elapsed_ms / 1000:5.1f}s"
    d.text((w - PAD_X - font.getlength(clock), 8), clock, font=font, fill=(110, 118, 135))

    visible = lines[-ROWS:] if len(lines) > ROWS else lines
    y = PAD_TOP
    for line in visible:
        x = PAD_X
        for seg, colour, bold in line:
            f = bold_font if bold else font
            d.text((x, y), seg, font=f, fill=colour)
            x += f.getlength(seg)
        y += LINE_H
    return img


def main() -> int:
    if not CAPTURE.exists():
        print(f"missing {CAPTURE} - run scripts/capture-run.ts first", file=sys.stderr)
        return 1

    data = json.loads(CAPTURE.read_text(encoding="utf-8"))
    chunks = data["chunks"]
    font, bold_font = load_font(FONT_SIZE), load_font(FONT_SIZE)

    frames: list[Image.Image] = []
    delays: list[int] = []
    acc = ""
    prev_t = 0

    for ch in chunks:
        acc += ch["text"]
        real_gap = ch["t"] - prev_t
        prev_t = ch["t"]
        # Compress dead air (Playwright execution) but keep relative rhythm.
        delay = max(40, min(int(real_gap * 0.28), 900))
        frames.append(render(wrap(parse(acc), COLS), font, bold_font, ch["t"]))
        delays.append(delay)

    # Hold the final frame so the summary is readable before the loop restarts.
    frames.append(frames[-1].copy())
    delays.append(3200)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        OUT, save_all=True, append_images=frames[1:], duration=delays,
        loop=0, optimize=True,
    )
    size_mb = OUT.stat().st_size / 1_048_576
    print(f"{OUT.relative_to(ROOT)}  {len(frames)} frames  "
          f"{sum(delays)/1000:.1f}s loop  {size_mb:.2f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
