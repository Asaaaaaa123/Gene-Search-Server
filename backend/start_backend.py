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
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"])
        print("✅ 依赖项安装完成")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ 依赖项安装失败: {e}")
        return False
    except FileNotFoundError:
        print("⚠️  找不到requirements.txt文件，跳过依赖项安装")
        return True

def start_server():
    """启动后端服务器"""
    print("正在启动后端服务器...")
    try:
        # 检查端口 8050 是否可用
        import socket
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('localhost', 8050))
                print("✅ 端口 8050 可用")
            except OSError:
                print("❌ 端口 8050 已被占用")
                print("请停止占用该端口的其他服务")
                return False
        
        # 启动服务器
        print("🚀 启动服务器在 http://localhost:8050")
        print("📚 API文档: http://localhost:8050/docs")
        print("按 Ctrl+C 停止服务器")
        
        subprocess.run([
            sys.executable, "-m", "uvicorn", 
            "server:app", 
            "--host", "0.0.0.0", 
            "--port", "8050",
            "--reload"
        ])
        return True
    except KeyboardInterrupt:
        print("\n服务器已停止")
        return True
    except Exception as e:
        print(f"❌ 启动服务器失败: {e}")
        return False

def main():
    print("=== 基因搜索服务器启动脚本 ===")
    
    # 安装依赖项
    if not install_requirements():
        return
    
    # 启动服务器
    start_server()

if __name__ == "__main__":
    main() 