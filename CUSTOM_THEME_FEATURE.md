# 自定义主题功能 (Custom Theme Feature)

## 功能概述

在 **Customize Theme Analysis** 页面中，用户现在可以在三个类别（Biological Process、Molecular Function、Cellular Component）中自定义添加主题，并使用自己定义的关键词进行基因本体论分析。

## 新增功能

### 1. 添加自定义主题
- 在每个类别的主题列表末尾都有一个 **"+"** 按钮
- 点击后弹出对话框，允许用户输入：
  - **主题名称**（必填）
  - **描述**（可选）
  - **关键词**（必填，用逗号分隔）

### 2. 管理自定义主题
- 自定义主题会显示在对应类别的主题列表中
- 每个自定义主题右上角有一个删除按钮（X）
- 可以像预定义主题一样选择和使用

### 3. 分析自定义主题
- 自定义主题的关键词会临时添加到后端的主题映射中
- 执行基因富集分析时，会使用这些关键词匹配 GO terms
- 支持生成主题详细图表和汇总图表

## 使用步骤

### 步骤 1: 添加自定义主题

1. 进入 **Gene Ontology** → **Customize Theme Analysis**
2. 滚动到 **Theme Selection** 部分
3. 选择想要添加主题的类别（Biological Process/Molecular Function/Cellular Component）
4. 点击该类别末尾的 **"+ Add Custom Theme"** 按钮

### 步骤 2: 填写主题信息

在弹出的对话框中填写：

```
主题名称: DNA Repair
描述: DNA damage repair and genome stability mechanisms
关键词: dna repair, double strand break, base excision, nucleotide excision, mismatch repair, rad51, brca, xrcc, parp
```

**关键词编写技巧：**
- 使用具体的生物过程或通路名称
- 包含全称和缩写（如 "DNA" 和 "deoxyribonucleic acid"）
- 添加相关的蛋白质名称或基因家族
- 关键词不区分大小写
- 用逗号分隔多个关键词

### 步骤 3: 使用自定义主题

1. 添加完成后，自定义主题会出现在主题列表中
2. 上传基因文件（.txt 格式）
3. 勾选要分析的主题（包括自定义主题和预定义主题）
4. 点击 **"Analyze Genes"** 按钮
5. 查看分析结果和可视化图表

### 步骤 4: 删除自定义主题

- 点击自定义主题右上角的 **X** 按钮即可删除
- 删除后，如果该主题已被选中，会自动取消选择

## 技术实现

### 前端更改

1. **文件**: `genegen/app/gene-ontology/customize-theme/page.tsx`
   
   新增状态：
   ```typescript
   - showAddThemeDialog: 控制对话框显示
   - selectedCategory: 当前选择的类别
   - customThemes: 自定义主题列表
   - newThemeName: 新主题名称
   - newThemeDescription: 新主题描述
   - newThemeKeywords: 新主题关键词
   ```

   新增函数：
   ```typescript
   - handleAddThemeClick(): 打开添加主题对话框
   - handleSaveCustomTheme(): 保存自定义主题
   - handleDeleteCustomTheme(): 删除自定义主题
   ```

   UI 更改：
   - 在每个类别末尾添加 "+" 按钮
   - 添加自定义主题对话框
   - 为自定义主题添加删除按钮

2. **ThemeOption 接口更新**:
   ```typescript
   interface ThemeOption {
     id: string;
     name: string;
     description: string;
     category: string;
     keywords?: string[]; // 新增：用于自定义主题
   }
   ```

### 后端更改

1. **文件**: `backend/server.py`

   更新端点：
   - `POST /api/ontology/custom-analyze`
     - 新增 `custom_themes` 参数（可选）
     - 临时添加自定义主题到 ontology_api.themes
     - 分析后恢复原始主题

   - `POST /api/ontology/custom-summary-chart`
     - 新增 `custom_themes` 参数（可选）
     - 支持自定义主题的图表生成

