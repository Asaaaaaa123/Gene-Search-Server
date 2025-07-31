#!/usr/bin/env python3
"""
启动后端服务器的脚本
"""

import subprocess
import sys
import os

def install_requirements():
    """安装后端依赖项"""
    print("正在安装后端依赖项...")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", "backend/requirements.txt"])
        print("✅ 依赖项安装完成")
    except subprocess.CalledProcessError as e:
        print(f"❌ 依赖项安装失败: {e}")
        return False
    return True

def start_server():
    """启动后端服务器"""
    print("正在启动后端服务器...")
    try:
        # 切换到backend目录
        os.chdir("backend")
        
        # 启动服务器
        subprocess.run([sys.executable, "server.py"])
    except KeyboardInterrupt:
        print("\n服务器已停止")
    except Exception as e:
        print(f"❌ 启动服务器失败: {e}")

def main():
    print("=== 基因搜索服务器启动脚本 ===")
    
    # 检查backend目录是否存在
    if not os.path.exists("backend"):
        print("❌ 找不到backend目录")
        return
    
    # 安装依赖项
    if not install_requirements():
        return
    
    # 启动服务器
    start_server()

if __name__ == "__main__":
    main() 