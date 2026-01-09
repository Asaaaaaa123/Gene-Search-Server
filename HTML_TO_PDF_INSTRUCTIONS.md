# HTML 转 PDF 使用说明

## 已生成的 HTML 文件

1. **System_Architecture_Complete.html** - 完整系统架构文档
2. **Architecture_Flow_Details.html** - 详细流程图和组件交互文档

## 如何转换为 PDF

### 方法1：使用浏览器打印功能（推荐）

1. **打开 HTML 文件**
   - 双击 `System_Architecture_Complete.html` 或 `Architecture_Flow_Details.html`
   - 文件会在默认浏览器中打开

2. **打印为 PDF**
   - 点击页面右上角的 **"🖨️ 打印为 PDF"** 按钮
   - 或者使用快捷键 **Ctrl+P** (Windows) / **Cmd+P** (Mac)

3. **打印设置**
   - **目标**：选择 "另存为 PDF" 或 "Save as PDF"
   - **纸张大小**：A4
   - **边距**：默认或最小
   - **重要**：勾选 "背景图形" 或 "Background graphics"（以显示颜色和样式）
   - **缩放**：100% 或适合页面

4. **保存**
   - 点击 "保存" 按钮
   - 选择保存位置和文件名

### 方法2：使用 Chrome/Edge 浏览器（最佳效果）

1. 使用 Chrome 或 Edge 浏览器打开 HTML 文件

2. 按 **Ctrl+P** 打开打印对话框

3. 设置：
   - **目标**：另存为 PDF
   - **布局**：纵向
   - **纸张**：A4
   - **边距**：默认
   - **缩放**：默认
   - **选项**：
     - ✅ 背景图形
     - ✅ 页眉和页脚（可选）

4. 点击 "保存"

### 方法3：使用 Firefox 浏览器

1. 使用 Firefox 打开 HTML 文件

2. 按 **Ctrl+P** 或点击菜单 → 打印

3. 设置：
   - **目标打印机**：选择 "另存为 PDF" 或 "Print to File"
   - **页面设置**：
     - 格式：A4
     - 方向：纵向
     - 边距：正常
   - **选项**：
     - ✅ 打印背景（颜色和图片）

4. 点击 "保存"

### 方法4：使用专业工具（可选）

如果需要更高质量的 PDF 输出，可以使用：

1. **Pandoc**（命令行工具）
   ```bash
   pandoc System_Architecture_Complete.md -o System_Architecture_Complete.pdf
   ```

2. **在线工具**
   - https://www.markdowntopdf.com/
   - 上传 Markdown 文件，下载 PDF

3. **VS Code 扩展**
   - 安装 "Markdown PDF" 扩展
   - 右键点击 Markdown 文件 → "Markdown PDF: Export (pdf)"

## 打印技巧

### 优化打印效果

1. **分页控制**
   - HTML 已配置自动分页
   - 标题会自动避免分页
   - 代码块和表格会尽量保持在同一页

2. **字体大小**
   - 文档已优化为 A4 打印尺寸
   - 字体大小适合打印阅读

3. **颜色和样式**
   - 确保勾选 "背景图形" 以显示颜色
   - 表格标题会显示为蓝色背景
   - 代码块会有灰色背景和边框

### 常见问题

**Q: 打印出来的 PDF 没有颜色？**
A: 确保在打印设置中勾选了 "背景图形" 或 "Background graphics" 选项。

**Q: PDF 文件太大？**
A: 可以在打印设置中选择 "更多设置" → "质量" → 选择较低的质量设置，但可能影响文字清晰度。

**Q: 代码块显示不完整？**
A: HTML 已经配置了自动换行和滚动，但如果代码过长，建议在浏览器中调整缩放比例。

**Q: 表格显示不正确？**
A: 确保纸张大小设置为 A4，并且边距设置合理。如果表格太宽，浏览器会自动调整。

## 文件位置

所有生成的 HTML 文件都在项目根目录：
```
C:\Users\WangA\Desktop\gene-search-server\
├── System_Architecture_Complete.html
├── Architecture_Flow_Details.html
└── HTML_TO_PDF_INSTRUCTIONS.md (本文件)
```

## 重新生成 HTML

如果需要重新生成 HTML 文件，运行：

```bash
python export_architecture_html.py
```

这会重新转换所有架构文档为 HTML 格式。


