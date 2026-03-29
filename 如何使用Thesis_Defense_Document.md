# 如何使用 Thesis Defense 文档

## 📄 文档说明

`Thesis_Defense_Document.md` 是一个 Markdown 格式的文档，用于 Master Thesis Defense。它不能"运行"，但可以通过多种方式查看和使用。

---

## 方法一：在编辑器中查看（最简单）

### 在 Cursor/VS Code 中：
1. 打开 `Thesis_Defense_Document.md` 文件
2. 点击右上角的 **预览图标**（两个方框图标）
3. 或按快捷键：`Ctrl+Shift+V` (Windows) 或 `Cmd+Shift+V` (Mac)
4. 可以同时打开编辑和预览窗口（`Ctrl+K V`）

---

## 方法二：转换为 PDF（用于演示/打印）

### 选项 A：使用 Pandoc（推荐，专业）

1. **安装 Pandoc**：
   ```bash
   # Windows (使用 Chocolatey)
   choco install pandoc
   
   # 或下载安装包
   # https://pandoc.org/installing.html
   ```

2. **转换命令**：
   ```bash
   cd C:\Users\WangA\Desktop\gene-search-server
   pandoc Thesis_Defense_Document.md -o Thesis_Defense_Document.pdf --pdf-engine=xelatex -V CJKmainfont="Microsoft YaHei"
   ```

### 选项 B：使用在线工具（简单快速）

1. 访问在线转换工具：
   - https://www.markdowntopdf.com/
   - https://dillinger.io/ （可以编辑并导出PDF）
   - https://stackedit.io/ （可以编辑并导出PDF）

2. 步骤：
   - 复制文档内容
   - 粘贴到在线编辑器
   - 点击"导出为PDF"

### 选项 C：使用 VS Code 扩展

1. 安装扩展：
   - **Markdown PDF** (yzane)
   - 或 **Markdown Preview Enhanced** (shd101wyy)

2. 使用：
   - 打开 Markdown 文件
   - 右键 → "Markdown PDF: Export (pdf)"
   - 或使用命令面板（`Ctrl+Shift+P`）→ "Markdown PDF: Export (pdf)"

---

## 方法三：转换为 Word 文档

### 使用 Pandoc：
```bash
cd C:\Users\WangA\Desktop\gene-search-server
pandoc Thesis_Defense_Document.md -o Thesis_Defense_Document.docx
```

### 使用在线工具：
- https://cloudconvert.com/md-to-docx
- https://convertio.co/md-docx/

---

## 方法四：在浏览器中查看

### 使用 Markdown 预览扩展：
1. 安装 VS Code 扩展：**Markdown Preview Enhanced**
2. 打开文档，点击预览
3. 右键预览窗口 → "Open in Browser"

### 或使用本地服务器：
```bash
# 安装 markdown-serve (需要 Node.js)
npm install -g markdown-serve

# 在项目目录运行
cd C:\Users\WangA\Desktop\gene-search-server
markdown-serve
# 然后在浏览器访问 http://localhost:3000
```

---

## 方法五：创建演示文稿（PPT）

如果需要制作演示文稿，可以：

1. **手动转换**：
   - 将文档内容分段复制到 PowerPoint
   - 每个主要章节作为一页幻灯片

2. **使用工具**：
   - 使用 Pandoc 转换为 HTML，然后导入到 PowerPoint
   - 或使用在线工具如 https://www.markdown-to-slides.com/

---

## 推荐方案

### 对于 Thesis Defense：

1. **准备阶段**：
   - 在 Cursor 中编辑和预览文档
   - 使用 `Ctrl+Shift+V` 查看格式

2. **演示阶段**：
   - 转换为 PDF（使用 Pandoc 或在线工具）
   - 或转换为 PowerPoint 演示文稿
   - 打印纸质版本作为备份

3. **提交阶段**：
   - PDF 格式（最通用）
   - 或 Word 格式（如果需要进一步编辑）

---

## 快速命令参考

```bash
# 转换为 PDF (需要安装 Pandoc)
pandoc Thesis_Defense_Document.md -o Thesis_Defense_Document.pdf

# 转换为 Word
pandoc Thesis_Defense_Document.md -o Thesis_Defense_Document.docx

# 转换为 HTML
pandoc Thesis_Defense_Document.md -o Thesis_Defense_Document.html --standalone
```

---

## 提示

- **编辑**：直接在 Cursor/VS Code 中编辑 `.md` 文件
- **预览**：使用 `Ctrl+Shift+V` 实时预览
- **导出**：需要正式文档时再转换为 PDF/Word
- **版本控制**：Markdown 文件可以用 Git 进行版本控制

---

## 如果遇到问题

1. **中文显示问题**：确保使用支持中文的 PDF 引擎（如 XeLaTeX）
2. **格式问题**：可以在在线编辑器中调整后再导出
3. **代码块显示**：确保使用支持代码高亮的工具

