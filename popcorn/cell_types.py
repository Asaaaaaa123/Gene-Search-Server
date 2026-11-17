#!/usr/bin/env python3
"""
cell_types.py
=============
[APP] Added 2026-11-16: the tissue of a dataset and its cell types, detected from the data, so that a project of any
tissue (brain, liver, kidney, a tumor, ...) gets gene signatures that fit it instead of the manuscript's bone ones.

  CELL_TYPES     a library of cell types, each with lineage-restricted marker genes (core) and a wider scored list
                 (extended). Generic types (endothelium, fibroblast, immune cells, ...) occur in any tissue; the others
                 belong to one tissue. Gene names are mouse symbols; "Mouse|HUMAN" gives the other species' symbol where it
                 is not the same name in another case (Lyz2|LYZ). Names are matched exactly, then in any case.
  TISSUES        the tissues the library knows, each with its hallmark cell types (the parenchyma that makes it that
                 tissue).
  detect(...)    which cell types are present in a dataset: a cell type is present when its core markers are
                 co-expressed (their mean pairwise correlation across units) far beyond random gene sets of the same
                 detection rates. The tissue is the one whose hallmark cell types are present and cover the most units.
  tissue_config(...)  the configuration changes that give a project the detected cell types as its signatures (or the
                 manuscript's signatures when the tissue is bone).

The markers are canonical ones from the literature (PanglaoDB, CellMarker, the Tabula Muris / Tabula Sapiens and
Allen Brain atlases). The detection only decides which of them to use; the analysis itself (scores, positivity calls,
the tissue assignment, Leiden domains) is unchanged.
"""
from __future__ import annotations

import copy
import math

import numpy as np
from scipy import sparse

# ============================================================================
# THE LIBRARY
# ============================================================================
# class -> color of the tissue classes (Figure 3a style legend)
CLASS_COLORS = {
    "neuron": "#1F77B4", "glia": "#2CA02C", "vascular": "#17BECF", "stroma": "#E6AB02", "immune": "#FF7F00",
    "blood": "#A65628", "epithelium": "#E377C2", "parenchyma": "#9467BD", "muscle": "#8C564B",
    "proliferating": "#D62728", "pigment": "#7F7F7F", "adipose": "#FFD92F", "germline": "#BCBD22",
    "endocrine": "#AEC7E8", "bone lineage": "#984EA3", "chondrocyte": "#33A02C", "hematopoietic marrow": "#FF7F00",
}

