from fastapi import FastAPI, HTTPException, Query, Depends, status, UploadFile, File, Form
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend

# 配置matplotlib以避免字体问题
plt.rcParams['font.family'] = ['DejaVu Sans', 'Arial', 'sans-serif']
plt.rcParams['font.size'] = 10
plt.rcParams['figure.dpi'] = 100
import base64
import io
import os
import glob
from typing import Dict, List, Optional
import numpy as np
import secrets
import os
from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure
import seaborn as sns
from gprofiler import GProfiler

# Load environment variables
env_path = os.path.join(os.path.dirname(__file__), '.env')
print(f"About to load .env from: {env_path}")
if os.path.exists(env_path):
    with open(env_path, 'r') as f:
        print(".env contents:")
        print(f.read())
else:
    print(".env file does not exist!")
load_dotenv(env_path, override=True)
print("All environment variables after load_dotenv:")
for k, v in os.environ.items():
    if 'TOKEN' in k or 'MONGO' in k:
        print(f"{k}={v}")

# MongoDB connection
MONGODB_URI = os.getenv('MONGODB_URI')
MONGODB_AVAILABLE = False

if MONGODB_URI:
    try:
        client = MongoClient(MONGODB_URI)
        # Test the connection
        client.admin.command('ping')
        print("Successfully connected to MongoDB")
        db = client.gene_search_db
        collection = db.gene_data
        MONGODB_AVAILABLE = True
    except ConnectionFailure as e:
        print(f"Failed to connect to MongoDB: {e}")
        print("Server will start without MongoDB functionality")
        MONGODB_AVAILABLE = False
    except Exception as e:
        print(f"Unexpected error connecting to MongoDB: {e}")
        print("Server will start without MongoDB functionality")
        MONGODB_AVAILABLE = False
else:
    print("MONGODB_URI not provided, server will start without MongoDB functionality")
    MONGODB_AVAILABLE = False

# Pydantic models
class GeneData(BaseModel):
    gene_symbol: str
    gene_name: str
    p_value_10_mgkg_vs_control: str
    fdr_step_up_10_mgkg_vs_control: str
    ratio_10_mgkg_vs_control: str
    fold_change_10_mgkg_vs_control: str
    lsmean_10mgkg_10_mgkg_vs_control: str
    lsmean_control_10_mgkg_vs_control: str
    organ: str

class TokenLoginRequest(BaseModel):
    token: str

class LoginResponse(BaseModel):
    success: bool
    message: str

