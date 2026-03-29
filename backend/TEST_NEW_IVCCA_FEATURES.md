# 新IVCCA功能测试指南

## 前置条件

1. 安装新依赖：
```bash
pip install networkx matplotlib-venn
```

2. 确保后端服务器运行：
```bash
cd backend
python server.py
# 或
uvicorn server:app --reload
```

## 测试步骤

### 1. 加载数据（必需的第一步）

```bash
curl -X POST "http://localhost:8000/api/ivcca/load-data" \
  -F "file=@your_data.xlsx"
```

保存返回的 `analyzer_id`，后续所有请求都需要使用它。

### 2. 计算相关性矩阵

```bash
curl -X POST "http://localhost:8000/api/ivcca/calculate-correlation" \
  -F "analyzer_id=YOUR_ANALYZER_ID" \
  -F "method=pearson"
```

### 3. 测试 Gene to Genes

创建目标基因文件 `target_genes.txt`：
```
Gene1
Gene2
Gene3
```

```bash
curl -X POST "http://localhost:8000/api/ivcca/gene-to-genes" \
  -F "analyzer_id=YOUR_ANALYZER_ID" \
  -F "single_gene=YourGeneName" \
  -F "target_genes_file=@target_genes.txt"
```

### 4. 测试 Gene to Pathways

准备多个通路文件（如 `pathway1.txt`, `pathway2.txt`）：

```bash
curl -X POST "http://localhost:8000/api/ivcca/gene-to-pathways" \
  -F "analyzer_id=YOUR_ANALYZER_ID" \
  -F "single_gene=YourGeneName" \
  -F "pathway_files=@pathway1.txt" \
  -F "pathway_files=@pathway2.txt"
```

### 5. 测试 Multi-Pathway

```bash
curl -X POST "http://localhost:8000/api/ivcca/multi-pathway" \
  -F "analyzer_id=YOUR_ANALYZER_ID" \
  -F "pathway_files=@pathway1.txt" \
  -F "pathway_files=@pathway2.txt" \
  -F "min_genes_threshold=5" \
  -F "sorted_matrix=false"
```

### 6. 测试 Venn Diagram

```bash
curl -X POST "http://localhost:8000/api/ivcca/venn-diagram" \
  -F "analyzer_id=YOUR_ANALYZER_ID" \
  -F "pathway1_file=@pathway1.txt" \
  -F "pathway2_file=@pathway2.txt"
```

返回的 `image_base64` 可以直接在HTML中使用：
```html
<img src="data:image/png;base64,{image_base64}" />
```

### 7. 测试 Network Analysis

#### 2D网络图（使用所有基因）：
```bash
curl -X POST "http://localhost:8000/api/ivcca/network-analysis" \
  -F "analyzer_id=YOUR_ANALYZER_ID" \
  -F "threshold=0.75" \
  -F "plot_type=2D"
```

#### 3D网络图（使用特定通路）：
```bash
curl -X POST "http://localhost:8000/api/ivcca/network-analysis" \
  -F "analyzer_id=YOUR_ANALYZER_ID" \
  -F "pathway_file=@pathway1.txt" \
  -F "threshold=0.75" \
  -F "plot_type=3D"
```

## Python测试脚本示例

```python
import requests
import base64
from io import BytesIO
from PIL import Image

API_BASE = "http://localhost:8000"

# 1. 加载数据
with open("data.xlsx", "rb") as f:
    response = requests.post(
        f"{API_BASE}/api/ivcca/load-data",
        files={"file": f}
    )
data = response.json()
analyzer_id = data["analyzer_id"]
print(f"Analyzer ID: {analyzer_id}")

# 2. 计算相关性
response = requests.post(
    f"{API_BASE}/api/ivcca/calculate-correlation",
    data={"analyzer_id": analyzer_id, "method": "pearson"}
)
print("Correlation calculated:", response.json()["status"])

# 3. 测试 Gene to Genes
with open("target_genes.txt", "rb") as f:
    response = requests.post(
        f"{API_BASE}/api/ivcca/gene-to-genes",
        data={"analyzer_id": analyzer_id, "single_gene": "Gene1"},
        files={"target_genes_file": f}
    )
result = response.json()
print(f"Gene to Genes: {result['n_targets']} targets found")

# 4. 测试 Venn Diagram
with open("pathway1.txt", "rb") as f1, open("pathway2.txt", "rb") as f2:
    response = requests.post(
        f"{API_BASE}/api/ivcca/venn-diagram",
        data={"analyzer_id": analyzer_id},
        files={"pathway1_file": f1, "pathway2_file": f2}
    )
result = response.json()
if result["status"] == "success":
    # 保存图像
    img_data = base64.b64decode(result["image_base64"])
    img = Image.open(BytesIO(img_data))
    img.save("venn_diagram.png")
    print("Venn diagram saved to venn_diagram.png")

# 5. 测试 Network Analysis
response = requests.post(
    f"{API_BASE}/api/ivcca/network-analysis",
    data={
        "analyzer_id": analyzer_id,
        "threshold": "0.75",
        "plot_type": "2D"
    }
)
result = response.json()
if result["status"] == "success":
    img_data = base64.b64decode(result["image_base64"])
    img = Image.open(BytesIO(img_data))
    img.save("network_2d.png")
    print(f"Network graph saved: {result['n_nodes']} nodes, {result['n_edges']} edges")
```

## 常见问题

### 1. NetworkX未安装
错误：`NetworkX library required for network analysis`
解决：`pip install networkx`

### 2. matplotlib-venn未安装
Venn图会使用fallback实现（简单的圆形图），功能仍然可用。

### 3. 多文件上传问题
FastAPI的`List[UploadFile]`需要确保所有文件都在同一个请求中。

### 4. 内存问题
对于大型数据集，网络分析可能会消耗大量内存。建议：
- 使用通路文件过滤基因
- 提高相关性阈值以减少边数

## 性能建议

1. **网络分析**：对于超过1000个基因的数据集，建议使用通路文件过滤
2. **Multi-Pathway**：可以设置较高的`min_genes_threshold`来过滤小通路
3. **Venn Diagram**：处理速度很快，适合实时交互

## 下一步开发建议

1. **前端完整实现**：
   - 为每个功能添加表单UI
   - 文件上传组件
   - 结果可视化组件

2. **批量处理**：
   - 支持批量通路分析
   - 结果导出为Excel/CSV

3. **缓存优化**：
   - 缓存相关性矩阵计算结果
   - 减少重复计算

