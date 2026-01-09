# t-SNE 算法一步一步实现详解

## 一、t-SNE 算法核心思想

t-SNE (t-Distributed Stochastic Neighbor Embedding) 是一种非线性降维算法，用于将高维数据映射到低维空间（通常是2D或3D），同时保持数据点之间的局部相似性。

**核心思想：**
- 在高维空间中，相似的点应该靠得近
- 在低维空间中，也要保持这种相似性
- 使用概率分布来建模相似性

---

## 二、算法步骤详解

### 步骤 1: 数据准备

```python
# 1.1 获取相关性矩阵（基因 x 基因）
data = np.abs(self.correlation_matrix)  # 取绝对值

# 1.2 处理缺失值
data_filled = np.nan_to_num(data, nan=0.0)  # NaN → 0

# 1.3 确定数据维度
n_genes = data_filled.shape[0]  # 基因数量
n_features = data_filled.shape[1]  # 特征数量（也是基因数量，因为是相关性矩阵）
```

**说明：**
- 输入是基因间的相关性矩阵
- 每个基因是一个数据点
- 矩阵大小：n_genes × n_genes

---

### 步骤 2: 调整 Perplexity 参数

```python
# 2.1 计算调整后的 perplexity
adjusted_perplexity = min(perplexity, max(5, (n_genes - 1) // 3))
```

**Perplexity 的作用：**
- 控制每个点考虑多少个邻居
- 典型值：5-50
- 必须满足：perplexity < n_genes
- 公式：`perplexity ≤ (n_genes - 1) / 3`

**为什么需要调整：**
- 如果基因数量太少，perplexity 不能太大
- 确保算法能正常工作

---

### 步骤 3: PCA 初始化（可选但推荐）

```python
# 3.1 执行 PCA 降维
pca_init = PCA(n_components=min(3, n_genes))
pca_scores_init = pca_init.fit_transform(data_filled)

# 3.2 提取前几个主成分
first_three_pcs = pca_scores_init[:, :min(3, n_genes)]

# 3.3 标准化
std_dev = np.std(first_three_pcs[:, 0])
first_three_pcs = first_three_pcs / std_dev

# 3.4 缩放（乘以小常数，如 MATLAB 版本）
first_three_pcs = first_three_pcs * 0.0001

# 3.5 准备初始化数据
if n_components == 3:
    init_data = first_three_pcs[:, :3]
elif n_components == 2:
    init_data = first_three_pcs[:, :2]
```

**为什么使用 PCA 初始化：**
- 提供更好的起始点
- 加速收敛
- 提高结果稳定性
- 与 MATLAB 版本保持一致

---

### 步骤 4: 计算高维空间的相似性（P 矩阵）

这是 t-SNE 的核心步骤之一。

#### 4.1 计算成对距离

```python
# 对于每对点 i 和 j，计算欧氏距离
distances = pairwise_distances(data_filled, metric='euclidean')
# 或者使用其他距离度量
```

#### 4.2 转换为条件概率（使用高斯分布）

对于点 i 和点 j，计算：

```python
# 4.2.1 计算未归一化的相似度
p_j_given_i = exp(-||x_i - x_j||² / (2 * σ_i²))

# 4.2.2 归一化（确保每行的概率和为1）
p_j_given_i = p_j_given_i / sum_k(p_k_given_i)

# 4.2.3 对称化（使 P 矩阵对称）
p_ij = (p_j_given_i + p_i_given_j) / (2 * n)
```

**σ_i 的确定：**
- 使用二分搜索找到合适的 σ_i
- 使得点 i 的 perplexity = 2^(-Σ p_j|i * log2(p_j|i))
- Perplexity 控制每个点考虑多少个邻居

**数学公式：**
```
p_{j|i} = exp(-||x_i - x_j||² / (2σ_i²)) / Σ_{k≠i} exp(-||x_i - x_k||² / (2σ_i²))

p_{ij} = (p_{j|i} + p_{i|j}) / (2n)
```

---

### 步骤 5: 初始化低维空间

```python
# 5.1 使用 PCA 初始化（如果提供了）
if init_data is provided:
    Y = init_data  # 形状: (n_genes, n_components)
else:
    # 5.2 随机初始化
    Y = random.normal(0, 1e-4, (n_genes, n_components))
```

**Y 矩阵：**
- 形状：n_genes × n_components（2 或 3）
- 每一行代表一个基因在低维空间的位置

---

### 步骤 6: 迭代优化（梯度下降）

这是 t-SNE 的核心优化过程。

#### 6.1 计算低维空间的相似性（Q 矩阵）

使用 t-分布（而不是高斯分布）：

```python
# 6.1.1 计算低维空间的距离
d_ij = ||y_i - y_j||²

# 6.1.2 计算未归一化的相似度（使用 t-分布）
q_ij = (1 + d_ij)^(-1)

# 6.1.3 归一化
q_ij = q_ij / Σ_{k≠l} q_kl
```

**数学公式：**
```
q_{ij} = (1 + ||y_i - y_j||²)^(-1) / Σ_{k≠l} (1 + ||y_k - y_l||²)^(-1)
```

**为什么使用 t-分布：**
- t-分布有更重的尾部
- 可以更好地分离不同簇
- 避免"拥挤问题"（crowding problem）

#### 6.2 计算损失函数（KL 散度）

```python
# KL 散度衡量 P 和 Q 的差异
KL_divergence = Σ_i Σ_j p_ij * log(p_ij / q_ij)
```

**目标：**
- 最小化 KL 散度
- 使低维空间的分布 Q 尽可能接近高维空间的分布 P

