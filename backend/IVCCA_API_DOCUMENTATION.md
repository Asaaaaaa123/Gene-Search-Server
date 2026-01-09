# IVCCA API 文档

## 概述

IVCCA (Inter-Variability Cross Correlation Analysis) Python 版本已成功集成到基因搜索平台中。这个模块提供了从 MATLAB IVCCA 应用转换而来的完整功能。

## 主要功能

### 1. 数据加载和分析
- 支持 Excel (.xlsx, .xls)、CSV (.csv) 和 TSV (.tsv) 格式
- 可选基因列表过滤
- 自动处理 NaN 值

### 2. 相关性分析
- Pearson、Spearman 和 Kendall 相关性计算
- 相关性矩阵排序
- 相关性分布统计

### 3. 可视化
- 相关性热图（支持排序）
- 相关性直方图
- 聚类树状图（Dendrogram）

### 4. 聚类分析
- Elbow 方法确定最优聚类数
- Silhouette 方法确定最优聚类数
- 层次聚类树状图

### 5. 降维分析
- PCA (主成分分析)
- t-SNE (t分布随机邻域嵌入)

### 6. 通路分析
- 单通路分析（Single Pathway）
- 通路比较（Compare Pathways）
- 基于余弦相似度的通路相似性

### 7. 两数据集相关性分析
- TwoSetCorrTool 等效功能
- 两个数据集间的配对相关性计算
- 跨数据集相关性可视化

## API 端点

### 基础分析端点

#### 1. 加载数据
```
POST /api/ivcca/load-data
```

**参数:**
- `file` (File, 必需): 数据文件 (Excel/CSV/TSV)
- `filter_genes` (File, 可选): 基因列表过滤文件 (.txt)

**响应:**
```json
{
  "analyzer_id": "abc123...",
  "status": "success",
  "message": "Data loaded successfully: 100 samples x 2000 genes",
  "n_samples": 100,
  "n_genes": 2000,
  "gene_names": ["Gene1", "Gene2", ...]
}
```

**注意:** 保存返回的 `analyzer_id`，后续所有操作都需要使用这个 ID。

#### 2. 计算相关性矩阵
```
POST /api/ivcca/calculate-correlation
```

**参数:**
- `analyzer_id` (str, 必需): 分析器 ID
- `method` (str, 可选): 相关性方法 ("pearson", "spearman", "kendall")，默认 "pearson"

**响应:**
```json
{
  "status": "success",
  "message": "Correlation matrix calculated successfully",
  "matrix_size": [2000, 2000],
  "statistics": {
    "mean": 0.15,
    "std": 0.25,
    "min": -0.89,
    "max": 0.95,
    "median": 0.12
  }
}
```

#### 3. 排序相关性矩阵
```
POST /api/ivcca/sort-matrix
```

**参数:**
- `analyzer_id` (str, 必需)
- `sort_by` (str, 可选): 排序方法 ("magnitude", "mean", "max")，默认 "magnitude"

**响应:**
```json
{
  "status": "success",
  "message": "Matrix sorted successfully",
  "sorted_matrix": [[...], [...]],
  "sorted_gene_names": ["Gene1", "Gene2", ...],
  "sorted_scores": [0.95, 0.89, ...],
  "sorted_indices": [0, 1, ...]
}
```

#### 4. 生成相关性热图
```
POST /api/ivcca/heatmap
```

**参数:**
- `analyzer_id` (str, 必需)
- `sorted` (bool, 可选): 是否使用排序后的矩阵，默认 false

**响应:**
```json
{
  "image_base64": "iVBORw0KGgoAAAANSUhEUg...",
  "sorted": false
}
```

**注意:** `image_base64` 是 PNG 图像的 base64 编码字符串，可以直接用于 `<img src="data:image/png;base64,..." />`

#### 5. 生成相关性直方图
```
POST /api/ivcca/histogram
```

**参数:**
- `analyzer_id` (str, 必需)

**响应:**
```json
{
  "image_base64": "iVBORw0KGgoAAAANSUhEUg..."
}
```

### 聚类分析端点

#### 6. 计算最优聚类数
```
POST /api/ivcca/optimal-clusters
```

**参数:**
- `analyzer_id` (str, 必需)
- `max_k` (int, 可选): 最大聚类数，默认 10