# One entry per cell type: label, class, tissues ([] = any tissue), core (lineage-restricted: detection uses these, and
# a positivity call needs scoring.min_core of them), extended (the genes scored), competes (closely related types: a bin
# scoring higher on one of them is not called positive for this one).
CELL_TYPES: dict[str, dict] = {
    # ---- generic: found in many tissues ---------------------------------------------------------------------------
    "endothelium": {"label": "endothelium", "class": "vascular", "tissues": [],
                    "core": ["Pecam1", "Cdh5", "Emcn", "Kdr", "Tek"],
                    "extended": ["Pecam1", "Cdh5", "Emcn", "Kdr", "Tek", "Flt1", "Cldn5", "Ptprb", "Egfl7"]},
    "fibroblast": {"label": "fibroblast", "class": "stroma", "tissues": [],
                   "core": ["Dcn", "Lum", "Pdgfra", "Col1a2", "Col3a1"],
                   "extended": ["Dcn", "Lum", "Pdgfra", "Col1a1", "Col1a2", "Col3a1", "Fbln1", "Pdgfrb", "Mfap5"]},
    "smooth_muscle": {"label": "smooth muscle", "class": "muscle", "tissues": [],
                      "core": ["Myh11", "Cnn1", "Acta2", "Tagln", "Des"],
                      "extended": ["Myh11", "Cnn1", "Acta2", "Tagln", "Des", "Myl9", "Lmod1", "Synpo2"]},
    "pericyte": {"label": "pericyte", "class": "vascular", "tissues": [],
                 "core": ["Rgs5", "Kcnj8", "Abcc9", "Vtn", "Higd1b"],
                 "extended": ["Rgs5", "Kcnj8", "Abcc9", "Vtn", "Higd1b", "Pdgfrb", "Cspg4", "Notch3"],
                 "competes": ["smooth_muscle"]},
    "macrophage": {"label": "macrophage", "class": "immune", "tissues": [],
                   "core": ["C1qa", "C1qb", "C1qc", "Cd68", "Csf1r"],
                   "extended": ["C1qa", "C1qb", "C1qc", "Cd68", "Csf1r", "Adgre1", "Mrc1", "Ms4a7", "Lyz2|LYZ",
                                "Cd14", "Fcgr1|FCGR1A"],
                   "competes": ["microglia", "kupffer_cell"]},
    "neutrophil": {"label": "neutrophil", "class": "immune", "tissues": [],
                   "core": ["S100a8", "S100a9", "Csf3r", "Retnlg", "FCGR3B"],
                   "extended": ["S100a8", "S100a9", "Csf3r", "Retnlg", "FCGR3B", "Cxcr2", "Lcn2", "Mmp8", "Il1r2"]},
    "t_cell": {"label": "T cell", "class": "immune", "tissues": [],
               "core": ["Cd3e", "Cd3d", "Cd3g", "Cd2", "Cd247"],
               "extended": ["Cd3e", "Cd3d", "Cd3g", "Cd2", "Cd247", "Lck", "Il7r", "Cd4", "Cd8a", "Trac"]},
    "b_cell": {"label": "B cell", "class": "immune", "tissues": [],
               "core": ["Cd79a", "Cd79b", "Cd19", "Ms4a1", "Pax5"],
               "extended": ["Cd79a", "Cd79b", "Cd19", "Ms4a1", "Pax5", "Cd22", "Bank1", "Fcrla", "Cr2"]},
    "plasma_cell": {"label": "plasma cell", "class": "immune", "tissues": [],
                    "core": ["Jchain", "Mzb1", "Tnfrsf17", "Derl3", "Igkc"],
                    "extended": ["Jchain", "Mzb1", "Tnfrsf17", "Derl3", "Igkc", "Xbp1", "Sdc1", "Prdm1"],
                    "competes": ["b_cell"]},
    "nk_cell": {"label": "NK cell", "class": "immune", "tissues": [],
                "core": ["Ncr1", "Klrd1", "Nkg7", "Gzma", "Klrb1c|KLRF1"],
                "extended": ["Ncr1", "Klrd1", "Nkg7", "Gzma", "Gzmb", "Prf1", "Klrb1c|KLRF1", "Klrk1"],
                "competes": ["t_cell"]},
    "dendritic_cell": {"label": "dendritic cell", "class": "immune", "tissues": [],
                       "core": ["Flt3", "Clec9a", "Xcr1", "Itgax", "Ccr7"],
                       "extended": ["Flt3", "Clec9a", "Xcr1", "Itgax", "Ccr7", "Fscn1", "Cd86", "Zbtb46"],
                       "competes": ["macrophage"]},
    "mast_cell": {"label": "mast cell", "class": "immune", "tissues": [],
                  "core": ["Cpa3", "Kit", "Ms4a2", "Mcpt4|TPSAB1", "Cma1"],
                  "extended": ["Cpa3", "Kit", "Ms4a2", "Mcpt4|TPSAB1", "Cma1", "Tpsb2", "Hdc", "Fcer1a"]},
    "erythroid": {"label": "erythroid", "class": "blood", "tissues": [],
                  "core": ["Hba-a1|HBA1", "Hbb-bs|HBB", "Alas2", "Hba-a2|HBA2"],
                  "extended": ["Hba-a1|HBA1", "Hba-a2|HBA2", "Hbb-bs|HBB", "Hbb-bt", "Alas2", "Slc4a1", "Gypa",
                               "Klf1"]},
    "adipocyte": {"label": "adipocyte", "class": "adipose", "tissues": [],
                  "core": ["Adipoq", "Plin1", "Cidec", "Lep"],
                  "extended": ["Adipoq", "Plin1", "Cidec", "Lep", "Cfd", "Plin4", "Lipe", "Pparg", "Fabp4"]},
    "cycling": {"label": "proliferating cells", "class": "proliferating", "tissues": [],
                "core": ["Mki67", "Top2a", "Cenpf", "Birc5", "Ube2c"],
                "extended": ["Mki67", "Top2a", "Cenpf", "Birc5", "Ube2c", "Tpx2", "Nusap1", "Cdk1", "Ccnb1"]},
    # simple epithelia and carcinoma cells
    "epithelial": {"label": "epithelial / carcinoma", "class": "epithelium", "tissues": [],
                   "core": ["Epcam", "Krt8", "Krt18", "Krt19", "Cldn4"],
                   "extended": ["Epcam", "Krt8", "Krt18", "Krt19", "Cldn4", "Cldn7", "Cdh1", "Elf3"]},
    "melanocyte": {"label": "melanocyte / melanoma", "class": "pigment", "tissues": [],
                   "core": ["Pmel", "Mlana", "Tyrp1", "Dct", "Tyr"],
                   "extended": ["Pmel", "Mlana", "Tyrp1", "Dct", "Tyr", "Mitf", "S100b"]},
    "skeletal_muscle": {"label": "skeletal muscle", "class": "muscle", "tissues": [],
                        "core": ["Acta1", "Mylpf", "Tnnt3", "Tnnc2", "Myh1", "Atp2a1"],
                        "extended": ["Acta1", "Mylpf", "Tnnt3", "Tnnc2", "Myh1", "Atp2a1", "Ckm", "Myl1", "Tnni2"]},
    "nerve": {"label": "peripheral nerve (Schwann)", "class": "glia", "tissues": [],
              "core": ["Mpz", "Prx", "Ncmap", "Drp2"],
              "extended": ["Mpz", "Prx", "Ncmap", "Drp2", "Pmp22", "Sox10", "S100b"],
              "competes": ["oligodendrocyte"]},

    # ---- brain and spinal cord ------------------------------------------------------------------------------------
    "excitatory_neuron": {"label": "excitatory neuron", "class": "neuron", "tissues": ["brain"],
                          "core": ["Slc17a7", "Slc17a6", "Neurod6", "Satb2", "Tbr1"],
                          "extended": ["Slc17a7", "Slc17a6", "Neurod6", "Satb2", "Tbr1", "Camk2a", "Snap25", "Syt1"],
                          "competes": ["inhibitory_neuron"]},
    "inhibitory_neuron": {"label": "inhibitory neuron", "class": "neuron", "tissues": ["brain"],
                          "core": ["Gad1", "Gad2", "Slc32a1", "Dlx6os1|DLX6-AS1"],
                          "extended": ["Gad1", "Gad2", "Slc32a1", "Dlx6os1|DLX6-AS1", "Sst", "Vip", "Lhx6", "Snap25"]},
    "neuron": {"label": "neuron", "class": "neuron", "tissues": ["brain"],
               "core": ["Snap25", "Syt1", "Rbfox3", "Stmn2", "Syp"],
               "extended": ["Snap25", "Syt1", "Rbfox3", "Stmn2", "Syp", "Uchl1", "Nefl", "Eno2"],
               "detect_only": True},   # pan-neuronal: the tissue's hallmark, scored through the two neuron types
    "astrocyte": {"label": "astrocyte", "class": "glia", "tissues": ["brain"],
                  "core": ["Gfap", "Aqp4", "Aldh1l1", "Slc1a3", "Slc1a2"],
                  "extended": ["Gfap", "Aqp4", "Aldh1l1", "Slc1a3", "Slc1a2", "Gja1", "Aldoc", "Sox9", "Fgfr3"]},
    "oligodendrocyte": {"label": "oligodendrocyte", "class": "glia", "tissues": ["brain"],
                        "core": ["Mog", "Mobp", "Mag", "Plp1", "Mbp"],
                        "extended": ["Mog", "Mobp", "Mag", "Plp1", "Mbp", "Cldn11", "Cnp", "Opalin", "St18"]},
    "opc": {"label": "oligodendrocyte precursor", "class": "glia", "tissues": ["brain"],
            "core": ["Pdgfra", "Olig1", "Olig2", "Lhfpl3", "Cspg4"],
            "extended": ["Pdgfra", "Olig1", "Olig2", "Lhfpl3", "Cspg4", "Vcan", "Ptprz1", "Gpr17"],
            "competes": ["oligodendrocyte"]},
    "microglia": {"label": "microglia", "class": "immune", "tissues": ["brain"],
                  "core": ["P2ry12", "Tmem119", "Cx3cr1", "Sall1", "Hexb"],
                  "extended": ["P2ry12", "Tmem119", "Cx3cr1", "Sall1", "Hexb", "Csf1r", "C1qa", "Trem2", "Siglech"]},
    "ependymal": {"label": "ependymal", "class": "glia", "tissues": ["brain"],
                  "core": ["Foxj1", "Ccdc153", "Tmem212", "Dynlrb2"],
                  "extended": ["Foxj1", "Ccdc153", "Tmem212", "Dynlrb2", "Rarres2", "Sntn"]},
    "choroid_plexus": {"label": "choroid plexus", "class": "glia", "tissues": ["brain"],
                       "core": ["Ttr", "Kl", "Folr1", "Kcnj13", "Clic6"],
                       "extended": ["Ttr", "Kl", "Folr1", "Kcnj13", "Clic6", "Otx2", "Sostdc1"]},

    # ---- heart ----------------------------------------------------------------------------------------------------
    "cardiomyocyte": {"label": "cardiomyocyte", "class": "muscle", "tissues": ["heart"],
                      "core": ["Tnni3", "Tnnt2", "Actc1", "Myl2", "Ryr2"],
                      "extended": ["Tnni3", "Tnnt2", "Actc1", "Myl2", "Ryr2", "Myh6", "Myh7", "Nppa", "Nppb", "Myl7",
                                   "Pln", "Mb"]},

    # ---- lung -----------------------------------------------------------------------------------------------------
    "alveolar_type2": {"label": "alveolar type 2", "class": "epithelium", "tissues": ["lung"],
                       "core": ["Sftpc", "Sftpb", "Sftpa1|SFTPA1", "Lamp3", "Napsa"],
                       "extended": ["Sftpc", "Sftpb", "Sftpa1|SFTPA1", "Lamp3", "Napsa", "Sftpd", "Slc34a2", "Abca3"]},
    "alveolar_type1": {"label": "alveolar type 1", "class": "epithelium", "tissues": ["lung"],
                       "core": ["Ager", "Rtkn2", "Hopx", "Emp2", "Clic5"],
                       "extended": ["Ager", "Rtkn2", "Hopx", "Emp2", "Clic5", "Aqp5", "Pdpn", "Cav1"]},
    "club_cell": {"label": "club cell", "class": "epithelium", "tissues": ["lung"],
                  "core": ["Scgb1a1", "Scgb3a2", "Cyp2f2|CYP2F1", "Bpifa1"],
                  "extended": ["Scgb1a1", "Scgb3a2", "Cyp2f2|CYP2F1", "Bpifa1", "Cbr2", "Hp"]},
    "ciliated_cell": {"label": "ciliated cell", "class": "epithelium", "tissues": ["lung"],
                      "core": ["Foxj1", "Tppp3", "Dynlrb2", "Rsph1", "Ccdc153"],
                      "extended": ["Foxj1", "Tppp3", "Dynlrb2", "Rsph1", "Ccdc153", "Cdhr3", "Sntn"]},

    # ---- liver ----------------------------------------------------------------------------------------------------
    "hepatocyte": {"label": "hepatocyte", "class": "parenchyma", "tissues": ["liver"],
                   "core": ["Alb", "Apoh", "Ahsg", "Fgb", "Serpina1a|SERPINA1"],
                   "extended": ["Alb", "Apoh", "Ahsg", "Fgb", "Serpina1a|SERPINA1", "Cyp2e1", "Apoa1", "Apoc3",
                                "Ttr", "Ass1"]},
    "kupffer_cell": {"label": "Kupffer cell", "class": "immune", "tissues": ["liver"],
                     "core": ["Clec4f", "Vsig4", "Cd5l", "Marco", "Timd4"],
                     "extended": ["Clec4f", "Vsig4", "Cd5l", "Marco", "Timd4", "C1qa", "Cd68"]},
    "hepatic_stellate": {"label": "hepatic stellate", "class": "stroma", "tissues": ["liver"],
                         "core": ["Lrat", "Reln", "Colec11", "Hgf", "Hand2"],
                         "extended": ["Lrat", "Reln", "Colec11", "Hgf", "Hand2", "Dcn", "Ecm1"],
                         "competes": ["fibroblast"]},
    "cholangiocyte": {"label": "cholangiocyte", "class": "epithelium", "tissues": ["liver"],
                      "core": ["Krt19", "Krt7", "Sox9", "Epcam", "Cftr"],
                      "extended": ["Krt19", "Krt7", "Sox9", "Epcam", "Cftr", "Spp1", "Hnf1b"]},

    # ---- kidney ---------------------------------------------------------------------------------------------------
    "podocyte": {"label": "podocyte", "class": "epithelium", "tissues": ["kidney"],
                 "core": ["Nphs1", "Nphs2", "Ptpro", "Synpo"],
                 "extended": ["Nphs1", "Nphs2", "Ptpro", "Synpo", "Podxl", "Wt1", "Mafb"]},
    "proximal_tubule": {"label": "proximal tubule", "class": "epithelium", "tissues": ["kidney"],
                        "core": ["Lrp2", "Slc34a1", "Cubn", "Slc5a12", "Slc22a6"],
                        "extended": ["Lrp2", "Slc34a1", "Cubn", "Slc5a12", "Slc22a6", "Kap", "Gatm", "Fbp1",
                                     "Aldob"]},
    "loop_of_henle": {"label": "loop of Henle", "class": "epithelium", "tissues": ["kidney"],
                      "core": ["Umod", "Slc12a1", "Kcnj1", "Cldn16"],
                      "extended": ["Umod", "Slc12a1", "Kcnj1", "Cldn16", "Ptgs2", "Egf"]},
    "distal_tubule": {"label": "distal tubule", "class": "epithelium", "tissues": ["kidney"],
                      "core": ["Slc12a3", "Calb1", "Trpm6", "Pvalb"],
                      "extended": ["Slc12a3", "Calb1", "Trpm6", "Pvalb", "Klhl3"]},
    "collecting_duct": {"label": "collecting duct", "class": "epithelium", "tissues": ["kidney"],
                        "core": ["Aqp2", "Aqp3", "Fxyd4", "Hsd11b2", "Scnn1g"],
                        "extended": ["Aqp2", "Aqp3", "Fxyd4", "Hsd11b2", "Scnn1g", "Atp6v1g3", "Atp6v0d2"]},

    # ---- small intestine and colon --------------------------------------------------------------------------------
    "enterocyte": {"label": "enterocyte", "class": "epithelium", "tissues": ["intestine"],
                   "core": ["Fabp2", "Apoa4", "Alpi", "Sis|SI", "Fabp6"],
                   "extended": ["Fabp2", "Apoa4", "Alpi", "Sis|SI", "Fabp6", "Vil1", "Rbp2", "Lct"]},
    "colonocyte": {"label": "colonocyte", "class": "epithelium", "tissues": ["intestine"],
                   "core": ["Car1", "Slc26a3", "Aqp8", "Guca2b", "Car4"],
                   "extended": ["Car1", "Slc26a3", "Aqp8", "Guca2b", "Car4", "Vil1", "Ceacam1"]},
    "goblet_cell": {"label": "goblet cell", "class": "epithelium", "tissues": ["intestine"],
                    "core": ["Muc2", "Tff3", "Clca1", "Fcgbp", "Zg16"],
                    "extended": ["Muc2", "Tff3", "Clca1", "Fcgbp", "Zg16", "Spink4", "Agr2"]},
    "paneth_cell": {"label": "Paneth cell", "class": "epithelium", "tissues": ["intestine"],
                    "core": ["Lyz1", "Defa24", "Ang4", "Mptx2", "DEFA5", "DEFA6"],
                    "extended": ["Lyz1", "Defa24", "Ang4", "Mptx2", "Itln1", "DEFA5", "DEFA6", "REG3A"]},
    "intestinal_stem": {"label": "intestinal stem cell", "class": "epithelium", "tissues": ["intestine"],
                        "core": ["Lgr5", "Olfm4", "Ascl2", "Smoc2"],
                        "extended": ["Lgr5", "Olfm4", "Ascl2", "Smoc2", "Sox9"]},
    "enteroendocrine": {"label": "enteroendocrine", "class": "endocrine", "tissues": ["intestine"],
                        "core": ["Chga", "Chgb", "Tph1", "Pyy", "Neurod1"],
                        "extended": ["Chga", "Chgb", "Tph1", "Pyy", "Neurod1", "Gcg", "Cck"]},

    # ---- stomach --------------------------------------------------------------------------------------------------
    "gastric_pit": {"label": "gastric pit cell", "class": "epithelium", "tissues": ["stomach"],
                    "core": ["Gkn1", "Gkn2", "Tff1", "Muc5ac"],
                    "extended": ["Gkn1", "Gkn2", "Tff1", "Muc5ac", "Tff2"]},
    "parietal_cell": {"label": "parietal cell", "class": "epithelium", "tissues": ["stomach"],
                      "core": ["Atp4a", "Atp4b", "Gif|CBLIF"],
                      "extended": ["Atp4a", "Atp4b", "Gif|CBLIF", "Kcne2"]},
    "chief_cell": {"label": "chief cell", "class": "epithelium", "tissues": ["stomach"],
                   "core": ["Pgc", "Lipf", "Pga5|PGA3", "Chia1|CHIA"],
                   "extended": ["Pgc", "Lipf", "Pga5|PGA3", "Chia1|CHIA", "Clps"]},

    # ---- pancreas -------------------------------------------------------------------------------------------------
    "acinar": {"label": "acinar", "class": "parenchyma", "tissues": ["pancreas"],
               "core": ["Cpa1", "Prss2|PRSS1", "Cela3b|CELA3A", "Ctrb1", "Pnlip"],
               "extended": ["Cpa1", "Prss2|PRSS1", "Cela3b|CELA3A", "Ctrb1", "Pnlip", "Cel", "Cpb1", "Try4"]},
    "islet_endocrine": {"label": "islet endocrine", "class": "endocrine", "tissues": ["pancreas"],
                        "core": ["Ins1|INS", "Ins2", "Gcg", "Iapp", "Ppy", "Pcsk1"],
                        "extended": ["Ins1|INS", "Ins2", "Gcg", "Iapp", "Ppy", "Pcsk1", "Sst", "Chga", "Nkx6-1"]},
    "pancreatic_duct": {"label": "pancreatic duct", "class": "epithelium", "tissues": ["pancreas"],
                        "core": ["Krt19", "Cftr", "Sox9", "Spp1", "Krt7"],
                        "extended": ["Krt19", "Cftr", "Sox9", "Spp1", "Krt7", "Hnf1b"]},

    # ---- lymphoid organs ------------------------------------------------------------------------------------------
    "germinal_center_b": {"label": "germinal-center B cell", "class": "immune", "tissues": ["lymphoid"],
                          "core": ["Aicda", "Rgs13", "Mef2b", "S1pr2"],
                          "extended": ["Aicda", "Rgs13", "Mef2b", "S1pr2", "Gcsam", "Bcl6"],
                          "competes": ["b_cell"]},
    "fibroblastic_reticular": {"label": "fibroblastic reticular cell", "class": "stroma", "tissues": ["lymphoid"],
                               "core": ["Ccl19", "Ccl21a|CCL21", "Ch25h"],
                               "extended": ["Ccl19", "Ccl21a|CCL21", "Ch25h", "Pdpn", "Grem1"],
                               "competes": ["fibroblast"]},
    "thymocyte": {"label": "thymocyte", "class": "immune", "tissues": ["thymus"],
                  "core": ["Rag1", "Dntt", "Rag2", "Ptcra"],
                  "extended": ["Rag1", "Dntt", "Rag2", "Ptcra", "Cd8b1|CD8B", "Cd4", "Cd3e"],
                  "competes": ["t_cell"]},
    "thymic_epithelium": {"label": "thymic epithelium", "class": "epithelium", "tissues": ["thymus"],
                          "core": ["Foxn1", "Psmb11", "Prss16", "Ly75"],
                          "extended": ["Foxn1", "Psmb11", "Prss16", "Ly75", "Krt8", "Krt5"]},

    # ---- skin -----------------------------------------------------------------------------------------------------
    "keratinocyte_basal": {"label": "basal keratinocyte", "class": "epithelium", "tissues": ["skin"],
                           "core": ["Krt5", "Krt14", "Krt15", "Col17a1"],
                           "extended": ["Krt5", "Krt14", "Krt15", "Col17a1", "Trp63", "Krt17"]},
    "keratinocyte_differentiated": {"label": "differentiated keratinocyte", "class": "epithelium",
                                    "tissues": ["skin"],
                                    "core": ["Krt10", "Krt1", "Lor", "Ivl", "Krtdap"],
                                    "extended": ["Krt10", "Krt1", "Lor", "Ivl", "Krtdap", "Sbsn", "Dmkn"]},

    # ---- breast ---------------------------------------------------------------------------------------------------
    "mammary_luminal": {"label": "mammary luminal", "class": "epithelium", "tissues": ["breast"],
                        "core": ["Esr1", "Pgr", "Prlr", "Ankrd30a", "Foxa1"],
                        "extended": ["Esr1", "Pgr", "Prlr", "Ankrd30a", "Foxa1", "Krt8", "Krt18", "Areg", "Tff1"]},
    "mammary_basal": {"label": "mammary basal / myoepithelial", "class": "epithelium", "tissues": ["breast"],
                      "core": ["Krt5", "Krt14", "Krt17", "Oxtr", "Trp63"],
                      "extended": ["Krt5", "Krt14", "Krt17", "Oxtr", "Trp63", "Acta2", "Myh11"]},
    "mammary_secretory": {"label": "mammary secretory (milk)", "class": "epithelium", "tissues": ["breast"],
                          "core": ["Csn2", "Csn3", "Wap", "Lalba"],
                          "extended": ["Csn2", "Csn3", "Wap", "Lalba", "Csn1s1"]},

    # ---- prostate -------------------------------------------------------------------------------------------------
    "prostate_luminal": {"label": "prostate luminal", "class": "epithelium", "tissues": ["prostate"],
                         "core": ["KLK3", "Msmb", "Acpp|ACP3", "Nkx3-1", "Pbsn", "Sbp"],
                         "extended": ["KLK3", "KLK2", "Msmb", "Acpp|ACP3", "Nkx3-1", "Pbsn", "Sbp", "Tmprss2"]},

    # ---- testis and ovary -----------------------------------------------------------------------------------------
    "spermatid": {"label": "spermatid", "class": "germline", "tissues": ["testis"],
                  "core": ["Prm1", "Prm2", "Tnp1", "Tnp2"],
                  "extended": ["Prm1", "Prm2", "Tnp1", "Tnp2", "Acrv1", "Spaca1"]},
    "spermatocyte": {"label": "spermatocyte", "class": "germline", "tissues": ["testis"],
                     "core": ["Sycp3", "Sycp1", "Piwil1", "Hormad1"],
                     "extended": ["Sycp3", "Sycp1", "Piwil1", "Hormad1", "Ddx4"]},
    "sertoli": {"label": "Sertoli cell", "class": "parenchyma", "tissues": ["testis"],
                "core": ["Amh", "Wt1", "Dhh", "Sox9"],
                "extended": ["Amh", "Wt1", "Dhh", "Sox9", "Cldn11", "Inha"]},
    "leydig": {"label": "Leydig cell", "class": "endocrine", "tissues": ["testis"],
               "core": ["Cyp17a1", "Star", "Insl3", "Cyp11a1", "Hsd3b1|HSD3B2"],
               "extended": ["Cyp17a1", "Star", "Insl3", "Cyp11a1", "Hsd3b1|HSD3B2"]},
    "granulosa": {"label": "granulosa cell", "class": "parenchyma", "tissues": ["ovary"],
                  "core": ["Amh", "Inha", "Cyp19a1", "Foxl2", "Fshr"],
                  "extended": ["Amh", "Inha", "Cyp19a1", "Foxl2", "Fshr", "Nr5a2"]},

    # ---- bone and marrow (detection; a bone project uses the manuscript's signatures) -----------------------------
    "osteoblast": {"label": "osteoblast", "class": "bone lineage", "tissues": ["bone"],
                   "core": ["Sp7", "Ibsp", "Alpl", "Runx2"],
                   "extended": ["Sp7", "Ibsp", "Alpl", "Runx2", "Bglap", "Col1a1"]},
    "osteocyte": {"label": "osteocyte", "class": "bone lineage", "tissues": ["bone"],
                  "core": ["Sost", "Dmp1", "Mepe"],
                  "extended": ["Sost", "Dmp1", "Mepe", "Fgf23", "Pdpn"]},
    "osteoclast": {"label": "osteoclast", "class": "bone lineage", "tissues": ["bone"],
                   "core": ["Acp5", "Ctsk", "Calcr", "Atp6v0d2", "Dcstamp", "Ocstamp"],
                   "extended": ["Acp5", "Ctsk", "Calcr", "Mmp9", "Atp6v0d2", "Dcstamp", "Ocstamp", "Nfatc1"]},
    # cartilage collagens (Col10a1 and Comp are also cancer-associated fibroblast genes, so they are not core)
    "chondrocyte": {"label": "chondrocyte", "class": "chondrocyte", "tissues": ["bone"],
                    "core": ["Col2a1", "Col9a1", "Col9a2", "Matn3", "Col11a2"],
                    "extended": ["Col2a1", "Col9a1", "Col9a2", "Matn3", "Col11a2", "Acan", "Col10a1", "Sox9"]},
    "marrow_granulocyte": {"label": "marrow granulocyte", "class": "hematopoietic marrow", "tissues": ["bone"],
                           "core": ["Ngp", "Ltf", "Camp", "Mpo", "Elane", "Ctsg"],
                           "extended": ["Ngp", "Ltf", "Camp", "Mpo", "Elane", "Ctsg", "Chil3", "Lcn2"],
                           "competes": ["neutrophil"]},
    "megakaryocyte": {"label": "megakaryocyte", "class": "hematopoietic marrow", "tissues": ["bone"],
                      "core": ["Pf4", "Itga2b", "Gp9", "Gp1bb", "Ppbp"],
                      "extended": ["Pf4", "Itga2b", "Gp9", "Gp1bb", "Ppbp", "Vwf"]},
}

