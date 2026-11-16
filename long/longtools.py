"""Builds a War Maps long video from long.json: title card, chapter map cards (real borders), painted pictures
with slow camera moves, calm war music under the narration, a small preview and a thumbnail.
Usage: python longtools.py long.json"""
import json
import os
import subprocess
import sys
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

spec = json.load(open(sys.argv[1]))
HERE = os.path.dirname(os.path.abspath(__file__))
ENG = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ENG, "src"))
from geo import Topic, edge_glow, mask_box  # noqa: E402

W, H, FPS = 1920, 1080, 25
FF = spec.get("ffmpeg", "ffmpeg")
WORK = spec["work"]
FONT_SERIF = os.path.join(ENG, "fonts", "Lora-Variable.ttf")
FONT_BOLD = os.path.join(ENG, "fonts", "Poppins-Bold.ttf")
FONT_MED = os.path.join(ENG, "fonts", "Poppins-Medium.ttf")
OCEAN = ((8, 10, 14), (18, 22, 30))
LAND = ((128, 124, 108), (100, 96, 82))
BORDER = (52, 50, 44)
EMPIRE = (196, 72, 24)
GLOW = (255, 150, 60)
ACCENT = (255, 146, 52)
CREAM = (255, 244, 230)
DARK = (20, 8, 2)


def font(p, size, bold=False):
    f = ImageFont.truetype(p, size)
    if bold:
        try:
            f.set_variation_by_name("Bold")
        except Exception:
            pass
    return f


