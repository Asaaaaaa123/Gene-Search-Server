#!/usr/bin/env python3
"""Regenerate backend/ontology_publication_themes.py from t_GO_publication.py THEMES."""
from __future__ import annotations

import ast
import sys
from pathlib import Path

DEFAULT_SOURCE = Path("/home/asa/Desktop/t_go_test/t_GO_publication.py")
REPO_BACKEND = Path(__file__).resolve().parent.parent
OUT = REPO_BACKEND / "ontology_publication_themes.py"


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    if not src.is_file():
        print(f"Source not found: {src}", file=sys.stderr)
        sys.exit(1)

    mod = ast.parse(src.read_text(encoding="utf-8"))
    themes_node = None
    for n in mod.body:
        if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name) and n.target.id == "THEMES":
            themes_node = ast.literal_eval(n.value)
            break
    if themes_node is None:
        print("Could not find THEMES in source", file=sys.stderr)
        sys.exit(1)

    lines = [
        f"# Auto-generated from {src} THEMES.",
        "# Regenerate: python3 backend/scripts/regenerate_publication_themes.py [path/to/t_GO_publication.py]",
        "from __future__ import annotations",
        "from typing import Dict, FrozenSet, List",
        "",
        "PUBLICATION_THEME_KEYWORDS: Dict[str, List[str]] = {",
    ]
    for k in themes_node.keys():
        lines.append(f"    {k!r}: [")
        for kw in themes_node[k]["keywords"]:
            lines.append(f"        {kw!r},")
        lines.append("    ],")
    lines.append("}")
    lines.append("")
    lines.append("# Mirrors THEMES[...][\"enabled\"] is True in source file")
    lines.append("PUBLICATION_DEFAULT_ENABLED_THEME_NAMES: FrozenSet[str] = frozenset(")
    lines.append("    {")
    for k, v in themes_node.items():
        if v.get("enabled") is True:
            lines.append(f"        {k!r},")
    lines.append("    }")
    lines.append(")")
    lines.append("")
    lines.append(
        "# Extra themes for Customize Theme UI only (not in t_GO_publication THEMES)."
    )
    lines.append("UI_ONTOLOGY_THEME_KEYWORDS: Dict[str, List[str]] = {")
    ui = {
        "Membrane & Cell Surface": [
            "membrane",
            "plasma membrane",
            "cell surface",
            "membrane protein",
            "transmembrane",
            "integral membrane",
            "membrane transport",
            "ion channel",
        ],
        "Nucleus & Nuclear Processes": [
            "nucleus",
            "nuclear",
            "chromatin",
            "dna",
            "rna",
            "transcription",
            "nucleolus",
            "nuclear envelope",
            "nuclear pore",
            "chromosome",
        ],
        "Cytoplasm & Cytoskeleton": [
            "cytoplasm",
            "cytoskeleton",
            "microtubule",
            "actin",
            "intermediate filament",
            "microfilament",
            "centrosome",
            "centriole",
            "cilium",
            "flagellum",
        ],
        "Mitochondria & Energy": [
            "mitochondria",
            "mitochondrial",
            "atp",
            "energy",
            "respiration",
            "electron transport",
            "oxidative phosphorylation",
            "krebs cycle",
        ],
        "Endoplasmic Reticulum & Golgi": [
            "endoplasmic reticulum",
            "er",
            "golgi",
            "golgi apparatus",
            "vesicle",
            "secretory",
            "protein folding",
            "glycosylation",
            "trafficking",
        ],
    }
    for k, kws in ui.items():
        lines.append(f"    {k!r}: [")
        for kw in kws:
            lines.append(f"        {kw!r},")
        lines.append("    ],")
    lines.append("}")
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
