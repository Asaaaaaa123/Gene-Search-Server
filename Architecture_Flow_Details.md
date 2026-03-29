# 系统架构详细流程图与组件交互

本文档提供系统架构中每一步的详细流程和组件间的交互关系。

---

## 一、系统启动流程

### 1.1 后端启动流程

```
Step 1: 加载环境变量
    │
    ├─→ 读取 .env 文件
    ├─→ MONGODB_URI
    ├─→ VALID_TOKENS
    └─→ 其他配置
    │
Step 2: 连接MongoDB
    │
    ├─→ MongoClient(MONGODB_URI)
    ├─→ client.admin.command('ping')  # 测试连接
    ├─→ db = client.gene_search_db
    └─→ collection = db.gene_data
    │
Step 3: 初始化API类
    │
    ├─→ gene_api = GeneSearchAPI()
    │     │
    │     ├─→ load_data_to_mongodb()
    │     │     │
    │     │     ├─→ 扫描 data/*.xlsx 文件
    │     │     ├─→ 读取每个文件
    │     │     ├─→ 数据清洗和转换
    │     │     ├─→ 批量写入MongoDB
    │     │     └─→ 创建索引
    │     │
    │     └─→ load_all_genes()
    │           │
    │           ├─→ MongoDB聚合查询
    │           ├─→ $group 去重
    │           └─→ 返回基因符号列表
    │
    ├─→ ontology_api = GeneOntologyAPI()
    │     │
    │     ├─→ gp = GProfiler(return_dataframe=True)
    │     └─→ themes = {...}  # 定义主题关键词
    │
Step 4: 创建FastAPI应用
    │
    ├─→ app = FastAPI(...)
    ├─→ app.add_middleware(CORSMiddleware, ...)
    └─→ 定义所有API路由
    │
Step 5: 启动Uvicorn服务器
    │
    └─→ uvicorn.run(app, host="0.0.0.0", port=8000)
```

### 1.2 前端启动流程

```
Step 1: 加载环境变量
    │
    └─→ NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL
    │
Step 2: 编译TypeScript
    │
    └─→ TypeScript → JavaScript
    │
Step 3: Next.js启动
    │
    ├─→ 初始化React应用
    ├─→ 加载路由配置
    └─→ 启动开发服务器 (port 3000)
    │
Step 4: 页面加载
    │
    ├─→ layout.tsx (根布局)
    └─→ page.tsx (首页)
```

---

## 二、基因搜索模块详细流程

### 2.1 数据加载到MongoDB的完整流程

```
┌─────────────────────────────────────────────────────┐
│ 启动时自动执行: GeneSearchAPI.__init__()            │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: 检查MongoDB是否已有数据                     │
│                                                      │
│ existing_count = collection.count_documents({})     │
│ if existing_count > 0:                              │
│     print("数据已存在，跳过加载")                    │
│     return                                          │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: 扫描数据文件目录                            │
│                                                      │
│ excel_files = glob.glob("data/*.xlsx")              │
│ # 结果: ['data/BoneMarrow.xlsx', ...]              │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: 遍历每个Excel文件                           │
│                                                      │
│ for file_path in excel_files:                       │
│     # 处理单个文件                                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: 读取Excel文件                               │
│                                                      │
│ df = pd.read_excel(file_path)                       │
│ # DataFrame结构:                                    │
│ # Columns: Gene_symbol, Gene_name, P_value_...,    │
│ #          FDR_..., Ratio_..., Fold_change_...,    │
│ #          LSMean10mgkg_..., LSMeancontrol_...     │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: 提取组织名称                                │
│                                                      │
│ organ_name = os.path.splitext(                      │
│     os.path.basename(file_path)                     │
│ )[0]                                                │
│ # 结果: 'BoneMarrow', 'Cortex', etc.               │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: 遍历DataFrame的每一行                       │
│                                                      │
│ for index, row in df.iterrows():                    │
│     # 处理单行数据                                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 7: 提取和验证基因符号                          │
│                                                      │
│ gene_symbol = str(row.get('Gene_symbol', '')).strip()│
│ if not gene_symbol:                                 │
│     continue  # 跳过空基因符号                       │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 8: 构建MongoDB文档                             │
│                                                      │
│ record = {                                          │
│     'organ': organ_name,                            │
│     'gene_symbol': gene_symbol,                     │
│     'gene_name': str(row.get('Gene_name', '')),    │
│     'p_value_10_mgkg_vs_control':                   │
│         str(row.get('P_value_10_mgkg_vs_control', '')),│
│     # ... 其他7个字段                                │
│ }                                                   │
│ records.append(record)                              │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 9: 批量构建写入操作                            │
│                                                      │
│ operations = []                                     │
│ for record in records:                              │
│     operations.append({                             │
│         'replaceOne': {                             │
│             'filter': {                             │
│                 'organ': record['organ'],           │
│                 'gene_symbol': record['gene_symbol']│
│             },                                      │
│             'replacement': record,                  │
│             'upsert': True  # 不存在则插入，存在则更新│
│         }                                           │
│     })                                              │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 10: 执行批量写入                               │
│                                                      │
│ result = collection.bulk_write(operations)          │
│ # 结果统计:                                         │
│ # - result.upserted_count: 新插入数                 │
│ # - result.modified_count: 更新数                    │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 11: 创建索引                                   │
│                                                      │
│ collection.create_index([("gene_symbol", 1)])       │
│ collection.create_index([("organ", 1)])             │
│ collection.create_index(                            │
│     [("organ", 1), ("gene_symbol", 1)],             │
│     unique=True                                     │
│ )                                                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ 完成：数据已加载到MongoDB                           │
└─────────────────────────────────────────────────────┘
```

### 2.2 基因搜索查询流程

