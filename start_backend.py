#!/usr/bin/env python3
"""
启动后端服务器的脚本
"""

import subprocess
import sys
import os

def main():
    print("=== 基因搜索后端服务器启动脚本 ===")
    
    # 检查是否在正确的目录
    if not os.path.exists("backend"):
        print("❌ 请在项目根目录运行此脚本")
        return
    
    # 切换到backend目录
    os.chdir("backend")
    
    # 检查端口 8050 是否可用
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(('localhost', 8050))
            print("✅ 端口 8050 可用")
        except OSError:
            print("❌ 端口 8050 已被占用")
            print("请停止占用该端口的其他服务")
            return
    
    # 启动服务器
    print("🚀 启动服务器在 http://localhost:8050")
    print("📚 API文档: http://localhost:8050/docs")
    print("按 Ctrl+C 停止服务器")
    
    try:
        subprocess.run([
            sys.executable, "-m", "uvicorn", 
            "server:app", 
            "--host", "0.0.0.0", 
            "--port", "8050",
            "--reload"
        ])
    except KeyboardInterrupt:
        print("\n服务器已停止")

if __name__ == "__main__":
    main()