# tissue -> label and hallmark cell types (the tissue's parenchyma; the tissue is scored on these). Accessory tissues
# (muscle, fat, lymphoid tissue) accompany organs in most sections (the muscle around a bone, the fat of a breast or a
# kidney, lymphoid aggregates in a tumor): one of them is the tissue only when no organ is found.
ACCESSORY_TISSUES = ("muscle", "adipose", "lymphoid")
TISSUES: dict[str, dict] = {
    "brain": {"label": "brain / spinal cord", "hallmarks": ["neuron", "astrocyte", "oligodendrocyte"]},
    "heart": {"label": "heart", "hallmarks": ["cardiomyocyte"]},
    "lung": {"label": "lung", "hallmarks": ["alveolar_type2", "alveolar_type1"]},
    "liver": {"label": "liver", "hallmarks": ["hepatocyte"]},
    "kidney": {"label": "kidney", "hallmarks": ["proximal_tubule", "loop_of_henle", "podocyte"]},
    "intestine": {"label": "intestine / colon", "hallmarks": ["enterocyte", "colonocyte", "goblet_cell"]},
    "stomach": {"label": "stomach", "hallmarks": ["gastric_pit", "parietal_cell", "chief_cell"]},
    "pancreas": {"label": "pancreas", "hallmarks": ["acinar"]},
    "lymphoid": {"label": "lymph node / spleen", "hallmarks": ["b_cell", "t_cell"]},
    "thymus": {"label": "thymus", "hallmarks": ["thymocyte", "thymic_epithelium"]},
    # basal keratinocyte genes (Krt5, Krt14) are shared by every basal epithelium (breast, prostate, airway): skin is
    # recognised by its differentiated keratinocytes
    "skin": {"label": "skin", "hallmarks": ["keratinocyte_differentiated"]},
    "breast": {"label": "breast / mammary gland", "hallmarks": ["mammary_luminal", "mammary_basal"]},
    "prostate": {"label": "prostate", "hallmarks": ["prostate_luminal"]},
    "testis": {"label": "testis", "hallmarks": ["spermatid", "spermatocyte"]},
    "ovary": {"label": "ovary", "hallmarks": ["granulosa"]},
    "muscle": {"label": "skeletal muscle", "hallmarks": ["skeletal_muscle"]},
    "adipose": {"label": "adipose tissue", "hallmarks": ["adipocyte"]},
    "bone": {"label": "bone and marrow", "hallmarks": ["osteoblast", "osteocyte", "chondrocyte",
                                                        "marrow_granulocyte"]},
}