```
┌─────────────────────────────────────────────────────┐
│ 用户在前端输入"GAPDH"并点击搜索                      │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ 前端: gene-search/page.tsx                          │
│                                                      │
│ const handleSearch = async () => {                  │
│     setIsLoading(true)                              │
│     setError('')                                    │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ 构建API请求                                          │
│                                                      │
│ const url = `${API_BASE_URL}/api/gene/             │
│              symbol/search?gene_symbol=GAPDH`       │
│                                                      │
│ fetch(url, {                                        │
│     method: 'GET',                                  │
│     headers: {'Content-Type': 'application/json'}   │
│ })                                                  │
└─────────────────────────────────────────────────────┘
    │
    │ HTTP GET 请求
    │ URL: http://localhost:8000/api/gene/symbol/search?gene_symbol=GAPDH
    ▼
┌─────────────────────────────────────────────────────┐
│ FastAPI路由: @app.get("/api/gene/symbol/search")   │
│                                                      │
│ async def search_gene_symbol(                       │
│     gene_symbol: str = Query(...)                   │
│ ):                                                  │
│     # FastAPI自动解析查询参数                        │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ 调用业务逻辑: gene_api.search_gene_data()           │
│                                                      │
│ def search_gene_data(self, gene_symbol: str):       │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: 构建MongoDB查询                             │
│                                                      │
│ query = {                                           │
│     "gene_symbol": {                                │
│         "$regex": "^GAPDH$",  # 精确匹配            │
│         "$options": "i"          # 大小写不敏感      │
│     }                                               │
│ }                                                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: 执行MongoDB查询                             │
│                                                      │
│ cursor = collection.find(query)                     │
│ # MongoDB使用gene_symbol索引加速查询                │
│ # 查询复杂度: O(log n)                              │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: 遍历查询结果                                │
│                                                      │
│ results = []                                        │
│ for doc in cursor:                                  │
│     # doc是MongoDB文档                               │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: 格式化数据                                  │
│                                                      │
│ results.append({                                    │
│     'organ': doc.get('organ', ''),                  │
│     'gene_symbol': doc.get('gene_symbol', ''),      │
│     'gene_name': doc.get('gene_name', ''),          │
│     'p_value': doc.get('p_value_10_mgkg_vs_control', ''),│
│     # ... 其他字段                                   │
│ })                                                  │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: 返回结果列表                                │
│                                                      │
│ return results  # List[Dict]                       │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ FastAPI自动序列化为JSON                             │
│                                                      │
│ return {                                            │
│     "gene_symbol": "GAPDH",                         │
│     "data": [                                       │
│         {                                           │
│             "organ": "Heart",                       │
│             "gene_symbol": "GAPDH",                 │
│             ...                                     │
│         },                                          │
│         {                                           │
│             "organ": "Liver",                       │
│             "gene_symbol": "GAPDH",                 │
│             ...                                     │
│         }                                           │
│     ]                                               │
│ }                                                   │
└─────────────────────────────────────────────────────┘
    │
    │ HTTP 200 Response
    │ Content-Type: application/json
    ▼
┌─────────────────────────────────────────────────────┐
│ 前端: 处理响应                                       │
│                                                      │
│ const data = await response.json()                  │
│ setSearchResults(data.data)  # 更新状态             │
│ setIsLoading(false)                                 │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ React重渲染                                         │
│                                                      │
│ ResultsTable组件显示数据                             │
│ - 遍历searchResults                                 │
│ - 渲染表格行                                         │
│ - 显示每个组织的表达数据                             │
└─────────────────────────────────────────────────────┘
```

### 2.3 可视化生成流程

```
┌─────────────────────────────────────────────────────┐
│ 用户点击"显示Fold Change图"按钮                      │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ 前端: 调用API                                        │
│                                                      │
│ fetch(`${API_BASE_URL}/api/gene/symbol/            │
│       showFoldChange?gene_symbol=GAPDH`)            │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ 后端: create_fold_change_plot()                     │
│                                                      │
│ Step 1: 查询基因数据                                 │
│     results = search_gene_data(gene_symbol)         │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: 提取数据                                     │
│                                                      │
│ organs = []                                         │
│ fold_changes = []                                   │
│ colors = []                                         │
│                                                      │
│ for doc in results:                                 │
│     fold_change = float(doc['fold_change_...'])     │
│     organs.append(doc['organ'])                     │
│     fold_changes.append(fold_change)                │
│     colors.append('blue' if fold_change >= 0        │
│                    else 'red')                      │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: 创建matplotlib图表                          │
│                                                      │
│ fig, ax = plt.subplots(figsize=(10, 6))            │
│ ax.bar(organs, fold_changes, color=colors)         │
│ ax.set_title(f'Fold Change for {gene_symbol}')     │
│ ax.set_xlabel('Organ')                              │
│ ax.set_ylabel('Fold Change')                        │
│ plt.tight_layout()                                  │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: 转换为base64                                │
│                                                      │
│ buffer = io.BytesIO()                               │
│ plt.savefig(buffer, format='jpg', dpi=300)         │
│ buffer.seek(0)                                      │
│ image_base64 = base64.b64encode(                    │
│     buffer.getvalue()                               │
│ ).decode()                                          │
│ plt.close()                                         │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: 返回响应                                     │
│                                                      │
│ return {                                            │
│     "gene_symbol": "GAPDH",                         │
│     "image_base64": "iVBORw0KGgoAAAANSUhEUg..."    │
│ }                                                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ 前端: 显示图片                                       │
│                                                      │
│ <img src={`data:image/jpeg;base64,${image_base64}`} │
│      alt="Fold Change Chart" />                     │
└─────────────────────────────────────────────────────┘
```

---

## 三、主题分析模块详细流程

### 3.1 完整分析流程