app = FastAPI(title="Gene Expression Search API", version="1.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security
security = HTTPBasic()

# Get valid tokens from environment variables
VALID_TOKENS = os.getenv('VALID_TOKENS', '').split(',')
VALID_TOKENS = [token.strip() for token in VALID_TOKENS if token.strip()]

# Debug: Print loaded tokens and environment info
print(f"Environment file path: {os.path.join(os.path.dirname(__file__), '.env')}")
print(f"VALID_TOKENS env var: {os.getenv('VALID_TOKENS')}")
print(f"Loaded valid tokens: {VALID_TOKENS}")

def verify_token(token: str) -> bool:
    """Verify if token is valid"""
    return token in VALID_TOKENS

class GeneSearchAPI:
    def __init__(self):
        self.load_data_to_mongodb()
        self.all_genes = self.load_all_genes()
    
    def load_data_to_mongodb(self):
        """Load data from Excel files into MongoDB with duplicate prevention"""
        data_dir = "data"
        if not os.path.exists(data_dir):
            print(f"Data directory {data_dir} not found")
            return
        
        # Check if data already exists
        existing_count = collection.count_documents({})
        if existing_count > 0:
            print(f"Found {existing_count} existing records in MongoDB. Skipping data load.")
            return
        
        excel_files = glob.glob(os.path.join(data_dir, "*.xlsx"))
        total_records = 0
        skipped_duplicates = 0
        
        for file_path in excel_files:
            organ_name = os.path.splitext(os.path.basename(file_path))[0]
            try:
                df = pd.read_excel(file_path)
                print(f"Processing {len(df)} records from {organ_name}")
                
                # Convert DataFrame to list of dictionaries
                records = []
                for _, row in df.iterrows():
                    gene_symbol = str(row.get('Gene_symbol', '')).strip()
                    if not gene_symbol:  # Skip empty gene symbols
                        continue
                        
                    record = {
                        'organ': organ_name,
                        'gene_symbol': gene_symbol,
                        'gene_name': str(row.get('Gene_name', '')),
                        'p_value_10_mgkg_vs_control': str(row.get('P_value_10_mgkg_vs_control', '')),
                        'fdr_step_up_10_mgkg_vs_control': str(row.get('FDR_step_up_10_mgkg_vs_control', '')),
                        'ratio_10_mgkg_vs_control': str(row.get('Ratio_10_mgkg_vs_control', '')),
                        'fold_change_10_mgkg_vs_control': str(row.get('Fold_change_10_mgkg_vs_control', '')),
                        'lsmean_10mgkg_10_mgkg_vs_control': str(row.get('LSMean10mgkg_10_mgkg_vs_control', '')),
                        'lsmean_control_10_mgkg_vs_control': str(row.get('LSMeancontrol_10_mgkg_vs_control', ''))
                    }
                    records.append(record)
                
                # Insert records into MongoDB with duplicate prevention
                if records:
                    # Use bulk operations with upsert to prevent duplicates
                    operations = []
                    for record in records:
                        operations.append({
                            'replaceOne': {
                                'filter': {
                                    'organ': record['organ'],
                                    'gene_symbol': record['gene_symbol']
                                },
                                'replacement': record,
                                'upsert': True
                            }
                        })
                    
                    if operations:
                        result = collection.bulk_write(operations)
                        total_records += result.upserted_count + result.modified_count
                        print(f"Successfully processed {len(records)} records for {organ_name}")
                        print(f"  - Inserted: {result.upserted_count}")
                        print(f"  - Updated: {result.modified_count}")
                
            except Exception as e:
                print(f"Error loading {file_path}: {e}")
        
        print(f"Total records processed in MongoDB: {total_records}")
        
        # Create indexes for better performance
        collection.create_index([("gene_symbol", 1)])
        collection.create_index([("organ", 1)])
        # Create unique compound index to prevent duplicates
        collection.create_index([("organ", 1), ("gene_symbol", 1)], unique=True)
        print("Created indexes on gene_symbol, organ fields, and unique compound index")
    
    def load_all_genes(self) -> List[str]:
        """Load all unique gene symbols from MongoDB"""
        pipeline = [
            {"$group": {"_id": "$gene_symbol"}},
            {"$sort": {"_id": 1}}
        ]
        genes = [doc["_id"] for doc in collection.aggregate(pipeline)]
        return genes
    
    def search_gene_data(self, gene_symbol: str) -> List[Dict]:
        """Search for a gene and return results from MongoDB"""
        query = {"gene_symbol": {"$regex": f"^{gene_symbol}$", "$options": "i"}}
        cursor = collection.find(query)
        results = []
        for doc in cursor:
            results.append({
                'organ': doc.get('organ', ''),
                'gene_symbol': doc.get('gene_symbol', ''),
                'gene_name': doc.get('gene_name', ''),
                'p_value': doc.get('p_value_10_mgkg_vs_control', ''),
                'fdr_step_up': doc.get('fdr_step_up_10_mgkg_vs_control', ''),
                'ratio': doc.get('ratio_10_mgkg_vs_control', ''),
                'fold_change': doc.get('fold_change_10_mgkg_vs_control', ''),
                'lsmean_10mgkg': doc.get('lsmean_10mgkg_10_mgkg_vs_control', ''),
                'lsmean_control': doc.get('lsmean_control_10_mgkg_vs_control', '')
            })
        return results
    
    def create_fold_change_plot(self, gene_symbol: str) -> str:
        """Create fold change plot and return as base64 string"""
        query = {"gene_symbol": {"$regex": f"^{gene_symbol}$", "$options": "i"}}
        cursor = collection.find(query)
        
        organs = []
        fold_changes = []
        colors = []
        
        for doc in cursor:
            try:
                fold_change = float(doc.get('fold_change_10_mgkg_vs_control', 0))
                organ = doc.get('organ', '')
                
                organs.append(organ)
                fold_changes.append(fold_change)
                
                # Color based on fold change sign
                if fold_change >= 0:
                    colors.append('blue')
                else:
                    colors.append('red')
            except (ValueError, TypeError):
                continue
        
        if not organs:
            raise HTTPException(status_code=404, detail="No data found for this gene symbol")
        
        # Create the plot
        fig, ax = plt.subplots(figsize=(10, 6))
        bars = ax.bar(organs, fold_changes, color=colors)
        ax.set_title(f'Fold Change for {gene_symbol}')
        ax.set_xlabel('Organ')
        ax.set_ylabel('Fold Change')
        ax.tick_params(axis='x', rotation=45)
        ax.grid(True, axis='y')
        plt.tight_layout()
        
        # Convert to base64
        buffer = io.BytesIO()
        plt.savefig(buffer, format='jpg', dpi=300, bbox_inches='tight')
        buffer.seek(0)
        image_base64 = base64.b64encode(buffer.getvalue()).decode()
        plt.close()
        
        return image_base64
    
    def create_lsmean_control_plot(self, gene_symbol: str) -> str:
        """Create LSmean(Control) plot and return as base64 string"""
        query = {"gene_symbol": {"$regex": f"^{gene_symbol}$", "$options": "i"}}
        cursor = collection.find(query)
        
        organs = []
        lsmeans = []
        
        for doc in cursor:
            try:
                lsmean = float(doc.get('lsmean_control_10_mgkg_vs_control', 0))
                organ = doc.get('organ', '')
                organs.append(organ)
                lsmeans.append(lsmean)
            except (ValueError, TypeError):
                continue
        
        if not organs:
            raise HTTPException(status_code=404, detail="No data found for this gene symbol")
        
        # Create the plot
        fig, ax = plt.subplots(figsize=(10, 6))
        ax.bar(organs, lsmeans, color='blue')
        ax.set_title(f'LSmean(Control) for {gene_symbol}')
        ax.set_xlabel('Organ')
        ax.set_ylabel('LSmean (Control)')
        ax.tick_params(axis='x', rotation=45)
        ax.grid(True, axis='y')
        plt.tight_layout()
        
        # Convert to base64
        buffer = io.BytesIO()
        plt.savefig(buffer, format='jpg', dpi=300, bbox_inches='tight')
        buffer.seek(0)
        image_base64 = base64.b64encode(buffer.getvalue()).decode()
        plt.close()
        
        return image_base64
    
    def create_lsmean_10mgkg_plot(self, gene_symbol: str) -> str:
        """Create LSmean(10mg/kg) plot and return as base64 string"""
        query = {"gene_symbol": {"$regex": f"^{gene_symbol}$", "$options": "i"}}
        cursor = collection.find(query)
        
        organs = []
        lsmeans = []
        
        for doc in cursor:
            try:
                lsmean = float(doc.get('lsmean_10mgkg_10_mgkg_vs_control', 0))
                organ = doc.get('organ', '')
                organs.append(organ)
                lsmeans.append(lsmean)
            except (ValueError, TypeError):
                continue
        
        if not organs:
            raise HTTPException(status_code=404, detail="No data found for this gene symbol")
        
        # Create the plot
        fig, ax = plt.subplots(figsize=(10, 6))
        ax.bar(organs, lsmeans, color='green')
        ax.set_title(f'LSmean(10mg/kg) for {gene_symbol}')
        ax.set_xlabel('Organ')
        ax.set_ylabel('LSmean (10mg/kg)')
        ax.tick_params(axis='x', rotation=45)
        ax.grid(True, axis='y')
        plt.tight_layout()
        
        # Convert to base64
        buffer = io.BytesIO()
        plt.savefig(buffer, format='jpg', dpi=300, bbox_inches='tight')
        buffer.seek(0)
        image_base64 = base64.b64encode(buffer.getvalue()).decode()
        plt.close()
        
        return image_base64

    def add_gene(self, gene_data: GeneData) -> Dict:
        """Add a new gene to MongoDB with duplicate prevention"""
        try:
            # Check if the organ exists in the database
            organ_exists = collection.find_one({"organ": gene_data.organ})
            if not organ_exists:
                raise HTTPException(status_code=400, detail=f"Organ '{gene_data.organ}' not found in database")
            
            # Check if gene already exists in this organ
            existing_gene = collection.find_one({
                "organ": gene_data.organ,
                "gene_symbol": gene_data.gene_symbol
            })
            
            if existing_gene:
                raise HTTPException(
                    status_code=409, 
                    detail=f"Gene '{gene_data.gene_symbol}' already exists in organ '{gene_data.organ}'"
                )
            
            # Create new record
            new_record = {
                'organ': gene_data.organ,
                'gene_symbol': gene_data.gene_symbol,
                'gene_name': gene_data.gene_name,
                'p_value_10_mgkg_vs_control': gene_data.p_value_10_mgkg_vs_control,
                'fdr_step_up_10_mgkg_vs_control': gene_data.fdr_step_up_10_mgkg_vs_control,
                'ratio_10_mgkg_vs_control': gene_data.ratio_10_mgkg_vs_control,
                'fold_change_10_mgkg_vs_control': gene_data.fold_change_10_mgkg_vs_control,
                'lsmean_10mgkg_10_mgkg_vs_control': gene_data.lsmean_10mgkg_10_mgkg_vs_control,
                'lsmean_control_10_mgkg_vs_control': gene_data.lsmean_control_10_mgkg_vs_control
            }
            
            # Insert the new record into MongoDB
            result = collection.insert_one(new_record)
            
            if result.inserted_id:
                return {
                    "message": f"Gene '{gene_data.gene_symbol}' added successfully to {gene_data.organ}",
                    "gene_symbol": gene_data.gene_symbol,
                    "organ": gene_data.organ,
                    "inserted_id": str(result.inserted_id)
                }
            else:
                raise HTTPException(status_code=500, detail="Failed to insert gene data")
            
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error adding gene: {str(e)}")

# Initialize the API
gene_api = GeneSearchAPI()

@app.post("/api/auth/login")
async def login(login_request: TokenLoginRequest):
    """Token-based login endpoint"""
    if verify_token(login_request.token):
        return LoginResponse(
            success=True,
            message="Login successful"
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )

@app.get("/api/gene/symbols")
async def get_gene_symbols():
    """Get all available gene symbols"""
    gene_api.load_all_genes()
    return {"gene_symbols": gene_api.all_genes}

@app.get("/api/gene/symbol/search")
async def search_gene_symbol(gene_symbol: str = Query(..., description="Gene symbol to search for")):
    """Search for a gene symbol and return all matching data"""
    if not gene_symbol:
        raise HTTPException(status_code=400, detail="Gene symbol is required")
    
    results = gene_api.search_gene_data(gene_symbol)
    if not results:
        return {"message": "No results found", "data": []}
    
    return {"gene_symbol": gene_symbol, "data": results}

@app.get("/api/gene/symbol/showFoldChange")
async def show_fold_change(gene_symbol: str = Query(..., description="Gene symbol to plot fold change for")):
    """Get fold change plot as base64 encoded image"""
    if not gene_symbol:
        raise HTTPException(status_code=400, detail="Gene symbol is required")
    
    try:
        image_base64 = gene_api.create_fold_change_plot(gene_symbol)
        return {"gene_symbol": gene_symbol, "image_base64": image_base64}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating plot: {str(e)}")

@app.get("/api/gene/symbol/showLSMeanControl")
async def show_lsmean_control(gene_symbol: str = Query(..., description="Gene symbol to plot LSmean(Control) for")):
    """Get LSmean(Control) plot as base64 encoded image"""
    if not gene_symbol:
        raise HTTPException(status_code=400, detail="Gene symbol is required")
    
    try:
        image_base64 = gene_api.create_lsmean_control_plot(gene_symbol)
        return {"gene_symbol": gene_symbol, "image_base64": image_base64}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating plot: {str(e)}")

@app.get("/api/gene/symbol/showLSMeanTenMgKg")
async def show_lsmean_ten_mgkg(gene_symbol: str = Query(..., description="Gene symbol to plot LSmean(10mg/kg) for")):
    """Get LSmean(10mg/kg) plot as base64 encoded image"""
    if not gene_symbol:
        raise HTTPException(status_code=400, detail="Gene symbol is required")
    
    try:
        image_base64 = gene_api.create_lsmean_10mgkg_plot(gene_symbol)
        return {"gene_symbol": gene_symbol, "image_base64": image_base64}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating plot: {str(e)}")

@app.post("/api/gene/add")
async def add_gene(gene_data: GeneData, token: str = Query(..., description="Authentication token")):
    """Add a new gene to the specified organ's Excel file"""
    if not verify_token(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required"
        )
    
    try:
        result = gene_api.add_gene(gene_data)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error adding gene: {str(e)}")

# Gene Ontology Analysis Class
class GeneOntologyAPI:
    def __init__(self):
        try:
            print("Initializing GeneOntologyAPI...")
            self.gp = GProfiler(return_dataframe=True)
            print("GProfiler initialized successfully")
        except Exception as e:
            print(f"Error initializing GProfiler: {e}")
            raise e
        self.themes = {
            "Stress & cytokine response": [
                "stress", "interferon", "cytokine", "inflammatory", "defense", "response to stress",
                "cellular response to stress", "response to cytokine", "cytokine production"
            ],
            "Inflammation & immune signaling": [
                "inflammation", "inflammatory", "tnf", "il-1", "il-6", "nf-kb", "toll-like",
                "interleukin", "chemokine", "ccl", "cxcl", "immune response",
                "inflammasome", "pattern recognition", "pathogen response", "immune system",
                "inflammatory response", "immune signaling", "toll-like receptor"
            ],
            "Oxidative stress & redox regulation": [
                "oxidative", "redox", "reactive oxygen", "ros", "nitrosative", "nrf2",
                "antioxidant", "glutathione", "superoxide", "peroxidase", "peroxiredoxin",
                "sod", "catalase", "thioredoxin", "oxidoreductase"
            ],
            "Extracellular matrix & adhesion": [
                "extracellular", "matrix", "adhesion", "integrin", "collagen",
                "remodeling", "fibronectin", "laminin", "basement membrane",
                "mmp", "matrix metalloproteinase", "tenascin", "focal adhesion",
                "ecm", "tissue remodeling", "stromal", "scaffold", "matrisome",
                "cell junction", "cell adhesion", "cell-matrix", "desmosome"
            ],
            "Metabolic re-wiring": [
                "metabolic", "oxidoreductase", "catabolic", "fatty",
                "one-carbon", "biosynthetic"
            ],
            "Hematopoietic & immune commitment": [
                "hematopoiet", "myeloid", "lymphoid", "leukocyte", "granulocyte",
                "erythro", "megakary", "erythropoiet", "myelopoiet", "thrombopoiet",
                "lymphocyte", "monocyte", "neutrophil", "eosinophil", "basophil",
                "platelet", "erythrocyte", "anemia", "cytopenia", "pancytopenia",
                "thrombocytopenia", "leukopenia", "neutropenia", "immune cell",
                "blood cell", "hematologic", "hematopoiesis", "stem cell", "hsc"
            ],
            "Cell-cycle & Apoptosis": [
                "cell cycle", "mitotic", "chromosome", "checkpoint",
                "dna replication", "nuclear division", "apoptosis",
                "programmed cell death", "caspase"
            ],
            "Neuronal Excitability & Synapse": [
                "axon", "dendrite", "synapse", "neurotransmitter", "vesicle",
                "action potential", "ion channel", "potassium", "sodium", "calcium",
                "glutamate", "gaba", "synaptic", "neurogenesis", "axonogenesis"
            ],
            "Neurotrophic Signaling & Growth Factors": [
                "neurotrophin", "ngf", "bdnf", "ntf", "trk", "trka", "trkb", "gdnf",
                "growth factor", "igf", "egf", "fgf", "receptor tyrosine kinase"
            ],
            "Immune-Neuronal Crosstalk": [
                "microglia", "macrophage", "satellite glia", "neuroimmune", "neuroinflammation",
                "cd11b", "cd68", "csf1", "tslp", "complement", "ccr", "cxcr"
            ],
            "Pain & Nociception": [
                "pain", "nociception", "nociceptor", "hyperalgesia", "allodynia",
                "trpv1", "trpa1", "scn9a", "piezo", "itch", "sensory perception", "neuropeptide"
            ],
            "Oxidative Phosphorylation & Mitochondria": [
                "mitochondrial", "oxidative phosphorylation", "electron transport chain",
                "atp synthase", "complex i", "respiratory chain", "mitophagy"
            ],
            "Autophagy & Proteostasis": [
                "autophagy", "lysosome", "proteasome", "ubiquitin", "protein folding", "chaperone"
            ],
            "Myelination & Schwann Cell Biology": [
                "myelin", "schwann cell", "mbp", "mpz", "prx", "pmp22", "node of ranvier"
            ],
            "Membrane & Cell Surface": [
                "membrane", "plasma membrane", "cell surface", "membrane protein",
                "transmembrane", "integral membrane", "membrane transport", "ion channel"
            ],
            "Nucleus & Nuclear Processes": [
                "nucleus", "nuclear", "chromatin", "dna", "rna", "transcription",
                "nucleolus", "nuclear envelope", "nuclear pore", "chromosome"
            ],
            "Cytoplasm & Cytoskeleton": [
                "cytoplasm", "cytoskeleton", "microtubule", "actin", "intermediate filament",
                "microfilament", "centrosome", "centriole", "cilium", "flagellum"
            ],
            "Mitochondria & Energy": [
                "mitochondria", "mitochondrial", "atp", "energy", "respiration",
                "electron transport", "oxidative phosphorylation", "krebs cycle"
            ],
            "Endoplasmic Reticulum & Golgi": [
                "endoplasmic reticulum", "er", "golgi", "golgi apparatus", "vesicle",
                "secretory", "protein folding", "glycosylation", "trafficking"
            ]
        }

    def load_genes_from_file(self, file_content: str) -> List[str]:
        """Load genes from file content"""
        genes = [g.strip() for g in file_content.split('\n') if g.strip()]
        return genes

    def enrich(self, genes: List[str], p_thresh: float = 1e-2) -> pd.DataFrame:
        """Perform gene enrichment analysis"""
        if not genes:
            return pd.DataFrame()
        
        try:
            print(f"Starting enrichment analysis for {len(genes)} genes")
            df = self.gp.profile(organism="mmusculus", query=genes)
            print(f"GProfiler returned {len(df)} results")
            df = df[df["p_value"] < p_thresh].sort_values("p_value").copy()
            print(f"After filtering, {len(df)} results remain")
            df["Score"] = -np.log10(df["p_value"])
            return df
        except Exception as e:
            print(f"Error in enrichment analysis: {e}")
            import traceback
            traceback.print_exc()
            return pd.DataFrame()

    def assign_theme(self, name: str) -> Optional[str]:
        """Assign theme to GO term based on keywords"""
        low = name.lower()
        matched_themes = []
        
        # 检查每个主题的关键词匹配
        for th, kws in self.themes.items():
            for kw in kws:
                if kw in low:
                    matched_themes.append(th)
                    break  # 找到一个匹配就跳出内层循环
        
        # 如果有多个匹配，返回第一个（优先级）
        if matched_themes:
            return matched_themes[0]
        
        return None

    def aggregate(self, df: pd.DataFrame) -> pd.DataFrame:
        """Aggregate GO terms by theme"""
        if df.empty:
            return pd.DataFrame()
        
        df["Theme"] = df["name"].apply(self.assign_theme)
        themed = (df.dropna(subset=["Theme"])
                  .groupby("Theme")
                  .agg(Score=("Score", "sum"),
                       Terms=("Theme", "count"))
                  .sort_values("Score", ascending=False))
        return themed

    def create_theme_chart(self, df: pd.DataFrame, theme_name: str) -> str:
        """Create chart for a specific theme"""
        try:
            # Filter GO terms belonging to the current theme
            sub_df = df[df["Theme"] == theme_name].sort_values("Score", ascending=True)

            if sub_df.empty:
                print(f"No data found for theme: {theme_name}")
                return ""

            print(f"Creating chart for theme: {theme_name} with {len(sub_df)} terms")

            # Create plot with better proportions to avoid font stretching
            fig_width = 12
            fig_height = max(6, 0.3 * len(sub_df))  # Reduced height multiplier
            plt.figure(figsize=(fig_width, fig_height))
            
            # Create horizontal bar chart
            bars = plt.barh(sub_df["name"], sub_df["Score"], color="mediumseagreen", height=0.6)
            
            # Improve font settings
            plt.xlabel("-log10(p-value)", size=12)
            plt.title(f"Top GO Terms in Theme: {theme_name}", loc="left", fontsize=14, weight="bold")
            
            # Adjust y-axis to prevent font stretching
            plt.gca().set_ylim(-0.5, len(sub_df) - 0.5)
            
            # Improve layout
            plt.tight_layout(pad=1.5)

            # Convert to base64
            img_buffer = io.BytesIO()
            plt.savefig(img_buffer, format='png', dpi=300, bbox_inches='tight')
            img_buffer.seek(0)
            img_base64 = base64.b64encode(img_buffer.getvalue()).decode()
            plt.close()

            print(f"Chart created successfully for theme: {theme_name}")
            return img_base64
            
        except Exception as e:
            print(f"Error creating chart for theme {theme_name}: {str(e)}")
            # 清理matplotlib状态
            plt.close('all')
            raise e

    def create_summary_chart(self, themed_df: pd.DataFrame) -> str:
        """Create summary chart showing all themes"""
        try:
            if themed_df.empty:
                print("No data for summary chart")
                return ""

            print(f"Creating summary chart with {len(themed_df)} themes")

            # Create plot with better proportions
            fig_width = 12
            fig_height = max(8, 0.4 * len(themed_df))  # Better height calculation
            plt.figure(figsize=(fig_width, fig_height))
            
            # Sort by score for better visualization
            themed_df_sorted = themed_df.sort_values("Score", ascending=True)
            
            # Define distinct colors for different themes - more vibrant and distinct
            colors = [
                '#FF6B6B',  # Red
                '#4ECDC4',  # Teal
                '#45B7D1',  # Blue
                '#96CEB4',  # Green
                '#FFEAA7',  # Yellow
                '#DDA0DD',  # Plum
                '#98D8C8',  # Mint
                '#F7DC6F',  # Gold
                '#BB8FCE',  # Lavender
                '#85C1E9',  # Sky Blue
                '#F8C471',  # Orange
                '#82E0AA',  # Light Green
                '#F1948A',  # Salmon
                '#A9CCE3',  # Light Blue
                '#FAD7A0',  # Peach
                '#D7BDE2',  # Light Purple
                '#A9DFBF',  # Light Mint
                '#F9E79F',  # Light Yellow
                '#F5B7B1',  # Light Pink
                '#AED6F1'   # Light Sky Blue
            ]
            
            # Create horizontal bar chart with different colors and better bar height
            bars = plt.barh(themed_df_sorted.index, themed_df_sorted["Score"], 
                           color=colors[:len(themed_df_sorted)], alpha=0.9, height=0.7)
            
            # Add value labels on bars with better contrast
            for i, (theme, score) in enumerate(zip(themed_df_sorted.index, themed_df_sorted["Score"])):
                plt.text(score + 1, i, f'{score:.1f}', va='center', fontsize=10, 
                        fontweight='bold', color='black')
            
            plt.xlabel("Cumulative Score (-log10(p-value))", size=12)
            plt.title("Gene Ontology Analysis Summary by Theme", loc="left", fontsize=14, weight="bold")
            
            # Adjust y-axis to prevent font stretching
            plt.gca().set_ylim(-0.5, len(themed_df_sorted) - 0.5)
            
            plt.tight_layout(pad=1.5)

            # Convert to base64
            img_buffer = io.BytesIO()
            plt.savefig(img_buffer, format='png', dpi=300, bbox_inches='tight')
            img_buffer.seek(0)
            img_base64 = base64.b64encode(img_buffer.getvalue()).decode()
            plt.close()

            print(f"Summary chart created successfully with {len(themed_df_sorted)} distinct colors")
            return img_base64
            
        except Exception as e:
            print(f"Error creating summary chart: {str(e)}")
            # 清理matplotlib状态
            plt.close('all')
            raise e

# Initialize ontology API
ontology_api = GeneOntologyAPI()

@app.post("/api/ontology/analyze")
async def analyze_ontology(file: UploadFile = File(...)):
    """Analyze gene ontology from uploaded file"""
    if not file.filename.endswith('.txt'):
        raise HTTPException(status_code=400, detail="Only .txt files are supported")
    
    try:
        print("Starting ontology analysis...")
        
        # Read file content
        content = await file.read()
        file_content = content.decode('utf-8')
        print(f"File content length: {len(file_content)} characters")
        
        # Load genes
        genes = ontology_api.load_genes_from_file(file_content)
        if not genes:
            raise HTTPException(status_code=400, detail="No valid genes found in file")
        print(f"Loaded {len(genes)} genes from file")
        
        # Perform enrichment
        print("Starting enrichment analysis...")
        enr_df = ontology_api.enrich(genes)
        if enr_df.empty:
            print("No enrichment results found")
            return {"results": [], "message": "No significant enrichment results found"}
        print(f"Enrichment analysis completed with {len(enr_df)} results")
        
        # Assign themes and aggregate
        print("Assigning themes...")
        enr_df["Theme"] = enr_df["name"].apply(ontology_api.assign_theme)
        themed = ontology_api.aggregate(enr_df)
        print(f"Theme aggregation completed with {len(themed)} themes")
        
        # Convert to list of dictionaries
        results = []
        for theme, row in themed.iterrows():
            results.append({
                "theme": theme,
                "score": float(row["Score"]),
                "terms": int(row["Terms"])
            })
        
        print(f"Analysis completed successfully with {len(results)} results")
        return {"results": results}
        
    except ImportError as e:
        print(f"Import error in ontology analysis: {e}")
        raise HTTPException(status_code=500, detail=f"Missing dependency: {str(e)}")
    except Exception as e:
        print(f"Error in ontology analysis: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error analyzing genes: {str(e)}")

@app.post("/api/ontology/theme-chart")
async def generate_theme_chart(file: UploadFile = File(...), theme: str = Form(...)):
    """Generate chart for a specific theme"""
    if not file.filename.endswith('.txt'):
        raise HTTPException(status_code=400, detail="Only .txt files are supported")
    
    try:
        print(f"Processing theme chart request for theme: {theme}")
        
        # Read file content
        content = await file.read()
        file_content = content.decode('utf-8')
        print(f"File content length: {len(file_content)} characters")
        
        # Load genes
        genes = ontology_api.load_genes_from_file(file_content)
        if not genes:
            raise HTTPException(status_code=400, detail="No valid genes found in file")
        print(f"Loaded {len(genes)} genes from file")
        
        # Perform enrichment
        enr_df = ontology_api.enrich(genes)
        if enr_df.empty:
            raise HTTPException(status_code=400, detail="No significant enrichment results found")
        print(f"Enrichment analysis completed with {len(enr_df)} significant terms")
        
        # Assign themes
        enr_df["Theme"] = enr_df["name"].apply(ontology_api.assign_theme)
        themed_terms = enr_df[enr_df["Theme"].notna()]
        print(f"Assigned themes to {len(themed_terms)} terms")
        
        # Check if theme exists
        theme_terms = enr_df[enr_df["Theme"] == theme]
        if theme_terms.empty:
            available_themes = enr_df["Theme"].dropna().unique().tolist()
            raise HTTPException(
                status_code=400, 
                detail=f"Theme '{theme}' not found. Available themes: {available_themes}"
            )
        
        # Create chart
        chart_base64 = ontology_api.create_theme_chart(enr_df, theme)
        if not chart_base64:
            raise HTTPException(status_code=400, detail=f"No data found for theme: {theme}")
        
        # Get subterms for the theme
        sub_df = enr_df[enr_df["Theme"] == theme].sort_values("Score", ascending=False)
        subterms = []
        for _, row in sub_df.iterrows():
            subterms.append({
                "name": row["name"],
                "score": float(row["Score"])
            })
        
        print(f"Successfully generated chart for theme: {theme} with {len(subterms)} subterms")
        return {
            "chart_base64": chart_base64,
            "subterms": subterms
        }
        
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        print(f"Unexpected error in generate_theme_chart: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error generating chart: {str(e)}")

@app.post("/api/ontology/summary-chart")
async def generate_summary_chart(file: UploadFile = File(...)):
    """Generate summary chart showing all themes"""
    if not file.filename.endswith('.txt'):
        raise HTTPException(status_code=400, detail="Only .txt files are supported")
    
    try:
        print("Processing summary chart request")
        
        # Read file content
        content = await file.read()
        file_content = content.decode('utf-8')
        print(f"File content length: {len(file_content)} characters")
        
        # Load genes
        genes = ontology_api.load_genes_from_file(file_content)
        if not genes:
            raise HTTPException(status_code=400, detail="No valid genes found in file")
        print(f"Loaded {len(genes)} genes from file")
        
        # Perform enrichment
        enr_df = ontology_api.enrich(genes)
        if enr_df.empty:
            raise HTTPException(status_code=400, detail="No significant enrichment results found")
        print(f"Enrichment analysis completed with {len(enr_df)} significant terms")
        
        # Assign themes and aggregate
        enr_df["Theme"] = enr_df["name"].apply(ontology_api.assign_theme)
        themed = ontology_api.aggregate(enr_df)
        
        if themed.empty:
            raise HTTPException(status_code=400, detail="No themes could be aggregated")
        print(f"Aggregated {len(themed)} themes")
        
        # Generate summary chart
        chart_base64 = ontology_api.create_summary_chart(themed)
        
        if not chart_base64:
            raise HTTPException(status_code=500, detail="Failed to generate summary chart")
        
        print("Successfully generated summary chart")
        return {"chart": chart_base64}
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error generating summary chart: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/api/ontology/custom-analyze")
async def analyze_custom_ontology(
    file: UploadFile = File(...), 
    themes: str = Form(...),
    custom_themes: str = Form(None)
):
    """Analyze gene ontology with custom theme selection"""
    if not file.filename.endswith('.txt'):
        raise HTTPException(status_code=400, detail="Only .txt files are supported")
    
    try:
        # Parse selected themes
        import json
        selected_themes = json.loads(themes)
        if not selected_themes:
            raise HTTPException(status_code=400, detail="No themes selected")
        
        print(f"Custom analysis requested for themes: {selected_themes}")
        
        # Parse custom themes if provided
        custom_theme_data = []
        if custom_themes:
            try:
                custom_theme_data = json.loads(custom_themes)
                print(f"Custom themes received: {custom_theme_data}")
            except json.JSONDecodeError:
                print("Warning: Failed to parse custom themes")
        
        # Temporarily add custom themes to the ontology API
        original_themes = ontology_api.themes.copy()
        for custom_theme in custom_theme_data:
            theme_name = custom_theme.get('name')
            keywords = custom_theme.get('keywords', [])
            if theme_name and keywords:
                ontology_api.themes[theme_name] = keywords
                print(f"Added custom theme '{theme_name}' with keywords: {keywords}")
        
        # Read file content
        content = await file.read()
        file_content = content.decode('utf-8')
        
        # Load genes
        genes = ontology_api.load_genes_from_file(file_content)
        if not genes:
            raise HTTPException(status_code=400, detail="No valid genes found in file")
        
        # Perform enrichment
        enr_df = ontology_api.enrich(genes)
        if enr_df.empty:
            return {"results": [], "message": "No significant enrichment results found"}
        
        # Filter results based on selected themes
        # For custom analysis, we'll map theme IDs to actual theme names
        theme_mapping = {
            # Biological Processes
            'metabolism': 'Metabolic re-wiring',
            'cell_cycle': 'Cell-cycle & Apoptosis',
            'apoptosis': 'Cell-cycle & Apoptosis',
            'immune_response': 'Inflammation & immune signaling',
            'development': 'Neurotrophic Signaling & Growth Factors',
            'signaling': 'Neurotrophic Signaling & Growth Factors',
            'transport': 'Extracellular matrix & adhesion',
            'transcription': 'Metabolic re-wiring',
            'translation': 'Metabolic re-wiring',
            'stress_response': 'Stress & cytokine response',
            
            # Molecular Functions
            'enzyme_activity': 'Metabolic re-wiring',
            'binding': 'Metabolic re-wiring',
            'receptor_activity': 'Neurotrophic Signaling & Growth Factors',
            'transporter_activity': 'Extracellular matrix & adhesion',
            'structural_molecule': 'Extracellular matrix & adhesion',
            
            # Cellular Components
            'membrane': 'Membrane & Cell Surface',
            'nucleus': 'Nucleus & Nuclear Processes',
            'cytoplasm': 'Cytoplasm & Cytoskeleton',
            'mitochondria': 'Mitochondria & Energy',
            'endoplasmic_reticulum': 'Endoplasmic Reticulum & Golgi',
            'golgi': 'Endoplasmic Reticulum & Golgi',
            'cytoskeleton': 'Cytoplasm & Cytoskeleton'
        }
        
        # Add custom themes to mapping (they map to themselves)
        for custom_theme in custom_theme_data:
            theme_id = custom_theme.get('id')
            theme_name = custom_theme.get('name')
            if theme_id and theme_name:
                theme_mapping[theme_id] = theme_name
        
        print(f"Available themes in ontology: {list(ontology_api.themes.keys())}")
        
        # Assign themes and filter by selected themes
        enr_df["Theme"] = enr_df["name"].apply(ontology_api.assign_theme)
        selected_theme_names = [theme_mapping.get(theme_id, theme_id) for theme_id in selected_themes]
        
        print(f"Selected theme IDs: {selected_themes}")
        print(f"Mapped theme names: {selected_theme_names}")
        print(f"Available themes in data: {enr_df['Theme'].dropna().unique().tolist()}")
        
        # Filter enrichment results to only include selected themes
        filtered_df = enr_df[enr_df["Theme"].isin(selected_theme_names)]
        
        print(f"Filtered dataframe shape: {filtered_df.shape}")
        
        if filtered_df.empty:
            return {"results": [], "message": f"No enrichment results found for selected themes: {selected_theme_names}"}
        
        # Aggregate results for selected themes
        themed = ontology_api.aggregate(filtered_df)
        
        # Convert to list of dictionaries
        results = []
        for theme, row in themed.iterrows():
            results.append({
                "theme": theme,
                "score": float(row["Score"]),
                "terms": int(row["Terms"])
            })
        
        print(f"Custom analysis completed with {len(results)} results")
        
        # Restore original themes
        ontology_api.themes = original_themes
        
        return {"results": results}
        
    except json.JSONDecodeError:
        # Restore original themes on error
        if 'original_themes' in locals():
            ontology_api.themes = original_themes
        raise HTTPException(status_code=400, detail="Invalid themes format")
    except Exception as e:
        # Restore original themes on error
        if 'original_themes' in locals():
            ontology_api.themes = original_themes
        raise HTTPException(status_code=500, detail=f"Error analyzing genes: {str(e)}")

@app.post("/api/ontology/custom-summary-chart")
async def generate_custom_summary_chart(
    file: UploadFile = File(...), 
    themes: str = Form(...),
    custom_themes: str = Form(None)
):
    """Generate summary chart for custom theme selection"""
    if not file.filename.endswith('.txt'):
        raise HTTPException(status_code=400, detail="Only .txt files are supported")
    
    try:
        # Parse selected themes
        import json
        selected_themes = json.loads(themes)
        if not selected_themes:
            raise HTTPException(status_code=400, detail="No themes selected")
        
        print(f"Custom summary chart requested for themes: {selected_themes}")
        
        # Parse custom themes if provided
        custom_theme_data = []
        if custom_themes:
            try:
                custom_theme_data = json.loads(custom_themes)
                print(f"Custom themes received: {custom_theme_data}")
            except json.JSONDecodeError:
                print("Warning: Failed to parse custom themes")
        
        # Temporarily add custom themes to the ontology API
        original_themes = ontology_api.themes.copy()
        for custom_theme in custom_theme_data:
            theme_name = custom_theme.get('name')
            keywords = custom_theme.get('keywords', [])
            if theme_name and keywords:
                ontology_api.themes[theme_name] = keywords
                print(f"Added custom theme '{theme_name}' with keywords: {keywords}")
        
        # Read file content
        content = await file.read()
        file_content = content.decode('utf-8')
        
        # Load genes
        genes = ontology_api.load_genes_from_file(file_content)
        if not genes:
            raise HTTPException(status_code=400, detail="No valid genes found in file")
        
        # Perform enrichment
        enr_df = ontology_api.enrich(genes)
        if enr_df.empty:
            raise HTTPException(status_code=400, detail="No significant enrichment results found")
        
        # Theme mapping
        theme_mapping = {
            # Biological Processes
            'metabolism': 'Metabolic re-wiring',
            'cell_cycle': 'Cell-cycle & Apoptosis',
            'apoptosis': 'Cell-cycle & Apoptosis',
            'immune_response': 'Inflammation & immune signaling',
            'development': 'Neurotrophic Signaling & Growth Factors',
            'signaling': 'Neurotrophic Signaling & Growth Factors',
            'transport': 'Extracellular matrix & adhesion',
            'transcription': 'Metabolic re-wiring',
            'translation': 'Metabolic re-wiring',
            'stress_response': 'Stress & cytokine response',
            
            # Molecular Functions
            'enzyme_activity': 'Metabolic re-wiring',
            'binding': 'Metabolic re-wiring',
            'receptor_activity': 'Neurotrophic Signaling & Growth Factors',
            'transporter_activity': 'Extracellular matrix & adhesion',
            'structural_molecule': 'Extracellular matrix & adhesion',
            
            # Cellular Components
            'membrane': 'Membrane & Cell Surface',
            'nucleus': 'Nucleus & Nuclear Processes',
            'cytoplasm': 'Cytoplasm & Cytoskeleton',
            'mitochondria': 'Mitochondria & Energy',
            'endoplasmic_reticulum': 'Endoplasmic Reticulum & Golgi',
            'golgi': 'Endoplasmic Reticulum & Golgi',
            'cytoskeleton': 'Cytoplasm & Cytoskeleton'
        }
        
        # Add custom themes to mapping (they map to themselves)
        for custom_theme in custom_theme_data:
            theme_id = custom_theme.get('id')
            theme_name = custom_theme.get('name')
            if theme_id and theme_name:
                theme_mapping[theme_id] = theme_name
        
        print(f"Custom summary chart - Available themes in ontology: {list(ontology_api.themes.keys())}")
        
        # Assign themes and filter by selected themes
        enr_df["Theme"] = enr_df["name"].apply(ontology_api.assign_theme)
        selected_theme_names = [theme_mapping.get(theme_id, theme_id) for theme_id in selected_themes]
        
        # Filter enrichment results to only include selected themes
        filtered_df = enr_df[enr_df["Theme"].isin(selected_theme_names)]
        
        if filtered_df.empty:
            # Restore original themes before raising exception
            ontology_api.themes = original_themes
            raise HTTPException(status_code=400, detail=f"No enrichment results found for selected themes: {selected_theme_names}")
        
        # Aggregate results for selected themes
        themed = ontology_api.aggregate(filtered_df)
        
        if themed.empty:
            # Restore original themes before raising exception
            ontology_api.themes = original_themes
            raise HTTPException(status_code=400, detail="No themes could be aggregated")
        
        # Generate summary chart
        chart_base64 = ontology_api.create_summary_chart(themed)
        
        if not chart_base64:
            # Restore original themes before raising exception
            ontology_api.themes = original_themes
            raise HTTPException(status_code=500, detail="Failed to generate custom summary chart")
        
        print("Successfully generated custom summary chart")
        
        # Restore original themes
        ontology_api.themes = original_themes
        
        return {"chart": chart_base64}
        
    except json.JSONDecodeError:
        # Restore original themes on error
        if 'original_themes' in locals():
            ontology_api.themes = original_themes
        raise HTTPException(status_code=400, detail="Invalid themes format")
    except HTTPException:
        # Restore original themes on error
        if 'original_themes' in locals():
            ontology_api.themes = original_themes
        raise
    except Exception as e:
        # Restore original themes on error
        if 'original_themes' in locals():
            ontology_api.themes = original_themes
        print(f"Error generating custom summary chart: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/api/debug/themes")
async def debug_themes():
    """Debug endpoint to show available themes"""
    return {
        "available_themes": list(ontology_api.themes.keys()),
        "theme_count": len(ontology_api.themes)
    }

@app.post("/api/debug/test-enrichment")
async def debug_test_enrichment(file: UploadFile = File(...)):
    """Debug endpoint to test enrichment analysis"""
    if not file.filename.endswith('.txt'):
        raise HTTPException(status_code=400, detail="Only .txt files are supported")
    
    try:
        # Read file content
        content = await file.read()
        file_content = content.decode('utf-8')
        
        # Load genes
        genes = ontology_api.load_genes_from_file(file_content)
        if not genes:
            return {"error": "No valid genes found in file"}
        
        # Perform enrichment
        enr_df = ontology_api.enrich(genes)
        if enr_df.empty:
            return {"error": "No significant enrichment results found"}
        
        # Assign themes with detailed logging
        print(f"Assigning themes to {len(enr_df)} terms...")
        theme_assignments = []
        for idx, row in enr_df.iterrows():
            term_name = row["name"]
            assigned_theme = ontology_api.assign_theme(term_name)
            theme_assignments.append({
                "term": term_name,
                "theme": assigned_theme,
                "score": row["Score"]
            })
            if assigned_theme:
                print(f"  '{term_name}' -> '{assigned_theme}'")
        
        enr_df["Theme"] = [ta["theme"] for ta in theme_assignments]
        themed_terms = enr_df[enr_df["Theme"].notna()]
        
        # Get theme distribution
        theme_counts = enr_df["Theme"].value_counts().to_dict()
        
        return {
            "gene_count": len(genes),
            "enrichment_terms": len(enr_df),
            "themed_terms": len(themed_terms),
            "theme_distribution": theme_counts,
            "available_themes": list(theme_counts.keys()),
            "sample_terms": enr_df.head(5)[["name", "Theme", "Score"]].to_dict('records'),
            "theme_assignments": theme_assignments[:10]  # 前10个分配结果
        }
        
    except Exception as e:
        return {"error": f"Debug error: {str(e)}"}

@app.get("/")
async def root():
    """Root endpoint with API information"""
    return {
        "message": "Gene Expression Search API",
        "version": "1.0.0",
        "endpoints": {
            "GET /api/gene/symbols": "Get all available gene symbols",
            "GET /api/gene/symbol/search?gene_symbol=<symbol>": "Search for gene data",
            "GET /api/gene/symbol/showFoldChange?gene_symbol=<symbol>": "Get fold change plot (base64)",
            "GET /api/gene/symbol/showLSMeanControl?gene_symbol=<symbol>": "Get LSmean(Control) plot (base64)",
            "GET /api/gene/symbol/showLSMeanTenMgKg?gene_symbol=<symbol>": "Get LSmean(10mg/kg) plot (base64)",
            "POST /api/gene/add": "Add a new gene to the database",
            "POST /api/ontology/analyze": "Analyze gene ontology from uploaded file",
            "POST /api/ontology/theme-chart": "Generate theme-specific chart",
            "GET /api/debug/themes": "Debug: Show available themes",
            "POST /api/debug/test-enrichment": "Debug: Test enrichment analysis"
        }
    }

@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": "2024-01-01T00:00:00Z"}

@app.get("/api/test")
async def test_endpoint():
    """Test endpoint for debugging"""
    return {"message": "Test endpoint is working"}

def install_requirements():
    """安装依赖项"""
    import subprocess
    import sys
    
    print("正在检查并安装依赖项...")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"])
        print("✅ 依赖项安装完成")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ 依赖项安装失败: {e}")
        return False
    except FileNotFoundError:
        print("⚠️  找不到requirements.txt文件，跳过依赖项安装")
        return True

def check_dependencies():
    """检查关键依赖项是否可用"""
    missing_deps = []
    
    try:
        import fastapi
    except ImportError:
        missing_deps.append("fastapi")
    
    try:
        import uvicorn
    except ImportError:
        missing_deps.append("uvicorn")
    
    try:
        import pandas
    except ImportError:
        missing_deps.append("pandas")
    
    try:
        import matplotlib
    except ImportError:
        missing_deps.append("matplotlib")
    
    try:
        import gprofiler
    except ImportError:
        missing_deps.append("gprofiler-official")
    
    if missing_deps:
        print(f"❌ 缺少以下依赖项: {', '.join(missing_deps)}")
        print("正在尝试安装...")
        return install_requirements()
    
    return True

def start_server():
    """启动服务器"""
    print("=== 基因搜索后端服务器 ===")
    
    # 检查依赖项
    if not check_dependencies():
        print("❌ 依赖项检查失败，无法启动服务器")
        return
    
    # 使用固定端口 8000
    port = 8000
    import socket
    
    def is_port_available(port):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('localhost', port))
                return True
            except OSError:
                return False
    
    # 检查端口 8000 是否可用
    if not is_port_available(port):
        print(f"❌ 端口 {port} 已被占用")
        print("请停止占用该端口的其他服务，或修改前端配置使用其他端口")
        return
    
    print(f"正在启动服务器...")
    print(f"服务器地址: http://localhost:{port}")
    print(f"API文档: http://localhost:{port}/docs")
    print("按 Ctrl+C 停止服务器")
    
    try:
        import uvicorn
        uvicorn.run(app, host="0.0.0.0", port=port, reload=False)
    except KeyboardInterrupt:
        print("\n服务器已停止")
    except Exception as e:
        print(f"❌ 启动服务器失败: {e}")

if __name__ == "__main__":
    start_server() 