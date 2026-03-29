# System Architecture Detailed Flow Diagrams and Component Interactions

This document provides detailed flow diagrams for each step of the system architecture and the interactions between components.

---

## I. System Startup Flow

### 1.1 Backend Startup Flow

```
Step 1: Load Environment Variables
    │
    ├─→ Read .env file
    ├─→ MONGODB_URI
    ├─→ VALID_TOKENS
    └─→ Other configurations
    │
Step 2: Connect to MongoDB
    │
    ├─→ MongoClient(MONGODB_URI)
    ├─→ client.admin.command('ping')  # Test connection
    ├─→ db = client.gene_search_db
    └─→ collection = db.gene_data
    │
Step 3: Initialize API Classes
    │
    ├─→ gene_api = GeneSearchAPI()
    │     │
    │     ├─→ load_data_to_mongodb()
    │     │     │
    │     │     ├─→ Scan data/*.xlsx files
    │     │     ├─→ Read each file
    │     │     ├─→ Data cleaning and transformation
    │     │     ├─→ Batch write to MongoDB
    │     │     └─→ Create indexes
    │     │
    │     └─→ load_all_genes()
    │           │
    │           ├─→ MongoDB aggregation query
    │           ├─→ $group deduplication
    │           └─→ Return gene symbol list
    │
    ├─→ ontology_api = GeneOntologyAPI()
    │     │
    │     ├─→ gp = GProfiler(return_dataframe=True)
    │     └─→ themes = {...}  # Define theme keywords
    │
Step 4: Create FastAPI Application
    │
    ├─→ app = FastAPI(...)
    ├─→ app.add_middleware(CORSMiddleware, ...)
    └─→ Define all API routes
    │
Step 5: Start Uvicorn Server
    │
    └─→ uvicorn.run(app, host="0.0.0.0", port=8000)
```

### 1.2 Frontend Startup Flow

```
Step 1: Load Environment Variables
    │
    └─→ NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL
    │
Step 2: Compile TypeScript
    │
    └─→ TypeScript → JavaScript
    │
Step 3: Next.js Startup
    │
    ├─→ Initialize React application
    ├─→ Load routing configuration
    └─→ Start development server (port 3000)
    │
Step 4: Page Loading
    │
    ├─→ layout.tsx (root layout)
    └─→ page.tsx (home page)
```

---

## II. Gene Search Module Detailed Flow

### 2.1 Complete Flow of Data Loading to MongoDB

```
┌─────────────────────────────────────────────────────┐
│ Automatically executed on startup: GeneSearchAPI.__init__() │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: Check if MongoDB already has data          │
│                                                      │
│ existing_count = collection.count_documents({})     │
│ if existing_count > 0:                              │
│     print("Data already exists, skip loading")      │
│     return                                          │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: Scan data file directory                   │
│                                                      │
│ excel_files = glob.glob("data/*.xlsx")              │
│ # Result: ['data/BoneMarrow.xlsx', ...]            │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: Iterate through each Excel file            │
│                                                      │
│ for file_path in excel_files:                       │
│     # Process single file                           │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: Read Excel file                            │
│                                                      │
│ df = pd.read_excel(file_path)                       │
│ # DataFrame structure:                              │
│ # Columns: Gene_symbol, Gene_name, P_value_...,   │
│ #          FDR_..., Ratio_..., Fold_change_...,   │
│ #          LSMean10mgkg_..., LSMeancontrol_...     │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: Extract organ name                         │
│                                                      │
│ organ_name = os.path.splitext(                      │
│     os.path.basename(file_path)                     │
│ )[0]                                                │
│ # Result: 'BoneMarrow', 'Cortex', etc.            │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: Iterate through each row of DataFrame      │
│                                                      │
│ for index, row in df.iterrows():                    │
│     # Process single row data                       │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 7: Extract and validate gene symbol           │
│                                                      │
│ gene_symbol = str(row.get('Gene_symbol', '')).strip()│
│ if not gene_symbol:                                 │
│     continue  # Skip empty gene symbols             │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 8: Build MongoDB document                     │
│                                                      │
│ record = {                                          │
│     'organ': organ_name,                            │
│     'gene_symbol': gene_symbol,                     │
│     'gene_name': str(row.get('Gene_name', '')),    │
│     'p_value_10_mgkg_vs_control':                   │
│         str(row.get('P_value_10_mgkg_vs_control', '')),│
│     # ... 7 other fields                            │
│ }                                                   │
│ records.append(record)                              │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 9: Build batch write operations               │
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
│             'upsert': True  # Insert if not exists, update if exists │
│         }                                           │
│     })                                              │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 10: Execute batch write                       │
│                                                      │
│ result = collection.bulk_write(operations)          │
│ # Result statistics:                                │
│ # - result.upserted_count: number of new insertions │
│ # - result.modified_count: number of updates        │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 11: Create indexes                            │
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
│ Complete: Data loaded to MongoDB                   │
└─────────────────────────────────────────────────────┘
```

### 2.2 Gene Search Query Flow