```
┌─────────────────────────────────────────────────────┐
│ 用户上传基因列表文件 (.txt)                          │
│                                                      │
│ 文件内容示例:                                        │
│ GAPDH                                               │
│ ACTB                                                │
│ TUBB                                                │
│ ...                                                 │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ 前端: 读取文件内容                                    │
│                                                      │
│ const fileContent = await file.text()               │
│ # 结果: "GAPDH\nACTB\nTUBB\n..."                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ 构建FormData                                         │
│                                                      │
│ const formData = new FormData()                     │
│ formData.append('file', file)                       │
│ formData.append('selected_themes', JSON.stringify(  │
│     ['Inflammation & immune signaling', ...]        │
│ ))                                                  │
│ formData.append('custom_themes', JSON.stringify([   │
│     {name: 'DNA Repair', keywords: [...]}           │
│ ]))                                                 │
└─────────────────────────────────────────────────────┘
    │
    │ HTTP POST
    ▼
┌─────────────────────────────────────────────────────┐
│ 后端: /api/ontology/custom-analyze                  │
│                                                      │
│ async def custom_analyze(                           │
│     file: UploadFile,                               │
│     selected_themes: str = Form(...),               │
│     custom_themes: str = Form(None)                 │
│ ):                                                  │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: 解析请求参数                                 │
│                                                      │
│ file_content = await file.read()                    │
│ file_content = file_content.decode('utf-8')         │
│                                                      │
│ selected_theme_names = json.loads(selected_themes)  │
│ custom_theme_data = json.loads(custom_themes) if custom_themes else []│
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: 加载基因列表                                 │
│                                                      │
│ genes = ontology_api.load_genes_from_file(          │
│     file_content                                    │
│ )                                                   │
│ # 实现:                                             │
│ # genes = []                                        │
│ # for line in file_content.strip().split('\n'):    │
│ #     gene = line.strip()                           │
│ #     if gene:                                      │
│ #         genes.append(gene)                        │
│ # return genes                                      │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: 临时添加自定义主题                           │
│                                                      │
│ original_themes = ontology_api.themes.copy()        │
│                                                      │
│ for custom_theme in custom_theme_data:              │
│     theme_name = custom_theme.get('name')           │
│     keywords = custom_theme.get('keywords', [])     │
│     ontology_api.themes[theme_name] = keywords      │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: 执行富集分析                                 │
│                                                      │
│ enr_df = ontology_api.enrich(genes, p_thresh=1e-2) │
│                                                      │
│ # enrich() 内部流程:                                │
│ # 1. 调用GProfiler API:                             │
│ #    df = self.gp.profile(                          │
│ #        organism="mmusculus",                      │
│ #        query=genes                                │
│ #    )                                              │
│ # 2. 过滤P值:                                       │
│ #    df = df[df["p_value"] < p_thresh]             │
│ # 3. 计算Score:                                     │
│ #    df["Score"] = -np.log10(df["p_value"])        │
│ # 4. 排序:                                          │
│ #    df = df.sort_values("p_value")                │
└─────────────────────────────────────────────────────┘
    │
    │ GProfiler API调用（外部服务）
    ▼
┌─────────────────────────────────────────────────────┐
│ GProfiler服务器处理                                  │
│                                                      │
│ 1. 接收基因列表                                      │
│ 2. 查询GO数据库                                      │
│ 3. 对每个GO术语执行超几何检验:                       │
│    P(X ≥ k) = Σ C(M,i) × C(N-M,n-i) / C(N,n)      │
│    (i从k到min(n,M))                                 │
│ 4. 计算FDR校正                                       │
│ 5. 返回DataFrame                                     │
│    Columns: name, p_value, term_size, ...          │
└─────────────────────────────────────────────────────┘
    │
    │ 返回DataFrame
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: 分配主题                                     │
│                                                      │
│ enr_df["Theme"] = enr_df["name"].apply(             │
│     ontology_api.assign_theme                       │
│ )                                                   │
│                                                      │
│ # assign_theme() 内部:                              │
│ # 1. go_term_lower = name.lower()                   │
│ # 2. for theme, keywords in themes.items():         │
│ #    for keyword in keywords:                       │
│ #        if keyword.lower() in go_term_lower:       │
│ #            return theme                           │
│ # 3. return None                                    │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: 过滤选定的主题                               │
│                                                      │
│ if selected_theme_names:                            │
│     enr_df = enr_df[                                │
│         enr_df["Theme"].isin(selected_theme_names)  │
│     ]                                               │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 7: 聚合主题                                     │
│                                                      │
│ themed_df = ontology_api.aggregate(enr_df)          │
│                                                      │
│ # aggregate() 内部:                                 │
│ # 1. 移除无主题的GO术语:                            │
│ #    themed = df.dropna(subset=["Theme"])           │
│ # 2. 按主题分组:                                    │
│ #    grouped = themed.groupby("Theme")              │
│ # 3. 聚合计算:                                      │
│ #    aggregated = grouped.agg(                      │
│ #        Score=("Score", "sum"),                    │
│ #        Terms=("Theme", "count")                   │
│ #    )                                              │
│ # 4. 排序:                                          │
│ #    aggregated = aggregated.sort_values(           │
│ #        "Score", ascending=False                   │
│ #    )                                              │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 8: 恢复原始主题                                 │
│                                                      │
│ ontology_api.themes = original_themes               │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 9: 准备响应数据                                 │
│                                                      │
│ results = []                                        │
│ for theme_name, row in themed_df.iterrows():        │
│     theme_go_terms = enr_df[                        │
│         enr_df["Theme"] == theme_name               │
│     ]                                               │
│     results.append({                                │
│         "theme": theme_name,                        │
│         "score": float(row["Score"]),               │
│         "terms_count": int(row["Terms"]),           │
│         "go_terms": theme_go_terms.to_dict('records')│
│     })                                              │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 10: 返回JSON响应                                │
│                                                      │
│ return {                                            │
│     "results": results,                             │
│     "message": "Analysis completed"                 │
│ }                                                   │
└─────────────────────────────────────────────────────┘
    │
    │ HTTP 200 Response
    ▼
┌─────────────────────────────────────────────────────┐
│ 前端: 显示结果                                       │
│                                                      │
│ setResults(data.results)                            │
│ # 渲染结果表格                                       │
│ # 显示主题、分数、GO术语数量                          │
└─────────────────────────────────────────────────────┘
```

### 3.2 主题匹配算法详细流程

```
输入: GO术语名称 "inflammatory response"

┌─────────────────────────────────────────────────────┐
│ Step 1: 转换为小写                                   │
│                                                      │
│ go_term_lower = "inflammatory response"             │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: 遍历所有主题                                 │
│                                                      │
│ for theme_name, keywords in themes.items():         │
│     # theme_name: "Inflammation & immune signaling" │
│     # keywords: ["inflammatory", "immune", ...]     │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: 遍历主题的关键词                             │
│                                                      │
│ for keyword in keywords:                            │
│     # keyword: "inflammatory"                        │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: 检查关键词是否在GO术语名称中                 │
│                                                      │
│ if keyword.lower() in go_term_lower:                │
│     # "inflammatory" in "inflammatory response"      │
│     # → True                                        │
│     return theme_name  # 返回第一个匹配的主题       │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ 返回: "Inflammation & immune signaling"             │
└─────────────────────────────────────────────────────┘

如果没有匹配:
┌─────────────────────────────────────────────────────┐
│ 返回: None                                          │
│ (该GO术语在聚合阶段会被过滤掉)                        │
└─────────────────────────────────────────────────────┘
```

---

## 四、IVCCA分析模块详细流程

### 4.1 数据加载流程

