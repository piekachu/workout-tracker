#!/usr/bin/env python3
"""Adds to collection/catalog.json:
  series[].cat  one of the 9 FIXED categories (from the release name)
  items[].fr    the franchise / "series" the figure comes from (from its name / MS code)
Run again after regenerating the catalogue:  python3 scripts/categorize_catalog.py
Edit the rules below to change a mapping, then re-run."""
import json, re, collections
P = "collection/catalog.json"
CATS = ["Classics", "Classics Revive", "SP", "# Series", "# Series Selection", "# Plus", "CORE", "EX", "SB"]

def category(n):                                   # first match wins
    if re.search(r"Converge EX \d", n): return "EX"
    if re.search(r"Converge SB\d", n): return "SB"
    if re.search(r"Converge SP\b", n): return "SP"
    if "Selection" in n: return "# Series Selection"
    if "Revive" in n: return "Classics Revive"
    if "CORE" in n: return "CORE"
    if "#Plus" in n: return "# Plus"
    if re.search(r"Converge #\d+$", n): return "# Series"
    if "Anniversary" in n and "Webshop" in n: return "CORE"      # Webshop anniversary sets sit with the CORE line
    return "Classics"                                 # vol. 1-20, option sets, limited/event/promo items

FRS = ["Universal Century", "Gundam Wing", "G Gundam", "Gundam X", "Turn A Gundam", "Gundam SEED", "Gundam 00",
       "Gundam AGE", "Iron-Blooded Orphans", "Reconguista in G", "Witch from Mercury", "Gundam Build", "GQuuuuuuX", "SD Gundam", "Other"]
FR_RULES = [  # first match wins; anything unmatched is Universal Century (the bulk of the line)
    ("Universal Century", r"Crossbone|XM-|Blue Destiny|Deep Striker|Semi Striker|MSA-0011|Mk-II"),
    ("GQuuuuuuX", r"\[GQ\]|gMS-|GQuuuuuuX|White Gundam|GFreD"),
    ("Witch from Mercury", r"XVX-|Aerial|Schwarzette|Lfrith"),
    ("Iron-Blooded Orphans", r"ASW-G|EB-05|Barbatos|Bael|Kimaris"),
    ("Reconguista in G", r"YG-111|G-Self|FF-X29A|Hrududu"),
    ("Gundam AGE", r"\bAGE-|Genoace|Gundam AGE"),
    ("Gundam Build", r"BG-011|Beargguy|KUMA-|Grimoire|Superior Dragon|Build "),
    ("SD Gundam", r"Musha Gundam|Knight Gundam"),
    ("Gundam SEED", r"GAT-|ZGMF|ORB-|MBF-|MVF-|MDE|STTS-|LCAM|Destiny|Impulse|Strike|Skygrasper|Freedom|Astray"),
    ("Gundam 00", r"SVMS|Union Flag|\bGN-|GNT-|GNR-|GNX-|CB-0|Qan\[T\]|QAN\[T\]|Gundam Exia|Reborns"),
    ("G Gundam", r"GF13-|JDG-|God Gundam|Master Gundam|Shining Gundam|Devil Gundam"),
    ("Turn A Gundam", r"∀|Turn A|Turn X"),
    ("Gundam X", r"GX-99|GS-9900|G-Falcon|Gundam X|Double X"),
    ("Gundam Wing", r"XXXG-|OZ-|OZX-|Endless Waltz|\(EW\)|Wing Gundam"),
    ("Other", r"Calibarn"),
]
def franchise(name):
    for fr, rx in FR_RULES:
        if re.search(rx, name): return fr
    return "Universal Century"

if __name__ == "__main__":
    c = json.load(open(P))
    for s in c["series"]: s["cat"] = category(s["name"])
    for i in c["items"]: i["fr"] = franchise(i["name"])
    c["categories"], c["franchises"] = CATS, FRS
    json.dump(c, open(P, "w"), ensure_ascii=False, separators=(",", ":"))
    per = collections.Counter(i["s"] for i in c["items"]); cat = collections.Counter()
    for k, s in enumerate(c["series"]): cat[s["cat"]] += per[k]
    print({k: cat[k] for k in CATS}, sum(cat.values()))
    print(dict(collections.Counter(i["fr"] for i in c["items"]).most_common()))
    for fr in FRS[1:-1] + ["Other"]:
        ex = [i["name"] for i in c["items"] if i["fr"] == fr]
        print(f"\n[{fr}] {len(ex)}:", " | ".join(dict.fromkeys(ex))[:900])