2. **主题管理机制**:
   ```python
   # 保存原始主题
   original_themes = ontology_api.themes.copy()
   
   # 临时添加自定义主题
   for custom_theme in custom_theme_data:
       theme_name = custom_theme.get('name')
       keywords = custom_theme.get('keywords', [])
       ontology_api.themes[theme_name] = keywords
   
   # 执行分析...
   
   # 恢复原始主题
   ontology_api.themes = original_themes
   ```

## 示例

### 示例 1: 添加 "DNA Repair" 主题

**类别**: Biological Process

**主题名称**: DNA Repair

**描述**: DNA damage repair and genome stability mechanisms

**关键词**: 
```
dna repair, double strand break, base excision, nucleotide excision, mismatch repair, rad51, brca, xrcc, parp, atm, atr, chk1, chk2, fanconi, homologous recombination, non-homologous end joining
```

### 示例 2: 添加 "Ubiquitin System" 主题

**类别**: Molecular Function

**主题名称**: Ubiquitin System

**描述**: Ubiquitin-proteasome system and protein degradation

**关键词**:
```
ubiquitin, proteasome, e3 ligase, ubiquitination, deubiquitinase, skp, cullin, ring finger, hect, usp, sumo, nedd8, degradation
```

### 示例 3: 添加 "Peroxisome" 主题

**类别**: Cellular Component

**主题名称**: Peroxisome

**描述**: Peroxisomal structure and functions

**关键词**:
```
peroxisome, pex, catalase, fatty acid oxidation, plasmalogen, glyoxysome, microbody, peroxin
```

## 注意事项

1. **关键词质量**：关键词的选择直接影响分析结果的准确性。建议：
   - 使用标准的生物学术语
   - 参考 Gene Ontology 数据库的术语
   - 包含相关的同义词和缩写

2. **主题范围**：自定义主题应该专注于特定的生物过程、功能或组件：
   - 不要太宽泛（如 "metabolism" 太宽泛）
   - 不要太狭窄（如只包含单个基因名）
   - 保持在合理的生物学概念范围内

3. **性能考虑**：
   - 自定义主题是临时的，不会永久保存在后端
   - 刷新页面后自定义主题会丢失
   - 每次分析时会临时添加和删除自定义主题

4. **兼容性**：
   - 自定义主题与预定义主题完全兼容
   - 可以同时选择自定义和预定义主题进行分析
   - 支持所有现有的分析和可视化功能

## 未来改进

可能的功能扩展：

1. **保存自定义主题**：将自定义主题保存到本地存储或数据库
2. **导入/导出主题**：允许用户导入和导出自定义主题配置
3. **主题模板**：提供常用主题模板供用户选择
4. **主题共享**：允许用户分享自定义主题给其他用户
5. **关键词建议**：基于已选主题名称自动推荐关键词

## 测试

### 测试步骤

1. 启动后端服务器：
   ```bash
   cd backend
   python server.py
   ```

2. 启动前端服务器：
   ```bash
   cd genegen
   npm run dev
   ```

3. 测试流程：
   - 访问 Customize Theme Analysis 页面
   - 点击任意类别的 "+" 按钮
   - 填写主题信息并保存
   - 上传基因文件
   - 选择包含自定义主题的主题列表
   - 执行分析
   - 验证结果是否包含自定义主题

## 故障排除

### 问题 1: 自定义主题没有出现在结果中

**可能原因**：
- 关键词与 GO terms 不匹配
- 关键词拼写错误
- 基因列表与该主题无关

**解决方案**：
- 检查关键词是否准确
- 尝试添加更多相关关键词
- 参考 Gene Ontology 数据库

### 问题 2: "Failed to fetch" 错误

**可能原因**：
- 后端服务器未运行
- 端口配置错误

**解决方案**：
- 确保后端运行在 http://localhost:8000
- 检查 `genegen/.env.local` 中的 API URL 配置

### 问题 3: 自定义主题被意外删除

**可能原因**：
- 页面刷新导致状态丢失

**解决方案**：
- 当前版本不支持持久化存储
- 未来版本将添加本地存储支持

## 支持

如有问题或建议，请联系开发团队。