```
┌─────────────────────────────────────────────────────┐
│ User enters "GAPDH" in frontend and clicks search   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Frontend: gene-search/page.tsx                     │
│                                                      │
│ const handleSearch = async () => {                  │
│     setIsLoading(true)                              │
│     setError('')                                    │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Build API request                                   │
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
    │ HTTP GET Request
    │ URL: http://localhost:8000/api/gene/symbol/search?gene_symbol=GAPDH
    ▼
┌─────────────────────────────────────────────────────┐
│ FastAPI Route: @app.get("/api/gene/symbol/search") │
│                                                      │
│ async def search_gene_symbol(                       │
│     gene_symbol: str = Query(...)                   │
│ ):                                                  │
│     # FastAPI automatically parses query parameters │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Call business logic: gene_api.search_gene_data()   │
│                                                      │
│ def search_gene_data(self, gene_symbol: str):       │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: Build MongoDB query                        │
│                                                      │
│ query = {                                           │
│     "gene_symbol": {                                │
│         "$regex": "^GAPDH$",  # Exact match         │
│         "$options": "i"          # Case insensitive  │
│     }                                               │
│ }                                                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: Execute MongoDB query                      │
│                                                      │
│ cursor = collection.find(query)                     │
│ # MongoDB uses gene_symbol index to speed up query  │
│ # Query complexity: O(log n)                        │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: Iterate through query results              │
│                                                      │
│ results = []                                        │
│ for doc in cursor:                                  │
│     # doc is a MongoDB document                     │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: Format data                                 │
│                                                      │
│ results.append({                                    │
│     'organ': doc.get('organ', ''),                  │
│     'gene_symbol': doc.get('gene_symbol', ''),      │
│     'gene_name': doc.get('gene_name', ''),          │
│     'p_value': doc.get('p_value_10_mgkg_vs_control', ''),│
│     # ... other fields                              │
│ })                                                  │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: Return result list                          │
│                                                      │
│ return results  # List[Dict]                       │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ FastAPI automatically serializes to JSON            │
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
│ Frontend: Process response                          │
│                                                      │
│ const data = await response.json()                  │
│ setSearchResults(data.data)  # Update state         │
│ setIsLoading(false)                                 │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ React re-renders                                    │
│                                                      │
│ ResultsTable component displays data                 │
│ - Iterate through searchResults                     │
│ - Render table rows                                 │
│ - Display expression data for each organ            │
└─────────────────────────────────────────────────────┘
```

### 2.3 Visualization Generation Flow

```
┌─────────────────────────────────────────────────────┐
│ User clicks "Show Fold Change Chart" button         │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Frontend: Call API                                  │
│                                                      │
│ fetch(`${API_BASE_URL}/api/gene/symbol/            │
│       showFoldChange?gene_symbol=GAPDH`)            │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Backend: create_fold_change_plot()                 │
│                                                      │
│ Step 1: Query gene data                             │
│     results = search_gene_data(gene_symbol)         │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: Extract data                                │
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
│ Step 3: Create matplotlib chart                    │
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
│ Step 4: Convert to base64                           │
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
│ Step 5: Return response                             │
│                                                      │
│ return {                                            │
│     "gene_symbol": "GAPDH",                         │
│     "image_base64": "iVBORw0KGgoAAAANSUhEUg..."    │
│ }                                                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Frontend: Display image                             │
│                                                      │
│ <img src={`data:image/jpeg;base64,${image_base64}`} │
│      alt="Fold Change Chart" />                     │
└─────────────────────────────────────────────────────┘
```

---

## III. Theme Analysis Module Detailed Flow

### 3.1 Complete Analysis Flow