```
┌─────────────────────────────────────────────────────┐
│ 用户上传数据文件 (.xlsx/.csv/.tsv)                  │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ 前端: POST /api/ivcca/load-data                     │
│                                                      │
│ const formData = new FormData()                     │
│ formData.append('file', file)                       │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ 后端处理                                             │
│                                                      │
│ Step 1: 创建IVCCAAnalyzer实例                       │
│     analyzer = IVCCAAnalyzer()                      │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: 调用analyzer.load_data(file_path)           │
│                                                      │
│ def load_data(self, file_path: str):                │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: 检测文件类型                                 │
│                                                      │
│ if file_path.endswith('.xlsx'):                     │
│     df = pd.read_excel(file_path)                   │
│ elif file_path.endswith('.csv'):                    │
│     df = pd.read_csv(file_path)                     │
│ elif file_path.endswith('.tsv'):                    │
│     df = pd.read_csv(file_path, sep='\t')           │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: 提取数据结构                                 │
│                                                      │
│ sample_col = df.columns[0]                          │
│ self.sample_names = df[sample_col].tolist()         │
│ # 结果: ['Sample1', 'Sample2', ...]                │
│                                                      │
│ self.gene_names = [col for col in df.columns[1:]]   │
│ # 结果: ['Gene1', 'Gene2', ...]                    │
│                                                      │
│ self.data = df.iloc[:, 1:].values                   │
│ # 结果: numpy数组 (samples × genes)                 │
│ # [[val11, val12, ...],                            │
│ #  [val21, val22, ...],                             │
│ #  ...]                                             │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: 数据类型转换和验证                           │
│                                                      │
│ self.data = pd.DataFrame(self.data).apply(          │
│     pd.to_numeric, errors='coerce'                  │
│ ).values                                            │
│                                                      │
│ # 检查NaN值:                                        │
│ nan_count = np.isnan(self.data).sum()               │
│ if nan_count > 0:                                   │
│     print(f"Warning: {nan_count} NaN values")       │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: 设置状态标志                                 │
│                                                      │
│ self.data_loaded = True                             │
│ self.correlation_calculated = False                 │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 7: 生成数据预览                                 │
│                                                      │
│ preview = {                                         │
│     "columns": [sample_col] + self.gene_names,      │
│     "rows": [...]  # 前几行数据                      │
│ }                                                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 8: 存储analyzer到内存                          │
│                                                      │
│ analyzer_id = str(uuid.uuid4())                     │
│ analyzers[analyzer_id] = analyzer                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 9: 返回响应                                     │
│                                                      │
│ return {                                            │
│     "status": "success",                            │
│     "analyzer_id": analyzer_id,                     │
│     "n_samples": self.data.shape[0],                │
│     "n_genes": self.data.shape[1],                  │
│     "preview": preview                              │
│ }                                                   │
└─────────────────────────────────────────────────────┘
```

### 4.2 相关性计算流程

```
┌─────────────────────────────────────────────────────┐
│ 用户点击"计算相关性"按钮                              │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ 前端: POST /api/ivcca/calculate-correlation         │
│                                                      │
│ Body: {                                             │
│     "analyzer_id": "uuid-string",                   │
│     "method": "pearson"                             │
│ }                                                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ 后端: 从内存获取analyzer                             │
│                                                      │
│ analyzer = analyzers.get(analyzer_id)               │
│ if not analyzer:                                    │
│     raise HTTPException(404, "Analyzer not found")  │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ 调用: analyzer.calculate_correlations(method)        │
│                                                      │
│ def calculate_correlations(self, method='pearson'): │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: 检查数据是否已加载                           │
│                                                      │
│ if not self.data_loaded:                            │
│     return {"status": "error", ...}                 │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: 转换为DataFrame                              │
│                                                      │
│ data_df = pd.DataFrame(                             │
│     self.data,                                      │
│     columns=self.gene_names                         │
│ )                                                   │
│ # Shape: (samples, genes)                           │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: 计算相关性矩阵                               │
│                                                      │
│ if method == 'pearson':                             │
│     self.correlation_matrix = data_df.corr(         │
│         method='pearson'                            │
│     ).values                                        │
│ # pandas.corr()内部:                                │
│ # - 对每对基因计算Pearson相关系数                    │
│ # - 返回相关性矩阵 (genes × genes)                   │
│ # - 对角线为1（自相关）                              │
│ # - 矩阵对称                                        │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: 处理NaN值                                    │
│                                                      │
│ self.correlation_matrix = np.nan_to_num(            │
│     self.correlation_matrix,                        │
│     nan=0.0                                         │
│ )                                                   │
│ # 将NaN替换为0（通常由于常数值导致）                 │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: 计算统计信息                                 │
│                                                      │
│ # 提取上三角矩阵（排除对角线和下三角）                │
│ corr_values = self.correlation_matrix[              │
│     np.triu_indices_from(                           │
│         self.correlation_matrix,                    │
│         k=1                                         │
│     )                                               │
│ ]                                                   │
│                                                      │
│ stats = {                                           │
│     "mean": float(np.mean(corr_values)),            │
│     "std": float(np.std(corr_values)),              │
│     "min": float(np.min(corr_values)),              │
│     "max": float(np.max(corr_values)),              │
│     "median": float(np.median(corr_values))         │
│ }                                                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: 设置状态标志                                 │
│                                                      │
│ self.correlation_calculated = True                  │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 7: 返回响应                                     │
│                                                      │
│ return {                                            │
│     "status": "success",                            │
│     "matrix_size": self.correlation_matrix.shape,   │
│     "statistics": stats                             │
│ }                                                   │
└─────────────────────────────────────────────────────┘
```

### 4.3 矩阵排序流程

```
┌─────────────────────────────────────────────────────┐
│ 用户点击"排序"按钮                                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ 后端: analyzer.sort_correlation_matrix()             │
│                                                      │
│ def sort_correlation_matrix(self):                  │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: 计算每个基因的平均绝对相关性                  │
│                                                      │
│ abs_corr = np.abs(self.correlation_matrix)          │
│ # 取绝对值: 正相关和负相关都视为相关性                │
│                                                      │
│ np.fill_diagonal(abs_corr, 0)                       │
│ # 对角线设为0（排除自相关）                          │
│                                                      │
│ gene_scores = np.mean(abs_corr, axis=1)             │
│ # 对每一行求均值，得到每个基因的平均绝对相关性         │
│ # gene_scores[i] = mean(|r_ij|) for j ≠ i          │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: 排序索引                                     │
│                                                      │
│ sorted_indices = np.argsort(gene_scores)[::-1]      │
│ # argsort返回从小到大的索引                          │
│ # [::-1]反转，得到从大到小的索引                      │
│ # 结果: [5, 12, 3, ...]  # 基因5的相关性最高        │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: 使用排序索引重新排列                         │
│                                                      │
│ sorted_matrix = self.correlation_matrix[            │
│     sorted_indices[:, None],                        │
│     sorted_indices                                  │
│ ]                                                   │
│ # 同时重新排列行和列                                 │
│                                                      │
│ sorted_gene_names = [                               │
│     self.gene_names[i]                              │
│     for i in sorted_indices                         │
│ ]                                                   │
│                                                      │
│ sorted_scores = gene_scores[sorted_indices]         │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: 返回排序结果                                 │
│                                                      │
│ return {                                            │
│     "status": "success",                            │
│     "sorted_matrix": sorted_matrix.tolist(),        │
│     "sorted_gene_names": sorted_gene_names,         │
│     "sorted_scores": sorted_scores.tolist()         │
│ }                                                   │
└─────────────────────────────────────────────────────┘
```

