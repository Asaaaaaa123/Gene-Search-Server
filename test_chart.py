#!/usr/bin/env python3
"""
测试图表生成功能
"""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import base64
import io
import pandas as pd

def test_matplotlib():
    """测试matplotlib是否正常工作"""
    try:
        # 创建测试数据
        data = pd.DataFrame({
            'name': ['Term1', 'Term2', 'Term3'],
            'Score': [5.2, 3.8, 2.1]
        })
        
        # 创建图表
        plt.figure(figsize=(6, 4))
        plt.barh(data['name'], data['Score'], color='mediumseagreen')
        plt.xlabel('Score')
        plt.title('Test Chart')
        plt.tight_layout()
        
        # 保存为base64
        img_buffer = io.BytesIO()
        plt.savefig(img_buffer, format='png', dpi=300, bbox_inches='tight')
        img_buffer.seek(0)
        img_base64 = base64.b64encode(img_buffer.getvalue()).decode()
        plt.close()
        
        print("✅ matplotlib测试成功")
        print(f"生成的base64长度: {len(img_base64)}")
        return True
        
    except Exception as e:
        print(f"❌ matplotlib测试失败: {e}")
        return False

def test_gprofiler():
    """测试gprofiler是否正常工作"""
    try:
        from gprofiler import GProfiler
        gp = GProfiler(return_dataframe=True)
        
        # 测试查询
        test_genes = ['Socs3', 'Zmat3', 'Brpf3']
        result = gp.profile(organism="mmusculus", query=test_genes)
        
        print("✅ gprofiler测试成功")
        print(f"查询结果数量: {len(result)}")
        return True
        
    except Exception as e:
        print(f"❌ gprofiler测试失败: {e}")
        return False

if __name__ == "__main__":
    print("=== 测试图表生成功能 ===")
    
    # 测试matplotlib
    matplotlib_ok = test_matplotlib()
    
    # 测试gprofiler
    gprofiler_ok = test_gprofiler()
    
    if matplotlib_ok and gprofiler_ok:
        print("\n✅ 所有测试通过，图表生成功能应该正常工作")
    else:
        print("\n❌ 部分测试失败，请检查相关依赖项") 