```
┌─────────────────────────────────────────────────────┐
│ User uploads gene list file (.txt)                  │
│                                                      │
│ File content example:                               │
│ GAPDH                                               │
│ ACTB                                                │
│ TUBB                                                │
│ ...                                                 │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Frontend: Read file content                         │
│                                                      │
│ const fileContent = await file.text()               │
│ # Result: "GAPDH\nACTB\nTUBB\n..."                 │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Build FormData                                      │
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
│ Backend: /api/ontology/custom-analyze              │
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
│ Step 1: Parse request parameters                    │
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
│ Step 2: Load gene list                              │
│                                                      │
│ genes = ontology_api.load_genes_from_file(          │
│     file_content                                    │
│ )                                                   │
│ # Implementation:                                   │
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
│ Step 3: Temporarily add custom themes               │
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
│ Step 4: Execute enrichment analysis                 │
│                                                      │
│ enr_df = ontology_api.enrich(genes, p_thresh=1e-2) │
│                                                      │
│ # enrich() internal flow:                           │
│ # 1. Call GProfiler API:                            │
│ #    df = self.gp.profile(                          │
│ #        organism="mmusculus",                      │
│ #        query=genes                                │
│ #    )                                              │
│ # 2. Filter P-value:                                │
│ #    df = df[df["p_value"] < p_thresh]             │
│ # 3. Calculate Score:                               │
│ #    df["Score"] = -np.log10(df["p_value"])        │
│ # 4. Sort:                                          │
│ #    df = df.sort_values("p_value")                │
└─────────────────────────────────────────────────────┘
    │
    │ GProfiler API call (external service)
    ▼
┌─────────────────────────────────────────────────────┐
│ GProfiler server processing                         │
│                                                      │
│ 1. Receive gene list                                │
│ 2. Query GO database                                │
│ 3. Execute hypergeometric test for each GO term:    │
│    P(X ≥ k) = Σ C(M,i) × C(N-M,n-i) / C(N,n)      │
│    (i from k to min(n,M))                           │
│ 4. Calculate FDR correction                         │
│ 5. Return DataFrame                                 │
│    Columns: name, p_value, term_size, ...          │
└─────────────────────────────────────────────────────┘
    │
    │ Return DataFrame
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: Assign themes                               │
│                                                      │
│ enr_df["Theme"] = enr_df["name"].apply(             │
│     ontology_api.assign_theme                       │
│ )                                                   │
│                                                      │
│ # assign_theme() internal:                          │
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
│ Step 6: Filter selected themes                      │
│                                                      │
│ if selected_theme_names:                            │
│     enr_df = enr_df[                                │
│         enr_df["Theme"].isin(selected_theme_names)  │
│     ]                                               │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 7: Aggregate themes                            │
│                                                      │
│ themed_df = ontology_api.aggregate(enr_df)          │
│                                                      │
│ # aggregate() internal:                             │
│ # 1. Remove GO terms without themes:                │
│ #    themed = df.dropna(subset=["Theme"])           │
│ # 2. Group by theme:                                │
│ #    grouped = themed.groupby("Theme")              │
│ # 3. Aggregate calculation:                         │
│ #    aggregated = grouped.agg(                      │
│ #        Score=("Score", "sum"),                    │
│ #        Terms=("Theme", "count")                   │
│ #    )                                              │
│ # 4. Sort:                                          │
│ #    aggregated = aggregated.sort_values(           │
│ #        "Score", ascending=False                   │
│ #    )                                              │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 8: Restore original themes                     │
│                                                      │
│ ontology_api.themes = original_themes               │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 9: Prepare response data                       │
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
│ Step 10: Return JSON response                       │
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
│ Frontend: Display results                           │
│                                                      │
│ setResults(data.results)                            │
│ # Render results table                              │
│ # Display theme, score, GO term count               │
└─────────────────────────────────────────────────────┘
```

### 3.2 Theme Matching Algorithm Detailed Flow

```
Input: GO term name "inflammatory response"

┌─────────────────────────────────────────────────────┐
│ Step 1: Convert to lowercase                        │
│                                                      │
│ go_term_lower = "inflammatory response"             │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: Iterate through all themes                  │
│                                                      │
│ for theme_name, keywords in themes.items():         │
│     # theme_name: "Inflammation & immune signaling" │
│     # keywords: ["inflammatory", "immune", ...]     │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: Iterate through theme keywords              │
│                                                      │
│ for keyword in keywords:                            │
│     # keyword: "inflammatory"                        │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: Check if keyword is in GO term name         │
│                                                      │
│ if keyword.lower() in go_term_lower:                │
│     # "inflammatory" in "inflammatory response"      │
│     # → True                                        │
│     return theme_name  # Return first matching theme│
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Return: "Inflammation & immune signaling"           │
└─────────────────────────────────────────────────────┘

If no match:
┌─────────────────────────────────────────────────────┐
│ Return: None                                        │
│ (This GO term will be filtered out in aggregation) │
└─────────────────────────────────────────────────────┘
```

---

## IV. IVCCA Analysis Module Detailed Flow

### 4.1 Data Loading Flow