### 4.4 PCA分析流程

```
┌─────────────────────────────────────────────────────┐
│ 用户点击"执行PCA"按钮                                │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ 后端: analyzer.perform_pca(n_components=3)           │
│                                                      │
│ def perform_pca(self, n_components=3):              │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: 使用相关性矩阵作为输入                        │
│                                                      │
│ data = np.abs(self.correlation_matrix)              │
│ # 使用绝对相关性矩阵                                 │
│ # Shape: (genes, genes)                             │
│ # 每个基因是一个"样本"，基因间的相关性是"特征"         │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: 填充NaN值                                    │
│                                                      │
│ data_filled = np.nan_to_num(data, nan=0.0)          │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: 执行PCA（使用sklearn）                       │
│                                                      │
│ from sklearn.decomposition import PCA               │
│                                                      │
│ pca = PCA(n_components=25)  # 计算25个主成分        │
│ pca.fit(data_filled)                                │
│                                                      │
│ # PCA内部步骤:                                      │
│ # 1. 标准化数据（如果需要）                          │
│ # 2. 计算协方差矩阵                                   │
│ # 3. 特征值分解: C = Q × Λ × Q^T                    │
│ # 4. 选择前k个主成分                                  │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: 计算主成分分数                               │
│                                                      │
│ pca_scores = pca.transform(data_filled)             │
│ # Shape: (genes, n_components)                      │
│ # 每个基因在主成分空间中的坐标                        │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: 计算解释方差                                 │
│                                                      │
│ explained_variance = pca.explained_variance_ratio_  │
│ # 每个主成分解释的方差比例                            │
│ # 例如: [0.25, 0.15, 0.10, ...]                    │
│ # 表示PC1解释25%的方差，PC2解释15%，等等             │
│                                                      │
│ cumulative_variance = np.cumsum(explained_variance) │
│ # 累积方差: [0.25, 0.40, 0.50, ...]                │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: 生成可视化                                   │
│                                                      │
│ # 6.1 Scree图（累积方差）                            │
│ fig = go.Figure()                                   │
│ fig.add_trace(go.Scatter(                           │
│     x=components,                                   │
│     y=cumulative_variance * 100,  # 转换为百分比    │
│     mode='lines+markers'                            │
│ ))                                                  │
│                                                      │
│ # 6.2 3D散点图                                      │
│ fig = go.Figure()                                   │
│ fig.add_trace(go.Scatter3d(                         │
│     x=pca_scores[:, 0],  # PC1                      │
│     y=pca_scores[:, 1],  # PC2                      │
│     z=pca_scores[:, 2],  # PC3                      │
│     text=gene_names,                                │
│     mode='markers'                                  │
│ ))                                                  │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 7: 转换为JSON（Plotly）                        │
│                                                      │
│ plot_data = fig.to_json()                           │
│ # Plotly图表配置（JSON格式）                         │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 8: 返回响应                                     │
│                                                      │
│ return {                                            │
│     "status": "success",                            │
│     "scores": pca_scores.tolist(),                  │
│     "explained_variance": explained_variance.tolist(),│
│     "cumulative_variance": cumulative_variance.tolist(),│
│     "scree_plot": {"type": "plotly", "content": ...},│
│     "scatter_plot": {"type": "plotly", "content": ...}│
│ }                                                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ 前端: 渲染Plotly图表                                 │
│                                                      │
│ <Plot                                               │
│     data={JSON.parse(plot_data.content)}            │
│     layout={...}                                    │
│ />                                                  │
└─────────────────────────────────────────────────────┘
```

### 4.5 多通路分析流程

```
┌─────────────────────────────────────────────────────┐
│ 用户选择多个通路文件并点击"分析"                      │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ 后端: analyzer.multi_pathway_analysis()              │
│                                                      │
│ def multi_pathway_analysis(                         │
│     self,                                           │
│     pathway_files: List[str],                       │
│     pathway_genes_list: List[List[str]],            │
│     sorted_genes: List[str] = None,                 │
│     sorted_correlations: List[float] = None         │
│ ):                                                  │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ 遍历每个通路                                         │
│                                                      │
│ for pathway_file, pathway_genes in                  │
│     zip(pathway_files, pathway_genes_list):         │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: 找到通路基因在数据集中的索引                  │
│                                                      │
│ pathway_indices = []                                │
│ for gene in pathway_genes:                          │
│     gene_lower = gene.lower()                       │
│     if gene_lower in gene_names_lower:              │
│         idx = gene_names_lower.index(gene_lower)    │
│         pathway_indices.append(idx)                 │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: 检查最小基因数阈值                           │
│                                                      │
│ if len(pathway_indices) < min_genes_threshold:      │
│     continue  # 跳过该通路                           │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: 计算PCI_A（通路内相关性）                     │
│                                                      │
│ # 提取通路相关性子矩阵                                │
│ pathway_corr = self.correlation_matrix[             │
│     np.ix_(pathway_indices, pathway_indices)        │
│ ]                                                   │
│ # Shape: (k, k) where k = len(pathway_indices)      │
│                                                      │
│ # 计算绝对相关性                                      │
│ abs_pathway_corr = np.abs(pathway_corr)             │
│ np.fill_diagonal(abs_pathway_corr, 0)               │
│                                                      │
│ # 计算每个基因的平均绝对相关性                         │
│ sum_abs_correlations = np.sum(                      │
│     abs_pathway_corr, axis=1                        │
│ )                                                   │
│ avg_abs_correlation = sum_abs_correlations / (      │
│     len(pathway_indices) - 1                        │
│ )                                                   │
│                                                      │
│ # 计算PCI_A（通路内平均）                            │
│ pci_a = float(np.mean(avg_abs_correlation))         │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: 计算PCI_B（从全局排序中提取）                 │
│                                                      │
│ if sorted_genes and sorted_correlations:            │
│     pci_b_values = []                               │
│     for gene in pathway_genes:                      │
│         if gene in sorted_genes:                    │
│             idx = sorted_genes.index(gene)          │
│             pci_b_values.append(                    │
│                 sorted_correlations[idx]             │
│             )                                       │
│     pci_b = float(np.mean(pci_b_values))            │
│ else:                                               │
│     pci_b = None                                    │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: 计算PAI（通路激活指数）                       │
│                                                      │
│ pai = len(pathway_indices) / len(pathway_genes)     │
│ # 数据集中发现的基因数 / 通路总基因数                 │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: 计算CECI（相关性-表达复合指数）               │
│                                                      │
│ if pci_b is not None:                               │
│     ceci = pai * pci_b * 100                        │
│ else:                                               │
│     ceci = pai * pci_a * 100                        │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 7: 计算Z-score                                  │
│                                                      │
│ z_score = (ceci - 7.908) / 2.0605                  │
│ # 7.908: 随机基因集的CECI均值                        │
│ # 2.0605: 随机基因集的CECI标准差                     │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 8: 存储结果                                     │
│                                                      │
│ results.append({                                    │
│     "pathway_file": pathway_file,                   │
│     "total_genes_in_pathway": len(pathway_genes),   │
│     "genes_found_in_set": len(pathway_indices),     │
│     "pai": float(pai),                              │
│     "pci_a": pci_a,                                 │
│     "pci_b": pci_b,                                 │
│     "ceci": float(ceci),                            │
│     "z_score": float(z_score)                       │
│ })                                                  │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 9: 按CECI排序                                   │
│                                                      │
│ results.sort(                                       │
│     key=lambda x: x["ceci"]                         │
│     if x["ceci"] is not None                        │
│     else -float('inf'),                             │
│     reverse=True                                    │
│ )                                                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 10: 返回结果                                    │
│                                                      │
│ return {                                            │
│     "status": "success",                            │
│     "pathways": results,                            │
│     "n_pathways": len(results)                      │
│ }                                                   │
└─────────────────────────────────────────────────────┘
```

