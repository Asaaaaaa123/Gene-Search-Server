
# GenoCorr 平台完整系统架构文档

## 目录

1. [整体架构概述](#整体架构概述)
2. [三层架构详解](#三层架构详解)
3. [前端架构详细设计](#前端架构详细设计)
4. [后端架构详细设计](#后端架构详细设计)
5. [数据流与交互流程](#数据流与交互流程)
6. [核心模块架构](#核心模块架构)
7. [API接口架构](#api接口架构)
8. [数据库架构](#数据库架构)
9. [部署架构](#部署架构)
10. [技术栈详解](#技术栈详解)

---

## 整体架构概述

### 架构模式

GenoCorr 平台采用**三层客户端-服务器架构**（Three-Tier Client-Server Architecture），结合**RESTful API**通信模式和**前后端分离**的设计理念。

```
┌─────────────────────────────────────────────────────────────┐
│                     表示层 (Presentation Layer)                │
│                    Next.js 15.3.5 Frontend                    │
│                  (React 19.0 + TypeScript)                    │
└────────────────────┬──────────────────────────────────────────┘
                     │ HTTP/REST API (JSON)
                     │ Port: 8000
┌────────────────────▼──────────────────────────────────────────┐
│                   业务逻辑层 (Business Logic Layer)             │
│                   FastAPI 0.68.0 Backend                      │
│                    (Python 3.9+)                              │
└───────┬────────────────────────┬──────────────┬───────────────┘
        │                        │              │
        │                        │              │
┌───────▼────────┐  ┌───────────▼──────┐  ┌───▼──────────────┐
│   MongoDB      │  │   GProfiler API  │  │  File System     │
│  (数据持久层)   │  │  (外部API服务)    │  │  (Excel/CSV/TSV) │
│                │  │                  │  │                  │
│ gene_search_db │  │ 富集分析服务      │  │ 后端数据文件      │
└────────────────┘  └──────────────────┘  └──────────────────┘
```

### 架构层次说明

1. **表示层（前端）**：用户界面和交互
2. **业务逻辑层（后端）**：核心业务处理和算法
3. **数据持久层**：数据存储和外部服务集成

---

## 三层架构详解

### 第一层：表示层（Frontend - Next.js）

#### 技术栈

- **框架**：Next.js 15.3.5（基于 React 19.0）
- **语言**：TypeScript 5.x
- **样式**：Tailwind CSS 4.x
- **可视化**：Plotly.js 2.35.3
- **构建工具**：Turbopack（Next.js内置）

#### 前端目录结构

```
genegen/
├── app/                          # Next.js App Router
│   ├── layout.tsx               # 根布局组件
│   ├── page.tsx                 # 首页
│   ├── globals.css              # 全局样式
│   │
│   ├── gene-search/             # 模块1：基因搜索
│   │   └── page.tsx            # 基因搜索页面组件
│   │
│   ├── gene-ontology/           # 模块2：主题分析
│   │   ├── page.tsx            # 主题分析入口页
│   │   ├── default-theme/      # 默认主题分析
│   │   │   └── page.tsx
│   │   └── customize-theme/    # 自定义主题分析
│   │       └── page.tsx
│   │
│   ├── ivcca/                   # 模块3：IVCCA分析
│   │   └── page.tsx            # IVCCA分析页面
│   │
│   ├── login/                   # 认证页面
│   │   └── page.tsx
│   │
│   ├── add-gene/                # 添加基因数据（需认证）
│   │   └── page.tsx
│   │
│   └── upload-csv/              # CSV上传功能
│       └── page.tsx
│
├── public/                      # 静态资源
│   └── 885_genes.txt           # 示例基因列表
│
├── package.json                 # 依赖配置
├── tsconfig.json                # TypeScript配置
└── next.config.ts               # Next.js配置
```

#### 前端组件架构

**1. 页面组件（Page Components）**

每个页面都是一个独立的 React 组件，使用 `'use client'` 指令标记为客户端组件。

```typescript
// 示例：基因搜索页面结构
export default function GeneSearch() {
  // 状态管理
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<GeneData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // API调用
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  
  // 事件处理函数
  const handleSearch = async () => {
    // 调用后端API
    const response = await fetch(`${API_BASE_URL}/api/gene/symbol/search?gene_symbol=${searchTerm}`);
    const data = await response.json();
    setSearchResults(data.data);
  };
  
  // UI渲染
  return (
    // JSX结构
  );
}
```

**2. 状态管理架构**

- **本地状态**：使用 React `useState` Hook
- **全局状态**：通过 Context API 或 props传递
- **API状态**：每次API调用时独立管理
- **缓存策略**：浏览器 localStorage（认证token）

**3. 数据获取流程**

```
用户操作 → 事件触发 → API调用 → 状态更新 → UI重渲染
```

#### 前端-后端通信

**通信协议**：
- **协议**：HTTP/HTTPS
- **数据格式**：JSON
- **方法**：GET, POST
- **认证**：Token-based（存储在localStorage）

**API调用模式**：

```typescript
// 标准API调用模式
const response = await fetch(`${API_BASE_URL}/api/endpoint`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(requestData),
});

const data = await response.json();
```

**错误处理**：
- Try-catch 捕获网络错误
- HTTP状态码检查
- 用户友好的错误提示

### 第二层：业务逻辑层（Backend - FastAPI）

#### 技术栈

- **框架**：FastAPI 0.68.0
- **语言**：Python 3.9+
- **数据科学库**：
  - pandas：数据处理
  - NumPy：数值计算
  - SciPy：科学计算
  - scikit-learn：机器学习
- **可视化**：matplotlib, seaborn
- **外部服务**：GProfiler Python客户端

#### 后端目录结构

```
backend/
├── server.py                    # FastAPI主应用（1900+行）
├── ivcca_core.py               # IVCCA核心算法模块（2200+行）
├── start_backend.py            # 后端启动脚本
├── requirements.txt            # Python依赖
│
├── data/                       # 数据文件目录
│   ├── BoneMarrow.xlsx
│   ├── Cortex.xlsx
│   ├── DRG.xlsx
│   ├── Fat.xlsx
│   ├── Heart.xlsx
│   ├── Hypothalamus.xlsx
│   ├── Kidneys.xlsx
│   ├── Liver.xlsx
│   └── Muscle.xlsx
│
└── .env                        # 环境变量配置
```

#### 后端应用架构

**1. FastAPI 应用初始化**

```python
# server.py
app = FastAPI(title="Gene Expression Search API", version="1.0.0")

# CORS中间件配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**2. API类组织**

```python
# 三个主要API类
class GeneSearchAPI:
    """基因搜索API类"""
    - load_data_to_mongodb()
    - search_gene_data()
    - create_fold_change_plot()
    # ...

class GeneOntologyAPI:
    """基因本体分析API类"""
    - enrich()
    - assign_theme()
    - aggregate()
    - create_theme_chart()
    # ...

# IVCCA功能通过 ivcca_core.py 中的类实现
# 在 server.py 中直接使用 IVCCAAnalyzer 类
```

**3. 请求处理流程**

```
HTTP请求 → FastAPI路由 → Pydantic验证 → 业务逻辑 → 数据处理 → 响应返回
```

#### API端点组织

**端点分类**：

1. **认证端点**：
   - `POST /api/auth/login` - Token认证

2. **基因搜索端点**（7个）：
   - `GET /api/gene/symbols` - 获取所有基因符号
   - `GET /api/gene/symbol/search` - 搜索基因
   - `GET /api/gene/symbol/showFoldChange` - Fold Change图
   - `GET /api/gene/symbol/showLSMeanControl` - 对照组图
   - `GET /api/gene/symbol/showLSMeanTenMgKg` - 处理组图
   - `POST /api/gene/add` - 添加基因（需认证）

3. **主题分析端点**（4个）：
   - `POST /api/ontology/analyze` - 标准富集分析
   - `POST /api/ontology/custom-analyze` - 自定义主题分析
   - `POST /api/ontology/theme-chart` - 主题详细图
   - `POST /api/ontology/custom-summary-chart` - 主题汇总图

4. **IVCCA分析端点**（14个）：
   - `POST /api/ivcca/load-data` - 加载数据
   - `POST /api/ivcca/calculate-correlation` - 计算相关性
   - `POST /api/ivcca/sort-matrix` - 排序矩阵
   - `POST /api/ivcca/heatmap` - 热图
   - `POST /api/ivcca/histogram` - 直方图
   - `POST /api/ivcca/optimal-clusters` - 最优聚类数
   - `POST /api/ivcca/dendrogram` - 系统树图
   - `POST /api/ivcca/pca` - PCA分析
   - `POST /api/ivcca/tsne` - t-SNE分析
   - `POST /api/ivcca/single-pathway` - 单通路分析
   - `POST /api/ivcca/compare-pathways` - 通路比较
   - `POST /api/ivcca/gene-to-genes` - 基因到基因
   - `POST /api/ivcca/gene-to-pathways` - 基因到通路
   - `POST /api/ivcca/multi-pathway` - 多通路分析
   - `POST /api/ivcca/venn-diagram` - Venn图
   - `POST /api/ivcca/network-analysis` - 网络分析

5. **工具端点**：
   - `GET /api/health` - 健康检查
   - `GET /api/test` - 测试端点
   - `GET /docs` - API文档（自动生成）

**总计**：约 40+ API端点

### 第三层：数据持久层

#### MongoDB 数据库

**连接管理**：

```python
# 连接配置
MONGODB_URI = os.getenv('MONGODB_URI')
client = MongoClient(MONGODB_URI)
db = client.gene_search_db
collection = db.gene_data
```

**数据模型**：

```python
# 文档结构
{
    '_id': ObjectId,                    # MongoDB自动生成
    'organ': 'Heart',                   # 组织名称（9种）
    'gene_symbol': 'GAPDH',            # 基因符号（索引字段）
    'gene_name': 'Glyceraldehyde-3-phosphate dehydrogenase',
    'p_value_10_mgkg_vs_control': '0.001',
    'fdr_step_up_10_mgkg_vs_control': '0.05',
    'ratio_10_mgkg_vs_control': '1.5',
    'fold_change_10_mgkg_vs_control': '0.5',
    'lsmean_10mgkg_10_mgkg_vs_control': '10.5',
    'lsmean_control_10_mgkg_vs_control': '8.5'
}
```

**索引设计**：

```python
# 单字段索引（加速查询）
collection.create_index([("gene_symbol", 1)])      # 升序索引
collection.create_index([("organ", 1)])

# 复合唯一索引（防止重复）
collection.create_index(
    [("organ", 1), ("gene_symbol", 1)], 
    unique=True
)
```

#### 外部API服务

**GProfiler API**：

```python
# 初始化
from gprofiler import GProfiler
gp = GProfiler(return_dataframe=True)

# 富集分析调用
df = gp.profile(
    organism="mmusculus",  # 小鼠
    query=genes_list       # 基因列表
)
```

#### 文件系统存储

- **Excel文件**：`backend/data/*.xlsx`（9个组织）
- **基因列表**：`.txt`文件（通路定义、基因列表）
- **生成的图表**：临时存储在内存，以base64编码返回

---

## 前端架构详细设计

### 组件层次结构

```
RootLayout (layout.tsx)
├── Navigation/Header (各页面内嵌)
├── Page Components
│   ├── GeneSearch (gene-search/page.tsx)
│   │   ├── SearchInput Component
│   │   ├── GeneList Component
│   │   ├── ResultsTable Component
│   │   └── PlotDisplay Component
│   │
│   ├── ThemeAnalysis (gene-ontology/*/page.tsx)
│   │   ├── FileUpload Component
│   │   ├── ThemeSelector Component
│   │   ├── ResultsDisplay Component
│   │   └── ChartDisplay Component
│   │
│   └── IVCCA (ivcca/page.tsx)
│       ├── DataUpload Component
│       ├── AnalysisControls Component
│       ├── CorrelationMatrix Component
│       ├── VisualizationPanel Component
│       └── ResultsPanel Component
└── Footer (各页面内嵌)
```

### 数据流（前端视角）

**1. 用户输入流程**

```
用户输入 → 状态更新（useState）→ 事件处理函数 → API调用 → 响应处理 → 状态更新 → UI更新
```

**2. API调用流程**

```typescript
// 标准流程
async function handleApiCall() {
  setIsLoading(true);                    // 1. 设置加载状态
  setError('');                          // 2. 清除错误
  
  try {
    const response = await fetch(...);    // 3. 发起请求
    if (!response.ok) {                   // 4. 检查响应状态
      throw new Error(...);
    }
    const data = await response.json();   // 5. 解析JSON
    setResults(data);                     // 6. 更新状态
  } catch (error) {
    setError(error.message);              // 7. 错误处理
  } finally {
    setIsLoading(false);                  // 8. 清除加载状态
  }
}
```

**3. 可视化数据流**

```typescript
// Plotly图表数据流
API返回数据 → 数据转换 → Plotly JSON配置 → React Plotly组件 → 交互式图表

// 静态图片数据流
API返回base64 → <img src={`data:image/png;base64,${image}`} /> → 显示图片
```

### 状态管理架构

**本地状态（Component State）**：

- 使用 `useState` Hook管理组件级状态
- 每个页面组件独立管理自己的状态
- 状态类型：
  - 用户输入（表单数据）
  - API响应数据
  - UI状态（加载、错误、展开/折叠）
  - 可视化配置（图表类型、参数）

**示例**：

```typescript
// 基因搜索页面状态
const [searchTerm, setSearchTerm] = useState('');
const [searchResults, setSearchResults] = useState<GeneData[]>([]);
const [isLoading, setIsLoading] = useState(false);
const [error, setError] = useState('');
const [currentPlot, setCurrentPlot] = useState('');
```

**全局状态（App State）**：

- API URL：通过环境变量 `NEXT_PUBLIC_API_URL`
- 认证Token：存储在 `localStorage`
- 无全局状态管理库（Redux/Zustand），保持简单

### 路由架构（Next.js App Router）

**文件系统路由**：

```
app/
├── page.tsx                 → /
├── gene-search/
│   └── page.tsx            → /gene-search
├── gene-ontology/
│   ├── page.tsx            → /gene-ontology
│   ├── default-theme/
│   │   └── page.tsx        → /gene-ontology/default-theme
│   └── customize-theme/
│       └── page.tsx        → /gene-ontology/customize-theme
└── ivcca/
    └── page.tsx            → /ivcca
```

**导航实现**：

```typescript
// 使用 Next.js Link 组件
import Link from 'next/link';

<Link href="/gene-search">基因搜索</Link>
<Link href="/gene-ontology">主题分析</Link>
<Link href="/ivcca">IVCCA分析</Link>
```

---

## 后端架构详细设计

### FastAPI 应用结构

#### 1. 应用初始化流程

```python
# Step 1: 导入依赖
from fastapi import FastAPI, HTTPException, ...
from ivcca_core import IVCCAAnalyzer

# Step 2: 加载环境变量
load_dotenv(env_path)

# Step 3: 连接MongoDB
client = MongoClient(MONGODB_URI)
db = client.gene_search_db
collection = db.gene_data

# Step 4: 初始化API类
gene_api = GeneSearchAPI()        # 自动加载数据到MongoDB
ontology_api = GeneOntologyAPI()  # 初始化GProfiler客户端

# Step 5: 创建FastAPI应用
app = FastAPI(title="...", version="1.0.0")

# Step 6: 配置中间件
app.add_middleware(CORSMiddleware, ...)

# Step 7: 定义路由端点
@app.get("/api/...")
async def endpoint(...):
    ...
```

#### 2. 请求处理流程（详细步骤）

**步骤1：HTTP请求接收**

```
客户端 → HTTP请求 → FastAPI ASGI服务器 → 路由匹配
```

**步骤2：请求验证**

```python
# FastAPI自动验证（基于Pydantic模型）
@app.get("/api/gene/symbol/search")
async def search_gene_symbol(
    gene_symbol: str = Query(..., description="...")  # 自动验证参数
):
    # 如果验证失败，自动返回422错误
```

**步骤3：业务逻辑处理**

```python
# 调用相应的API类方法
results = gene_api.search_gene_data(gene_symbol)
```

**步骤4：响应生成**

```python
# 返回JSON响应（FastAPI自动序列化）
return {"gene_symbol": gene_symbol, "data": results}
```

**步骤5：错误处理**

```python
try:
    # 业务逻辑
except Exception as e:
    raise HTTPException(status_code=500, detail=str(e))
```

#### 3. API类详细设计

**GeneSearchAPI 类**：

```python
class GeneSearchAPI:
    def __init__(self):
        # 初始化时执行
        self.load_data_to_mongodb()  # 加载数据到MongoDB
        self.all_genes = self.load_all_genes()  # 加载所有基因符号
    
    # 数据加载流程
    def load_data_to_mongodb(self):
        """
        步骤1: 扫描data目录下的Excel文件
        步骤2: 对每个文件：
            - 读取Excel (pandas.read_excel)
            - 提取组织名称（文件名）
            - 遍历每一行：
                - 提取基因符号和表达数据
                - 构建MongoDB文档
                - 添加到批量操作列表
        步骤3: 执行批量写入（bulk_write with upsert）
        步骤4: 创建索引
        """
        pass
    
    # 搜索流程
    def search_gene_data(self, gene_symbol: str):
        """
        步骤1: 构建查询（正则表达式，大小写不敏感）
        步骤2: 执行MongoDB查询（使用索引）
        步骤3: 遍历查询结果
        步骤4: 格式化为响应格式
        步骤5: 返回结果列表
        """
        pass
    
    # 可视化生成流程
    def create_fold_change_plot(self, gene_symbol: str):
        """
        步骤1: 查询基因数据（调用search_gene_data）
        步骤2: 提取组织和Fold Change值
        步骤3: 使用matplotlib创建图表
        步骤4: 转换为base64编码
        步骤5: 返回base64字符串
        """
        pass
```

**GeneOntologyAPI 类**：

```python
class GeneOntologyAPI:
    def __init__(self):
        # 初始化GProfiler客户端
        self.gp = GProfiler(return_dataframe=True)
        # 定义主题关键词映射
        self.themes = {
            'Inflammation & immune signaling': ['inflammatory', ...],
            # ...
        }
    
    # 富集分析流程
    def enrich(self, genes: List[str]):
        """
        步骤1: 调用GProfiler API
            df = self.gp.profile(organism="mmusculus", query=genes)
        步骤2: 过滤P值（p < 0.01）
        步骤3: 计算Score = -log10(p_value)
        步骤4: 返回DataFrame
        """
        pass
    
    # 主题分配流程
    def assign_theme(self, go_term_name: str):
        """
        步骤1: 将GO术语名称转为小写
        步骤2: 遍历所有主题的关键词
        步骤3: 检查关键词是否在GO术语名称中
        步骤4: 返回第一个匹配的主题
        """
        pass
    
    # 主题聚合流程
    def aggregate(self, df: pd.DataFrame):
        """
        步骤1: 为每个GO术语分配主题（apply assign_theme）
        步骤2: 过滤掉无主题的GO术语
        步骤3: 按主题分组
        步骤4: 聚合计算：
            - Score: 累积分数（sum）
            - Terms: 术语数量（count）
        步骤5: 按Score降序排序
        """
        pass
```

#### 4. IVCCA核心模块架构

**IVCCAAnalyzer 类结构**：

```python
class IVCCAAnalyzer:
    def __init__(self):
        # 数据状态
        self.data = None              # 原始数据矩阵 (samples × genes)
        self.gene_names = None        # 基因名称列表
        self.sample_names = None      # 样本名称列表
        self.correlation_matrix = None # 相关性矩阵 (genes × genes)
        
        # 状态标志
        self.data_loaded = False
        self.correlation_calculated = False
    
    # 数据加载流程
    def load_data(self, file_path: str):
        """
        步骤1: 检测文件类型（.xlsx, .csv, .tsv）
        步骤2: 使用pandas读取文件
        步骤3: 提取样本名称（第一列）
        步骤4: 提取基因名称（除第一列外的所有列）
        步骤5: 提取数值数据（转换为numpy数组）
        步骤6: 处理缺失值（NaN）
        步骤7: 设置状态标志
        """
        pass
    
    # 相关性计算流程
    def calculate_correlations(self, method: str = 'pearson'):
        """
        步骤1: 检查数据是否已加载
        步骤2: 将数据转换为DataFrame
        步骤3: 调用pandas.corr()方法（根据method参数）
        步骤4: 处理NaN值（替换为0）
        步骤5: 计算统计信息（均值、标准差等）
        步骤6: 设置状态标志
        """
        pass
    
    # 排序流程
    def sort_correlation_matrix(self):
        """
        步骤1: 计算每个基因的平均绝对相关性
            Q_i = mean(|r_ij|) for j ≠ i
        步骤2: 按Q_i降序排序，得到排序索引
        步骤3: 使用排序索引重新排列：
            - 相关性矩阵
            - 基因名称列表
        步骤4: 返回排序后的矩阵和基因名称
        """
        pass
```

---

## 数据流与交互流程

### 完整请求-响应流程

#### 流程1：基因搜索完整流程

```
┌──────────┐
│  用户     │
│ (浏览器)  │
└────┬─────┘
     │ 1. 输入基因符号"GAPDH"
     │ 2. 点击"搜索"按钮
     ▼
┌─────────────────────────────────────┐
│ 前端: gene-search/page.tsx          │
│                                      │
│ handleSearch() 函数：                │
│ 1. setIsLoading(true)               │
│ 2. 构建API URL                       │
│ 3. fetch(`${API_URL}/api/gene/      │
│          symbol/search?gene_symbol=  │
│          GAPDH`)                     │
└────┬────────────────────────────────┘
     │ 3. HTTP GET 请求
     │    URL: /api/gene/symbol/search?gene_symbol=GAPDH
     ▼
┌─────────────────────────────────────┐
│ FastAPI 路由处理                     │
│ @app.get("/api/gene/symbol/search") │
│                                      │
│ 1. 接收查询参数 gene_symbol          │
│ 2. Pydantic验证（自动）              │
│ 3. 调用 gene_api.search_gene_data() │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ GeneSearchAPI.search_gene_data()    │
│                                      │
│ 1. 构建MongoDB查询：                 │
│    query = {"gene_symbol": {        │
│        "$regex": "^GAPDH$",         │
│        "$options": "i"              │
│    }}                                │
│ 2. collection.find(query)           │
│    （使用gene_symbol索引，O(log n)） │
│ 3. 遍历查询结果                      │
│ 4. 格式化数据                        │
│ 5. 返回列表                          │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ MongoDB 数据库                       │
│                                      │
│ 1. 使用索引快速查找                  │
│ 2. 返回匹配的文档列表                │
│    [                                │
│      {organ: "Heart", gene_symbol:  │
│       "GAPDH", ...},                │
│      {organ: "Liver", gene_symbol:  │
│       "GAPDH", ...},                │
│      ...                            │
│    ]                                │
└────┬────────────────────────────────┘
     │ 4. 返回结果
     ▼
┌─────────────────────────────────────┐
│ FastAPI 响应                        │
│                                      │
│ return {                            │
│   "gene_symbol": "GAPDH",           │
│   "data": [...]                     │
│ }                                   │
│ （FastAPI自动序列化为JSON）          │
└────┬────────────────────────────────┘
     │ 5. HTTP 200 响应
     │    Content-Type: application/json
     ▼
┌─────────────────────────────────────┐
│ 前端: 处理响应                       │
│                                      │
│ 1. response.json() 解析JSON         │
│ 2. setSearchResults(data.data)      │
│ 3. setIsLoading(false)              │
│ 4. React重渲染 → 显示结果表格        │
└────┬────────────────────────────────┘
     │
     ▼
┌──────────┐
│  用户看到 │
│ 结果表格  │
└──────────┘
```

#### 流程2：主题分析完整流程

```
┌──────────┐
│  用户     │
└────┬─────┘
     │ 1. 上传基因列表文件 (.txt)
     │ 2. 选择主题
     │ 3. 点击"分析"
     ▼
┌─────────────────────────────────────┐
│ 前端: customize-theme/page.tsx      │
│                                      │
│ handleAnalyze() 函数：               │
│ 1. 读取文件内容                       │
│ 2. 构建FormData                      │
│ 3. fetch(`${API_URL}/api/ontology/  │
│          custom-analyze`, {          │
│    method: 'POST',                   │
│    body: formData                    │
│  })                                  │
└────┬────────────────────────────────┘
     │ 2. HTTP POST 请求
     │    Content-Type: multipart/form-data
     ▼
┌─────────────────────────────────────┐
│ FastAPI 路由                        │
│ @app.post("/api/ontology/custom-    │
│          analyze")                   │
│                                      │
│ 1. 接收文件 (UploadFile)             │
│ 2. 接收selected_themes (Form)        │
│ 3. 接收custom_themes (Form, JSON)   │
│ 4. 调用ontology_api方法              │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ GeneOntologyAPI                     │
│                                      │
│ Step 1: load_genes_from_file()      │
│    - 读取文件内容                     │
│    - 按行分割                         │
│    - 去除空白                         │
│    - 返回基因列表                     │
│                                      │
│ Step 2: 临时添加自定义主题           │
│    original_themes = self.themes     │
│    for custom_theme in custom_themes:│
│        self.themes[theme_name] =     │
│            keywords                  │
│                                      │
│ Step 3: enrich(genes)               │
│    - 调用GProfiler API               │
│    - 过滤P值                         │
│    - 计算Score                       │
│                                      │
│ Step 4: assign_theme()              │
│    - 为每个GO术语分配主题             │
│                                      │
│ Step 5: aggregate()                 │
│    - 按主题聚合                       │
│                                      │
│ Step 6: 恢复原始主题                 │
│    self.themes = original_themes     │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ GProfiler API (外部服务)             │
│                                      │
│ 1. 接收基因列表                       │
│ 2. 执行超几何检验                     │
│ 3. 返回富集结果（DataFrame）          │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ 后端处理结果                         │
│                                      │
│ 1. 过滤显著结果                       │
│ 2. 分配主题                           │
│ 3. 聚合统计                           │
│ 4. 生成图表（可选）                   │
│ 5. 返回JSON响应                      │
└────┬────────────────────────────────┘
     │ 3. HTTP 200 响应
     ▼
┌─────────────────────────────────────┐
│ 前端: 显示结果                       │
│                                      │
│ 1. 解析响应                           │
│ 2. 显示结果表格                       │
│ 3. 显示汇总图表                       │
│ 4. 显示主题详细图                     │
└─────────────────────────────────────┘
```

#### 流程3：IVCCA分析完整流程

```
┌──────────┐
│  用户     │
└────┬─────┘
     │ 1. 上传数据文件 (.xlsx/.csv/.tsv)
     │ 2. 点击"加载数据"
     ▼
┌─────────────────────────────────────┐
│ 前端: ivcca/page.tsx                │
│                                      │
│ handleLoadData() 函数：              │
│ 1. 读取文件                          │
│ 2. 构建FormData                      │
│ 3. POST /api/ivcca/load-data        │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ 后端: /api/ivcca/load-data          │
│                                      │
│ 1. 创建IVCCAAnalyzer实例            │
│    analyzer = IVCCAAnalyzer()       │
│ 2. 调用analyzer.load_data()         │
│ 3. 生成唯一ID（analyzer_id）        │
│ 4. 存储到内存（字典）                │
│    analyzers[analyzer_id] = analyzer │
│ 5. 返回analyzer_id                  │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ 用户点击"计算相关性"                  │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ 前端: POST /api/ivcca/              │
│       calculate-correlation          │
│                                      │
│ Body: {                             │
│   analyzer_id: "...",                │
│   method: "pearson"                  │
│ }                                   │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ 后端处理                             │
│                                      │
│ 1. 从内存获取analyzer                │
│    analyzer = analyzers[analyzer_id] │
│ 2. analyzer.calculate_correlations() │
│    - 计算相关性矩阵                  │
│    - 计算统计信息                    │
│ 3. 返回统计信息                      │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ 用户选择"生成热图"                    │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ 前端: POST /api/ivcca/heatmap       │
│                                      │
│ Body: {                             │
│   analyzer_id: "...",                │
│   sorted: false                      │
│ }                                   │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ 后端: analyzer.create_correlation_   │
│       heatmap()                      │
│                                      │
│ 1. 获取相关性矩阵                    │
│ 2. 使用seaborn绘制热图               │
│ 3. 转换为base64                      │
│ 4. 或使用Plotly生成交互式图表        │
│ 5. 返回JSON: {                       │
│      type: "plotly",                 │
│      content: {...}                  │
│    }                                │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ 前端: 渲染图表                       │
│                                      │
│ if (type === "plotly") {            │
│    <Plot data={content} />          │
│ } else {                            │
│    <img src={`data:image/...`} />   │
│ }                                   │
└─────────────────────────────────────┘
```

### 状态管理（后端）

**内存状态管理**：

```python
# IVCCA分析器实例存储（内存中）
analyzers: Dict[str, IVCCAAnalyzer] = {}

# 使用analyzer_id作为键
analyzer_id = str(uuid.uuid4())
analyzers[analyzer_id] = IVCCAAnalyzer()
```

**MongoDB状态**：

- 基因表达数据持久化存储
- 索引加速查询
- 支持并发访问

**无状态API设计**：

- 每个请求独立处理
- 通过analyzer_id关联分析会话
- 支持多个用户同时分析

---

## 核心模块架构

### 模块1：基因搜索系统架构

#### 数据流架构

```
Excel文件 (data/*.xlsx)
    │
    ▼
[数据加载阶段]
    ├─ pandas.read_excel()
    ├─ 数据清洗（去除空值、类型转换）
    └─ 批量写入MongoDB
    │
    ▼
MongoDB (gene_data collection)
    │
    ▼
[查询阶段]
    ├─ 用户输入基因符号
    ├─ MongoDB查询（使用索引）
    └─ 返回匹配文档
    │
    ▼
[可视化阶段]
    ├─ 提取数据（organ, fold_change, lsmean）
    ├─ matplotlib生成图表
    └─ base64编码返回
```

#### 组件交互

```
用户界面 (React)
    │
    ├─→ SearchInput → handleSearch()
    │                    │
    │                    ▼
    │              API调用 (fetch)
    │                    │
    ├─→ ResultsTable ←─ API响应
    │                    │
    └─→ PlotDisplay ←─ 图表API调用
```

### 模块2：主题分析系统架构

#### 数据流架构

```
用户上传基因列表 (.txt)
    │
    ▼
[解析阶段]
    ├─ 按行读取
    ├─ 去除空白
    └─ 生成基因列表
    │
    ▼
[富集分析阶段]
    ├─ 调用GProfiler API
    ├─ 超几何检验
    └─ 返回显著GO术语
    │
    ▼
[主题分配阶段]
    ├─ 关键词匹配
    ├─ 主题映射
    └─ 标记每个GO术语的主题
    │
    ▼
[聚合阶段]
    ├─ 按主题分组
    ├─ 计算累积分数
    └─ 排序
    │
    ▼
[可视化阶段]
    ├─ 生成汇总图表
    ├─ 生成主题详细图
    └─ base64编码返回
```

#### 主题匹配算法流程

```
GO术语名称 ("inflammatory response")
    │
    ▼
转换为小写 ("inflammatory response")
    │
    ▼
遍历主题关键词：
    ├─ "Inflammation & immune signaling": 
    │     ["inflammatory", "immune", ...]
    │     │
    │     ▼
    │  检查 "inflammatory" in "inflammatory response" → True
    │     │
    │     ▼
    │  返回主题 "Inflammation & immune signaling"
    │
    └─ 其他主题（跳过）
```

### 模块3：IVCCA分析系统架构

#### 分析流程架构

```
数据加载
    │
    ├─→ 文件读取 → 数据矩阵 (samples × genes)
    │
    ▼
相关性计算
    │
    ├─→ Pearson/Spearman/Kendall → 相关性矩阵 (genes × genes)
    │
    ▼
排序/聚类
    │
    ├─→ 排序 → 按相关性强度排序
    ├─→ 聚类 → Elbow/Silhouette → K-means/层次聚类
    │
    ▼
降维分析
    │
    ├─→ PCA → 主成分分数
    └─→ t-SNE → 低维嵌入
    │
    ▼
通路分析
    │
    ├─→ 单通路 → PCI_A, PCI_B计算
    ├─→ 多通路 → CECI, Z-score计算
    └─→ 通路比较 → 余弦相似度
    │
    ▼
网络分析
    │
    └─→ 相关性阈值过滤 → 网络图（2D/3D）
```

#### IVCCA类方法调用链

```
load_data()
    │
    ▼
calculate_correlations()
    │
    ├─→ sort_correlation_matrix()
    │       │
    │       └─→ create_correlation_heatmap()
    │
    ├─→ calculate_optimal_clusters()
    │       │
    │       └─→ create_dendrogram()
    │
    ├─→ perform_pca()
    │       │
    │       └─→ create_pca_3d_plot()
    │
    ├─→ perform_tsne()
    │       │
    │       └─→ create_tsne_3d_plot()
    │
    ├─→ analyze_single_pathway()
    │
    ├─→ multi_pathway_analysis()
    │
    └─→ create_network_graph()
```

---

## API接口架构

### RESTful API设计原则

1. **资源导向**：URL代表资源
   - `/api/gene/symbol/search` - 基因资源
   - `/api/ontology/analyze` - 本体分析资源
   - `/api/ivcca/load-data` - IVCCA数据资源

2. **HTTP方法语义**：
   - GET：获取资源
   - POST：创建/执行操作

3. **状态码使用**：
   - 200：成功
   - 400：客户端错误
   - 401：未认证
   - 404：资源不存在
   - 500：服务器错误

### API端点详细映射

#### 基因搜索API端点

| 端点 | 方法 | 输入 | 输出 | 关联组件 |
|------|------|------|------|----------|
| `/api/gene/symbols` | GET | - | `{gene_symbols: []}` | GeneSearch → MongoDB |
| `/api/gene/symbol/search` | GET | `gene_symbol` | `{gene_symbol, data: []}` | GeneSearch → MongoDB |
| `/api/gene/symbol/showFoldChange` | GET | `gene_symbol` | `{image_base64}` | GeneSearch → matplotlib |
| `/api/gene/symbol/showLSMeanControl` | GET | `gene_symbol` | `{image_base64}` | GeneSearch → matplotlib |
| `/api/gene/symbol/showLSMeanTenMgKg` | GET | `gene_symbol` | `{image_base64}` | GeneSearch → matplotlib |

**数据流**：
```
前端 → FastAPI路由 → GeneSearchAPI → MongoDB → 数据处理 → 可视化 → base64 → 前端
```

#### 主题分析API端点

| 端点 | 方法 | 输入 | 输出 | 关联组件 |
|------|------|------|------|----------|
| `/api/ontology/analyze` | POST | `file`, `selected_themes` | `{results: []}` | ThemeAnalysis → GProfiler |
| `/api/ontology/custom-analyze` | POST | `file`, `selected_themes`, `custom_themes` | `{results: []}` | ThemeAnalysis → GProfiler |
| `/api/ontology/theme-chart` | POST | `file`, `theme` | `{image_base64}` | ThemeAnalysis → matplotlib |
| `/api/ontology/custom-summary-chart` | POST | `file`, `selected_themes`, `custom_themes` | `{image_base64}` | ThemeAnalysis → matplotlib |

**数据流**：
```
前端 → FastAPI → GeneOntologyAPI → GProfiler API → 富集结果 → 主题分配 → 聚合 → 可视化 → 前端
```

#### IVCCA分析API端点

| 端点 | 方法 | 输入 | 输出 | 关联组件 |
|------|------|------|------|----------|
| `/api/ivcca/load-data` | POST | `file` | `{analyzer_id, preview}` | IVCCA → IVCCAAnalyzer |
| `/api/ivcca/calculate-correlation` | POST | `analyzer_id`, `method` | `{statistics}` | IVCCA → IVCCAAnalyzer |
| `/api/ivcca/sort-matrix` | POST | `analyzer_id` | `{sorted_matrix, sorted_genes}` | IVCCA → IVCCAAnalyzer |
| `/api/ivcca/heatmap` | POST | `analyzer_id`, `sorted` | `{type, content}` | IVCCA → IVCCAAnalyzer → Plotly |
| `/api/ivcca/pca` | POST | `analyzer_id`, `n_components` | `{scores, explained_variance, plots}` | IVCCA → IVCCAAnalyzer → sklearn |
| `/api/ivcca/tsne` | POST | `analyzer_id`, `n_components`, `perplexity` | `{scores, scatter_plot}` | IVCCA → IVCCAAnalyzer → sklearn |
| `/api/ivcca/multi-pathway` | POST | `analyzer_id`, `pathway_files` | `{pathways: [{ceci, z_score, ...}]}` | IVCCA → IVCCAAnalyzer |

**数据流**：
```
前端 → FastAPI → 内存中的IVCCAAnalyzer实例 → 算法计算 → 结果返回 → 前端
```

### API响应格式

**成功响应**：
```json
{
  "status": "success",
  "data": {...},
  "message": "Operation completed successfully"
}
```

**错误响应**：
```json
{
  "detail": "Error message here"
}
```

**分页响应**（如果需要）：
```json
{
  "status": "success",
  "data": [...],
  "total": 100,
  "page": 1,
  "page_size": 20
}
```

---

## 数据库架构

### MongoDB数据模型

#### 集合（Collection）：`gene_data`

**文档结构**：

```javascript
{
  "_id": ObjectId("..."),                    // MongoDB自动生成
  "organ": "Heart",                          // 组织名称（索引字段）
  "gene_symbol": "GAPDH",                   // 基因符号（索引字段）
  "gene_name": "Glyceraldehyde-3-phosphate dehydrogenase",
  "p_value_10_mgkg_vs_control": "0.001",
  "fdr_step_up_10_mgkg_vs_control": "0.05",
  "ratio_10_mgkg_vs_control": "1.5",
  "fold_change_10_mgkg_vs_control": "0.5",
  "lsmean_10mgkg_10_mgkg_vs_control": "10.5",
  "lsmean_control_10_mgkg_vs_control": "8.5"
}
```

**索引设计**：

```python
# 1. 单字段索引（加速单条件查询）
collection.create_index([("gene_symbol", 1)])  # 升序索引
# 查询性能：O(log n)

# 2. 单字段索引（按组织筛选）
collection.create_index([("organ", 1)])
# 查询性能：O(log n)

# 3. 复合唯一索引（防止重复数据）
collection.create_index(
    [("organ", 1), ("gene_symbol", 1)], 
    unique=True
)
# 确保同一组织同一基因只有一条记录
```

#### 数据加载流程（详细步骤）

**步骤1：文件扫描**

```python
excel_files = glob.glob(os.path.join("data", "*.xlsx"))
# 结果：['data/BoneMarrow.xlsx', 'data/Cortex.xlsx', ...]
```

**步骤2：逐个文件处理**

```python
for file_path in excel_files:
    # 2.1 提取组织名称
    organ_name = os.path.splitext(os.path.basename(file_path))[0]
    # 结果：'BoneMarrow'
    
    # 2.2 读取Excel文件
    df = pd.read_excel(file_path)
    # DataFrame结构：
    # | Gene_symbol | Gene_name | P_value_... | ... |
    # |-------------|-----------|-------------|-----|
    # | GAPDH       | ...       | 0.001       | ... |
    # | ACTB        | ...       | 0.002       | ... |
    
    # 2.3 遍历每一行
    for _, row in df.iterrows():
        gene_symbol = str(row.get('Gene_symbol', '')).strip()
        if not gene_symbol:  # 跳过空基因符号
            continue
        
        # 2.4 构建MongoDB文档
        record = {
            'organ': organ_name,
            'gene_symbol': gene_symbol,
            'gene_name': str(row.get('Gene_name', '')),
            # ... 其他字段
        }
        records.append(record)
```

**步骤3：批量写入**

```python
# 3.1 构建批量操作列表
operations = []
for record in records:
    operations.append({
        'replaceOne': {
            'filter': {
                'organ': record['organ'],
                'gene_symbol': record['gene_symbol']
            },
            'replacement': record,
            'upsert': True  # 不存在则插入，存在则更新
        }
    })

# 3.2 执行批量操作
result = collection.bulk_write(operations)
# 结果：
# - result.upserted_count: 新插入的文档数
# - result.modified_count: 更新的文档数
```

**步骤4：创建索引**

```python
# 4.1 创建单字段索引
collection.create_index([("gene_symbol", 1)])
collection.create_index([("organ", 1)])

# 4.2 创建复合唯一索引
collection.create_index(
    [("organ", 1), ("gene_symbol", 1)], 
    unique=True
)
```

#### 查询优化

**查询1：精确基因符号搜索**

```python
query = {"gene_symbol": {"$regex": f"^{gene_symbol}$", "$options": "i"}}
# 使用索引：gene_symbol索引
# 性能：O(log n)
```

**查询2：获取所有唯一基因符号**

```python
pipeline = [
    {"$group": {"_id": "$gene_symbol"}},  # 分组去重
    {"$sort": {"_id": 1}}                  # 排序
]
genes = [doc["_id"] for doc in collection.aggregate(pipeline)]
# 使用索引：gene_symbol索引
# 性能：O(n log n)
```

---

## 部署架构

### Docker容器化架构

```
┌─────────────────────────────────────────┐
│         Docker Compose                  │
│                                         │
│  ┌──────────────┐    ┌──────────────┐  │
│  │   Frontend   │    │   Backend    │  │
│  │   Container  │◄──►│   Container  │  │
│  │              │    │              │  │
│  │ Next.js      │    │ FastAPI      │  │
│  │ Port: 3000   │    │ Port: 8000   │  │
│  └──────────────┘    └──────┬───────┘  │
│                             │          │
│                             ▼          │
│                      ┌──────────────┐  │
│                      │   MongoDB    │  │
│                      │   Container  │  │
│                      │   (可选)     │  │
│                      └──────────────┘  │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │      gene-search-network         │  │
│  │      (Bridge Network)            │  │
│  └──────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### 部署流程

**1. 构建阶段**

```bash
# Frontend构建
cd genegen
npm install
npm run build  # 生成.next目录

# Backend准备
cd backend
pip install -r requirements.txt
```

**2. Docker镜像构建**

```dockerfile
# Dockerfile.backend
FROM python:3.9-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]

# Dockerfile.frontend
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
CMD ["npm", "start"]
```

**3. 容器启动**

```bash
docker-compose up -d
```

---

## 技术栈详解

### 前端技术栈

| 技术 | 版本 | 用途 | 关联关系 |
|------|------|------|----------|
| Next.js | 15.3.5 | React框架，路由，SSR | 构建前端应用 |
| React | 19.0.0 | UI组件库 | Next.js的基础 |
| TypeScript | 5.x | 类型安全 | 编译为JavaScript |
| Tailwind CSS | 4.x | 样式框架 | 通过globals.css引入 |
| Plotly.js | 2.35.3 | 交互式图表 | 通过react-plotly.js使用 |

**依赖关系**：
```
Next.js → React → React DOM
Next.js → TypeScript Compiler
Next.js → Tailwind CSS
React → Plotly.js (动态导入)
```

### 后端技术栈

| 技术 | 版本 | 用途 | 关联关系 |
|------|------|------|----------|
| FastAPI | 0.68.0 | Web框架 | 构建API服务 |
| Python | 3.9+ | 编程语言 | FastAPI的基础 |
| pandas | 1.3.0+ | 数据处理 | 读取Excel/CSV |
| NumPy | 1.21.0+ | 数值计算 | 矩阵运算 |
| SciPy | - | 科学计算 | 统计检验 |
| scikit-learn | - | 机器学习 | PCA, t-SNE, K-means |
| matplotlib | 3.4.0+ | 图表生成 | 静态图片 |
| seaborn | 0.11.0+ | 高级可视化 | 热图 |
| GProfiler | 1.0.0+ | 富集分析 | 外部API客户端 |
| pymongo | - | MongoDB驱动 | 数据库连接 |

**依赖关系**：
```
FastAPI → Pydantic (数据验证)
FastAPI → Uvicorn (ASGI服务器)
pandas → NumPy (底层数组)
scikit-learn → NumPy, SciPy
matplotlib → NumPy
seaborn → matplotlib, pandas
```

---

## 模块间关联关系

### 数据共享

**1. 基因列表共享**：

```
MongoDB (gene_data)
    │
    ├─→ 基因搜索模块：查询基因表达数据
    │
    └─→ 其他模块：可以作为参考数据源
```

**2. 分析结果共享**：

```
IVCCA分析结果（相关性矩阵）
    │
    └─→ 可用于通路分析
        └─→ 通路分析结果可用于主题分析
```

### 功能依赖关系

```
基因搜索 ←─ 独立模块（仅依赖MongoDB）
    │
主题分析 ←─ 依赖GProfiler API
    │
IVCCA分析 ←─ 独立模块（算法自包含）
```

### API端点关联

**同一模块内的端点关联**：

```
/api/ivcca/load-data
    ↓ (返回analyzer_id)
/api/ivcca/calculate-correlation (需要analyzer_id)
    ↓ (需要先计算相关性)
/api/ivcca/heatmap (需要analyzer_id)
/api/ivcca/pca (需要analyzer_id)
/api/ivcca/tsne (需要analyzer_id)
```

---

## 性能优化策略

### 前端优化

1. **代码分割**：
   - Plotly.js动态导入（`dynamic import`）
   - 页面级代码分割（Next.js自动）

2. **缓存策略**：
   - 基因符号列表缓存（localStorage）
   - API响应缓存（可选）

3. **懒加载**：
   - 图表组件懒加载
   - 图片懒加载

### 后端优化

1. **数据库优化**：
   - 索引加速查询
   - 批量操作减少IO

2. **计算优化**：
   - NumPy向量化运算
   - 相关性矩阵缓存（内存中）

3. **并发处理**：
   - FastAPI异步处理
   - 多个analyzer实例独立

---

## 安全架构

### 认证机制

**Token-based认证**：

```python
# 环境变量存储有效token
VALID_TOKENS = os.getenv('VALID_TOKENS', '').split(',')

# 验证函数
def verify_token(token: str) -> bool:
    return token in VALID_TOKENS

# 保护端点
@app.post("/api/gene/add")
async def add_gene(..., token: str = Query(...)):
    if not verify_token(token):
        raise HTTPException(status_code=401)
```

### CORS配置

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 开发环境，生产环境应限制
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 数据验证

**Pydantic模型验证**：

```python
class GeneData(BaseModel):
    gene_symbol: str
    gene_name: str
    # ... 自动类型验证和转换
```

---

## 错误处理架构

### 前端错误处理

```typescript
try {
  const response = await fetch(...);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
} catch (error) {
  setError(error.message);  // 显示错误信息
  console.error(error);     // 日志记录
}
```

### 后端错误处理

```python
try:
    # 业务逻辑
    result = process_data()
    return {"status": "success", "data": result}
except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e))
except Exception as e:
    raise HTTPException(status_code=500, detail=str(e))
```

---

## 扩展性设计

### 水平扩展

- **前端**：可以部署多个实例，使用负载均衡
- **后端**：无状态设计，支持多实例部署
- **数据库**：MongoDB支持分片和副本集

### 功能扩展

- **新模块**：可以添加新的API类和新端点
- **新算法**：可以在`ivcca_core.py`中添加新方法
- **新可视化**：可以添加新的图表生成函数

---

**文档版本**：1.0  
**最后更新**：2024年