```
┌─────────────────────────────────────────────────────┐
│ User uploads data file (.xlsx/.csv/.tsv)            │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Frontend: POST /api/ivcca/load-data                │
│                                                      │
│ const formData = new FormData()                     │
│ formData.append('file', file)                       │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Backend Processing                                  │
│                                                      │
│ Step 1: Create IVCCAAnalyzer instance               │
│     analyzer = IVCCAAnalyzer()                      │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: Call analyzer.load_data(file_path)          │
│                                                      │
│ def load_data(self, file_path: str):                │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: Detect file type                            │
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
│ Step 4: Extract data structure                      │
│                                                      │
│ sample_col = df.columns[0]                          │
│ self.sample_names = df[sample_col].tolist()         │
│ # Result: ['Sample1', 'Sample2', ...]              │
│                                                      │
│ self.gene_names = [col for col in df.columns[1:]]   │
│ # Result: ['Gene1', 'Gene2', ...]                  │
│                                                      │
│ self.data = df.iloc[:, 1:].values                   │
│ # Result: numpy array (samples × genes)             │
│ # [[val11, val12, ...],                            │
│ #  [val21, val22, ...],                             │
│ #  ...]                                             │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: Data type conversion and validation         │
│                                                      │
│ self.data = pd.DataFrame(self.data).apply(          │
│     pd.to_numeric, errors='coerce'                  │
│ ).values                                            │
│                                                      │
│ # Check NaN values:                                 │
│ nan_count = np.isnan(self.data).sum()               │
│ if nan_count > 0:                                   │
│     print(f"Warning: {nan_count} NaN values")       │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: Set status flags                            │
│                                                      │
│ self.data_loaded = True                             │
│ self.correlation_calculated = False                 │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 7: Generate data preview                       │
│                                                      │
│ preview = {                                         │
│     "columns": [sample_col] + self.gene_names,      │
│     "rows": [...]  # First few rows of data         │
│ }                                                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 8: Store analyzer in memory                    │
│                                                      │
│ analyzer_id = str(uuid.uuid4())                     │
│ analyzers[analyzer_id] = analyzer                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 9: Return response                             │
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

### 4.2 Correlation Calculation Flow

```
┌─────────────────────────────────────────────────────┐
│ User clicks "Calculate Correlation" button          │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Frontend: POST /api/ivcca/calculate-correlation    │
│                                                      │
│ Body: {                                             │
│     "analyzer_id": "uuid-string",                   │
│     "method": "pearson"                             │
│ }                                                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Backend: Get analyzer from memory                   │
│                                                      │
│ analyzer = analyzers.get(analyzer_id)               │
│ if not analyzer:                                    │
│     raise HTTPException(404, "Analyzer not found")  │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Call: analyzer.calculate_correlations(method)       │
│                                                      │
│ def calculate_correlations(self, method='pearson'): │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: Check if data is loaded                     │
│                                                      │
│ if not self.data_loaded:                            │
│     return {"status": "error", ...}                 │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: Convert to DataFrame                        │
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
│ Step 3: Calculate correlation matrix                │
│                                                      │
│ if method == 'pearson':                             │
│     self.correlation_matrix = data_df.corr(         │
│         method='pearson'                            │
│     ).values                                        │
│ # pandas.corr() internal:                           │
│ # - Calculate Pearson correlation coefficient for each gene pair │
│ # - Return correlation matrix (genes × genes)        │
│ # - Diagonal is 1 (autocorrelation)                  │
│ # - Matrix is symmetric                              │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: Handle NaN values                           │
│                                                      │
│ self.correlation_matrix = np.nan_to_num(            │
│     self.correlation_matrix,                        │
│     nan=0.0                                         │
│ )                                                   │
│ # Replace NaN with 0 (usually due to constant values)│
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: Calculate statistics                        │
│                                                      │
│ # Extract upper triangle matrix (exclude diagonal and lower triangle) │
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
│ Step 6: Set status flag                             │
│                                                      │
│ self.correlation_calculated = True                  │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 7: Return response                             │
│                                                      │
│ return {                                            │
│     "status": "success",                            │
│     "matrix_size": self.correlation_matrix.shape,   │
│     "statistics": stats                             │
│ }                                                   │
└─────────────────────────────────────────────────────┘
```

### 4.3 Matrix Sorting Flow

```
┌─────────────────────────────────────────────────────┐
│ User clicks "Sort" button                           │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Backend: analyzer.sort_correlation_matrix()         │
│                                                      │
│ def sort_correlation_matrix(self):                  │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: Calculate mean absolute correlation for each gene │
│                                                      │
│ abs_corr = np.abs(self.correlation_matrix)          │
│ # Take absolute value: both positive and negative correlations considered │
│                                                      │
│ np.fill_diagonal(abs_corr, 0)                       │
│ # Set diagonal to 0 (exclude autocorrelation)       │
│                                                      │
│ gene_scores = np.mean(abs_corr, axis=1)             │
│ # Calculate mean for each row, get mean absolute correlation for each gene │
│ # gene_scores[i] = mean(|r_ij|) for j ≠ i          │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: Sort indices                                │
│                                                      │
│ sorted_indices = np.argsort(gene_scores)[::-1]      │
│ # argsort returns indices in ascending order        │
│ # [::-1] reverses to get descending order           │
│ # Result: [5, 12, 3, ...]  # Gene 5 has highest correlation │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: Rearrange using sorted indices              │
│                                                      │
│ sorted_matrix = self.correlation_matrix[            │
│     sorted_indices[:, None],                        │
│     sorted_indices                                  │
│ ]                                                   │
│ # Rearrange both rows and columns                   │
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
│ Step 4: Return sorted results                       │
│                                                      │
│ return {                                            │
│     "status": "success",                            │
│     "sorted_matrix": sorted_matrix.tolist(),        │
│     "sorted_gene_names": sorted_gene_names,         │
│     "sorted_scores": sorted_scores.tolist()         │
│ }                                                   │
└─────────────────────────────────────────────────────┘
```

### 4.4 PCA Analysis Flow

```
┌─────────────────────────────────────────────────────┐
│ User clicks "Perform PCA" button                    │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Backend: analyzer.perform_pca(n_components=3)       │
│                                                      │
│ def perform_pca(self, n_components=3):              │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: Use correlation matrix as input             │
│                                                      │
│ data = np.abs(self.correlation_matrix)              │
│ # Use absolute correlation matrix                   │
│ # Shape: (genes, genes)                             │
│ # Each gene is a "sample", correlations between genes are "features" │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: Fill NaN values                             │
│                                                      │
│ data_filled = np.nan_to_num(data, nan=0.0)          │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: Execute PCA (using sklearn)                 │
│                                                      │
│ from sklearn.decomposition import PCA               │
│                                                      │
│ pca = PCA(n_components=25)  # Calculate 25 principal components │
│ pca.fit(data_filled)                                │
│                                                      │
│ # PCA internal steps:                               │
│ # 1. Standardize data (if needed)                   │
│ # 2. Calculate covariance matrix                     │
│ # 3. Eigendecomposition: C = Q × Λ × Q^T            │
│ # 4. Select top k principal components               │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: Calculate principal component scores        │
│                                                      │
│ pca_scores = pca.transform(data_filled)             │
│ # Shape: (genes, n_components)                      │
│ # Coordinates of each gene in principal component space │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: Calculate explained variance                │
│                                                      │
│ explained_variance = pca.explained_variance_ratio_  │
│ # Variance proportion explained by each principal component │
│ # Example: [0.25, 0.15, 0.10, ...]                 │
│ # PC1 explains 25% variance, PC2 explains 15%, etc. │
│                                                      │
│ cumulative_variance = np.cumsum(explained_variance) │
│ # Cumulative variance: [0.25, 0.40, 0.50, ...]     │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: Generate visualizations                     │
│                                                      │
│ # 6.1 Scree plot (cumulative variance)              │
│ fig = go.Figure()                                   │
│ fig.add_trace(go.Scatter(                           │
│     x=components,                                   │
│     y=cumulative_variance * 100,  # Convert to percentage │
│     mode='lines+markers'                            │
│ ))                                                  │
│                                                      │
│ # 6.2 3D scatter plot                               │
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
│ Step 7: Convert to JSON (Plotly)                    │
│                                                      │
│ plot_data = fig.to_json()                           │
│ # Plotly chart configuration (JSON format)          │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 8: Return response                             │
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
│ Frontend: Render Plotly chart                       │
│                                                      │
│ <Plot                                               │
│     data={JSON.parse(plot_data.content)}            │
│     layout={...}                                    │
│ />                                                  │
└─────────────────────────────────────────────────────┘
```

### 4.5 Multi-Pathway Analysis Flow

```
┌─────────────────────────────────────────────────────┐
│ User selects multiple pathway files and clicks "Analyze" │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Backend: analyzer.multi_pathway_analysis()          │
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
│ Iterate through each pathway                        │
│                                                      │
│ for pathway_file, pathway_genes in                  │
│     zip(pathway_files, pathway_genes_list):         │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: Find indices of pathway genes in dataset    │
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
│ Step 2: Check minimum gene count threshold          │
│                                                      │
│ if len(pathway_indices) < min_genes_threshold:      │
│     continue  # Skip this pathway                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: Calculate PCI_A (within-pathway correlation) │
│                                                      │
│ # Extract pathway correlation submatrix             │
│ pathway_corr = self.correlation_matrix[             │
│     np.ix_(pathway_indices, pathway_indices)        │
│ ]                                                   │
│ # Shape: (k, k) where k = len(pathway_indices)      │
│                                                      │
│ # Calculate absolute correlation                    │
│ abs_pathway_corr = np.abs(pathway_corr)             │
│ np.fill_diagonal(abs_pathway_corr, 0)               │
│                                                      │
│ # Calculate mean absolute correlation for each gene │
│ sum_abs_correlations = np.sum(                      │
│     abs_pathway_corr, axis=1                        │
│ )                                                   │
│ avg_abs_correlation = sum_abs_correlations / (      │
│     len(pathway_indices) - 1                        │
│ )                                                   │
│                                                      │
│ # Calculate PCI_A (within-pathway average)          │
│ pci_a = float(np.mean(avg_abs_correlation))         │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: Calculate PCI_B (extract from global sort)  │
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
│ Step 5: Calculate PAI (Pathway Activation Index)    │
│                                                      │
│ pai = len(pathway_indices) / len(pathway_genes)     │
│ # Number of genes found in dataset / Total genes in pathway │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: Calculate CECI (Correlation-Expression Composite Index) │
│                                                      │
│ if pci_b is not None:                               │
│     ceci = pai * pci_b * 100                        │
│ else:                                               │
│     ceci = pai * pci_a * 100                        │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 7: Calculate Z-score                           │
│                                                      │
│ z_score = (ceci - 7.908) / 2.0605                  │
│ # 7.908: Mean CECI of random gene sets              │
│ # 2.0605: Standard deviation of CECI for random gene sets │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 8: Store results                               │
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
│ Step 9: Sort by CECI                                │
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
│ Step 10: Return results                             │
│                                                      │
│ return {                                            │
│     "status": "success",                            │
│     "pathways": results,                            │
│     "n_pathways": len(results)                      │
│ }                                                   │
└─────────────────────────────────────────────────────┘
```

---

## V. Component Interaction Relationships

### 5.1 Frontend Component Interactions

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

All components communicate via:
├─→ Props passing (parent → child)
├─→ State lifting (child → parent via callback functions)
└─→ API calls (component → backend)
```

