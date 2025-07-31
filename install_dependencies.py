#!/usr/bin/env python3
"""
安装基因分析脚本所需的依赖包
"""

import subprocess
import sys

def install_package(package):
    """安装单个包"""
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", package])
        print(f"✅ 成功安装: {package}")
        return True
    except subprocess.CalledProcessError:
        print(f"❌ 安装失败: {package}")
        return False

def main():
    """主函数：安装所有依赖包"""
    print("开始安装依赖包...")
    print("=" * 50)
    
    # 需要安装的包列表
    packages = [
        "numpy>=1.21.0",
        "pandas>=1.3.0", 
        "matplotlib>=3.4.0",
        "gprofiler-official>=1.0.0"
    ]
    
    success_count = 0
    total_count = len(packages)
    
    for package in packages:
        print(f"\n正在安装: {package}")
        if install_package(package):
            success_count += 1
    
    print("\n" + "=" * 50)
    print(f"安装完成！成功安装 {success_count}/{total_count} 个包")
    
    if success_count == total_count:
        print("🎉 所有依赖包安装成功！现在可以运行 test1.py 了")
    else:
        print("⚠️  部分包安装失败，请检查网络连接或手动安装")

if __name__ == "__main__":
    main() 