# Housekeeping transcripts of the Leiden screen (pipeline_config "ubiquitous"), with the human symbol where it differs.
UBIQUITOUS_ALIASES = {"Ftl1": "FTL", "Sept7": "SEPTIN7", "Hba-a1": "HBA1"}

# ---- detection settings ----------------------------------------------------------------------------------------------
MAX_UNITS = 20000          # units (bins, spots, cells) sampled per section for the detection
N_NULL = 40                # random gene sets per cell type
N_STRATA = 25              # detection-rate strata of the null genes
MIN_UNITS_DETECTED = 5     # a marker counts as expressed when detected in at least this many units ...
MIN_FRACTION_DETECTED = 0.0005   # ... and this fraction of the units
MIN_Z = 4.0                # a cell type is present when its markers' coherence is above the null by this many null
MIN_DELTA_R = 0.03         # standard deviations, and by this much correlation
MIN_TISSUE_SCORE = 0.2     # a tissue needs at least this score (mean over its hallmarks of present x level)
SECONDARY_TISSUE = 0.5     # another organ is also used when its score is at least this fraction of the best one


# ============================================================================
# GENE NAMES
# ============================================================================
class GeneIndex:
    """The genes of a dataset, matched by exact name, then in any case."""

    def __init__(self, genes):
        self.genes = list(genes)
        self.exact = {g: i for i, g in enumerate(self.genes)}
        self.folded: dict[str, int] = {}
        for i, g in enumerate(self.genes):
            self.folded.setdefault(g.casefold(), i)

    def find(self, token: str) -> int | None:
        """Column of the first alternative of `token` ("Mouse|HUMAN") in the dataset, else None."""
        for name in token.split("|"):
            name = name.strip()
            if not name:
                continue
            col = self.exact.get(name)
            if col is None:
                col = self.folded.get(name.casefold())
            if col is not None:
                return col
        return None

    def resolve(self, tokens) -> list[str]:
        """The dataset's names of the tokens it has, each once, in order."""
        out = []
        for t in tokens:
            col = self.find(t)
            if col is not None and self.genes[col] not in out:
                out.append(self.genes[col])
        return out