def sh(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit("ffmpeg failed: " + r.stderr[-1500:])


def text_c(d, xy, t, f, fill=CREAM, stroke=6, sfill=DARK, anchor="mm"):
    d.text(xy, t, font=f, fill=fill, anchor=anchor, stroke_width=stroke, stroke_fill=sfill)


def fit_lines(d, text, f, maxw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        nxt = (cur + " " + w).strip()
        if d.textlength(nxt, font=f) <= maxw or not cur:
            cur = nxt
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


# ---------- map cards ----------
topic = spec["topic"]
years_needed = sorted({int(i["year"]) for i in spec["timeline"] if i["kind"] == "map"})
geo = Topic(topic["names"], sorted(set(topic["years"]) | set(years_needed)), spec["data_dir"], max_px=5200, log=lambda *a: None)
gy = np.linspace(0, 1, geo.H, dtype=np.float32)[:, None, None]
ocean = np.array(OCEAN[0], np.float32) * (1 - gy) + np.array(OCEAN[1], np.float32) * gy
base = np.broadcast_to(ocean, (geo.H, geo.W, 3)).copy()
la = np.asarray(geo.land(), np.float32)[:, :, None] / 255
rng = np.random.default_rng(3)
nz = np.asarray(Image.fromarray(((rng.normal(0, 1, (geo.H // 16 + 1, geo.W // 16 + 1)) + 3) * 40).clip(0, 255).astype(np.uint8)).resize((geo.W, geo.H), Image.BICUBIC), np.float32)[:, :, None] / 255
base = base * (1 - la) + (np.array(LAND[1], np.float32) * (1 - nz) + np.array(LAND[0], np.float32) * nz) * la
BASE = Image.fromarray(base.clip(0, 255).astype(np.uint8))
del base, la, nz, ocean


def map_card(year, heading, chapter, out):
    m = geo.empire(year)
    pic = BASE.copy()
    pic.paste(Image.new("RGB", pic.size, EMPIRE), (0, 0), m)
    pic.paste(Image.new("RGB", pic.size, GLOW), (0, 0), edge_glow(m, geo.ppd))
    pic.paste(Image.new("RGB", pic.size, BORDER), (0, 0), geo.borders(year).point(lambda v: int(v * 0.7)))
    box = mask_box(m) or (0, 0, geo.W, geo.H)
    x0, y0, x1, y1 = box[:4]
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    bw, bh = (x1 - x0) * 1.5, (y1 - y0) * 1.6
    bw = max(bw, bh * 16 / 9, 22 * geo.ppd)
    bh = bw * 9 / 16
    cy += bh * 0.08  # leave room for the heading at the top
    crop = Image.new("RGB", (int(bw), int(bh)), OCEAN[0])
    crop.paste(pic.crop((int(cx - bw / 2), int(cy - bh / 2), int(cx + bw / 2), int(cy + bh / 2))), (0, 0))
    card = crop.resize((W, H), Image.LANCZOS).convert("RGBA")
    shade = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade)
    for i in range(300):
        sd.line((0, i, W, i), fill=(0, 0, 0, int(190 * (1 - i / 300))))
    card = Image.alpha_composite(card, shade)
    d = ImageDraw.Draw(card)
    text_c(d, (W / 2, 70), f"CHAPTER {chapter}", font(FONT_BOLD, 34), ACCENT, 3)
    text_c(d, (W / 2, 150), heading.upper(), font(FONT_SERIF, 86, True), CREAM, 6)
    yt = f"{-year} BC" if year < 0 else (f"{year} AD" if year < 1000 else str(year))
    text_c(d, (W - 60, H - 60), yt, font(FONT_SERIF, 96, True), ACCENT, 6, anchor="rs")
    label = (topic.get("labels") or {}).get(str(year), topic["label"])
    text_c(d, (60, H - 60), label, font(FONT_BOLD, 40), CREAM, 4, anchor="ls")
    card.convert("RGB").save(out, quality=94)


# ---------- title, outro, thumbnail ----------
imgs = [i["img"] for i in spec["timeline"] if i["kind"] == "img"]


def wide(path, ypos=0.45):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    ch = int(w * 9 / 16)
    top = int((h - ch) * ypos)
    return im.crop((0, top, w, top + ch)).resize((W, H), Image.LANCZOS)


def title_card(out):
    bg = wide(imgs[min(1, len(imgs) - 1)]).filter(ImageFilter.GaussianBlur(3)).convert("RGBA")
    bg = Image.alpha_composite(bg, Image.new("RGBA", (W, H), (0, 0, 0, 120)))
    d = ImageDraw.Draw(bg)
    text_c(d, (W / 2, 330), spec.get("brand", "WAR MAPS"), font(FONT_BOLD, 40), ACCENT, 3)
    f = font(FONT_SERIF, 100, True)
    lines = fit_lines(d, spec["title"].upper(), f, 1600)
    for k, ln in enumerate(lines[:3]):
        text_c(d, (W / 2, 470 + k * 120), ln, f)
    bg.convert("RGB").save(out, quality=94)


def outro_card(out):
    bg = BASE.resize((W, int(BASE.height * W / BASE.width))).crop((0, 0, W, H)) if BASE.width else Image.new("RGB", (W, H))
    bg = bg.convert("RGBA")
    bg = Image.alpha_composite(bg, Image.new("RGBA", (W, H), (0, 0, 0, 150)))
    d = ImageDraw.Draw(bg)
    text_c(d, (W / 2, 470), "WHICH WAR NEXT?", font(FONT_SERIF, 120, True))
    text_c(d, (W / 2, 610), "Tell me in the comments  •  Subscribe for more war maps", font(FONT_MED, 48), ACCENT, 3)
    bg.convert("RGB").save(out, quality=94)


def thumbnail(out):
    bg = wide(imgs[min(1, len(imgs) - 1)], 0.4).resize((1280, 720), Image.LANCZOS).convert("RGBA")
    g = Image.new("RGBA", (1280, 720), (0, 0, 0, 0))
    gd = ImageDraw.Draw(g)
    for x in range(760):
        gd.line((x, 0, x, 720), fill=(0, 0, 0, int(200 * (1 - x / 760))))
    bg = Image.alpha_composite(bg, g)
    d = ImageDraw.Draw(bg)
    words = (spec.get("thumb_text") or spec["title"]).upper().split()[:4]
    f = font(FONT_SERIF, 120 if len(words) <= 3 else 100, True)
    y = 360 - (len(words) - 1) * 62
    for k, w in enumerate(words):
        d.text((50, y + k * 124), w, font=f, fill=(255, 214, 90) if k == len(words) - 1 else CREAM, anchor="lm", stroke_width=8, stroke_fill=(0, 0, 0))
    d.rounded_rectangle((40, 40, 300, 100), 14, fill=ACCENT)
    d.text((170, 70), "WAR MAPS", font=font(FONT_BOLD, 34), fill=DARK, anchor="mm")
    bg.convert("RGB").save(out, quality=92)


# ---------- moving stills ----------
def segment(still, dur, k, out, ypos=0.45, gentle=False):
    frames = max(2, int(round(dur * FPS)))
    src = Image.open(still).convert("RGB")
    if src.size != (W, H):
        src = wide(still, ypos)
    big = os.path.join(WORK, f"_big{k}.jpg")
    src.resize((2880, 1620), Image.LANCZOS).save(big, quality=93)
    zmax = 1.06 if gentle else 1.14
    mode = k % 4
    if mode == 0:
        z, x, y = f"1+{zmax - 1:.3f}*on/{frames}", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
    elif mode == 1:
        z, x, y = f"{zmax:.3f}-{zmax - 1:.3f}*on/{frames}", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
    elif mode == 2:
        z, x, y = f"{zmax:.3f}", f"(iw-iw/zoom)*on/{frames}", "ih/2-(ih/zoom/2)"
    else:
        z, x, y = f"{zmax:.3f}", f"(iw-iw/zoom)*(1-on/{frames})", "ih/2-(ih/zoom/2)"
    sh([FF, "-y", "-loglevel", "error", "-loop", "1", "-i", big, "-vf",
        f"zoompan=z='{z}':x='{x}':y='{y}':d={frames}:s={W}x{H}:fps={FPS},format=yuv420p",
        "-frames:v", str(frames), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", out])
    os.remove(big)


tl = spec["timeline"]
segs = []
for k, it in enumerate(tl):
    still = os.path.join(WORK, f"_still{k}.jpg")
    if it["kind"] == "title":
        title_card(still)
    elif it["kind"] == "outro":
        outro_card(still)
    elif it["kind"] == "map":
        map_card(int(it["year"]), it["heading"], it["chapter"], still)
    else:
        still = it["img"]
    out = os.path.join(WORK, f"_seg{k:03d}.mp4")
    segment(still, float(it["dur"]), k, out, ypos=[0.3, 0.5, 0.7][k % 3], gentle=it["kind"] != "img")
    segs.append(out)
    if it["kind"] in ("title", "outro", "map") and os.path.exists(still) and still.startswith(os.path.join(WORK, "_still")):
        pass
print("segments done:", len(segs), flush=True)
lst = os.path.join(WORK, "_list.txt")
open(lst, "w").write("".join(f"file '{s}'\n" for s in segs))
silent = os.path.join(WORK, "_video.mp4")
sh([FF, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", silent])

# ---------- music: calm war drone + slow drums, quieter under the voice ----------
SR = 24000
T = float(spec["total"])
N = int(T * SR) + SR
t = np.arange(N, dtype=np.float32) / SR
mus = np.zeros(N, np.float32)
chords = [(110.0, 130.81, 164.81), (98.0, 123.47, 146.83), (87.31, 110.0, 130.81), (82.41, 98.0, 123.47)]
bar = 8.0
for i, ch in enumerate(chords * int(T / (bar * 4) + 2)):
    a, b = int(i * bar * SR), int((i + 1) * bar * SR)
    if a >= N:
        break
    b = min(b, N)
    tt = t[a:b] - t[a]
    env_ = np.minimum(1, tt / 1.5) * np.minimum(1, (bar - tt) / 1.5)
    for f0 in ch:
        mus[a:b] += 0.05 * env_ * (np.sin(2 * np.pi * f0 * tt) + 0.4 * np.sin(2 * np.pi * f0 * 2.003 * tt))
    mus[a:b] += 0.06 * env_ * np.sin(2 * np.pi * ch[0] / 2 * tt)
drum = np.exp(-np.arange(int(0.6 * SR)) / (0.12 * SR)) * np.sin(2 * np.pi * 55 * np.arange(int(0.6 * SR)) / SR)
beat = 0.0
while beat < T:
    for off, g in ((0, 0.22), (0.75, 0.12), (2.0, 0.18)):
        i = int((beat + off) * SR)
        if i + len(drum) < N:
            mus[i:i + len(drum)] += g * drum
    beat += 4.0
fade = np.minimum(1, t / 3) * np.minimum(1, np.maximum(0, (T - t)) / 4)
mus = (mus * fade / max(1e-6, np.abs(mus).max()) * 0.9 * 32767).astype(np.int16)
mwav = os.path.join(WORK, "_music.wav")
with wave.open(mwav, "wb") as wv:
    wv.setnchannels(1)
    wv.setsampwidth(2)
    wv.setframerate(SR)
    wv.writeframes(mus.tobytes())

ins, flt = [], []
for i, v in enumerate(spec["voice"]):
    ins += ["-i", v["file"]]
    ms = int(float(v["start"]) * 1000)
    flt.append(f"[{i + 1}:a]aresample=48000,adelay={ms}|{ms},apad[v{i}]")
nv = len(spec["voice"])
flt.append("".join(f"[v{i}]" for i in range(nv)) + f"amix=inputs={nv}:normalize=0:duration=longest,atrim=0:{T:.2f}[voice]")
flt.append(f"[{nv + 1}:a]aresample=48000,volume=0.22[m]")
flt.append("[voice]asplit[vo][sc]")
flt.append("[m][sc]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[md]")
flt.append("[vo][md]amix=inputs=2:normalize=0,alimiter=limit=0.95[a]")
sh([FF, "-y", "-loglevel", "error", "-i", silent] + ins + ["-i", mwav, "-filter_complex", ";".join(flt),
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-t", f"{T:.2f}", "-movflags", "+faststart", spec["out"]])
sh([FF, "-y", "-loglevel", "error", "-i", spec["out"], "-vf", "scale=640:360", "-c:v", "libx264", "-preset", "veryfast", "-crf", "32", "-c:a", "aac", "-b:a", "64k", spec["preview"]])
thumbnail(spec["thumb"])
for s in segs:
    os.remove(s)
print("long video done", flush=True)