### 5.2 Backend Class Interactions

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

Data flow:
├─→ GeneSearchAPI ←→ MongoDB
├─→ GeneOntologyAPI → GProfiler API → Enrichment results
└─→ IVCCAAnalyzer → Algorithm libraries → Analysis results
```

### 5.3 Data Flow Overview

```
┌──────────────┐
│ User Actions │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────┐
│        Frontend Components           │
│        (React State)                 │
└──────┬───────────────────────────────┘
       │ HTTP Request (JSON)
       ▼
┌──────────────────────────────────────┐
│      FastAPI Routes                  │
│      (Request Validation)            │
└──────┬───────────────────────────────┘
       │
       ├──────────────┬──────────────┬──────────────┐
       │              │              │              │
       ▼              ▼              ▼              ▼
┌──────────┐  ┌─────────────┐  ┌──────────┐  ┌──────────┐
│MongoDB   │  │GProfiler API│  │Algorithm │  │File      │
│Query/Write│  │Enrichment   │  │Computing │  │System    │
│          │  │             │  │(NumPy etc)│  │(Excel)   │
└────┬─────┘  └─────┬───────┘  └────┬─────┘  └────┬─────┘
     │              │               │             │
     └──────────────┴───────────────┴─────────────┘
                     │
                     ▼
          ┌──────────────────────┐
          │  Data Processing and │
          │     Computation      │
          │   (Business Logic)   │
          └──────────┬───────────┘
                     │
                     ▼
          ┌──────────────────────┐
          │   Response Generation │
          │    (JSON/Base64)     │
          └──────────┬───────────┘
                     │ HTTP Response
                     ▼
          ┌──────────────────────┐
          │  Frontend State Update│
          │    (React Re-render) │
          └──────────┬───────────┘
                     │
                     ▼
          ┌──────────────────────┐
          │  User Sees Results   │
          └──────────────────────┘