def species_of(genes) -> str:
    """'human' when most gene symbols are upper case (ACTB), 'mouse' when they are capitalised (Actb), else
    'unknown'. Rat and other rodents use mouse-style symbols."""
    names = [g for g in genes if g[:1].isalpha() and any(c.isalpha() for c in g[1:])]
    if not names:
        return "unknown"
    upper = sum(g == g.upper() for g in names) / len(names)
    capital = sum(g[0].isupper() and any(c.islower() for c in g[1:]) for g in names) / len(names)
    if upper >= 0.6:
        return "human"
    if capital >= 0.6:
        return "mouse"
    return "unknown"


# ============================================================================
# DETECTION
# ============================================================================
def _log_norm(X: sparse.csc_matrix, total: np.ndarray, cols: list[int]) -> np.ndarray:
    """log1p(counts per 10,000) of the columns `cols`, units x genes, dense float32."""
    sub = X[:, cols].toarray().astype(np.float32)
    scale = (1e4 / np.maximum(total, 1)).astype(np.float32)[:, None]
    return np.log1p(sub * scale)


def _mean_corr(M: np.ndarray) -> float:
    """Mean pairwise Pearson correlation of the columns of M (constant columns count as 0)."""
    k = M.shape[1]
    if k < 2:
        return 0.0
    Z = M - M.mean(axis=0)
    sd = np.sqrt((Z * Z).mean(axis=0))
    ok = sd > 0
    Z[:, ok] /= sd[ok]
    Z[:, ~ok] = 0.0
    C = (Z.T @ Z) / M.shape[0]
    return float((C.sum() - np.trace(C)) / (k * (k - 1)))


