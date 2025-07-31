#!/usr/bin/env python3
"""
测试API端点
"""

import requests
import json

def test_api():
    """测试API端点"""
    API_BASE_URL = "http://localhost:8001"
    
    print("=== API端点测试 ===")
    
    # 读取基因文件
    with open('885 genes.txt', 'r') as f:
        file_content = f.read()
    
    # 测试富集分析端点
    print("\n测试 /api/ontology/analyze 端点...")
    try:
        files = {'file': ('885_genes.txt', file_content, 'text/plain')}
        response = requests.post(f"{API_BASE_URL}/api/ontology/analyze", files=files)
        
        print(f"状态码: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            results = data.get('results', [])
            print(f"返回的主题数量: {len(results)}")
            
            for i, result in enumerate(results):
                print(f"  {i+1}. {result['theme']}: Score={result['score']:.2f}, Terms={result['terms']}")
        else:
            print(f"错误: {response.text}")
            
    except Exception as e:
        print(f"请求失败: {e}")
    
    # 测试调试端点
    print("\n测试 /api/debug/test-enrichment 端点...")
    try:
        files = {'file': ('885_genes.txt', file_content, 'text/plain')}
        response = requests.post(f"{API_BASE_URL}/api/debug/test-enrichment", files=files)
        
        print(f"状态码: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            if 'error' in data:
                print(f"错误: {data['error']}")
            else:
                available_themes = data.get('available_themes', [])
                print(f"可用主题数量: {len(available_themes)}")
                for theme in available_themes:
                    print(f"  - {theme}")
        else:
            print(f"错误: {response.text}")
            
    except Exception as e:
        print(f"请求失败: {e}")

if __name__ == "__main__":
    test_api() 