**响应:**
```json
{
  "status": "success",
  "optimal_k_elbow": 5,
  "optimal_k_silhouette": 6,
  "inertias": [100.5, 80.2, ...],
  "silhouette_scores": [0.45, 0.52, ...],
  "k_range": [2, 3, 4, ..., 10]
}
```

#### 7. 生成聚类树状图
```
POST /api/ivcca/dendrogram
```

**参数:**
- `analyzer_id` (str, 必需)
- `threshold` (float, 可选): 聚类距离阈值
- `method` (str, 可选): 链接方法 ("ward", "complete", "average", "single")，默认 "ward"

**响应:**
```json
{
  "image_base64": "iVBORw0KGgoAAAANSUhEUg..."
}
```

### 降维分析端点

#### 8. PCA 分析
```
POST /api/ivcca/pca
```

**参数:**
- `analyzer_id` (str, 必需)
- `n_components` (int, 可选): 主成分数量，默认 3

**响应:**
```json
{
  "status": "success",
  "scores": [[...], [...], ...],
  "explained_variance": [0.45, 0.25, 0.15],
  "cumulative_variance": [0.45, 0.70, 0.85],
  "components": [[...], [...], ...],
  "n_components": 3
}
```

#### 9. t-SNE 分析
```
POST /api/ivcca/tsne
```

**参数:**
- `analyzer_id` (str, 必需)
- `n_components` (int, 可选): 维度数 (2 或 3)，默认 2
- `perplexity` (float, 可选): 困惑度参数，默认 30.0

**响应:**
```json
{
  "status": "success",
  "scores": [[...], [...], ...],
  "n_components": 2
}
```

### 通路分析端点

#### 10. 单通路分析
```
POST /api/ivcca/single-pathway
```

**参数:**
- `analyzer_id` (str, 必需)
- `pathway_file` (File, 必需): 通路基因列表文件 (.txt，每行一个基因名)

**响应:**
```json
{
  "status": "success",
  "pathway_size": 25,
  "sorted_genes": ["Gene1", "Gene2", ...],
  "sorted_scores": [0.95, 0.89, ...],
  "correlation_matrix": [[...], [...], ...],
  "mean_correlation": 0.45
}
```

#### 11. 通路比较
```
POST /api/ivcca/compare-pathways
```

**参数:**
- `analyzer_id` (str, 必需)
- `pathway1_file` (File, 必需): 第一个通路基因列表
- `pathway2_file` (File, 必需): 第二个通路基因列表

**响应:**
```json
{
  "status": "success",
  "cosine_similarity": 0.78,
  "pathway1_size": 25,
  "pathway2_size": 30,
  "intersection_size": 12,
  "intersection_genes": ["Gene1", "Gene2", ...]
}
```

### 两数据集相关性分析端点

#### 12. 加载数据集 A
```
POST /api/ivcca/two-set/load-data-a
```

**参数:**
- `file` (File, 必需): 第一个数据集文件

**响应:**
```json
{
  "analyzer_id": "xyz789...",
  "status": "success",
  "message": "Data A loaded: 50 samples x 1500 genes"
}
```

#### 13. 加载数据集 B
```
POST /api/ivcca/two-set/load-data-b
```

**参数:**
- `analyzer_id` (str, 必需): TwoSet 分析器 ID
- `file` (File, 必需): 第二个数据集文件

**响应:**
```json
{
  "analyzer_id": "xyz789...",
  "status": "success",
  "message": "Data B loaded: 50 samples x 1800 genes"
}
```

#### 14. 计算两数据集相关性
```
POST /api/ivcca/two-set/calculate
```

**参数:**
- `analyzer_id` (str, 必需)

**响应:**
```json
{
  "status": "success",
  "message": "Correlation matrix calculated",
  "matrix_size": [1500, 1800],
  "mean_correlation": 0.12,
  "max_correlation": 0.89,
  "min_correlation": -0.76
}
```

#### 15. 生成两数据集相关性热图
```
POST /api/ivcca/two-set/heatmap
```

**参数:**
- `analyzer_id` (str, 必需)
- `sorted` (bool, 可选): 是否使用排序后的矩阵，默认 false

**响应:**
```json
{
  "image_base64": "iVBORw0KGgoAAAANSUhEUg..."
}
```

## 使用示例

### Python 示例