#### 6.3 计算梯度

```python
# 对每个点 y_i 的梯度
gradient_i = 4 * Σ_j (p_ij - q_ij) * (y_i - y_j) * (1 + ||y_i - y_j||²)^(-1)
```

**梯度含义：**
- 如果 p_ij > q_ij：点 i 和 j 应该更靠近
- 如果 p_ij < q_ij：点 i 和 j 应该更远离

#### 6.4 更新位置（梯度下降）

```python
# 6.4.1 计算动量（加速收敛）
momentum = 0.5 if iteration < 250 else 0.8

# 6.4.2 更新梯度（带动量）
gradient = gradient + momentum * previous_gradient

# 6.4.3 更新位置
Y = Y - learning_rate * gradient

# 6.4.4 学习率调整（早期放大）
if iteration < 250:
    learning_rate = initial_learning_rate * (1 - iteration / 250)
```

**参数说明：**
- `learning_rate`: 学习率（通常 200-1000）
- `momentum`: 动量（早期 0.5，后期 0.8）
- `n_iter`: 迭代次数（通常 1000）

#### 6.5 迭代循环

```python
for iteration in range(n_iter):
    # 计算 Q 矩阵
    Q = compute_q_matrix(Y)
    
    # 计算梯度
    gradient = compute_gradient(P, Q, Y)
    
    # 更新位置
    Y = update_positions(Y, gradient, learning_rate, momentum)
    
    # 检查收敛
    if no_progress_for_n_iterations:
        break
```

---

### 步骤 7: 方法选择（Exact vs Barnes-Hut）

```python
if n_genes < 1000:
    method = 'exact'  # 精确方法，计算所有成对距离
else:
    method = 'barnes_hut'  # 近似方法，使用树结构加速
```

**Exact 方法：**
- 时间复杂度：O(n²)
- 精确计算所有成对距离
- 适用于小数据集（< 1000 点）

**Barnes-Hut 方法：**
- 时间复杂度：O(n log n)
- 使用四叉树/八叉树近似
- 适用于大数据集（≥ 1000 点）

---

## 三、完整算法流程总结

```
输入：高维数据 X (n_genes × n_features)
输出：低维嵌入 Y (n_genes × n_components)

1. 数据预处理
   - 处理缺失值
   - 标准化（可选）

2. 计算高维相似性矩阵 P
   - 计算成对距离
   - 使用高斯分布转换为概率
   - 对称化

3. 初始化低维嵌入 Y
   - 使用 PCA 初始化（推荐）
   - 或随机初始化

4. 迭代优化（梯度下降）
   For iteration = 1 to n_iter:
     a. 计算低维相似性矩阵 Q（使用 t-分布）
     b. 计算 KL 散度损失
     c. 计算梯度
     d. 更新 Y 的位置
     e. 检查收敛条件

5. 返回低维嵌入 Y
```

---

## 四、在你的代码中的实现

你的代码使用 scikit-learn 的 `TSNE` 类，它内部实现了上述所有步骤：

```python
tsne = TSNE(
    n_components=n_components,        # 输出维度（2 或 3）
    perplexity=adjusted_perplexity,   # Perplexity 参数
    random_state=random_state,        # 随机种子
    n_iter=1000,                      # 迭代次数
    init=init_data,                   # 初始化（PCA 或随机）
    n_iter_without_progress=300,     # 无进展时停止
    method='exact' or 'barnes_hut'    # 计算方法
)

tsne_scores = tsne.fit_transform(data_filled)
```

**关键参数：**
- `n_components`: 输出维度（2D 或 3D）
- `perplexity`: 控制局部/全局平衡（通常 5-50）
- `init`: 初始化方式（PCA 初始化效果更好）
- `method`: 计算方法（根据数据量选择）

---

## 五、算法特点

### 优点：
1. **保持局部结构**：相似的点在低维空间也靠近
2. **非线性降维**：能处理复杂的非线性关系
3. **可视化效果好**：适合 2D/3D 可视化

### 缺点：
1. **计算复杂度高**：O(n²) 或 O(n log n)
2. **参数敏感**：perplexity 需要调优
3. **随机性**：每次运行结果可能不同
4. **不能用于新数据**：只能嵌入训练数据

---

## 六、在你的项目中的应用

在你的基因分析项目中：

1. **输入**：基因间的相关性矩阵（n_genes × n_genes）
2. **输出**：每个基因在 2D/3D 空间的位置
3. **用途**：
   - 可视化基因之间的关系
   - 发现基因簇
   - 识别功能相似的基因组

**可视化：**
- 每个点代表一个基因
- 靠近的点表示相关性高
- 可以叠加聚类结果（K-means）进行着色

---

## 七、数学公式总结

### 高维空间（P 矩阵）：
```
p_{j|i} = exp(-||x_i - x_j||² / (2σ_i²)) / Σ_{k≠i} exp(-||x_i - x_k||² / (2σ_i²))
p_{ij} = (p_{j|i} + p_{i|j}) / (2n)
```

### 低维空间（Q 矩阵）：
```
q_{ij} = (1 + ||y_i - y_j||²)^(-1) / Σ_{k≠l} (1 + ||y_k - y_l||²)^(-1)
```

### 损失函数（KL 散度）：
```
C = KL(P||Q) = Σ_i Σ_j p_{ij} log(p_{ij} / q_{ij})
```

### 梯度：
```
∂C/∂y_i = 4 Σ_j (p_{ij} - q_{ij}) (y_i - y_j) (1 + ||y_i - y_j||²)^(-1)
```

---

这就是 t-SNE 算法的完整实现过程！