def detect_section(X, genes, seed: int = 0) -> dict:
    """Evidence for every cell type of the library in one section. X: units x genes counts (any scipy sparse);
    genes: their names. Returns {"n_units", "species", "types": {name: {...}}}."""
    rng = np.random.default_rng(seed)
    X = X if sparse.issparse(X) else sparse.csr_matrix(X)
    n_all = X.shape[0]
    if n_all > MAX_UNITS:   # rows of a CSR or CSC matrix alike, without converting the whole matrix
        X = X[np.sort(rng.choice(n_all, MAX_UNITS, replace=False))]
    X = sparse.csc_matrix(X)
    n = X.shape[0]
    total = np.asarray(X.sum(axis=1)).ravel().astype(np.float64)
    idx = GeneIndex(genes)
    det = np.diff(X.indptr) / max(n, 1)                      # fraction of units each gene is detected in
    min_det = max(MIN_UNITS_DETECTED / max(n, 1), MIN_FRACTION_DETECTED)

    # null genes: by detection-rate stratum (genes detected somewhere), markers of the library left out
    marker_cols = {idx.find(t) for d in CELL_TYPES.values() for t in d["core"]} - {None}
    pool = np.array([j for j in np.flatnonzero(det >= min_det) if j not in marker_cols], dtype=np.int64)
    by_stratum: list[np.ndarray] = []
    edges = np.array([0.0, 1.0])
    if len(pool):
        edges = np.unique(np.quantile(det[pool], np.linspace(0, 1, N_STRATA + 1)))
        which = np.clip(np.searchsorted(edges, det[pool], side="right") - 1, 0, max(len(edges) - 2, 0))
        by_stratum = [pool[which == s] for s in range(max(len(edges) - 1, 1))]

    def stratum(j):
        return int(np.clip(np.searchsorted(edges, det[j], side="right") - 1, 0, len(by_stratum) - 1))

    # level of a gene: the percentile of its total counts among the genes of the section (1 = the most abundant)
    gene_total = np.asarray(X.sum(axis=0)).ravel()
    level_of = np.zeros(len(gene_total))
    level_of[np.argsort(gene_total, kind="stable")] = np.linspace(0, 1, len(gene_total)) if len(gene_total) else []
    level_of[gene_total == 0] = 0.0

    types = {}
    for name, d in CELL_TYPES.items():
        cols = []
        for t in d["core"]:
            c = idx.find(t)
            if c is not None and c not in cols:
                cols.append(c)
        in_panel = len(cols)
        expressed = [c for c in cols if det[c] >= min_det]
        level = float(np.median(level_of[cols])) if cols else 0.0
        entry = {"in_panel": in_panel, "expressed": [idx.genes[c] for c in expressed], "present": False,
                 "z": 0.0, "r": 0.0, "r_null": 0.0, "level": round(level, 4), "status": ""}
        types[name] = entry
        if in_panel < 2:
            entry["status"] = "not measurable: fewer than two of its markers are in the gene panel"
            continue
        if len(expressed) < 2:
            entry["status"] = "not expressed"
            continue
        M = _log_norm(X, total, expressed)
        r = _mean_corr(M)
        nulls_r = []
        if by_stratum:
            for _ in range(N_NULL):
                pick = []
                for c in expressed:
                    cand = by_stratum[stratum(c)]
                    if len(cand) == 0:
                        cand = pool
                    pick.append(int(cand[rng.integers(len(cand))]))
                nulls_r.append(_mean_corr(_log_norm(X, total, pick)))
        mu = float(np.mean(nulls_r)) if nulls_r else 0.0
        sd = float(np.std(nulls_r)) if nulls_r else 0.0
        z = (r - mu) / max(sd, 1e-3)
        present = z >= MIN_Z and (r - mu) >= MIN_DELTA_R
        entry.update(z=round(z, 2), r=round(r, 4), r_null=round(mu, 4), present=bool(present),
                     status="present" if present else "markers not co-expressed")
    return {"n_units": int(n_all), "species": species_of(genes), "types": types}