```python
import requests

# 1. 加载数据
with open('data.xlsx', 'rb') as f:
    response = requests.post(
        'http://localhost:8000/api/ivcca/load-data',
        files={'file': f}
    )
data = response.json()
analyzer_id = data['analyzer_id']

# 2. 计算相关性
response = requests.post(
    'http://localhost:8000/api/ivcca/calculate-correlation',
    data={'analyzer_id': analyzer_id, 'method': 'pearson'}
)
corr_result = response.json()

# 3. 生成热图
response = requests.post(
    'http://localhost:8000/api/ivcca/heatmap',
    data={'analyzer_id': analyzer_id, 'sorted': True}
)
heatmap = response.json()
image_base64 = heatmap['image_base64']

# 4. PCA 分析
response = requests.post(
    'http://localhost:8000/api/ivcca/pca',
    data={'analyzer_id': analyzer_id, 'n_components': 3}
)
pca_result = response.json()
```

### JavaScript/TypeScript 示例 (前端)

```typescript
// 加载数据
const formData = new FormData();
formData.append('file', fileInput.files[0]);

const loadResponse = await fetch('http://localhost:8000/api/ivcca/load-data', {
  method: 'POST',
  body: formData
});
const loadData = await loadResponse.json();
const analyzerId = loadData.analyzer_id;

// 计算相关性
const corrFormData = new FormData();
corrFormData.append('analyzer_id', analyzerId);
corrFormData.append('method', 'pearson');

const corrResponse = await fetch('http://localhost:8000/api/ivcca/calculate-correlation', {
  method: 'POST',
  body: corrFormData
});
const corrData = await corrResponse.json();

// 显示热图
const heatmapFormData = new FormData();
heatmapFormData.append('analyzer_id', analyzerId);
heatmapFormData.append('sorted', 'true');

const heatmapResponse = await fetch('http://localhost:8000/api/ivcca/heatmap', {
  method: 'POST',
  body: heatmapFormData
});
const heatmapData = await heatmapResponse.json();

// 在 HTML 中显示
const img = document.createElement('img');
img.src = `data:image/png;base64,${heatmapData.image_base64}`;
document.body.appendChild(img);
```

## 数据格式要求

### 输入数据文件格式
- **第一列**: 样本名称（文本）
- **第一行**: 基因名称（文本，从第二列开始）
- **其他单元格**: 数值（基因表达值）

示例：
```
Sample    Gene1    Gene2    Gene3
Sample1   2.5      1.8      3.2
Sample2   2.3      1.9      3.1
Sample3   2.7      1.7      3.3
```

### 通路基因列表文件格式
纯文本文件 (.txt)，每行一个基因名称：
```
Gene1
Gene2
Gene3
...
```

## 注意事项

1. **分析器 ID**: 每个分析会话都有一个唯一的 `analyzer_id`，需要保存并在后续请求中使用。分析器实例会保存在服务器内存中。

2. **文件大小**: 大文件（>100MB）可能需要较长处理时间。建议：
   - 使用基因列表过滤减少数据量
   - 对大数据集使用采样

3. **内存管理**: 分析器实例存储在内存中。在生产环境中，建议实现过期清理机制。

4. **并发**: 当前实现使用字典存储分析器实例。多个用户可以同时进行分析，每个用户有独立的分析器 ID。

5. **错误处理**: 所有端点都包含错误处理，会返回适当的 HTTP 状态码和错误消息。

### 16. Gene to Genes 分析
```
POST /api/ivcca/gene-to-genes
```

**参数:**
- `analyzer_id` (str, 必需): 分析器 ID
- `single_gene` (str, 必需): 单个基因名称
- `target_genes_file` (File, 必需): 目标基因列表文件 (.txt，每行一个基因名)

**响应:**
```json
{
  "status": "success",
  "single_gene": "Gene1",
  "target_genes": ["Gene2", "Gene3", ...],
  "correlations": [0.95, 0.89, ...],
  "avg_abs_correlation": 0.45,
  "n_targets": 25
}
```

### 17. Gene to Pathways 分析
```
POST /api/ivcca/gene-to-pathways
```

**参数:**
- `analyzer_id` (str, 必需): 分析器 ID
- `single_gene` (str, 必需): 单个基因名称
- `pathway_files` (File[], 必需): 多个通路基因列表文件 (.txt)

**响应:**
```json
{
  "status": "success",
  "single_gene": "Gene1",
  "pathways": [
    {
      "pathway_file": "pathway1.txt",
      "pathway_size": 25,
      "genes_found": 20,
      "avg_correlation": 0.45,
      "avg_abs_correlation": 0.52
    }
  ],
  "n_pathways": 5
}
```

