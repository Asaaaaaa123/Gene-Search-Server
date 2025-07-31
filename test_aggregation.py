#!/usr/bin/env python3
"""
测试聚合过程
"""

import sys
import os
import pandas as pd

# 添加backend目录到路径
sys.path.append('backend')

from server import GeneOntologyAPI

def test_aggregation():
    """测试聚合过程"""
    api = GeneOntologyAPI()
    
    # 读取基因文件
    with open('885 genes.txt', 'r') as f:
        genes = [g.strip() for g in f.readlines() if g.strip()]
    
    print(f"=== 聚合过程测试 ===")
    print(f"基因数量: {len(genes)}")
    
    try:
        # 执行富集分析
        print("\n执行富集分析...")
        enr_df = api.enrich(genes)
        
        if enr_df.empty:
            print("❌ 没有找到显著的富集结果")
            return
        
        print(f"✅ 找到 {len(enr_df)} 个显著富集术语")
        
        # 分配主题
        print("\n分配主题...")
        enr_df["Theme"] = enr_df["name"].apply(api.assign_theme)
        
        # 统计主题分配
        theme_counts = enr_df["Theme"].value_counts()
        print(f"主题分配统计:")
        for theme, count in theme_counts.items():
            print(f"  {theme}: {count} 个术语")
        
        # 执行聚合
        print("\n执行聚合...")
        themed = api.aggregate(enr_df)
        
        print(f"聚合结果:")
        print(f"聚合前主题数量: {len(theme_counts)}")
        print(f"聚合后主题数量: {len(themed)}")
        
        print("\n聚合后的主题:")
        for theme, row in themed.iterrows():
            print(f"  {theme}: Score={row['Score']:.2f}, Terms={row['Terms']}")
        
        # 检查是否有主题丢失
        missing_themes = set(theme_counts.index) - set(themed.index)
        if missing_themes:
            print(f"\n⚠️  丢失的主题: {missing_themes}")
            for theme in missing_themes:
                theme_data = enr_df[enr_df["Theme"] == theme]
                print(f"  {theme}: {len(theme_data)} 个术语")
                for _, row in theme_data.head(3).iterrows():
                    print(f"    - {row['name']} (score={row['Score']:.2f})")
        
        # 转换为结果格式
        print("\n转换为结果格式...")
        results = []
        for theme, row in themed.iterrows():
            results.append({
                "theme": theme,
                "score": float(row["Score"]),
                "terms": int(row["Terms"])
            })
        
        print(f"最终结果数量: {len(results)}")
        for result in results:
            print(f"  {result['theme']}: Score={result['score']:.2f}, Terms={result['terms']}")
        
    except Exception as e:
        print(f"❌ 错误: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_aggregation() 