"""Gives this channel its own colours on top of the Empire Maps renderer (so the channels do not look the same).
Usage: python theme.py <path to engine/src/render.py> <theme name>"""
import re
import sys

THEMES = {
    # Naqsha Wala: light paper map, royal-blue country, sky-blue highlights
    "naqsha": {
        "OCEAN_TOP": "[8, 40, 58]", "OCEAN_BOT": "[14, 66, 86]",
        "LAND": "[236, 228, 206]", "LAND_DARK": "[214, 204, 178]",
        "BORDER": "(120, 110, 90)", "EMPIRE": "(28, 92, 168)",
        "GLOW": "(120, 210, 255)", "NEW": "(170, 230, 255)", "ACCENT": "(110, 205, 255",
        "YEAR_SHADOW": "(4, 22, 44)", "LABEL_STROKE": "(6, 20, 48",
    },
    # War Maps: dark battlefield map, fire-orange territory, orange highlights
    "war": {
        "OCEAN_TOP": "[8, 10, 14]", "OCEAN_BOT": "[18, 22, 30]",
        "LAND": "[128, 124, 108]", "LAND_DARK": "[100, 96, 82]",
        "BORDER": "(52, 50, 44)", "EMPIRE": "(196, 72, 24)",
        "GLOW": "(255, 150, 60)", "NEW": "(255, 196, 110)", "ACCENT": "(255, 146, 52",
        "YEAR_SHADOW": "(40, 14, 2)", "LABEL_STROKE": "(44, 14, 4",
    },
}

path, name = sys.argv[1], sys.argv[2]
t = THEMES[name]
s = open(path, encoding="utf-8").read()
n = 0
for key in ("OCEAN_TOP", "OCEAN_BOT", "LAND", "LAND_DARK"):
    s, k = re.subn(r"^%s = np\.array\(\[[^\]]*\]" % key, "%s = np.array(%s" % (key, t[key]), s, flags=re.M)
    n += k
for key in ("BORDER", "EMPIRE", "GLOW", "NEW"):
    s, k = re.subn(r"^%s = \([^)]*\)" % key, "%s = %s" % (key, t[key]), s, flags=re.M)
    n += k
s, k = re.subn(r"^GOLD = \([^)]*\)", "GOLD = %s)" % t["ACCENT"], s, flags=re.M)
n += k
s = s.replace("(242, 193, 78", t["ACCENT"])
s = s.replace("sfill=(40, 22, 4)", "sfill=%s" % t["YEAR_SHADOW"])
s = s.replace("sfill=(40, 8, 8", "sfill=%s" % t["LABEL_STROKE"])
if n != 9:
    sys.exit("theme: expected 9 colour lines, changed %d" % n)
# camera fix: when the map is zoomed all the way out, the crop could be a hair wider than the canvas
# (rounding), which made PIL fail with "box offset can't be negative" (Reconquista, 17 Nov)
fix_old = "    left = min(max(0, left), geo.W - w)\n    top = min(max(0, top), geo.H - h)\n"
fix_new = "    w, h = min(w, geo.W), min(h, geo.H)\n    left = max(0.0, min(left, geo.W - w))\n    top = max(0.0, min(top, geo.H - h))\n"
if fix_old in s:
    s = s.replace(fix_old, fix_new)
elif fix_new not in s:
    sys.exit("theme: camera code not found")
open(path, "w", encoding="utf-8").write(s)
print("theme %s applied" % name)