### 18. Multi-Pathway 分析
```
POST /api/ivcca/multi-pathway
```

**参数:**
- `analyzer_id` (str, 必需): 分析器 ID
- `pathway_files` (File[], 必需): 多个通路基因列表文件 (.txt)
- `min_genes_threshold` (int, 可选): 最小基因数阈值，默认 5
- `sorted_matrix` (str, 可选): 是否使用排序矩阵 ("true"/"false")

**响应:**
```json
{
  "status": "success",
  "pathways": [
    {
      "pathway_file": "pathway1.txt",
      "total_genes_in_pathway": 25,
      "genes_found_in_set": 20,
      "pai": 0.8,
      "pci_a": 0.45,
      "pci_b": 0.52,
      "ceci": 8.32,
      "z_score": 0.2
    }
  ],
  "n_pathways": 5
}
```

### 19. Venn Diagram
```
POST /api/ivcca/venn-diagram
```

**参数:**
- `analyzer_id` (str, 必需): 分析器 ID
- `pathway1_file` (File, 必需): 第一个通路基因列表
- `pathway2_file` (File, 必需): 第二个通路基因列表

**响应:**
```json
{
  "status": "success",
  "image_base64": "iVBORw0KGgoAAAANSUhEUg...",
  "pathway1_size": 25,
  "pathway2_size": 30,
  "intersection_size": 12,
  "intersection_genes": ["Gene1", "Gene2", ...],
  "only_pathway1": ["Gene3", ...],
  "only_pathway2": ["Gene4", ...]
}
```

### 20. Network Analysis
```
POST /api/ivcca/network-analysis
```

**参数:**
- `analyzer_id` (str, 必需): 分析器 ID
- `pathway_file` (File, 可选): 通路基因列表文件（如果提供，只分析该通路）
- `threshold` (float, 可选): 相关性阈值，默认 0.75
- `plot_type` (str, 可选): 图表类型 ("2D" 或 "3D")，默认 "2D"

**响应:**
```json
{
  "status": "success",
  "image_base64": "iVBORw0KGgoAAAANSUhEUg...",
  "n_nodes": 50,
  "n_edges": 120,
  "threshold": 0.75,
  "plot_type": "2D",
  "node_degrees": [
    {"gene": "Gene1", "degree": 15},
    {"gene": "Gene2", "degree": 12},
    ...
  ]
}
```

## 与 MATLAB 版本的对比

| 功能 | MATLAB IVCCA | Python API |
|------|-------------|------------|
| 数据加载 | ✅ | ✅ |
| 相关性计算 | ✅ | ✅ |
| 排序功能 | ✅ | ✅ |
| 热图可视化 | ✅ | ✅ |
| 直方图 | ✅ | ✅ |
| Elbow/Silhouette | ✅ | ✅ |
| Dendrogram | ✅ | ✅ |
| PCA | ✅ | ✅ |
| t-SNE | ✅ | ✅ |
| Single Pathway | ✅ | ✅ |
| Multi Pathways | ✅ | ✅ |
| Gene to Genes | ✅ | ✅ |
| Gene to Pathways | ✅ | ✅ |
| Compare Pathways | ✅ | ✅ |
| TwoSetCorrTool | ✅ | ✅ |
| Venn Diagram | ✅ | ✅ |
| Network Analysis | ✅ | ✅ |

所有功能已完全实现！

## 依赖项

新增功能需要以下额外依赖：
- `networkx>=2.6.0` - 用于网络图生成
- `matplotlib-venn>=0.11.0` - 用于 Venn 图生成（可选，有fallback实现）

安装命令：
```bash
pip install networkx matplotlib-venn
```

## 未来改进

1. **会话管理**: 实现 Redis 或数据库存储分析器状态，支持长期会话
2. **批处理**: 支持批量通路分析
3. **缓存**: 相关性矩阵计算结果的缓存机制
4. **前端完整实现**: 为所有新功能添加完整的UI表单和交互

## 引用

如果使用此工具，请引用原始 MATLAB 版本：

Junwei Du; Leland C. Sudlow; Hridoy Biswas; Joshua D. Mitchell; Shamim Mollah; Mikhail Y. Berezin, Identification Drug Targets for Oxaliplatin-Induced Cardiotoxicity without affecting cancer treatment through Inter Variability Cross-Correlation Analysis (IVCCA), BIORXIV/2024/579390



