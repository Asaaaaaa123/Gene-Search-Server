# 将 Thesis_Defense_Complete.md 导出为 PDF

已为您生成了 HTML 文件，您可以通过以下方法转换为 PDF：

## 方法 1：从 HTML 打印为 PDF（推荐，最简单）

1. **打开 HTML 文件**：
   - 双击打开 `Thesis_Defense_Complete.html`
   - 或者右键选择浏览器打开

2. **打印为 PDF**：
   - 点击右上角的"🖨️ 打印为 PDF"按钮
   - 或使用快捷键 `Ctrl+P`

3. **设置打印选项**：
   - 目标：选择"另存为 PDF"或"Microsoft Print to PDF"
   - 纸张大小：A4
   - 边距：默认或最小
   - **重要**：勾选"背景图形"选项（以显示颜色和背景）
   - 缩放：100%

4. **保存**：
   - 点击"保存"按钮
   - 选择保存位置和文件名

## 方法 2：使用 VS Code 扩展（推荐）

1. **安装扩展**：
   - 打开 VS Code
   - 搜索并安装 `Markdown PDF`（作者：yzane）

2. **导出 PDF**：
   - 打开 `Thesis_Defense_Complete.md`
   - 右键点击文件
   - 选择 `Markdown PDF: Export (pdf)`

3. **等待生成**：
   - PDF 文件会生成在同一目录下
   - 文件名：`Thesis_Defense_Complete.pdf`

## 方法 3：使用 Pandoc（最专业，支持数学公式）

如果您已安装 Pandoc：

```bash
# 基本命令
pandoc Thesis_Defense_Complete.md -o Thesis_Defense_Complete.pdf

# 推荐命令（支持中文和更好的格式）
pandoc Thesis_Defense_Complete.md -o Thesis_Defense_Complete.pdf \
  --pdf-engine=xelatex \
  -V CJKmainfont="Microsoft YaHei" \
  -V geometry:margin=2.5cm \
  --toc \
  --toc-depth=3 \
  --highlight-style=tango
```

**安装 Pandoc**：
- Windows: https://pandoc.org/installing.html
- 还需要安装 MiKTeX 或 TeX Live（用于 PDF 生成）

## 方法 4：使用在线工具

1. 访问以下任一网站：
   - https://www.markdowntopdf.com/
   - https://dillinger.io/
   - https://stackedit.io/

2. 上传或粘贴 Markdown 内容

3. 导出为 PDF

## 已生成的文件

- ✅ `Thesis_Defense_Complete.html` - 可直接在浏览器中查看和打印

## 注意事项

1. **数学公式**：
   - HTML 文件中的数学公式可能显示不完整
   - 如需完美显示数学公式，推荐使用 Pandoc 方法

2. **中文支持**：
   - 确保浏览器和系统支持中文字体
   - 如果中文显示异常，尝试使用其他浏览器

3. **图表引用**：
   - 如果 Markdown 中引用了图片，确保图片路径正确
   - 图片文件需要在同一目录或相对路径下

## 推荐流程

对于您的论文答辩，我推荐：

1. **快速预览**：使用 HTML 文件在浏览器中查看
2. **最终PDF**：使用 VS Code 的 Markdown PDF 扩展生成（最简单）
3. **专业版本**：如果安装了 Pandoc，使用 Pandoc 生成（数学公式支持最好）

---

如有问题，请检查：
- HTML 文件是否正确生成
- 浏览器是否支持中文
- 打印设置是否正确