def combine(sections: list[dict]) -> dict:
    """The evidence of several sections: a cell type is present when it is present in any section; its z and level
    are the highest of the sections."""
    total = sum(s["n_units"] for s in sections) or 1
    out = {}
    for name in CELL_TYPES:
        per = [s["types"][name] for s in sections if name in s["types"]]
        if not per:
            continue
        out[name] = {
            "present": any(p["present"] for p in per),
            "z": max(p["z"] for p in per),
            "r": max(p["r"] for p in per),
            "level": max(p["level"] for p in per),
            "in_panel": max(p["in_panel"] for p in per),
            "expressed": sorted({g for p in per for g in p["expressed"]}),
            "status": next((p["status"] for p in per if p["present"]), per[0]["status"]),
        }
    species = [s["species"] for s in sections]
    sp = max(set(species), key=species.count) if species else "unknown"
    return {"n_units": total, "species": sp, "types": out}


def score_tissues(types: dict) -> list[dict]:
    """Tissues ranked by evidence: the mean over their hallmark cell types of present (1/0) x level (how abundant the
    hallmark's markers are in the section), so a tissue scores high when its parenchyma is there and makes up much of
    the section."""
    ranked = []
    for name, t in TISSUES.items():
        hall = t["hallmarks"]
        present = [h for h in hall if types.get(h, {}).get("present")]
        if not present:
            continue
        score = sum(types[h]["level"] for h in present) / len(hall)
        ranked.append({"name": name, "label": t["label"], "score": round(score, 4), "hallmarks_present": present,
                       "accessory": name in ACCESSORY_TISSUES})
    ranked.sort(key=lambda r: -r["score"])
    return ranked


def detect(sections: list[tuple]) -> dict:
    """Tissue and cell types of a dataset. sections: [(X, genes), ...] (units x genes counts, gene names).

    The tissue is the organ with the highest score, when one reaches MIN_TISSUE_SCORE; else the best accessory tissue
    (muscle, fat, lymphoid tissue); else unknown. Other organs and accessory tissues scoring at least SECONDARY_TISSUE of
    the tissue's score are used as well (their own cell types are scored too).

    Returns {"species", "tissue": {name, label, confidence, score}, "tissues": ranked list, "tissues_used",
    "types": per cell type, "selected": the cell types a project of this data should score, in order}."""
    per = [detect_section(X, genes, seed=i) for i, (X, genes) in enumerate(sections)]
    ev = combine(per)
    ranked = score_tissues(ev["types"])
    qualified = [r for r in ranked if r["score"] >= MIN_TISSUE_SCORE]
    organs = [r for r in qualified if not r["accessory"]]
    best = organs[0] if organs else qualified[0] if qualified else None
    if best is not None:
        rivals = [r for r in (organs if organs else qualified) if r is not best]
        ratio = best["score"] / rivals[0]["score"] if rivals and rivals[0]["score"] > 0 else math.inf
        confidence = "high" if ratio >= 1.5 else "medium" if ratio >= 1.15 else "low"
        tissue = {"name": best["name"], "label": best["label"], "score": best["score"], "confidence": confidence}
        chosen = [best["name"]] + [r["name"] for r in qualified
                                   if r is not best and r["score"] >= SECONDARY_TISSUE * best["score"]]
    else:
        tissue = {"name": "unknown", "label": "unknown tissue", "score": 0.0, "confidence": "low"}
        chosen = []
    selected = select_types(ev["types"], chosen)
    return {"species": ev["species"], "tissue": tissue, "tissues": ranked[:6], "tissues_used": chosen,
            "types": ev["types"], "selected": selected, "n_units": ev["n_units"]}


