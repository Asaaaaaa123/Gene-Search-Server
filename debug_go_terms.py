#!/usr/bin/env python3
"""
调试实际的GO术语和主题匹配
"""

import sys
import os

# 添加backend目录到路径
sys.path.append('backend')

from server import GeneOntologyAPI

def debug_go_terms():
    """调试实际的GO术语"""
    api = GeneOntologyAPI()
    
    # 读取基因文件
    with open('885 genes.txt', 'r') as f:
        genes = [g.strip() for g in f.readlines() if g.strip()]
    
    print(f"=== GO术语调试 ===")
    print(f"基因数量: {len(genes)}")
    print(f"前10个基因: {genes[:10]}")
    
    try:
        # 执行富集分析
        print("\n执行富集分析...")
        enr_df = api.enrich(genes)
        
        if enr_df.empty:
            print("❌ 没有找到显著的富集结果")
            return
        
        print(f"✅ 找到 {len(enr_df)} 个显著富集术语")
        
        # 显示前20个术语
        print("\n前20个富集术语:")
        for i, (idx, row) in enumerate(enr_df.head(20).iterrows()):
            term_name = row['name']
            p_value = row['p_value']
            score = row['Score']
            print(f"{i+1:2d}. {term_name} (p={p_value:.2e}, score={score:.2f})")
        
        # 测试主题分配
        print("\n=== 主题分配测试 ===")
        theme_counts = {}
        unassigned_terms = []
        
        for idx, row in enr_df.iterrows():
            term_name = row['name']
            assigned_theme = api.assign_theme(term_name)
            
            if assigned_theme:
                if assigned_theme not in theme_counts:
                    theme_counts[assigned_theme] = []
                theme_counts[assigned_theme].append({
                    'term': term_name,
                    'score': row['Score']
                })
            else:
                unassigned_terms.append(term_name)
        
        print(f"主题分配结果:")
        for theme, terms in theme_counts.items():
            print(f"  {theme}: {len(terms)} 个术语")
            for term_info in terms[:3]:  # 显示前3个
                print(f"    - {term_info['term']} (score={term_info['score']:.2f})")
            if len(terms) > 3:
                print(f"    ... 还有 {len(terms)-3} 个术语")
        
        print(f"\n未分配主题的术语: {len(unassigned_terms)} 个")
        for term in unassigned_terms[:10]:  # 显示前10个
            print(f"  - {term}")
        if len(unassigned_terms) > 10:
            print(f"  ... 还有 {len(unassigned_terms)-10} 个术语")
        
        # 检查特定主题的关键词匹配
        print(f"\n=== 检查 'Stress & cytokine response' 关键词匹配 ===")
        stress_keywords = api.themes["Stress & cytokine response"]
        print(f"关键词: {stress_keywords}")
        
        stress_matches = []
        for idx, row in enr_df.iterrows():
            term_name = row['name'].lower()
            for keyword in stress_keywords:
                if keyword in term_name:
                    stress_matches.append({
                        'term': row['name'],
                        'keyword': keyword,
                        'score': row['Score']
                    })
                    break
        
        print(f"匹配到 'Stress & cytokine response' 的术语: {len(stress_matches)} 个")
        for match in stress_matches:
            print(f"  - {match['term']} (关键词: {match['keyword']}, score={match['score']:.2f})")
        
    except Exception as e:
        print(f"❌ 错误: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    debug_go_terms() 