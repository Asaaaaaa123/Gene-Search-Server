# 故障排除指南

## "Analyze Genes" 按钮显示错误的问题

### 问题描述
当点击"Analyze Genes"按钮时出现错误，通常是因为后端服务器未运行或配置问题。

### 解决方案

#### 1. 启动后端服务器

**直接启动（推荐）**
```bash
cd backend
python server.py
```

服务器会自动：
- 检查并安装缺失的依赖项
- 验证MongoDB连接
- 启动API服务器

**手动启动（如果需要）**
```bash
cd backend
pip install -r requirements.txt
python server.py
```

#### 2. 检查后端服务器状态

后端服务器会自动选择可用端口（8001-8005）

你可以通过以下方式检查：
- 查看服务器启动时的输出信息
- 打开浏览器访问显示的端口地址
- 应该看到API信息页面

#### 3. 启动前端服务器

在另一个终端窗口中：
```bash
cd genegen
npm install
npm run dev
```

前端服务器应该运行在 `http://localhost:3000`

#### 4. 常见错误及解决方案

**错误：Failed to load preset file**
- 确保 `genegen/public/885_genes.txt` 文件存在
- 检查文件路径是否正确

**错误：Failed to analyze genes**
- 确保后端服务器正在运行
- 检查网络连接
- 查看浏览器控制台的错误信息

**错误：gprofiler相关错误**
- 确保已安装 `gprofiler-official` 包
- 检查网络连接（gprofiler需要访问外部API）

#### 5. 环境要求

- Python 3.7+
- Node.js 16+
- 网络连接（用于gprofiler API）

#### 6. 调试步骤

1. 打开浏览器开发者工具（F12）
2. 查看Console标签页的错误信息
3. 查看Network标签页的API请求状态
4. 检查后端服务器的控制台输出

### 联系支持

如果问题仍然存在，请提供：
- 错误信息的完整截图
- 浏览器控制台的错误日志
- 后端服务器的错误日志 