```

---

## VI. Key Algorithm Execution Flow

### 6.1 Pearson Correlation Coefficient Calculation (Detailed)

```
Input: Two gene expression vectors
X = [x1, x2, ..., xn]  (n samples)
Y = [y1, y2, ..., yn]

┌─────────────────────────────────────────────────────┐
│ Step 1: Calculate mean                              │
│                                                      │
│ x_mean = (x1 + x2 + ... + xn) / n                   │
│ y_mean = (y1 + y2 + ... + yn) / n                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: Calculate covariance numerator              │
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
│ Step 3: Calculate standard deviation                │
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
│ Step 4: Calculate correlation coefficient           │
│                                                      │
│ r = numerator / (x_std × y_std)                     │
│                                                      │
│ If denominator == 0:                                │
│     r = NaN  # One of the genes has no variation    │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Output: r ∈ [-1, 1]                                 │
│                                                      │
│ r = 1:  Perfect positive correlation                │
│ r = 0:  No linear correlation                       │
│ r = -1: Perfect negative correlation                │
└─────────────────────────────────────────────────────┘

Vectorized implementation (pandas):
┌─────────────────────────────────────────────────────┐
│ data_df.corr(method='pearson')                      │
│                                                      │
│ Internally performs above calculation for each gene pair, building correlation matrix │
│ Time complexity: O(n × m²) where n=sample count, m=gene count │
└─────────────────────────────────────────────────────┘
```

### 6.2 CECI Calculation Flow (Detailed)

```
Input:
- pathway_genes: ['Gene1', 'Gene2', ...]  # Pathway gene list
- sorted_genes: ['Gene5', 'Gene12', ...]  # Globally sorted genes
- sorted_correlations: [0.85, 0.82, ...]  # Corresponding correlation scores

