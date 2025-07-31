#!/usr/bin/env python3
"""
测试主题匹配逻辑
"""

import sys
import os

# 添加backend目录到路径
sys.path.append('backend')

from server import GeneOntologyAPI

def test_theme_matching():
    """测试主题匹配逻辑"""
    api = GeneOntologyAPI()
    
    # 测试用例
    test_terms = [
        "response to stress",
        "inflammatory response",
        "cytokine production",
        "immune system process",
        "oxidative stress response",
        "extracellular matrix organization",
        "metabolic process",
        "hematopoietic stem cell differentiation",
        "cell cycle",
        "synaptic transmission"，
        "neurotrophin signaling pathway",
        "microglia activation",
        "pain perception",
        "mitochondrial electron transport",
        "autophagy",
        "myelin sheath formation"
    ]
    
    print("=== 主题匹配测试 ===")
    print(f"可用主题数量: {len(api.themes)}")
    print("可用主题:")
    for theme in api.themes.keys():
        print(f"  - {theme}")
    print()
    
    print("测试术语匹配:")
    for term in test_terms:
        theme = api.assign_theme(term)
        status = "✅" if theme else "❌"
        print(f"{status} '{term}' -> '{theme}'")
    
    print("\n=== 主题关键词 ===")
    for theme, keywords in api.themes.items():
        print(f"\n{theme}:")
        for kw in keywords:
            print(f"  - {kw}")

if __name__ == "__main__":
    test_theme_matching() 