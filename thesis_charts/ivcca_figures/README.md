# IVCCA 论文图表说明

本目录包含用于IVCCA论文的示例图表。所有图表都提供了PNG（高分辨率）和PDF（矢量格式）两种格式。

## 生成的图表列表

### 1. ivcca_correlation_heatmap.png/pdf
**相关性矩阵热图**
- 展示50个基因之间的Pearson相关系数矩阵
- 颜色编码：红色表示正相关，蓝色表示负相关
- 包含聚类结构的可视化

### 2. ivcca_ceci_barchart.png/pdf
**CECI条形图**
- 展示前25个通路的CECI（相关性-表达复合指数）值
- 绿色表示显著激活（Z-score > 1.96）
- 包含背景均值和显著性阈值参考线

### 3. ivcca_pci_comparison.png/pdf
**PCI_A vs PCI_B散点图**
- 比较通路内相关性（PCI_A）与全局相关性（PCI_B）
- 蓝色点表示PCI_A > PCI_B（通路内相关性更强）
- 橙色点表示PCI_A < PCI_B（全局相关性更强）
- 对角线表示两者相等

### 4. ivcca_zscore_significance.png/pdf
**Z-score统计显著性图**
- 展示Z-score显著的通路（|Z| > 1.96）
- 绿色表示正Z-score（激活），红色表示负Z-score（抑制）
- 包含临界Z值参考线（±1.96）

### 5. ivcca_network_2d.png/pdf
**2D网络图**
- 展示基因共表达网络
- 节点大小表示连接度（degree）
- 边的粗细表示相关性强度
- 圆形布局，高连接度基因用橙色虚线框标注

### 6. ivcca_venn_diagram.png/pdf
**Venn图**
- 展示两个通路的基因重叠情况
- 包含重叠基因数量和百分比统计
- 用于通路比较分析

### 7. ivcca_elbow_silhouette.png/pdf
**Elbow曲线和Silhouette分析**
- 左侧：Elbow曲线，用于确定最优聚类数K
- 右侧：Silhouette分析，评估聚类质量
- 标注了建议的最优K值

### 8. ivcca_correlation_histogram.png/pdf
**相关性分布直方图**
- 展示所有基因对的相关性系数分布
- 颜色编码表示相关性强度
- 包含均值和中位数参考线

## 使用方法

1. **在论文中引用**：
   - PNG格式适合插入Word文档或PowerPoint
   - PDF格式适合LaTeX文档，保持矢量清晰度

2. **自定义修改**：
   - 运行 `generate_ivcca_figures.py` 脚本
   - 修改脚本中的数据和参数以适配您的实际数据

3. **数据替换**：
   - 所有图表都使用模拟数据生成
   - 在论文中，请使用您的实际IVCCA分析结果

## 图表规格

- **分辨率**：300 DPI（PNG格式）
- **尺寸**：根据图表类型优化，适合学术论文打印
- **字体**：支持中英文混合显示
- **颜色**：使用学术友好的配色方案

## 注意事项

1. 这些是**示例图表**，使用的是模拟数据
2. 在论文中使用时，请确保使用您的实际分析结果
3. 所有图表的标题和标签可以根据需要进行调整
4. 建议在论文中为每个图表添加详细的图例说明

## 依赖库

生成这些图表需要以下Python库：
- matplotlib
- numpy
- seaborn
- matplotlib-venn
- scipy

安装命令：
```bash
pip install matplotlib numpy seaborn matplotlib-venn scipy
```

## 重新生成图表

如果需要重新生成所有图表，运行：
```bash
python generate_ivcca_figures.py
```

图表将保存到 `thesis_charts/ivcca_figures/` 目录。