---

## 五、组件间交互关系

### 5.1 前端组件交互

```
┌─────────────────┐
│   RootLayout    │
│  (layout.tsx)   │
└────────┬────────┘
         │
         ├──────────────────────────────────────────┐
         │                                          │
    ┌────▼─────┐                            ┌──────▼──────┐
    │  Page    │                            │  Navigation │
    │ Component│                            │  Component  │
    └────┬─────┘                            └─────────────┘
         │
         ├──────────────────┬───────────────────┬─────────────┐
         │                  │                   │             │
    ┌────▼─────────┐  ┌─────▼─────────┐  ┌─────▼──────────┐
    │ GeneSearch   │  │ ThemeAnalysis │  │ IVCCA Analysis │
    │ Page         │  │ Page          │  │ Page           │
    └────┬─────────┘  └─────┬─────────┘  └─────┬──────────┘
         │                  │                   │
    ┌────▼─────────┐  ┌─────▼─────────┐  ┌─────▼──────────┐
    │ SearchInput  │  │ FileUpload    │  │ DataUpload     │
    │ Component    │  │ Component     │  │ Component      │
    └────┬─────────┘  └─────┬─────────┘  └─────┬──────────┘
         │                  │                   │
    ┌────▼─────────┐  ┌─────▼─────────┐  ┌─────▼──────────┐
    │ ResultsTable │  │ ThemeSelector │  │ AnalysisControls│
    │ Component    │  │ Component     │  │ Component       │
    └────┬─────────┘  └─────┬─────────┘  └─────┬──────────┘
         │                  │                   │
    ┌────▼─────────┐  ┌─────▼─────────┐  ┌─────▼──────────┐
    │ PlotDisplay  │  │ ChartDisplay  │  │ Visualization  │
    │ Component    │  │ Component     │  │ Panel          │
    └──────────────┘  └───────────────┘  └────────────────┘

所有组件通过以下方式通信:
├─→ Props传递（父→子）
├─→ State提升（子→父通过回调函数）
└─→ API调用（组件→后端）
```

### 5.2 后端类交互

```
┌──────────────────────────────────────┐
│         FastAPI App                  │
│         (server.py)                  │
└──────────┬───────────────────────────┘
           │
           ├──────────────────┬──────────────────┬──────────────┐
           │                  │                  │              │
    ┌──────▼──────┐   ┌───────▼──────┐   ┌──────▼──────────┐
    │GeneSearchAPI│   │GeneOntologyAPI│   │IVCCAAnalyzer    │
    │             │   │               │   │(ivcca_core.py)  │
    └──────┬──────┘   └───────┬───────┘   └──────┬──────────┘
           │                  │                  │
    ┌──────▼──────┐   ┌───────▼──────┐   ┌──────▼──────────┐
    │   MongoDB   │   │ GProfiler    │   │  NumPy/SciPy    │
    │  Collection │   │    API       │   │  scikit-learn   │
    └─────────────┘   └──────────────┘   └─────────────────┘

数据流向:
├─→ GeneSearchAPI ←→ MongoDB
├─→ GeneOntologyAPI → GProfiler API → 富集结果
└─→ IVCCAAnalyzer → 算法库 → 分析结果
```

### 5.3 数据流总览

```
┌──────────────┐
│   用户操作    │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────┐
│        前端组件                      │
│        (React State)                 │
└──────┬───────────────────────────────┘
       │ HTTP Request (JSON)
       ▼
┌──────────────────────────────────────┐
│      FastAPI路由                     │
│      (Request Validation)            │
└──────┬───────────────────────────────┘
       │
       ├──────────────┬──────────────┬──────────────┐
       │              │              │              │
       ▼              ▼              ▼              ▼
┌──────────┐  ┌─────────────┐  ┌──────────┐  ┌──────────┐
│MongoDB   │  │GProfiler API│  │算法计算   │  │文件系统   │
│查询/写入  │  │富集分析     │  │(NumPy等)  │  │(Excel)   │
└────┬─────┘  └─────┬───────┘  └────┬─────┘  └────┬─────┘
     │              │               │             │
     └──────────────┴───────────────┴─────────────┘
                     │
                     ▼
          ┌──────────────────────┐
          │    数据处理和计算     │
          │    (业务逻辑层)       │
          └──────────┬───────────┘
                     │
                     ▼
          ┌──────────────────────┐
          │    响应生成           │
          │    (JSON/Base64)     │
          └──────────┬───────────┘
                     │ HTTP Response
                     ▼
          ┌──────────────────────┐
          │    前端更新状态       │
          │    (React Re-render) │
          └──────────┬───────────┘
                     │
                     ▼
          ┌──────────────────────┐
          │    用户看到结果       │
          └──────────────────────┘
```

---

## 六、关键算法执行流程

### 6.1 Pearson相关系数计算（详细）

