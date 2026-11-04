#!/usr/bin/env python3
"""
Builds the static assets for /drugs/ from scripts/drugs_source.py:

  drugs/data.js        window.DRUGS = [...]  (daily order + computed properties)
  drugs/svg/<id>.svg   2D structure drawings (monochrome, stroke = currentColor
                       so they follow the page's light/dark theme)

Requires RDKit:  pip install rdkit
Run from the repo root:  python3 scripts/build_drugs.py

Safety net: EXPECTED_MW below is each drug's published average molecular weight
(from memory of standard references). The build FAILS if the weight RDKit
computes from a SMILES differs by more than 0.3 -- that catches typos in a
structure before it can be drawn confidently and wrongly.
"""
import json, random, re, sys
from pathlib import Path

from rdkit import Chem
from rdkit.Chem import Crippen, Descriptors, Lipinski, rdMolDescriptors
from rdkit.Chem.Draw import rdMolDraw2D

sys.path.insert(0, str(Path(__file__).resolve().parent))
from drugs_source import DRUGS

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "drugs"
SVG_DIR = OUT / "svg"
SVG_DIR.mkdir(parents=True, exist_ok=True)

EXPECTED_MW = {
    "aspirin": 180.16, "ibuprofen": 206.28, "paracetamol": 151.16, "celecoxib": 381.37, "metformin": 129.16,
    "sitagliptin": 407.31, "empagliflozin": 450.91, "atorvastatin": 558.64, "lisinopril": 405.49, "captopril": 217.29,
    "losartan": 422.91, "amlodipine": 408.88, "metoprolol": 267.36, "propranolol": 259.34, "furosemide": 330.74,
    "hydrochlorothiazide": 297.74, "warfarin": 308.33, "apixaban": 459.50, "clopidogrel": 321.82, "omeprazole": 345.42,
    "ondansetron": 293.37, "salbutamol": 239.31, "loratadine": 382.88, "diphenhydramine": 255.36, "fluoxetine": 309.33,
    "sertraline": 306.23, "diazepam": 284.74, "zolpidem": 307.39, "haloperidol": 375.86, "risperidone": 410.49,
    "methylphenidate": 233.31, "caffeine": 194.19, "nicotine": 162.23, "morphine": 285.34, "naloxone": 327.37,
    "tramadol": 263.38, "lidocaine": 234.34, "ketamine": 237.73, "propofol": 178.27, "gabapentin": 171.24,
    "levetiracetam": 170.21, "phenytoin": 252.27, "carbamazepine": 236.27, "valproate": 144.21, "levodopa": 197.19,
    "sumatriptan": 295.40, "sildenafil": 474.58, "finasteride": 372.55, "levothyroxine": 776.87, "prednisolone": 360.44,
    "dexamethasone": 392.46, "tamoxifen": 371.52, "imatinib": 493.60, "gefitinib": 446.90, "methotrexate": 454.44,
    "fluorouracil": 130.08, "amoxicillin": 365.40, "ciprofloxacin": 331.34, "fluconazole": 306.27, "acyclovir": 225.20,
    "oseltamivir": 312.41, "isoniazid": 137.14, "chloroquine": 319.87, "artemisinin": 282.33, "allopurinol": 136.11,
    "atropine": 289.37, "adenosine": 267.24, "epinephrine": 183.20,
}

def draw_svg(mol):
    d = rdMolDraw2D.MolDraw2DSVG(480, 340)
    o = d.drawOptions()
    o.useBWAtomPalette()
    o.clearBackground = False
    o.bondLineWidth = 2
    o.padding = 0.10
    o.baseFontSize = 0.55
    rdMolDraw2D.PrepareMolForDrawing  # (kept for clarity; DrawMolecule prepares as needed)
    d.DrawMolecule(mol)
    d.FinishDrawing()
    svg = d.GetDrawingText()
    svg = re.sub(r"<\?xml[^>]*\?>\s*", "", svg)
    svg = re.sub(r"<rect[^>]*/>", "", svg, count=1)  # background rect if any
    svg = svg.replace("#000000", "currentColor").replace("#FFFFFF", "none")
    svg = re.sub(r"(<svg[^>]*?)\swidth='[^']*'", r"\1", svg, count=1)
    svg = re.sub(r"(<svg[^>]*?)\sheight='[^']*'", r"\1", svg, count=1)
    return svg

problems, rows = [], []
for d in DRUGS:
    mol = Chem.MolFromSmiles(d["smiles"])
    if mol is None:
        problems.append(f"{d['id']}: SMILES did not parse"); continue
    mw = Descriptors.MolWt(mol)
    exp = EXPECTED_MW.get(d["id"])
    if exp is None:
        problems.append(f"{d['id']}: no EXPECTED_MW entry")
    elif abs(mw - exp) > 0.3:
        problems.append(f"{d['id']}: MW {mw:.2f} != expected {exp}  (formula {rdMolDescriptors.CalcMolFormula(mol)})")
    centers = Chem.FindMolChiralCenters(mol, includeUnassigned=True, useLegacyImplementation=False)
    hbd, hba = Lipinski.NumHDonors(mol), Lipinski.NumHAcceptors(mol)
    logp = Crippen.MolLogP(mol)
    ro5 = sum([mw > 500, logp > 5, hbd > 5, hba > 10])
    row = dict(d)
    row.update(
        formula=rdMolDescriptors.CalcMolFormula(mol), mw=round(mw, 2), logp=round(logp, 2), hbd=hbd, hba=hba,
        tpsa=round(rdMolDescriptors.CalcTPSA(mol), 1), rotb=rdMolDescriptors.CalcNumRotatableBonds(mol),
        ro5=ro5, stereo=len([c for c in centers if c[1] != "?"]),
        cip="".join(sorted(c[1] for c in centers)) if centers else "",
    )
    (SVG_DIR / f"{d['id']}.svg").write_text(draw_svg(mol), encoding="utf-8")
    rows.append(row)

if problems:
    print("BUILD FAILED:\n  " + "\n  ".join(problems)); sys.exit(1)

# Daily order: seeded shuffle (stable between builds) with Aspirin as day 1.
rng = random.Random(7)
first = [r for r in rows if r["id"] == "aspirin"]
rest = [r for r in rows if r["id"] != "aspirin"]
rng.shuffle(rest)
ordered = first + rest

(OUT / "data.js").write_text(
    "// GENERATED by scripts/build_drugs.py from scripts/drugs_source.py -- edit the source, not this file.\n"
    "window.DRUGS = " + json.dumps(ordered, ensure_ascii=False, indent=1) + ";\n", encoding="utf-8")
print(f"OK: {len(ordered)} drugs -> drugs/data.js + drugs/svg/")
for r in ordered:
    print(f"  {r['id']:20s} {r['formula']:16s} MW {r['mw']:7.2f}  stereo {r['stereo']} {r['cip']}")
