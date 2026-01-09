# 📄 导出 PDF 指南

## 🚀 方法一：使用 VS Code 扩展（推荐，最简单）

### 步骤：

1. **安装扩展**：
   - 在 VS Code/Cursor 中，按 `Ctrl+Shift+X` 打开扩展市场
   - 搜索：`Markdown PDF` (作者：yzane)
   - 点击安装

2. **导出 PDF**：
   - 打开 `Thesis_Defense_Document.md`
   - 右键点击文件 → 选择 `Markdown PDF: Export (pdf)`
   - 或者使用命令面板（`Ctrl+Shift+P`）→ 输入 `Markdown PDF: Export (pdf)`

3. **完成**：
   - PDF 文件会生成在同一目录下
   - 文件名：`Thesis_Defense_Document.pdf`

### 优点：
- ✅ 最简单，无需安装其他软件
- ✅ 支持中文
- ✅ 图表可以正常显示
- ✅ 格式美观

---

## 🌐 方法二：使用在线工具（无需安装）

### 推荐工具：Dillinger.io

1. **访问网站**：
   - 打开 https://dillinger.io/

2. **导入文件**：
   - 点击左上角菜单（三条横线）
   - 选择 "Import from" → "Disk"
   - 选择 `Thesis_Defense_Document.md`

3. **导出 PDF**：
   - 点击右上角 "Export as" 按钮
   - 选择 "PDF"
   - 下载 PDF 文件

### 其他在线工具：
- **StackEdit**: https://stackedit.io/
- **Markdown to PDF**: https://www.markdowntopdf.com/

### 优点：
- ✅ 无需安装任何软件
- ✅ 在线操作，方便快捷

### 缺点：
- ⚠️ 需要上传文件到在线服务
- ⚠️ 图表路径可能需要调整

---

## 🔧 方法三：安装 Pandoc（最专业）

### Windows 安装：

1. **下载安装包**：
   - 访问：https://github.com/jgm/pandoc/releases/latest
   - 下载 `pandoc-x.x.x-windows-x86_64.msi`
   - 运行安装程序

2. **安装 LaTeX（用于 PDF 生成）**：
   - 下载 MiKTeX: https://miktex.org/download
   - 或使用 Chocolatey: `choco install miktex`

3. **转换命令**：
   ```bash
   cd C:\Users\WangA\Desktop\gene-search-server
   pandoc Thesis_Defense_Document.md -o Thesis_Defense_Document.pdf
   ```

### 支持中文的转换（推荐）：
```bash
pandoc Thesis_Defense_Document.md -o Thesis_Defense_Document.pdf --pdf-engine=xelatex -V CJKmainfont="Microsoft YaHei"
```

### 优点：
- ✅ 专业工具，格式控制精确
- ✅ 支持复杂格式
- ✅ 命令行操作，可自动化

### 缺点：
- ⚠️ 需要安装 Pandoc 和 LaTeX（体积较大）

---

## 🐍 方法四：使用 Python 脚本（需要安装库）

### 安装依赖：
```bash
pip install markdown weasyprint
```

### 运行脚本：
```bash
python export_to_pdf.py
```

### 如果安装失败：
- Windows 可能需要安装 GTK+ 运行时
- 或者使用方法一或方法二

---

## 📋 快速对比

| 方法 | 难度 | 安装需求 | 图表支持 | 推荐度 |
|------|------|----------|----------|--------|
| VS Code 扩展 | ⭐ 简单 | 只需扩展 | ✅ 是 | ⭐⭐⭐⭐⭐ |
| 在线工具 | ⭐ 简单 | 无需安装 | ⚠️ 可能 | ⭐⭐⭐⭐ |
| Pandoc | ⭐⭐⭐ 中等 | Pandoc + LaTeX | ✅ 是 | ⭐⭐⭐ |
| Python 脚本 | ⭐⭐ 中等 | Python 库 | ✅ 是 | ⭐⭐⭐ |

---

## 🎯 推荐方案

### 对于你的情况，我推荐：

**首选：方法一（VS Code 扩展）**
- 你已经在使用 Cursor/VS Code
- 只需安装一个扩展
- 图表可以正常显示
- 操作最简单

**备选：方法二（在线工具）**
- 如果扩展安装有问题
- 或者想快速转换

---

## 💡 提示

1. **图表路径**：
   - 确保 `thesis_charts/` 文件夹和 Markdown 文件在同一目录
   - 图表路径使用相对路径：`thesis_charts/图表名.png`

2. **中文支持**：
   - VS Code 扩展和 Pandoc 都支持中文
   - 如果中文显示有问题，检查字体设置

3. **格式调整**：
   - 如果 PDF 格式不满意，可以：
     - 调整 Markdown 源文件
     - 使用 Pandoc 的模板和参数
     - 在 VS Code 扩展中调整 CSS

---

## ❓ 遇到问题？

### 问题 1：图表不显示
- 检查图表路径是否正确
- 确保图表文件存在
- 尝试使用绝对路径

### 问题 2：中文乱码
- 使用 Pandoc 时添加 `-V CJKmainfont="Microsoft YaHei"`
- 或使用 XeLaTeX 引擎

### 问题 3：格式不美观
- 使用 Pandoc 的自定义模板
- 或调整 Markdown 源文件格式

---

## 🚀 立即开始

**最简单的方法（推荐）**：

1. 在 Cursor 中按 `Ctrl+Shift+X`
2. 搜索并安装 `Markdown PDF` 扩展
3. 右键 `Thesis_Defense_Document.md` → `Markdown PDF: Export (pdf)`
4. 完成！✅