┌─────────────────────────────────────────────────────┐
│ Step 1: Match pathway genes to dataset              │
│                                                      │
│ pathway_indices = []                                │
│ for gene in pathway_genes:                          │
│     if gene in dataset_genes:                       │
│         idx = find_index(gene)                      │
│         pathway_indices.append(idx)                 │
│                                                      │
│ # Example:                                          │
│ # pathway_genes = ['GAPDH', 'ACTB', 'TUBB']        │
│ # pathway_indices = [5, 12, 23]  # Indices in dataset │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: Calculate PCI_A (within-pathway correlation) │
│                                                      │
│ # 2.1 Extract pathway correlation submatrix         │
│ pathway_corr = correlation_matrix[                  │
│     pathway_indices, :][:, pathway_indices]         │
│ # Shape: (k, k) where k = len(pathway_indices)      │
│                                                      │
│ # 2.2 Calculate absolute correlation                │
│ abs_pathway_corr = |pathway_corr|                   │
│ abs_pathway_corr[diagonal] = 0  # Exclude autocorrelation │
│                                                      │
│ # 2.3 Calculate mean absolute correlation for each gene │
│ for i in range(k):                                  │
│     Q_i = mean(abs_pathway_corr[i, :])              │
│     # Exclude diagonal, so divide by (k-1)          │
│                                                      │
│ # 2.4 Calculate PCI_A                               │
│ PCI_A = mean([Q_1, Q_2, ..., Q_k])                  │
│       = mean(Q_i) for all i in pathway              │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: Calculate PCI_B (global correlation)        │
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
│ Step 4: Calculate PAI (Pathway Activation Index)    │
│                                                      │
│ PAI = genes_found / total_genes                     │
│     = len(pathway_indices) / len(pathway_genes)     │
│                                                      │
│ # Example:                                          │
│ # pathway_genes has 100 genes                       │
│ # 45 found in dataset                               │
│ # PAI = 45/100 = 0.45                               │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: Calculate CECI                              │
│                                                      │
│ if PCI_B is not None:                               │
│     CECI = PAI × PCI_B × 100                        │
│ else:                                               │
│     CECI = PAI × PCI_A × 100                        │
│                                                      │
│ # Example:                                          │
│ # PAI = 0.45                                        │
│ # PCI_B = 0.72                                      │
│ # CECI = 0.45 × 0.72 × 100 = 32.4                   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: Calculate Z-score                           │
│                                                      │
│ # Background distribution parameters (calculated from random gene sets) │
│ background_mean = 7.908                             │
│ background_std = 2.0605                             │
│                                                      │
│ Z = (CECI - background_mean) / background_std       │
│   = (32.4 - 7.908) / 2.0605                         │
│   = 11.87                                           │
│                                                      │
│ # Critical Z-value (α=0.05):                        │
│ Z_critical = 1.96                                   │
│                                                      │
│ # Judgment:                                         │
│ if |Z| > Z_critical:                                │
│     Pathway significantly activated (or suppressed)  │
└─────────────────────────────────────────────────────┘
```

---

## VII. Memory Management and State Persistence

### 7.1 Backend Memory Management

**IVCCA Analyzer Instance Storage**:

```python
# Global dictionary (in memory)
analyzers: Dict[str, IVCCAAnalyzer] = {}

# Create new instance
analyzer_id = str(uuid.uuid4())
analyzers[analyzer_id] = IVCCAAnalyzer()

# Get instance
analyzer = analyzers.get(analyzer_id)
```

**Memory Usage**:

```
Memory usage per analyzer instance:
├─ self.data: (samples, genes) × 8 bytes (float64)
├─ self.correlation_matrix: (genes, genes) × 8 bytes
└─ Other variables: ~few MB

Example: 1000 genes, 100 samples
├─ data: 100 × 1000 × 8 = 800 KB
└─ correlation_matrix: 1000 × 1000 × 8 = 8 MB
Total: ~10 MB per analyzer
```

**Lifecycle Management**:

- Instances remain in memory until server restart
- No automatic cleanup mechanism (can add TTL)
- Supports multiple users analyzing simultaneously (each user has independent analyzer_id)

### 7.2 Frontend State Management

**State Lifecycle**:

```
Component mount
    │
    ├─→ useState initialization
    ├─→ useEffect execution
    └─→ Initial render
    │
User action
    │
    ├─→ State update (setState)
    └─→ React re-render
    │
Component unmount
    │
    └─→ State cleanup
```

**Persistent Storage**:

```typescript
// localStorage (browser storage)
localStorage.setItem('authToken', token);      // Authentication token
localStorage.setItem('isLoggedIn', 'true');    // Login status

// Session-level storage (lost after page refresh)
// - All useState states
// - API response data
// - UI states
```

---

## VIII. Error Handling and Exception Flow

### 8.1 Frontend Error Handling Flow

```
API call
    │
    ├─→ Success (response.ok === true)
    │     │
    │     └─→ Parse JSON → Update state → Display results
    │
    └─→ Failure
          │
          ├─→ Network error (fetch error)
          │     │
          │     └─→ catch block → setError() → Display error message
          │
          └─→ HTTP error (response.ok === false)
                │
                ├─→ 400: Client error → Display error details
                ├─→ 401: Unauthorized → Redirect to login page
                ├─→ 404: Resource not found → Display "Not found"
                └─→ 500: Server error → Display "Server error"
```

### 8.2 Backend Error Handling Flow

```
Request received
    │
    ├─→ Parameter validation failed (Pydantic)
    │     │
    │     └─→ Automatically return 422 (Unprocessable Entity)
    │
    ├─→ Business logic error
    │     │
    │     ├─→ ValueError → HTTPException(400)
    │     ├─→ KeyError → HTTPException(404)
    │     └─→ Exception → HTTPException(500)
    │
    └─→ Success
          │
          └─→ Return JSON response (200)
```

---

## IX. Performance Optimization Details

### 9.1 Database Query Optimization

**Index Usage**:

```
Query: {"gene_symbol": {"$regex": "^GAPDH$", "$options": "i"}}

Without index:
├─ Full table scan: O(n)
└─ Time complexity: High

With index:
├─ Index lookup: O(log n)
└─ Time complexity: Low (logarithmic)

