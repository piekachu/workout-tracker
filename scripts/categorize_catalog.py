#!/usr/bin/env python3
"""Adds a product-line "cat" to every series in collection/catalog.json, from the series name.
Run again after regenerating the catalogue:  python3 scripts/categorize_catalog.py"""
import json, re, collections
P = "collection/catalog.json"
RULES = [  # first match wins
    ("EX series",            r"Converge EX \d"),
    ("SB (Webshop)",         r"Converge SB\d"),
    ("CORE",                 r"CORE"),
    ("SP",                   r"Converge SP\b"),
    ("# Plus",               r"Converge #Plus"),
    ("Anniversary sets",     r"Anniversary"),
    ("Vol. series",          r"Converge vol\. \d"),
    ("# series",             r"Converge #\d+$"),
    ("Selection",            r"Selection"),
    ("Operation & option sets", r"Operation|Option|Revive|Jaburo|White Base|Wing of Light|Heavygun"),
    ("Promo & events",       r"promotional|Promotional|Magazine|ticket|Ticket|screening|Screening|Exhibition|exhibition|Complete Book|Blu-Ray|Advance"),
    ("Limited & exclusives", r"Limited|Exclusive|GFT|7-Eleven|Gold Edition|Caf|Factory|Fan ?[Cc]lub|Destiny Gundam"),
]
c = json.load(open(P))
for s in c["series"]:
    s["cat"] = next((n for n, rx in RULES if re.search(rx, s["name"])), "Other")
json.dump(c, open(P, "w"), ensure_ascii=False, separators=(",", ":"))
cnt = collections.Counter(); per = collections.Counter(i["s"] for i in c["items"])
for i, s in enumerate(c["series"]): cnt[s["cat"]] += per[i]
for k, v in cnt.most_common(): print(f"{v:4d}  {k}")
print([s["name"] for s in c["series"] if s["cat"] == "Other"])