def select_types(types: dict, tissues: list[str]) -> list[str]:
    """The cell types to score: those present that are generic or belong to one of `tissues` (with no tissue known:
    every present type with strong evidence), the tissues' hallmarks first, most abundant first within each group.
    The generic epithelial type stays next to a tissue's own epithelia: carcinoma cells often lose the markers of the
    epithelium they came from. The hallmarks of the detected tissue are used whenever their markers are expressed, even
    when the co-expression test misses them (astrocytes in spot data, whose markers every spot shares): they make up
    that tissue."""
    expected = set()
    if tissues:
        expected = set(TISSUES[tissues[0]]["hallmarks"])
        if "neuron" in expected:
            expected |= {"excitatory_neuron", "inhibitory_neuron"}

    def ok(name):
        d, t = CELL_TYPES[name], types.get(name)
        if not t or d.get("detect_only"):
            return False
        if not t["present"]:
            return name in expected and len(t["expressed"]) >= 2
        if not d["tissues"]:
            return True
        if not d["tissues"]:
            return True
        if tissues:
            return any(x in tissues for x in d["tissues"])
        return t["z"] >= 2 * MIN_Z
    picked = [n for n in CELL_TYPES if ok(n)]
    # the hallmarks of the tissue first, then those of the other tissues used, then the rest; most abundant first
    rank: dict[str, int] = {}
    for i, t in enumerate(tissues):
        for h in TISSUES[t]["hallmarks"]:
            rank.setdefault(h, i)
            if h == "neuron":   # the pan-neuronal hallmark is scored through the excitatory and inhibitory types
                rank.setdefault("excitatory_neuron", i)
                rank.setdefault("inhibitory_neuron", i)
        for n in CELL_TYPES:
            if t in CELL_TYPES[n]["tissues"]:
                rank.setdefault(n, len(tissues) + i)
    picked.sort(key=lambda n: (rank.get(n, 2 * len(tissues)), -types[n]["level"]))
    return picked


# ============================================================================
# THE CONFIGURATION OF A DETECTED TISSUE
# ============================================================================
SIGNATURE_COLORS = ["#1F77B4", "#FF7F0E", "#2CA02C", "#D62728", "#9467BD", "#8C564B", "#E377C2", "#7F7F7F",
                    "#BCBD22", "#17BECF", "#AEC7E8", "#FFBB78", "#98DF8A", "#FF9896", "#C5B0D5", "#C49C94",
                    "#F7B6D2", "#DBDB8D", "#9EDAE5", "#393B79", "#637939", "#8C6D31", "#843C39", "#7B4173"]

# settings of the bone study's own steps; a project of another tissue gets them switched off (they are off in a run
# of the application anyway, pipeline_config.app_config)
"""Red blood cells: hemoglobin transcripts of the blood are in nearly every bin of every tissue, so outside marrow
and spleen the erythroid signature keeps its positivity call but does not compete in the tissue assignment (where it
would take bins of the tissue's own cells)."""
BLOOD_ONLY_CALLED = ("erythroid",)
BLOOD_ASSIGNED_IN = ("bone", "lymphoid")

BONE_STEPS = ("receptor_panel", "adipocyte_panel", "compartments", "uncoupling", "proximity", "sensitivity",
              "sensitivity_analyses")


def tissue_config(result: dict, genes, defaults: dict) -> dict:
    """The configuration changes for a project of the detected tissue: a dict to merge over the project's
    configuration. genes: the gene names of the data (names are written as the data has them); defaults:
    pipeline_config.default_config(). A bone dataset keeps the manuscript's signatures."""
    idx = GeneIndex(genes)
    record = {"name": result["tissue"]["name"], "label": result["tissue"]["label"],
              "confidence": result["tissue"]["confidence"], "species": result["species"],
              "tissues_used": list(result.get("tissues_used") or []), "auto": True}
    ubiquitous = idx.resolve([f"{g}|{UBIQUITOUS_ALIASES[g]}" if g in UBIQUITOUS_ALIASES else g
                              for g in defaults.get("ubiquitous", [])])
    if result["tissue"]["name"] == "bone":
        out = {key: copy.deepcopy(defaults[key]) for key in ("signatures", "classes", "primary", "programs")}
        out["roi"] = {"exclude": list(defaults["roi"]["exclude"])}
        out["ubiquitous"] = ubiquitous or list(defaults["ubiquitous"])
        out["steps"] = {k: defaults["steps"][k] for k in BONE_STEPS}
        record["signatures"] = list(defaults["signatures"])
        out["tissue"] = record
        return out

    sigs: dict[str, dict] = {}
    for name in result["selected"]:
        d = CELL_TYPES[name]
        core = idx.resolve(d["core"])
        ext = idx.resolve(list(d["extended"]) + list(d["core"]))
        if len(core) < 2 or len(ext) < 2:
            continue
        sigs[name] = {"label": d["label"], "table_label": d["label"], "color": "", "class": d["class"],
                      "canonical": core[:2], "core": core, "extended": ext, "competes": [], "excluded": {}}
    for i, name in enumerate(sigs):
        sigs[name]["color"] = SIGNATURE_COLORS[i % len(SIGNATURE_COLORS)]
        sigs[name]["competes"] = [c for c in CELL_TYPES[name].get("competes", []) if c in sigs and c != name]
    names = list(sigs)
    used_classes = []
    for n in names:
        if sigs[n]["class"] not in used_classes:
            used_classes.append(sigs[n]["class"])
    classes = [{"name": c, "color": CLASS_COLORS.get(c, "#7F7F7F"), "emphasis": i == 0}
               for i, c in enumerate(used_classes)]
    a, b = (names + names)[:2] if names else (None, None)
    used = set(result.get("tissues_used") or [])
    out = {
        "signatures": sigs, "classes": classes, "primary": names,
        "programs": [n for n in names if not (n in BLOOD_ONLY_CALLED and not set(BLOOD_ASSIGNED_IN) & used)],
        "roi": {"exclude": []},
        "ubiquitous": ubiquitous,
        "steps": {k: False for k in BONE_STEPS},
        # settings that name signatures one by one (bone-study steps, off): pointed at this project's signatures
        "compartments": {"signature": a, "split_by": b},
        "uncoupling": {"a": a, "b": b},
        "proximity": {"pairs": []},
        "sensitivity": {"signatures": [], "competitors": [], "variants": {}},
        "sensitivity_analyses": {"lesion": {"genes": []}, "uncoupling": {"habitat_classes": []}},
        "figures": {"lineage_maps": {"a": a, "b": b},
                    "positivity_panels": [{"name": "Positivity", "signatures": names[:10]}] if names else [],
                    "composition_signatures": names},
    }
    record["signatures"] = names
    out["tissue"] = record
    return out


def summary(result: dict) -> list[dict]:
    """Per cell type, what the detection found (for the Data tab): name, label, tissue, present, evidence."""
    rows = []
    for name, t in result["types"].items():
        d = CELL_TYPES[name]
        if d.get("detect_only"):
            continue
        rows.append({"name": name, "label": d["label"], "class": d["class"], "tissues": d["tissues"],
                     "present": t["present"], "selected": name in result["selected"], "z": t["z"],
                     "level": t["level"], "status": t["status"], "markers": t["expressed"]})
    order = {n: i for i, n in enumerate(result["selected"])}   # the signatures' order; then present, by evidence
    rows.sort(key=lambda r: (order.get(r["name"], len(order)), not r["present"], -r["z"]))
    return rows