Index structure (B-Tree):
┌─────────────┐
│ ACTB → doc1 │
│ ACTB → doc2 │
│ ACTB → doc3 │
│ ...         │
│ GAPDH → doc5│  ← Quick positioning
│ GAPDH → doc6│
│ ...         │
└─────────────┘
```

### 9.2 Correlation Calculation Optimization

**Vectorized Calculation**:

```
Traditional loop approach:
for i in range(n_genes):
    for j in range(i+1, n_genes):
        r[i,j] = calculate_correlation(data[:,i], data[:,j])
Time complexity: O(n² × m) where m=sample count

Vectorized approach (pandas):
correlation_matrix = data_df.corr()
Time complexity: O(n² × m) but actually faster (underlying optimization)

NumPy optimization:
- Use BLAS library (linear algebra library)
- Multi-threaded computation
- SIMD instruction set acceleration
```

### 9.3 Frontend Rendering Optimization

**React Optimization**:

```
1. Use useMemo to cache computation results
   const filteredResults = useMemo(() => {
       return results.filter(...);
   }, [results]);

2. Use useCallback to cache functions
   const handleClick = useCallback(() => {
       // ...
   }, [dependencies]);

3. Code splitting (dynamic imports)
   const Plot = dynamic(() => import('react-plotly.js'));
```

---

## X. Deployment and Runtime Flow

### 10.1 Development Environment Startup Flow

```
┌─────────────────────────────────────┐
│ Step 1: Start Backend               │
│                                     │
│ cd backend                          │
│ python server.py                    │
│                                     │
│ Or:                                 │
│ uvicorn server:app --reload         │
└─────────────────────────────────────┘
    │
    ├─→ Load environment variables
    ├─→ Connect to MongoDB
    ├─→ Initialize API classes
    ├─→ Start FastAPI server
    └─→ Listen on port 8000
    │
┌─────────────────────────────────────┐
│ Step 2: Start Frontend              │
│                                     │
│ cd genegen                          │
│ npm run dev                         │
└─────────────────────────────────────┘
    │
    ├─→ Compile TypeScript
    ├─→ Start Next.js development server
    └─→ Listen on port 3000
    │
┌─────────────────────────────────────┐
│ Step 3: Browser Access              │
│                                     │
│ http://localhost:3000               │
└─────────────────────────────────────┘
```

### 10.2 Production Environment Deployment Flow

```
┌─────────────────────────────────────┐
│ Step 1: Build Frontend              │
│                                     │
│ cd genegen                          │
│ npm run build                       │
│ # Generate .next directory          │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ Step 2: Docker Build                │
│                                     │
│ docker-compose build                │
│ # Build backend and frontend images │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ Step 3: Start Containers            │
│                                     │
│ docker-compose up -d                │
│ # Run all services in background    │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ Step 4: Nginx Reverse Proxy (Optional) │
│                                     │
│ Configure Nginx to forward requests │
│ /api/* → backend:8000              │
│ /* → frontend:3000                 │
└─────────────────────────────────────┘
```

---

## XI. Key Technical Decision Explanations

### 11.1 Why Choose MongoDB?

**Reasons**:
1. **Flexible data model**: Different organs may have different numbers of genes, document model is more flexible
2. **Rapid development**: No need to predefine schema
3. **Horizontal scaling**: Supports sharding and replica sets
4. **Index support**: B-tree indexes accelerate queries

**Alternatives**:
- PostgreSQL: Requires predefined table structure, but supports SQL queries
- SQLite: Lightweight, but not suitable for concurrency

### 11.2 Why Choose FastAPI?

**Reasons**:
1. **Performance**: Based on Starlette, async support, performance close to Node.js
2. **Auto documentation**: OpenAPI/Swagger auto-generation
3. **Type safety**: Pydantic models automatically validate
4. **Python ecosystem**: Can use all Python scientific computing libraries

**Alternatives**:
- Django: Too heavy, suitable for full-stack applications
- Flask: Lightweight but lacks auto documentation and type validation

### 11.3 Why Choose Next.js?

**Reasons**:
1. **Server-side rendering**: SEO friendly
2. **File system routing**: Simple and intuitive
3. **Automatic code splitting**: Optimizes loading performance
4. **React ecosystem**: Can use all React libraries

**Alternatives**:
- Create React App: Lacks SSR and routing
- Vue.js: Different technology stack

---

## XII. System Extension Points

### 12.1 Data Extension

**Adding New Organs**:
```
1. Place new Excel file in backend/data/
2. Restart backend server
3. GeneSearchAPI.__init__() automatically loads new data
```

**Adding New Fields**:
```
1. Modify Excel file, add new columns
2. Modify GeneData model (server.py)
3. Modify data loading logic
4. Modify frontend display components
```

### 12.2 Feature Extension

**Adding New Analysis Algorithms**:
```
1. Add new method in ivcca_core.py
2. Add new API endpoint in server.py
3. Add new UI component in frontend
```

**Adding New Visualization Types**:
```
1. Create new chart generation function in backend
2. Use matplotlib/Plotly to generate charts
3. Return base64 or Plotly JSON
4. Frontend renders charts
```

---

**Document Version**: 1.0  
**Last Updated**: 2024