```
输入: 两个基因表达向量
X = [x1, x2, ..., xn]  (n个样本)
Y = [y1, y2, ..., yn]

┌─────────────────────────────────────────────────────┐
│ Step 1: 计算均值                                     │
│                                                      │
│ x_mean = (x1 + x2 + ... + xn) / n                   │
│ y_mean = (y1 + y2 + ... + yn) / n                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: 计算协方差分子                                │
│                                                      │
│ numerator = Σ(xi - x_mean) × (yi - y_mean)         │
│           = (x1-x_mean)(y1-y_mean) +                │
│             (x2-x_mean)(y2-y_mean) +                │
│             ... +                                   │
│             (xn-x_mean)(yn-y_mean)                  │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: 计算标准差                                   │
│                                                      │
│ x_var = Σ(xi - x_mean)²                            │
│       = (x1-x_mean)² + (x2-x_mean)² + ...          │
│                                                      │
│ y_var = Σ(yi - y_mean)²                            │
│       = (y1-y_mean)² + (y2-y_mean)² + ...          │
│                                                      │
│ x_std = √x_var                                      │
│ y_std = √y_var                                      │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: 计算相关系数                                 │
│                                                      │
│ r = numerator / (x_std × y_std)                     │
│                                                      │
│ 如果 denominator == 0:                              │
│     r = NaN  # 其中一个基因无变异                    │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ 输出: r ∈ [-1, 1]                                   │
│                                                      │
│ r = 1:  完全正相关                                   │
│ r = 0:  无线性相关                                   │
│ r = -1: 完全负相关                                   │
└─────────────────────────────────────────────────────┘

向量化实现（pandas）:
┌─────────────────────────────────────────────────────┐
│ data_df.corr(method='pearson')                      │
│                                                      │
│ 内部对每对基因列执行上述计算，构建相关性矩阵           │
│ 时间复杂度: O(n × m²) 其中n=样本数，m=基因数         │
└─────────────────────────────────────────────────────┘
```

### 6.2 CECI计算流程（详细）

```
输入:
- pathway_genes: ['Gene1', 'Gene2', ...]  # 通路基因列表
- sorted_genes: ['Gene5', 'Gene12', ...]  # 全局排序基因
- sorted_correlations: [0.85, 0.82, ...]  # 对应的相关性分数

┌─────────────────────────────────────────────────────┐
│ Step 1: 匹配通路基因到数据集                         │
│                                                      │
│ pathway_indices = []                                │
│ for gene in pathway_genes:                          │
│     if gene in dataset_genes:                       │
│         idx = find_index(gene)                      │
│         pathway_indices.append(idx)                 │
│                                                      │
│ # 示例:                                             │
│ # pathway_genes = ['GAPDH', 'ACTB', 'TUBB']        │
│ # pathway_indices = [5, 12, 23]  # 在数据集中的索引 │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: 计算PCI_A（通路内相关性）                     │
│                                                      │
│ # 2.1 提取通路相关性子矩阵                            │
│ pathway_corr = correlation_matrix[                  │
│     pathway_indices, :][:, pathway_indices]         │
│ # Shape: (k, k) 其中k = len(pathway_indices)        │
│                                                      │
│ # 2.2 计算绝对相关性                                  │
│ abs_pathway_corr = |pathway_corr|                   │
│ abs_pathway_corr[diagonal] = 0  # 排除自相关        │
│                                                      │
│ # 2.3 计算每个基因的平均绝对相关性                     │
│ for i in range(k):                                  │
│     Q_i = mean(abs_pathway_corr[i, :])              │
│     # 排除对角线，所以除以(k-1)                       │
│                                                      │
│ # 2.4 计算PCI_A                                     │
│ PCI_A = mean([Q_1, Q_2, ..., Q_k])                  │
│       = mean(Q_i) for all i in pathway              │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: 计算PCI_B（全局相关性）                       │
│                                                      │
│ if sorted_genes provided:                           │
│     pci_b_values = []                               │
│     for gene in pathway_genes:                      │
│         if gene in sorted_genes:                    │
│             idx = sorted_genes.index(gene)          │
│             Q_global = sorted_correlations[idx]     │
│             pci_b_values.append(Q_global)           │
│                                                      │
│     PCI_B = mean(pci_b_values)                      │
│ else:                                               │
│     PCI_B = None                                    │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: 计算PAI（通路激活指数）                       │
│                                                      │
│ PAI = genes_found / total_genes                     │
│     = len(pathway_indices) / len(pathway_genes)     │
│                                                      │
│ # 示例:                                             │
│ # pathway_genes有100个基因                           │
│ # 数据集中找到45个                                   │
│ # PAI = 45/100 = 0.45                               │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: 计算CECI                                    │
│                                                      │
│ if PCI_B is not None:                               │
│     CECI = PAI × PCI_B × 100                        │
│ else:                                               │
│     CECI = PAI × PCI_A × 100                        │
│                                                      │
│ # 示例:                                             │
│ # PAI = 0.45                                        │
│ # PCI_B = 0.72                                      │
│ # CECI = 0.45 × 0.72 × 100 = 32.4                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: 计算Z-score                                  │
│                                                      │
│ # 背景分布参数（从随机基因集计算得到）                │
│ background_mean = 7.908                             │
│ background_std = 2.0605                             │
│                                                      │
│ Z = (CECI - background_mean) / background_std       │
│   = (32.4 - 7.908) / 2.0605                         │
│   = 11.87                                           │
│                                                      │
│ # 临界Z值（α=0.05）:                                │
│ Z_critical = 1.96                                   │
│                                                      │
│ # 判断:                                             │
│ if |Z| > Z_critical:                                │
│     通路显著激活（或抑制）                            │
└─────────────────────────────────────────────────────┘
```

---

## 七、内存管理和状态持久化

### 7.1 后端内存管理

**IVCCA分析器实例存储**：

```python
# 全局字典（内存中）
analyzers: Dict[str, IVCCAAnalyzer] = {}

# 创建新实例
analyzer_id = str(uuid.uuid4())
analyzers[analyzer_id] = IVCCAAnalyzer()

# 获取实例
analyzer = analyzers.get(analyzer_id)
```

**内存占用**：

```
单个analyzer实例内存占用:
├─ self.data: (samples, genes) × 8 bytes (float64)
├─ self.correlation_matrix: (genes, genes) × 8 bytes
└─ 其他变量: ~几MB

例如: 1000个基因，100个样本
├─ data: 100 × 1000 × 8 = 800 KB
└─ correlation_matrix: 1000 × 1000 × 8 = 8 MB
总计: ~10 MB per analyzer
```

**生命周期管理**：

- 实例在内存中直到服务器重启
- 无自动清理机制（可以添加TTL）
- 支持多个用户同时分析（每个用户有独立的analyzer_id）

### 7.2 前端状态管理

**状态生命周期**：

```
组件挂载 (mount)
    │
    ├─→ useState初始化
    ├─→ useEffect执行
    └─→ 初始渲染
    │
用户操作
    │
    ├─→ 状态更新 (setState)
    └─→ React重渲染
    │
组件卸载 (unmount)
    │
    └─→ 状态清理
```

**持久化存储**：

```typescript
// localStorage（浏览器存储）
localStorage.setItem('authToken', token);      // 认证token
localStorage.setItem('isLoggedIn', 'true');    // 登录状态

// 会话级存储（刷新页面后丢失）
// - 所有useState状态
// - API响应数据
// - UI状态
```

