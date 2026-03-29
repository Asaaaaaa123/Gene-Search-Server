# GenoCorr Platform Complete System Architecture Documentation

## Table of Contents

1. [Overall Architecture Overview](#overall-architecture-overview)
2. [Three-Tier Architecture Details](#three-tier-architecture-details)
3. [Frontend Architecture Detailed Design](#frontend-architecture-detailed-design)
4. [Backend Architecture Detailed Design](#backend-architecture-detailed-design)
5. [Data Flow and Interaction Processes](#data-flow-and-interaction-processes)
6. [Core Module Architecture](#core-module-architecture)
7. [API Interface Architecture](#api-interface-architecture)
8. [Database Architecture](#database-architecture)
9. [Deployment Architecture](#deployment-architecture)
10. [Technology Stack Details](#technology-stack-details)

---

## Overall Architecture Overview

### Architecture Pattern

The GenoCorr platform adopts a **Three-Tier Client-Server Architecture**, combined with **RESTful API** communication patterns and **frontend-backend separation** design principles.

```
┌─────────────────────────────────────────────────────────────┐
│                  Presentation Layer                          │
│                  Next.js 15.3.5 Frontend                     │
│                (React 19.0 + TypeScript)                     │
└────────────────────┬──────────────────────────────────────────┘
                     │ HTTP/REST API (JSON)
                     │ Port: 8000
┌────────────────────▼──────────────────────────────────────────┐
│               Business Logic Layer                            │
│               FastAPI 0.68.0 Backend                         │
│                (Python 3.9+)                                 │
└───────┬────────────────────────┬──────────────┬───────────────┘
        │                        │              │
        │                        │              │
┌───────▼────────┐  ┌───────────▼──────┐  ┌───▼──────────────┐
│   MongoDB      │  │   GProfiler API  │  │  File System     │
│ (Data Persist  │  │ (External API    │  │  (Excel/CSV/TSV) │
│    Layer)      │  │   Service)       │  │                  │
│                │  │                  │  │                  │
│ gene_search_db │  │ Enrichment       │  │ Backend Data     │
│                │  │ Analysis Service │  │ Files            │
└────────────────┘  └──────────────────┘  └──────────────────┘
```

### Architecture Layer Description

1. **Presentation Layer (Frontend)**: User interface and interaction
2. **Business Logic Layer (Backend)**: Core business processing and algorithms
3. **Data Persistence Layer**: Data storage and external service integration

---

## Three-Tier Architecture Details

### Layer 1: Presentation Layer (Frontend - Next.js)

#### Technology Stack

- **Framework**: Next.js 15.3.5 (based on React 19.0)
- **Language**: TypeScript 5.x
- **Styling**: Tailwind CSS 4.x
- **Visualization**: Plotly.js 2.35.3
- **Build Tool**: Turbopack (built into Next.js)

#### Frontend Directory Structure

```
genegen/
├── app/                          # Next.js App Router
│   ├── layout.tsx               # Root layout component
│   ├── page.tsx                 # Home page
│   ├── globals.css              # Global styles
│   │
│   ├── gene-search/             # Module 1: Gene Search
│   │   └── page.tsx            # Gene search page component
│   │
│   ├── gene-ontology/           # Module 2: Theme Analysis
│   │   ├── page.tsx            # Theme analysis entry page
│   │   ├── default-theme/      # Default theme analysis
│   │   │   └── page.tsx
│   │   └── customize-theme/    # Custom theme analysis
│   │       └── page.tsx
│   │
│   ├── ivcca/                   # Module 3: IVCCA Analysis
│   │   └── page.tsx            # IVCCA analysis page
│   │
│   ├── login/                   # Authentication page
│   │   └── page.tsx
│   │
│   ├── add-gene/                # Add gene data (requires authentication)
│   │   └── page.tsx
│   │
│   └── upload-csv/              # CSV upload functionality
│       └── page.tsx
│
├── public/                      # Static resources
│   └── 885_genes.txt           # Example gene list
│
├── package.json                 # Dependencies configuration
├── tsconfig.json                # TypeScript configuration
└── next.config.ts               # Next.js configuration
```

#### Frontend Component Architecture

**1. Page Components**

Each page is an independent React component, marked as a client component using the `'use client'` directive.

```typescript
// Example: Gene search page structure
export default function GeneSearch() {
  // State management
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<GeneData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // API calls
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  
  // Event handler function
  const handleSearch = async () => {
    // Call backend API
    const response = await fetch(`${API_BASE_URL}/api/gene/symbol/search?gene_symbol=${searchTerm}`);
    const data = await response.json();
    setSearchResults(data.data);
  };
  
  // UI rendering
  return (
    // JSX structure
  );
}
```

**2. State Management Architecture**

- **Local State**: Using React `useState` Hook
- **Global State**: Through Context API or props passing
- **API State**: Independently managed for each API call
- **Caching Strategy**: Browser localStorage (authentication token)

**3. Data Fetching Process**

```
User Action → Event Trigger → API Call → State Update → UI Re-render
```

#### Frontend-Backend Communication

**Communication Protocol**:
- **Protocol**: HTTP/HTTPS
- **Data Format**: JSON
- **Methods**: GET, POST
- **Authentication**: Token-based (stored in localStorage)

**API Call Pattern**:

```typescript
// Standard API call pattern
const response = await fetch(`${API_BASE_URL}/api/endpoint`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(requestData),
});

const data = await response.json();
```

**Error Handling**:
- Try-catch to capture network errors
- HTTP status code checking
- User-friendly error messages

### Layer 2: Business Logic Layer (Backend - FastAPI)

#### Technology Stack

- **Framework**: FastAPI 0.68.0
- **Language**: Python 3.9+
- **Data Science Libraries**:
  - pandas: Data processing
  - NumPy: Numerical computation
  - SciPy: Scientific computing
  - scikit-learn: Machine learning
- **Visualization**: matplotlib, seaborn
- **External Service**: GProfiler Python client

#### Backend Directory Structure

```
backend/
├── server.py                    # FastAPI main application (1900+ lines)
├── ivcca_core.py               # IVCCA core algorithm module (2200+ lines)
├── start_backend.py            # Backend startup script
├── requirements.txt            # Python dependencies
│
├── data/                       # Data files directory
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
└── .env                        # Environment variables configuration
```

#### Backend Application Architecture

**1. FastAPI Application Initialization**

```python
# server.py
app = FastAPI(title="Gene Expression Search API", version="1.0.0")

# CORS middleware configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**2. API Class Organization**

```python
# Three main API classes
class GeneSearchAPI:
    """Gene Search API class"""
    - load_data_to_mongodb()
    - search_gene_data()
    - create_fold_change_plot()
    # ...

class GeneOntologyAPI:
    """Gene Ontology Analysis API class"""
    - enrich()
    - assign_theme()
    - aggregate()
    - create_theme_chart()
    # ...

# IVCCA functionality is implemented through classes in ivcca_core.py
# Direct use of IVCCAAnalyzer class in server.py
```

**3. Request Processing Flow**

```
HTTP Request → FastAPI Route → Pydantic Validation → Business Logic → Data Processing → Response Return
```

#### API Endpoint Organization

**Endpoint Categories**:

1. **Authentication Endpoints**:
   - `POST /api/auth/login` - Token authentication

2. **Gene Search Endpoints** (7 endpoints):
   - `GET /api/gene/symbols` - Get all gene symbols
   - `GET /api/gene/symbol/search` - Search gene
   - `GET /api/gene/symbol/showFoldChange` - Fold Change chart
   - `GET /api/gene/symbol/showLSMeanControl` - Control group chart
   - `GET /api/gene/symbol/showLSMeanTenMgKg` - Treatment group chart
   - `POST /api/gene/add` - Add gene (requires authentication)

3. **Theme Analysis Endpoints** (4 endpoints):
   - `POST /api/ontology/analyze` - Standard enrichment analysis
   - `POST /api/ontology/custom-analyze` - Custom theme analysis
   - `POST /api/ontology/theme-chart` - Theme detailed chart
   - `POST /api/ontology/custom-summary-chart` - Theme summary chart

4. **IVCCA Analysis Endpoints** (14 endpoints):
   - `POST /api/ivcca/load-data` - Load data
   - `POST /api/ivcca/calculate-correlation` - Calculate correlation
   - `POST /api/ivcca/sort-matrix` - Sort matrix
   - `POST /api/ivcca/heatmap` - Heatmap
   - `POST /api/ivcca/histogram` - Histogram
   - `POST /api/ivcca/optimal-clusters` - Optimal cluster number
   - `POST /api/ivcca/dendrogram` - Dendrogram
   - `POST /api/ivcca/pca` - PCA analysis
   - `POST /api/ivcca/tsne` - t-SNE analysis
   - `POST /api/ivcca/single-pathway` - Single pathway analysis
   - `POST /api/ivcca/compare-pathways` - Pathway comparison
   - `POST /api/ivcca/gene-to-genes` - Gene to genes
   - `POST /api/ivcca/gene-to-pathways` - Gene to pathways
   - `POST /api/ivcca/multi-pathway` - Multi-pathway analysis
   - `POST /api/ivcca/venn-diagram` - Venn diagram
   - `POST /api/ivcca/network-analysis` - Network analysis

5. **Utility Endpoints**:
   - `GET /api/health` - Health check
   - `GET /api/test` - Test endpoint
   - `GET /docs` - API documentation (auto-generated)

**Total**: Approximately 40+ API endpoints

### Layer 3: Data Persistence Layer

#### MongoDB Database

**Connection Management**:

```python
# Connection configuration
MONGODB_URI = os.getenv('MONGODB_URI')
client = MongoClient(MONGODB_URI)
db = client.gene_search_db
collection = db.gene_data
```

**Data Model**:

```python
# Document structure
{
    '_id': ObjectId,                    # Auto-generated by MongoDB
    'organ': 'Heart',                   # Organ name (9 types)
    'gene_symbol': 'GAPDH',            # Gene symbol (indexed field)
    'gene_name': 'Glyceraldehyde-3-phosphate dehydrogenase',
    'p_value_10_mgkg_vs_control': '0.001',
    'fdr_step_up_10_mgkg_vs_control': '0.05',
    'ratio_10_mgkg_vs_control': '1.5',
    'fold_change_10_mgkg_vs_control': '0.5',
    'lsmean_10mgkg_10_mgkg_vs_control': '10.5',
    'lsmean_control_10_mgkg_vs_control': '8.5'
}
```

**Index Design**:

```python
# Single-field index (accelerate queries)
collection.create_index([("gene_symbol", 1)])      # Ascending index
collection.create_index([("organ", 1)])

# Composite unique index (prevent duplicates)
collection.create_index(
    [("organ", 1), ("gene_symbol", 1)], 
    unique=True
)
```

#### External API Service

**GProfiler API**:

```python
# Initialization
from gprofiler import GProfiler
gp = GProfiler(return_dataframe=True)

# Enrichment analysis call
df = gp.profile(
    organism="mmusculus",  # Mouse
    query=genes_list       # Gene list
)
```

#### File System Storage

- **Excel Files**: `backend/data/*.xlsx` (9 organs)
- **Gene Lists**: `.txt` files (pathway definitions, gene lists)
- **Generated Charts**: Temporarily stored in memory, returned as base64 encoding

---

## Frontend Architecture Detailed Design

### Component Hierarchy

```
RootLayout (layout.tsx)
├── Navigation/Header (embedded in each page)
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
└── Footer (embedded in each page)
```

### Data Flow (Frontend Perspective)

**1. User Input Flow**

```
User Input → State Update (useState) → Event Handler Function → API Call → Response Processing → State Update → UI Update
```

**2. API Call Flow**

```typescript
// Standard flow
async function handleApiCall() {
  setIsLoading(true);                    // 1. Set loading state
  setError('');                          // 2. Clear errors
  
  try {
    const response = await fetch(...);    // 3. Make request
    if (!response.ok) {                   // 4. Check response status
      throw new Error(...);
    }
    const data = await response.json();   // 5. Parse JSON
    setResults(data);                     // 6. Update state
  } catch (error) {
    setError(error.message);              // 7. Error handling
  } finally {
    setIsLoading(false);                  // 8. Clear loading state
  }
}
```

**3. Visualization Data Flow**

```typescript
// Plotly chart data flow
API Return Data → Data Transformation → Plotly JSON Configuration → React Plotly Component → Interactive Chart

// Static image data flow
API Return base64 → <img src={`data:image/png;base64,${image}`} /> → Display Image
```

### State Management Architecture

**Local State (Component State)**:

- Use `useState` Hook to manage component-level state
- Each page component independently manages its own state
- State types:
  - User input (form data)
  - API response data
  - UI state (loading, error, expand/collapse)
  - Visualization configuration (chart type, parameters)

**Example**:

```typescript
// Gene search page state
const [searchTerm, setSearchTerm] = useState('');
const [searchResults, setSearchResults] = useState<GeneData[]>([]);
const [isLoading, setIsLoading] = useState(false);
const [error, setError] = useState('');
const [currentPlot, setCurrentPlot] = useState('');
```

**Global State (App State)**:

- API URL: Through environment variable `NEXT_PUBLIC_API_URL`
- Authentication Token: Stored in `localStorage`
- No global state management library (Redux/Zustand), keeping it simple

### Routing Architecture (Next.js App Router)

**File System Routing**:

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

**Navigation Implementation**:

```typescript
// Use Next.js Link component
import Link from 'next/link';

<Link href="/gene-search">Gene Search</Link>
<Link href="/gene-ontology">Theme Analysis</Link>
<Link href="/ivcca">IVCCA Analysis</Link>
```

---

## Backend Architecture Detailed Design

### FastAPI Application Structure

#### 1. Application Initialization Process

```python
# Step 1: Import dependencies
from fastapi import FastAPI, HTTPException, ...
from ivcca_core import IVCCAAnalyzer

# Step 2: Load environment variables
load_dotenv(env_path)

# Step 3: Connect to MongoDB
client = MongoClient(MONGODB_URI)
db = client.gene_search_db
collection = db.gene_data

# Step 4: Initialize API classes
gene_api = GeneSearchAPI()        # Automatically load data to MongoDB
ontology_api = GeneOntologyAPI()  # Initialize GProfiler client

# Step 5: Create FastAPI application
app = FastAPI(title="...", version="1.0.0")

# Step 6: Configure middleware
app.add_middleware(CORSMiddleware, ...)

# Step 7: Define route endpoints
@app.get("/api/...")
async def endpoint(...):
    ...
```

#### 2. Request Processing Flow (Detailed Steps)

**Step 1: HTTP Request Reception**

```
Client → HTTP Request → FastAPI ASGI Server → Route Matching
```

**Step 2: Request Validation**

```python
# FastAPI automatic validation (based on Pydantic models)
@app.get("/api/gene/symbol/search")
async def search_gene_symbol(
    gene_symbol: str = Query(..., description="...")  # Automatic parameter validation
):
    # If validation fails, automatically return 422 error
```

**Step 3: Business Logic Processing**

```python
# Call the corresponding API class method
results = gene_api.search_gene_data(gene_symbol)
```

**Step 4: Response Generation**

```python
# Return JSON response (FastAPI automatic serialization)
return {"gene_symbol": gene_symbol, "data": results}
```

**Step 5: Error Handling**

```python
try:
    # Business logic
except Exception as e:
    raise HTTPException(status_code=500, detail=str(e))
```

#### 3. API Class Detailed Design

**GeneSearchAPI Class**:

```python
class GeneSearchAPI:
    def __init__(self):
        # Execute during initialization
        self.load_data_to_mongodb()  # Load data to MongoDB
        self.all_genes = self.load_all_genes()  # Load all gene symbols
    
    # Data loading process
    def load_data_to_mongodb(self):
        """
        Step 1: Scan Excel files in data directory
        Step 2: For each file:
            - Read Excel (pandas.read_excel)
            - Extract organ name (file name)
            - Iterate through each row:
                - Extract gene symbol and expression data
                - Build MongoDB document
                - Add to bulk operations list
        Step 3: Execute bulk write (bulk_write with upsert)
        Step 4: Create indexes
        """
        pass
    
    # Search process
    def search_gene_data(self, gene_symbol: str):
        """
        Step 1: Build query (regular expression, case-insensitive)
        Step 2: Execute MongoDB query (using index)
        Step 3: Iterate through query results
        Step 4: Format to response format
        Step 5: Return result list
        """
        pass
    
    # Visualization generation process
    def create_fold_change_plot(self, gene_symbol: str):
        """
        Step 1: Query gene data (call search_gene_data)
        Step 2: Extract organ and Fold Change values
        Step 3: Create chart using matplotlib
        Step 4: Convert to base64 encoding
        Step 5: Return base64 string
        """
        pass
```

**GeneOntologyAPI Class**:

```python
class GeneOntologyAPI:
    def __init__(self):
        # Initialize GProfiler client
        self.gp = GProfiler(return_dataframe=True)
        # Define theme keyword mapping
        self.themes = {
            'Inflammation & immune signaling': ['inflammatory', ...],
            # ...
        }
    
    # Enrichment analysis process
    def enrich(self, genes: List[str]):
        """
        Step 1: Call GProfiler API
            df = self.gp.profile(organism="mmusculus", query=genes)
        Step 2: Filter P-values (p < 0.01)
        Step 3: Calculate Score = -log10(p_value)
        Step 4: Return DataFrame
        """
        pass
    
    # Theme assignment process
    def assign_theme(self, go_term_name: str):
        """
        Step 1: Convert GO term name to lowercase
        Step 2: Iterate through all theme keywords
        Step 3: Check if keyword is in GO term name
        Step 4: Return first matching theme
        """
        pass
    
    # Theme aggregation process
    def aggregate(self, df: pd.DataFrame):
        """
        Step 1: Assign theme to each GO term (apply assign_theme)
        Step 2: Filter out GO terms without themes
        Step 3: Group by theme
        Step 4: Aggregate calculations:
            - Score: Cumulative score (sum)
            - Terms: Term count (count)
        Step 5: Sort by Score descending
        """
        pass
```

#### 4. IVCCA Core Module Architecture

**IVCCAAnalyzer Class Structure**:

```python
class IVCCAAnalyzer:
    def __init__(self):
        # Data state
        self.data = None              # Raw data matrix (samples × genes)
        self.gene_names = None        # Gene name list
        self.sample_names = None      # Sample name list
        self.correlation_matrix = None # Correlation matrix (genes × genes)
        
        # Status flags
        self.data_loaded = False
        self.correlation_calculated = False
    
    # Data loading process
    def load_data(self, file_path: str):
        """
        Step 1: Detect file type (.xlsx, .csv, .tsv)
        Step 2: Read file using pandas
        Step 3: Extract sample names (first column)
        Step 4: Extract gene names (all columns except first)
        Step 5: Extract numerical data (convert to numpy array)
        Step 6: Handle missing values (NaN)
        Step 7: Set status flags
        """
        pass
    
    # Correlation calculation process
    def calculate_correlations(self, method: str = 'pearson'):
        """
        Step 1: Check if data is loaded
        Step 2: Convert data to DataFrame
        Step 3: Call pandas.corr() method (according to method parameter)
        Step 4: Handle NaN values (replace with 0)
        Step 5: Calculate statistics (mean, standard deviation, etc.)
        Step 6: Set status flags
        """
        pass
    
    # Sorting process
    def sort_correlation_matrix(self):
        """
        Step 1: Calculate average absolute correlation for each gene
            Q_i = mean(|r_ij|) for j ≠ i
        Step 2: Sort by Q_i descending, get sorted indices
        Step 3: Use sorted indices to rearrange:
            - Correlation matrix
            - Gene name list
        Step 4: Return sorted matrix and gene names
        """
        pass
```

---

## Data Flow and Interaction Processes

### Complete Request-Response Flow

#### Process 1: Gene Search Complete Flow

```
┌──────────┐
│  User    │
│(Browser) │
└────┬─────┘
     │ 1. Enter gene symbol "GAPDH"
     │ 2. Click "Search" button
     ▼
┌─────────────────────────────────────┐
│ Frontend: gene-search/page.tsx      │
│                                      │
│ handleSearch() function:            │
│ 1. setIsLoading(true)               │
│ 2. Build API URL                    │
│ 3. fetch(`${API_URL}/api/gene/      │
│          symbol/search?gene_symbol=  │
│          GAPDH`)                     │
└────┬────────────────────────────────┘
     │ 3. HTTP GET Request
     │    URL: /api/gene/symbol/search?gene_symbol=GAPDH
     ▼
┌─────────────────────────────────────┐
│ FastAPI Route Handler               │
│ @app.get("/api/gene/symbol/search") │
│                                      │
│ 1. Receive query parameter gene_symbol│
│ 2. Pydantic validation (automatic)  │
│ 3. Call gene_api.search_gene_data() │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ GeneSearchAPI.search_gene_data()    │
│                                      │
│ 1. Build MongoDB query:             │
│    query = {"gene_symbol": {        │
│        "$regex": "^GAPDH$",         │
│        "$options": "i"              │
│    }}                                │
│ 2. collection.find(query)           │
│    (using gene_symbol index, O(log n))│
│ 3. Iterate through query results    │
│ 4. Format data                      │
│ 5. Return list                      │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ MongoDB Database                    │
│                                      │
│ 1. Use index for fast lookup        │
│ 2. Return matching document list    │
│    [                                │
│      {organ: "Heart", gene_symbol:  │
│       "GAPDH", ...},                │
│      {organ: "Liver", gene_symbol:  │
│       "GAPDH", ...},                │
│      ...                            │
│    ]                                │
└────┬────────────────────────────────┘
     │ 4. Return results
     ▼
┌─────────────────────────────────────┐
│ FastAPI Response                    │
│                                      │
│ return {                            │
│   "gene_symbol": "GAPDH",           │
│   "data": [...]                     │
│ }                                   │
│ (FastAPI automatic JSON serialization)│
└────┬────────────────────────────────┘
     │ 5. HTTP 200 Response
     │    Content-Type: application/json
     ▼
┌─────────────────────────────────────┐
│ Frontend: Process Response          │
│                                      │
│ 1. response.json() parse JSON       │
│ 2. setSearchResults(data.data)      │
│ 3. setIsLoading(false)              │
│ 4. React re-render → Display results table│
└────┬────────────────────────────────┘
     │
     ▼
┌──────────┐
│  User    │
│  sees    │
│ Results  │
│  Table   │
└──────────┘
```

#### Process 2: Theme Analysis Complete Flow

```
┌──────────┐
│  User    │
└────┬─────┘
     │ 1. Upload gene list file (.txt)
     │ 2. Select themes
     │ 3. Click "Analyze"
     ▼
┌─────────────────────────────────────┐
│ Frontend: customize-theme/page.tsx  │
│                                      │
│ handleAnalyze() function:           │
│ 1. Read file content                │
│ 2. Build FormData                   │
│ 3. fetch(`${API_URL}/api/ontology/  │
│          custom-analyze`, {          │
│    method: 'POST',                   │
│    body: formData                    │
│  })                                  │
└────┬────────────────────────────────┘
     │ 2. HTTP POST Request
     │    Content-Type: multipart/form-data
     ▼
┌─────────────────────────────────────┐
│ FastAPI Route                       │
│ @app.post("/api/ontology/custom-    │
│          analyze")                   │
│                                      │
│ 1. Receive file (UploadFile)        │
│ 2. Receive selected_themes (Form)   │
│ 3. Receive custom_themes (Form, JSON)│
│ 4. Call ontology_api methods        │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ GeneOntologyAPI                     │
│                                      │
│ Step 1: load_genes_from_file()      │
│    - Read file content              │
│    - Split by lines                 │
│    - Remove whitespace              │
│    - Return gene list               │
│                                      │
│ Step 2: Temporarily add custom themes│
│    original_themes = self.themes    │
│    for custom_theme in custom_themes:│
│        self.themes[theme_name] =    │
│            keywords                  │
│                                      │
│ Step 3: enrich(genes)               │
│    - Call GProfiler API             │
│    - Filter P-values                │
│    - Calculate Score                │
│                                      │
│ Step 4: assign_theme()              │
│    - Assign theme to each GO term   │
│                                      │
│ Step 5: aggregate()                 │
│    - Aggregate by theme             │
│                                      │
│ Step 6: Restore original themes     │
│    self.themes = original_themes    │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ GProfiler API (External Service)    │
│                                      │
│ 1. Receive gene list                │
│ 2. Execute hypergeometric test      │
│ 3. Return enrichment results (DataFrame)│
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ Backend Processing Results          │
│                                      │
│ 1. Filter significant results       │
│ 2. Assign themes                    │
│ 3. Aggregate statistics             │
│ 4. Generate charts (optional)       │
│ 5. Return JSON response             │
└────┬────────────────────────────────┘
     │ 3. HTTP 200 Response
     ▼
┌─────────────────────────────────────┐
│ Frontend: Display Results           │
│                                      │
│ 1. Parse response                   │
│ 2. Display results table            │
│ 3. Display summary chart            │
│ 4. Display theme detailed chart     │
└─────────────────────────────────────┘
```

#### Process 3: IVCCA Analysis Complete Flow

```
┌──────────┐
│  User    │
└────┬─────┘
     │ 1. Upload data file (.xlsx/.csv/.tsv)
     │ 2. Click "Load Data"
     ▼
┌─────────────────────────────────────┐
│ Frontend: ivcca/page.tsx            │
│                                      │
│ handleLoadData() function:          │
│ 1. Read file                        │
│ 2. Build FormData                   │
│ 3. POST /api/ivcca/load-data        │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ Backend: /api/ivcca/load-data       │
│                                      │
│ 1. Create IVCCAAnalyzer instance   │
│    analyzer = IVCCAAnalyzer()       │
│ 2. Call analyzer.load_data()        │
│ 3. Generate unique ID (analyzer_id) │
│ 4. Store in memory (dictionary)     │
│    analyzers[analyzer_id] = analyzer│
│ 5. Return analyzer_id               │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ User clicks "Calculate Correlation" │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ Frontend: POST /api/ivcca/          │
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
│ Backend Processing                  │
│                                      │
│ 1. Get analyzer from memory         │
│    analyzer = analyzers[analyzer_id]│
│ 2. analyzer.calculate_correlations()│
│    - Calculate correlation matrix   │
│    - Calculate statistics           │
│ 3. Return statistics                │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ User selects "Generate Heatmap"     │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ Frontend: POST /api/ivcca/heatmap   │
│                                      │
│ Body: {                             │
│   analyzer_id: "...",                │
│   sorted: false                      │
│ }                                   │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ Backend: analyzer.create_correlation_│
│       heatmap()                      │
│                                      │
│ 1. Get correlation matrix           │
│ 2. Use seaborn to draw heatmap      │
│ 3. Convert to base64                │
│ 4. Or use Plotly to generate interactive chart│
│ 5. Return JSON: {                   │
│      type: "plotly",                 │
│      content: {...}                  │
│    }                                │
└────┬────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│ Frontend: Render Chart              │
│                                      │
│ if (type === "plotly") {            │
│    <Plot data={content} />          │
│ } else {                            │
│    <img src={`data:image/...`} />   │
│ }                                   │
└─────────────────────────────────────┘
```

### State Management (Backend)

**In-Memory State Management**:

```python
# IVCCA analyzer instance storage (in memory)
analyzers: Dict[str, IVCCAAnalyzer] = {}

# Use analyzer_id as key
analyzer_id = str(uuid.uuid4())
analyzers[analyzer_id] = IVCCAAnalyzer()
```

**MongoDB State**:

- Gene expression data persistent storage
- Index-accelerated queries
- Support concurrent access

**Stateless API Design**:

- Each request processed independently
- Associate analysis sessions through analyzer_id
- Support multiple users analyzing simultaneously

---

## Core Module Architecture

### Module 1: Gene Search System Architecture

#### Data Flow Architecture

```
Excel Files (data/*.xlsx)
    │
    ▼
[Data Loading Phase]
    ├─ pandas.read_excel()
    ├─ Data cleaning (remove nulls, type conversion)
    └─ Bulk write to MongoDB
    │
    ▼
MongoDB (gene_data collection)
    │
    ▼
[Query Phase]
    ├─ User inputs gene symbol
    ├─ MongoDB query (using index)
    └─ Return matching documents
    │
    ▼
[Visualization Phase]
    ├─ Extract data (organ, fold_change, lsmean)
    ├─ matplotlib generate chart
    └─ Return base64 encoded
```

#### Component Interaction

```
User Interface (React)
    │
    ├─→ SearchInput → handleSearch()
    │                    │
    │                    ▼
    │              API Call (fetch)
    │                    │
    ├─→ ResultsTable ←─ API Response
    │                    │
    └─→ PlotDisplay ←─ Chart API Call
```

### Module 2: Theme Analysis System Architecture

#### Data Flow Architecture

```
User uploads gene list (.txt)
    │
    ▼
[Parsing Phase]
    ├─ Read line by line
    ├─ Remove whitespace
    └─ Generate gene list
    │
    ▼
[Enrichment Analysis Phase]
    ├─ Call GProfiler API
    ├─ Hypergeometric test
    └─ Return significant GO terms
    │
    ▼
[Theme Assignment Phase]
    ├─ Keyword matching
    ├─ Theme mapping
    └─ Tag each GO term with theme
    │
    ▼
[Aggregation Phase]
    ├─ Group by theme
    ├─ Calculate cumulative score
    └─ Sort
    │
    ▼
[Visualization Phase]
    ├─ Generate summary chart
    ├─ Generate theme detailed chart
    └─ Return base64 encoded
```

#### Theme Matching Algorithm Flow

```
GO Term Name ("inflammatory response")
    │
    ▼
Convert to lowercase ("inflammatory response")
    │
    ▼
Iterate through theme keywords:
    ├─ "Inflammation & immune signaling": 
    │     ["inflammatory", "immune", ...]
    │     │
    │     ▼
    │   Check "inflammatory" in "inflammatory response" → True
    │     │
    │     ▼
    │   Return theme "Inflammation & immune signaling"
    │
    └─ Other themes (skip)
```

### Module 3: IVCCA Analysis System Architecture

#### Analysis Flow Architecture

```
Data Loading
    │
    ├─→ File Reading → Data Matrix (samples × genes)
    │
    ▼
Correlation Calculation
    │
    ├─→ Pearson/Spearman/Kendall → Correlation Matrix (genes × genes)
    │
    ▼
Sorting/Clustering
    │
    ├─→ Sorting → Sort by correlation strength
    ├─→ Clustering → Elbow/Silhouette → K-means/Hierarchical clustering
    │
    ▼
Dimensionality Reduction Analysis
    │
    ├─→ PCA → Principal component scores
    └─→ t-SNE → Low-dimensional embedding
    │
    ▼
Pathway Analysis
    │
    ├─→ Single Pathway → PCI_A, PCI_B calculation
    ├─→ Multi-Pathway → CECI, Z-score calculation
    └─→ Pathway Comparison → Cosine similarity
    │
    ▼
Network Analysis
    │
    └─→ Correlation threshold filtering → Network graph (2D/3D)
```

#### IVCCA Class Method Call Chain

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

## API Interface Architecture

### RESTful API Design Principles

1. **Resource-Oriented**: URLs represent resources
   - `/api/gene/symbol/search` - Gene resource
   - `/api/ontology/analyze` - Ontology analysis resource
   - `/api/ivcca/load-data` - IVCCA data resource

2. **HTTP Method Semantics**:
   - GET: Retrieve resources
   - POST: Create/Execute operations

3. **Status Code Usage**:
   - 200: Success
   - 400: Client error
   - 401: Unauthenticated
   - 404: Resource not found
   - 500: Server error

### API Endpoint Detailed Mapping

#### Gene Search API Endpoints

| Endpoint | Method | Input | Output | Related Components |
|----------|--------|-------|--------|-------------------|
| `/api/gene/symbols` | GET | - | `{gene_symbols: []}` | GeneSearch → MongoDB |
| `/api/gene/symbol/search` | GET | `gene_symbol` | `{gene_symbol, data: []}` | GeneSearch → MongoDB |
| `/api/gene/symbol/showFoldChange` | GET | `gene_symbol` | `{image_base64}` | GeneSearch → matplotlib |
| `/api/gene/symbol/showLSMeanControl` | GET | `gene_symbol` | `{image_base64}` | GeneSearch → matplotlib |
| `/api/gene/symbol/showLSMeanTenMgKg` | GET | `gene_symbol` | `{image_base64}` | GeneSearch → matplotlib |

**Data Flow**:
```
Frontend → FastAPI Route → GeneSearchAPI → MongoDB → Data Processing → Visualization → base64 → Frontend
```

#### Theme Analysis API Endpoints

| Endpoint | Method | Input | Output | Related Components |
|----------|--------|-------|--------|-------------------|
| `/api/ontology/analyze` | POST | `file`, `selected_themes` | `{results: []}` | ThemeAnalysis → GProfiler |
| `/api/ontology/custom-analyze` | POST | `file`, `selected_themes`, `custom_themes` | `{results: []}` | ThemeAnalysis → GProfiler |
| `/api/ontology/theme-chart` | POST | `file`, `theme` | `{image_base64}` | ThemeAnalysis → matplotlib |
| `/api/ontology/custom-summary-chart` | POST | `file`, `selected_themes`, `custom_themes` | `{image_base64}` | ThemeAnalysis → matplotlib |

**Data Flow**:
```
Frontend → FastAPI → GeneOntologyAPI → GProfiler API → Enrichment Results → Theme Assignment → Aggregation → Visualization → Frontend
```

#### IVCCA Analysis API Endpoints

| Endpoint | Method | Input | Output | Related Components |
|----------|--------|-------|--------|-------------------|
| `/api/ivcca/load-data` | POST | `file` | `{analyzer_id, preview}` | IVCCA → IVCCAAnalyzer |
| `/api/ivcca/calculate-correlation` | POST | `analyzer_id`, `method` | `{statistics}` | IVCCA → IVCCAAnalyzer |
| `/api/ivcca/sort-matrix` | POST | `analyzer_id` | `{sorted_matrix, sorted_genes}` | IVCCA → IVCCAAnalyzer |
| `/api/ivcca/heatmap` | POST | `analyzer_id`, `sorted` | `{type, content}` | IVCCA → IVCCAAnalyzer → Plotly |
| `/api/ivcca/pca` | POST | `analyzer_id`, `n_components` | `{scores, explained_variance, plots}` | IVCCA → IVCCAAnalyzer → sklearn |
| `/api/ivcca/tsne` | POST | `analyzer_id`, `n_components`, `perplexity` | `{scores, scatter_plot}` | IVCCA → IVCCAAnalyzer → sklearn |
| `/api/ivcca/multi-pathway` | POST | `analyzer_id`, `pathway_files` | `{pathways: [{ceci, z_score, ...}]}` | IVCCA → IVCCAAnalyzer |

**Data Flow**:
```
Frontend → FastAPI → In-Memory IVCCAAnalyzer Instance → Algorithm Calculation → Result Return → Frontend
```

### API Response Format

**Success Response**:
```json
{
  "status": "success",
  "data": {...},
  "message": "Operation completed successfully"
}
```

**Error Response**:
```json
{
  "detail": "Error message here"
}
```

**Paginated Response** (if needed):
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

## Database Architecture

### MongoDB Data Model

#### Collection: `gene_data`

**Document Structure**:

```javascript
{
  "_id": ObjectId("..."),                    // Auto-generated by MongoDB
  "organ": "Heart",                          // Organ name (indexed field)
  "gene_symbol": "GAPDH",                   // Gene symbol (indexed field)
  "gene_name": "Glyceraldehyde-3-phosphate dehydrogenase",
  "p_value_10_mgkg_vs_control": "0.001",
  "fdr_step_up_10_mgkg_vs_control": "0.05",
  "ratio_10_mgkg_vs_control": "1.5",
  "fold_change_10_mgkg_vs_control": "0.5",
  "lsmean_10mgkg_10_mgkg_vs_control": "10.5",
  "lsmean_control_10_mgkg_vs_control": "8.5"
}
```

**Index Design**:

```python
# 1. Single-field index (accelerate single-condition queries)
collection.create_index([("gene_symbol", 1)])  # Ascending index
# Query performance: O(log n)

# 2. Single-field index (filter by organ)
collection.create_index([("organ", 1)])
# Query performance: O(log n)

# 3. Composite unique index (prevent duplicate data)
collection.create_index(
    [("organ", 1), ("gene_symbol", 1)], 
    unique=True
)
# Ensure only one record per organ-gene combination
```

#### Data Loading Process (Detailed Steps)

**Step 1: File Scanning**

```python
excel_files = glob.glob(os.path.join("data", "*.xlsx"))
# Result: ['data/BoneMarrow.xlsx', 'data/Cortex.xlsx', ...]
```

**Step 2: Process Each File**

```python
for file_path in excel_files:
    # 2.1 Extract organ name
    organ_name = os.path.splitext(os.path.basename(file_path))[0]
    # Result: 'BoneMarrow'
    
    # 2.2 Read Excel file
    df = pd.read_excel(file_path)
    # DataFrame structure:
    # | Gene_symbol | Gene_name | P_value_... | ... |
    # |-------------|-----------|-------------|-----|
    # | GAPDH       | ...       | 0.001       | ... |
    # | ACTB        | ...       | 0.002       | ... |
    
    # 2.3 Iterate through each row
    for _, row in df.iterrows():
        gene_symbol = str(row.get('Gene_symbol', '')).strip()
        if not gene_symbol:  # Skip empty gene symbols
            continue
        
        # 2.4 Build MongoDB document
        record = {
            'organ': organ_name,
            'gene_symbol': gene_symbol,
            'gene_name': str(row.get('Gene_name', '')),
            # ... other fields
        }
        records.append(record)
```

**Step 3: Bulk Write**

```python
# 3.1 Build bulk operations list
operations = []
for record in records:
    operations.append({
        'replaceOne': {
            'filter': {
                'organ': record['organ'],
                'gene_symbol': record['gene_symbol']
            },
            'replacement': record,
            'upsert': True  # Insert if not exists, update if exists
        }
    })

# 3.2 Execute bulk operations
result = collection.bulk_write(operations)
# Results:
# - result.upserted_count: Number of newly inserted documents
# - result.modified_count: Number of updated documents
```

**Step 4: Create Indexes**

```python
# 4.1 Create single-field indexes
collection.create_index([("gene_symbol", 1)])
collection.create_index([("organ", 1)])

# 4.2 Create composite unique index
collection.create_index(
    [("organ", 1), ("gene_symbol", 1)], 
    unique=True
)
```

#### Query Optimization

**Query 1: Exact Gene Symbol Search**

```python
query = {"gene_symbol": {"$regex": f"^{gene_symbol}$", "$options": "i"}}
# Using index: gene_symbol index
# Performance: O(log n)
```

**Query 2: Get All Unique Gene Symbols**

```python
pipeline = [
    {"$group": {"_id": "$gene_symbol"}},  # Group and deduplicate
    {"$sort": {"_id": 1}}                  # Sort
]
genes = [doc["_id"] for doc in collection.aggregate(pipeline)]
# Using index: gene_symbol index
# Performance: O(n log n)
```

---

## Deployment Architecture

### Docker Containerization Architecture

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
│                      │   (Optional) │  │
│                      └──────────────┘  │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │      gene-search-network         │  │
│  │      (Bridge Network)            │  │
│  └──────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### Deployment Process

**1. Build Phase**

```bash
# Frontend build
cd genegen
npm install
npm run build  # Generate .next directory

# Backend preparation
cd backend
pip install -r requirements.txt
```

**2. Docker Image Build**

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

**3. Container Startup**

```bash
docker-compose up -d
```

---

## Technology Stack Details

### Frontend Technology Stack

| Technology | Version | Purpose | Relationships |
|------------|---------|---------|---------------|
| Next.js | 15.3.5 | React framework, routing, SSR | Build frontend application |
| React | 19.0.0 | UI component library | Foundation of Next.js |
| TypeScript | 5.x | Type safety | Compile to JavaScript |
| Tailwind CSS | 4.x | Styling framework | Imported via globals.css |
| Plotly.js | 2.35.3 | Interactive charts | Used via react-plotly.js |

**Dependencies**:
```
Next.js → React → React DOM
Next.js → TypeScript Compiler
Next.js → Tailwind CSS
React → Plotly.js (dynamic import)
```

### Backend Technology Stack

| Technology | Version | Purpose | Relationships |
|------------|---------|---------|---------------|
| FastAPI | 0.68.0 | Web framework | Build API service |
| Python | 3.9+ | Programming language | Foundation of FastAPI |
| pandas | 1.3.0+ | Data processing | Read Excel/CSV |
| NumPy | 1.21.0+ | Numerical computation | Matrix operations |
| SciPy | - | Scientific computing | Statistical tests |
| scikit-learn | - | Machine learning | PCA, t-SNE, K-means |
| matplotlib | 3.4.0+ | Chart generation | Static images |
| seaborn | 0.11.0+ | Advanced visualization | Heatmaps |
| GProfiler | 1.0.0+ | Enrichment analysis | External API client |
| pymongo | - | MongoDB driver | Database connection |

**Dependencies**:
```
FastAPI → Pydantic (data validation)
FastAPI → Uvicorn (ASGI server)
pandas → NumPy (underlying arrays)
scikit-learn → NumPy, SciPy
matplotlib → NumPy
seaborn → matplotlib, pandas
```

---

## Inter-Module Relationships

### Data Sharing

**1. Gene List Sharing**:

```
MongoDB (gene_data)
    │
    ├─→ Gene Search Module: Query gene expression data
    │
    └─→ Other Modules: Can serve as reference data source
```

**2. Analysis Result Sharing**:

```
IVCCA Analysis Results (correlation matrix)
    │
    └─→ Can be used for pathway analysis
        └─→ Pathway analysis results can be used for theme analysis
```

### Functional Dependencies

```
Gene Search ←─ Independent module (only depends on MongoDB)
    │
Theme Analysis ←─ Depends on GProfiler API
    │
IVCCA Analysis ←─ Independent module (algorithm self-contained)
```

### API Endpoint Relationships

**Endpoint Relationships Within Same Module**:

```
/api/ivcca/load-data
    ↓ (returns analyzer_id)
/api/ivcca/calculate-correlation (requires analyzer_id)
    ↓ (requires correlation calculation first)
/api/ivcca/heatmap (requires analyzer_id)
/api/ivcca/pca (requires analyzer_id)
/api/ivcca/tsne (requires analyzer_id)
```

---

## Performance Optimization Strategies

### Frontend Optimization

1. **Code Splitting**:
   - Plotly.js dynamic import (`dynamic import`)
   - Page-level code splitting (Next.js automatic)

2. **Caching Strategy**:
   - Gene symbol list cache (localStorage)
   - API response cache (optional)

3. **Lazy Loading**:
   - Chart component lazy loading
   - Image lazy loading

### Backend Optimization

1. **Database Optimization**:
   - Index-accelerated queries
   - Bulk operations to reduce IO

2. **Computation Optimization**:
   - NumPy vectorized operations
   - Correlation matrix cache (in memory)

3. **Concurrent Processing**:
   - FastAPI asynchronous processing
   - Multiple analyzer instances independent

---

## Security Architecture

### Authentication Mechanism

**Token-based Authentication**:

```python
# Store valid tokens in environment variables
VALID_TOKENS = os.getenv('VALID_TOKENS', '').split(',')

# Verification function
def verify_token(token: str) -> bool:
    return token in VALID_TOKENS

# Protect endpoint
@app.post("/api/gene/add")
async def add_gene(..., token: str = Query(...)):
    if not verify_token(token):
        raise HTTPException(status_code=401)
```

### CORS Configuration

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Development environment, should restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### Data Validation

**Pydantic Model Validation**:

```python
class GeneData(BaseModel):
    gene_symbol: str
    gene_name: str
    # ... Automatic type validation and conversion
```

---

## Error Handling Architecture

### Frontend Error Handling

```typescript
try {
  const response = await fetch(...);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
} catch (error) {
  setError(error.message);  // Display error message
  console.error(error);     // Logging
}
```

### Backend Error Handling

```python
try:
    # Business logic
    result = process_data()
    return {"status": "success", "data": result}
except ValueError as e:
    raise HTTPException(status_code=400, detail=str(e))
except Exception as e:
    raise HTTPException(status_code=500, detail=str(e))
```

---

## Scalability Design

### Horizontal Scaling

- **Frontend**: Can deploy multiple instances, use load balancing
- **Backend**: Stateless design, supports multi-instance deployment
- **Database**: MongoDB supports sharding and replica sets

### Feature Extension

- **New Modules**: Can add new API classes and new endpoints
- **New Algorithms**: Can add new methods in `ivcca_core.py`
- **New Visualizations**: Can add new chart generation functions

---

**Document Version**: 1.0  
**Last Updated**: 2024