---

## 八、错误处理和异常流程

### 8.1 前端错误处理流程

```
API调用
    │
    ├─→ 成功 (response.ok === true)
    │     │
    │     └─→ 解析JSON → 更新状态 → 显示结果
    │
    └─→ 失败
          │
          ├─→ 网络错误 (fetch error)
          │     │
          │     └─→ catch块 → setError() → 显示错误消息
          │
          └─→ HTTP错误 (response.ok === false)
                │
                ├─→ 400: 客户端错误 → 显示错误详情
                ├─→ 401: 未认证 → 跳转登录页
                ├─→ 404: 资源不存在 → 显示"未找到"
                └─→ 500: 服务器错误 → 显示"服务器错误"
```

### 8.2 后端错误处理流程

```
请求接收
    │
    ├─→ 参数验证失败 (Pydantic)
    │     │
    │     └─→ 自动返回422 (Unprocessable Entity)
    │
    ├─→ 业务逻辑错误
    │     │
    │     ├─→ ValueError → HTTPException(400)
    │     ├─→ KeyError → HTTPException(404)
    │     └─→ Exception → HTTPException(500)
    │
    └─→ 成功
          │
          └─→ 返回JSON响应 (200)
```

---

## 九、性能优化细节

### 9.1 数据库查询优化

**索引使用**：

```
查询: {"gene_symbol": {"$regex": "^GAPDH$", "$options": "i"}}

无索引:
├─ 全表扫描: O(n)
└─ 时间复杂度: 高

有索引:
├─ 索引查找: O(log n)
└─ 时间复杂度: 低（对数级）

索引结构（B-Tree）:
┌─────────────┐
│ ACTB → doc1 │
│ ACTB → doc2 │
│ ACTB → doc3 │
│ ...         │
│ GAPDH → doc5│  ← 快速定位
│ GAPDH → doc6│
│ ...         │
└─────────────┘
```

### 9.2 相关性计算优化

**向量化计算**：

```
传统循环方式:
for i in range(n_genes):
    for j in range(i+1, n_genes):
        r[i,j] = calculate_correlation(data[:,i], data[:,j])
时间复杂度: O(n² × m) 其中m=样本数

向量化方式 (pandas):
correlation_matrix = data_df.corr()
时间复杂度: O(n² × m) 但实际更快（底层优化）

NumPy优化:
- 使用BLAS库（线性代数库）
- 多线程计算
- SIMD指令集加速
```

### 9.3 前端渲染优化

**React优化**：

```
1. 使用useMemo缓存计算结果
   const filteredResults = useMemo(() => {
       return results.filter(...);
   }, [results]);

2. 使用useCallback缓存函数
   const handleClick = useCallback(() => {
       // ...
   }, [dependencies]);

3. 代码分割（动态导入）
   const Plot = dynamic(() => import('react-plotly.js'));
```

---

## 十、部署和运行流程

### 10.1 开发环境启动流程

```
┌─────────────────────────────────────┐
│ Step 1: 启动后端                    │
│                                     │
│ cd backend                          │
│ python server.py                    │
│                                     │
│ 或:                                 │
│ uvicorn server:app --reload         │
└─────────────────────────────────────┘
    │
    ├─→ 加载环境变量
    ├─→ 连接MongoDB
    ├─→ 初始化API类
    ├─→ 启动FastAPI服务器
    └─→ 监听端口8000
    │
┌─────────────────────────────────────┐
│ Step 2: 启动前端                    │
│                                     │
│ cd genegen                          │
│ npm run dev                         │
└─────────────────────────────────────┘
    │
    ├─→ 编译TypeScript
    ├─→ 启动Next.js开发服务器
    └─→ 监听端口3000
    │
┌─────────────────────────────────────┐
│ Step 3: 浏览器访问                  │
│                                     │
│ http://localhost:3000               │
└─────────────────────────────────────┘
```

### 10.2 生产环境部署流程

```
┌─────────────────────────────────────┐
│ Step 1: 构建前端                    │
│                                     │
│ cd genegen                          │
│ npm run build                       │
│ # 生成.next目录                     │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ Step 2: Docker构建                  │
│                                     │
│ docker-compose build                │
│ # 构建backend和frontend镜像          │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ Step 3: 启动容器                    │
│                                     │
│ docker-compose up -d                │
│ # 后台运行所有服务                   │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ Step 4: Nginx反向代理（可选）        │
│                                     │
│ 配置Nginx将请求转发到容器            │
│ /api/* → backend:8000              │
│ /* → frontend:3000                 │
└─────────────────────────────────────┘
```

---

## 十一、关键技术决策说明

### 11.1 为什么选择MongoDB？

**原因**：
1. **灵活的数据模型**：不同组织的基因数量可能不同，文档模型更灵活
2. **快速开发**：无需预定义schema
3. **水平扩展**：支持分片和副本集
4. **索引支持**：B-tree索引加速查询

**替代方案**：
- PostgreSQL：需要预定义表结构，但支持SQL查询
- SQLite：轻量级，但不适合并发

### 11.2 为什么选择FastAPI？

**原因**：
1. **性能**：基于Starlette，异步支持，性能接近Node.js
2. **自动文档**：OpenAPI/Swagger自动生成
3. **类型安全**：Pydantic模型自动验证
4. **Python生态**：可以使用所有Python科学计算库

**替代方案**：
- Django：太重，适合全栈应用
- Flask：轻量但缺少自动文档和类型验证

### 11.3 为什么选择Next.js？

**原因**：
1. **服务端渲染**：SEO友好
2. **文件系统路由**：简单直观
3. **自动代码分割**：优化加载性能
4. **React生态**：可以使用所有React库

**替代方案**：
- Create React App：缺少SSR和路由
- Vue.js：不同的技术栈

---

## 十二、系统扩展点

### 12.1 数据扩展

**添加新组织**：
```
1. 将新的Excel文件放入 backend/data/
2. 重启后端服务器
3. GeneSearchAPI.__init__() 自动加载新数据
```

**添加新字段**：
```
1. 修改Excel文件，添加新列
2. 修改GeneData模型（server.py）
3. 修改数据加载逻辑
4. 修改前端显示组件
```

### 12.2 功能扩展

**添加新的分析算法**：
```
1. 在ivcca_core.py中添加新方法
2. 在server.py中添加新的API端点
3. 在前端添加新的UI组件
```

**添加新的可视化类型**：
```
1. 在后端创建新的图表生成函数
2. 使用matplotlib/Plotly生成图表
3. 返回base64或Plotly JSON
4. 前端渲染图表
```

---

**文档版本**：1.0  
**最后更新**：2024年


