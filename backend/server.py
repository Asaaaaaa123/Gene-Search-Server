from fastapi import FastAPI, HTTPException, Query, Depends, status, UploadFile, File, Form, Header
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
import re
from typing import Any, Dict, List, Optional
import json
from datetime import datetime, timezone
import numpy as np
import secrets
import os
from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure
import seaborn as sns
from gprofiler import GProfiler
from ivcca_core import IVCCAAnalyzer, TwoSetCorrelation
from clerk_auth import (
    clerk_auth_configured,
    clerk_issuer,
    clerk_jwks_url,
    verify_clerk_bearer_token,
)

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

if clerk_auth_configured():
    print(f"Clerk JWT: configured (issuer={clerk_issuer()}, jwks={clerk_jwks_url()})")
else:
    print(
        "Clerk JWT: NOT configured — set CLERK_ISSUER in backend/.env (see env.example). "
        "Upload / add-gene / saved preferences need this; gene search still works without it."
    )

# MongoDB connection
MONGODB_URI = os.getenv('MONGODB_URI')
MONGODB_AVAILABLE = False
client = None
db = None
collection = None

if MONGODB_URI:
    try:
        client = MongoClient(MONGODB_URI)
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

USER_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "user_data")

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

class UserPreferencesUpdate(BaseModel):
    """Partial update for signed-in user state (stored per Clerk user id)."""
    customTheme: Optional[Dict[str, Any]] = None
    uploadHistoryAppend: Optional[Dict[str, Any]] = None


app = FastAPI(title="Gene Expression Search API", version="1.0.0")

# CORS: localhost via regex; aurorarangers.ca subdomains allowed by default; env can add more.
_cors_builtin = [
    "https://asagene.aurorarangers.ca",
    "https://www.asagene.aurorarangers.ca",
]
_cors_env = [
    o.strip()
    for o in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",")
    if o.strip()
]
_seen_origins: set[str] = set()
_allow_origins: list[str] = []
for _o in _cors_builtin + _cors_env:
    if _o not in _seen_origins:
        _seen_origins.add(_o)
        _allow_origins.append(_o)
# Optional single regex merged with defaults (e.g. ^https://preview\.example\.com$ ).
_cors_regex_extra = os.getenv("CORS_ALLOW_ORIGIN_REGEX", "").strip()
_localhost_cors = r"https?://(localhost|127\.0\.0\.1)(:\d+)?$"
_aurorarangers_cors = r"https://([a-z0-9-]+\.)*aurorarangers\.ca$"
_cors_regex = (
    f"({_localhost_cors})|({_aurorarangers_cors})|({_cors_regex_extra})"
    if _cors_regex_extra
    else f"({_localhost_cors})|({_aurorarangers_cors})"
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_origin_regex=_cors_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security
security = HTTPBasic()

def _safe_user_file_id(clerk_user_id: str) -> str:
    return clerk_user_id.replace("..", "_").replace("/", "_").replace("\\", "_")


def load_user_preferences(clerk_user_id: str) -> Dict[str, Any]:
    if MONGODB_AVAILABLE and db is not None:
        doc = db.user_preferences.find_one({"clerk_user_id": clerk_user_id})
        if doc and isinstance(doc.get("data"), dict):
            return dict(doc["data"])
        return {}
    os.makedirs(USER_DATA_DIR, exist_ok=True)
    path = os.path.join(USER_DATA_DIR, f"{_safe_user_file_id(clerk_user_id)}.json")
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Warning: could not read user prefs file {path}: {e}")
    return {}


def save_user_preferences(clerk_user_id: str, data: Dict[str, Any]) -> None:
    if MONGODB_AVAILABLE and db is not None:
        db.user_preferences.update_one(
            {"clerk_user_id": clerk_user_id},
            {"$set": {"clerk_user_id": clerk_user_id, "data": data}},
            upsert=True,
        )
        return
    os.makedirs(USER_DATA_DIR, exist_ok=True)
    path = os.path.join(USER_DATA_DIR, f"{_safe_user_file_id(clerk_user_id)}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


async def require_clerk_user(authorization: Optional[str] = Header(None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization: Bearer <Clerk session token> required",
        )
    token = authorization[7:].strip()
    return verify_clerk_bearer_token(token)


class GeneSearchAPI:
    @staticmethod
    def _data_dir() -> str:
        """backend/data next to this file (works regardless of process cwd)."""
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

    @staticmethod
    def _record_from_excel_row(organ_name: str, row) -> Optional[Dict]:
        gene_symbol = str(row.get("Gene_symbol", "")).strip()
        if not gene_symbol:
            return None
        return {
            "organ": organ_name,
            "gene_symbol": gene_symbol,
            "gene_name": str(row.get("Gene_name", "")),
            "p_value_10_mgkg_vs_control": str(row.get("P_value_10_mgkg_vs_control", "")),
            "fdr_step_up_10_mgkg_vs_control": str(row.get("FDR_step_up_10_mgkg_vs_control", "")),
            "ratio_10_mgkg_vs_control": str(row.get("Ratio_10_mgkg_vs_control", "")),
            "fold_change_10_mgkg_vs_control": str(row.get("Fold_change_10_mgkg_vs_control", "")),
            "lsmean_10mgkg_10_mgkg_vs_control": str(row.get("LSMean10mgkg_10_mgkg_vs_control", "")),
            "lsmean_control_10_mgkg_vs_control": str(row.get("LSMeancontrol_10_mgkg_vs_control", "")),
        }

    def _load_disk_records(self) -> List[Dict]:
        """In-memory gene rows from backend/data/*.xlsx (used when MongoDB is off or empty)."""
        out: List[Dict] = []
        data_dir = self._data_dir()
        if not os.path.isdir(data_dir):
            print(f"Data directory not found: {data_dir}")
            return out
        for file_path in glob.glob(os.path.join(data_dir, "*.xlsx")):
            organ_name = os.path.splitext(os.path.basename(file_path))[0]
            try:
                df = pd.read_excel(file_path)
                print(f"Indexed {len(df)} rows from Excel: {file_path}")
                for _, row in df.iterrows():
                    rec = self._record_from_excel_row(organ_name, row)
                    if rec:
                        out.append(rec)
            except Exception as e:
                print(f"Error reading {file_path}: {e}")
        print(f"Excel index: {len(out)} total gene rows under {data_dir}")
        return out

    def __init__(self):
        self._disk_records = self._load_disk_records()
        self.load_data_to_mongodb()
        self.all_genes = self.load_all_genes()

    def load_data_to_mongodb(self):
        """Load data from Excel files into MongoDB with duplicate prevention"""
        if not MONGODB_AVAILABLE:
            print("MongoDB not available, skipping MongoDB data load (search uses Excel files if present)")
            return

        data_dir = self._data_dir()
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
                    record = self._record_from_excel_row(organ_name, row)
                    if record is None:
                        continue
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
        """Unique gene symbols from MongoDB and/or Excel under backend/data."""
        genes: set = set()
        if MONGODB_AVAILABLE:
            try:
                pipeline = [
                    {"$group": {"_id": "$gene_symbol"}},
                    {"$sort": {"_id": 1}},
                ]
                for doc in collection.aggregate(pipeline):
                    gid = doc.get("_id")
                    if gid is not None and str(gid).strip():
                        genes.add(str(gid).strip())
            except Exception as e:
                print(f"Warning: could not list genes from MongoDB: {e}")
        for rec in self._disk_records:
            g = str(rec.get("gene_symbol", "")).strip()
            if g:
                genes.add(g)
        out = sorted(genes, key=lambda x: (x.lower(), x))
        print(
            f"Gene symbol index: {len(out)} unique symbols "
            f"(MongoDB={'on' if MONGODB_AVAILABLE else 'off'}, "
            f"{len(self._disk_records)} Excel rows cached)"
        )
        return out

    def _raw_docs_for_gene(self, gene_symbol: str) -> List[Dict]:
        """Rows for one gene: MongoDB first, then Excel rows not already present (organ+symbol)."""
        sym = gene_symbol.strip()
        if not sym:
            return []
        keys_seen: set = set()
        out: List[Dict] = []
        if MONGODB_AVAILABLE:
            try:
                query = {
                    "gene_symbol": {
                        "$regex": f"^{re.escape(sym)}$",
                        "$options": "i",
                    }
                }
                for doc in collection.find(query):
                    plain = {k: v for k, v in doc.items() if k != "_id"}
                    key = (plain.get("organ"), str(plain.get("gene_symbol", "")).strip().lower())
                    keys_seen.add(key)
                    out.append(plain)
            except Exception as e:
                print(f"Warning: MongoDB gene query failed: {e}")
        target_lower = sym.lower()
        for rec in self._disk_records:
            if str(rec.get("gene_symbol", "")).strip().lower() != target_lower:
                continue
            key = (rec.get("organ"), str(rec.get("gene_symbol", "")).strip().lower())
            if key in keys_seen:
                continue
            keys_seen.add(key)
            out.append(dict(rec))
        return out

    def search_gene_data(self, gene_symbol: str) -> List[Dict]:
        """Search for a gene (MongoDB and/or Excel fallback)."""
        results = []
        for doc in self._raw_docs_for_gene(gene_symbol):
            results.append({
                "organ": doc.get("organ", ""),
                "gene_symbol": doc.get("gene_symbol", ""),
                "gene_name": doc.get("gene_name", ""),
                "p_value": doc.get("p_value_10_mgkg_vs_control", ""),
                "fdr_step_up": doc.get("fdr_step_up_10_mgkg_vs_control", ""),
                "ratio": doc.get("ratio_10_mgkg_vs_control", ""),
                "fold_change": doc.get("fold_change_10_mgkg_vs_control", ""),
                "lsmean_10mgkg": doc.get("lsmean_10mgkg_10_mgkg_vs_control", ""),
                "lsmean_control": doc.get("lsmean_control_10_mgkg_vs_control", ""),
            })
        return results
    
    def create_fold_change_plot(self, gene_symbol: str) -> str:
        """Create fold change plot and return as base64 string"""
        docs = self._raw_docs_for_gene(gene_symbol)
        organs = []
        fold_changes = []
        colors = []
        
        for doc in docs:
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
        docs = self._raw_docs_for_gene(gene_symbol)
        organs = []
        lsmeans = []
        
        for doc in docs:
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
        docs = self._raw_docs_for_gene(gene_symbol)
        organs = []
        lsmeans = []
        
        for doc in docs:
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
        if not MONGODB_AVAILABLE:
            raise HTTPException(
                status_code=503,
                detail="MongoDB is not connected; gene add requires MongoDB. Start MongoDB and set MONGODB_URI, or add rows via Excel under backend/data.",
            )
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

@app.get("/api/gene/symbols")
async def get_gene_symbols():
    """Get all available gene symbols"""
    return {"gene_symbols": gene_api.all_genes}

@app.get("/api/gene/symbol/search")
async def search_gene_symbol(gene_symbol: str = Query(..., description="Gene symbol to search for")):
    """Search for a gene symbol and return all matching data"""
    if not gene_symbol:
        raise HTTPException(status_code=400, detail="Gene symbol is required")
    
    results = gene_api.search_gene_data(gene_symbol)
    if not results:
        return {
            "message": "No results found",
            "data": [],
            "hint": (
                "Put organ .xlsx files under backend/data (see README) with column Gene_symbol, or connect MongoDB "
                "and load data. Startup logs show how many Excel rows were indexed."
            ),
            "mongodb_connected": MONGODB_AVAILABLE,
            "excel_rows_indexed": len(gene_api._disk_records),
        }

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
async def add_gene(
    gene_data: GeneData,
    _user_id: str = Depends(require_clerk_user),
):
    """Add a new gene (requires Clerk session JWT: Authorization: Bearer …)."""
    try:
        result = gene_api.add_gene(gene_data)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error adding gene: {str(e)}")


def _csv_row_as_series(row_dict: Dict[str, Any]) -> pd.Series:
    """Normalize CSV column names to the keys expected by _record_from_excel_row."""

    def norm_key(k: str) -> str:
        return str(k).strip().lower().replace(" ", "_")

    lookup: Dict[str, Any] = {}
    for k, v in row_dict.items():
        lookup[norm_key(str(k))] = v

    def pick(*candidates: str) -> Any:
        for c in candidates:
            nk = norm_key(c)
            if nk in lookup:
                return lookup[nk]
        return ""

    return pd.Series(
        {
            "Gene_symbol": pick("gene_symbol", "genesymbol", "symbol"),
            "Gene_name": pick("gene_name", "genename"),
            "P_value_10_mgkg_vs_control": pick(
                "p_value_10_mgkg_vs_control",
                "p_value",
                "pvalue",
            ),
            "FDR_step_up_10_mgkg_vs_control": pick(
                "fdr_step_up_10_mgkg_vs_control",
                "fdr",
                "fdr_step_up",
            ),
            "Ratio_10_mgkg_vs_control": pick("ratio_10_mgkg_vs_control", "ratio"),
            "Fold_change_10_mgkg_vs_control": pick(
                "fold_change_10_mgkg_vs_control",
                "fold_change",
            ),
            "LSMean10mgkg_10_mgkg_vs_control": pick(
                "lsmean10mgkg_10_mgkg_vs_control",
                "lsmean_10mgkg",
            ),
            "LSMeancontrol_10_mgkg_vs_control": pick(
                "lsmeancontrol_10_mgkg_vs_control",
                "lsmean_control",
                "lsmeancontrol",
            ),
        }
    )


@app.post("/api/gene/upload_csv")
async def upload_gene_csv(
    organ: str = Form(..., description="Organ preset key, or 'Others' with organ_custom set"),
    organ_custom: Optional[str] = Form(
        None,
        description="When organ is Others, the custom organ name (letters, numbers, spaces, hyphen, underscore)",
    ),
    file: UploadFile = File(...),
    user_id: str = Depends(require_clerk_user),
):
    """Upload a CSV or Excel (.xlsx/.xls) file with gene columns; upserts into MongoDB gene_data. Requires MongoDB."""
    if not MONGODB_AVAILABLE or collection is None:
        raise HTTPException(
            status_code=503,
            detail="Upload requires a running MongoDB connection (MONGODB_URI).",
        )
    key = organ.strip()
    if key.lower() in ("others", "other"):
        organ_name = (organ_custom or "").strip()
        if not organ_name:
            raise HTTPException(
                status_code=400,
                detail="When organ is Others, provide organ_custom with the organ name.",
            )
    else:
        organ_name = key
    if not organ_name:
        raise HTTPException(status_code=400, detail="organ is required")
    if len(organ_name) > 120:
        raise HTTPException(status_code=400, detail="Organ name is too long (max 120 characters)")
    for bad in ("/", "\\", ".."):
        if bad in organ_name:
            raise HTTPException(status_code=400, detail="Organ name contains invalid characters")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    name = (file.filename or "").lower()
    ext = os.path.splitext(name)[1]
    try:
        if ext in (".xlsx", ".xls"):
            df = pd.read_excel(io.BytesIO(raw))
        elif ext == ".csv" or ext == "":
            df = pd.read_csv(io.BytesIO(raw))
        else:
            raise HTTPException(
                status_code=400,
                detail="Unsupported file type. Use .csv, .xlsx, or .xls",
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read file: {e}")

    records: List[Dict] = []
    for _, row in df.iterrows():
        series = _csv_row_as_series(row.to_dict())
        rec = gene_api._record_from_excel_row(organ_name, series)
        if rec:
            records.append(rec)
    if not records:
        raise HTTPException(
            status_code=400,
            detail="No valid rows (need Gene_symbol / gene_symbol column in the sheet)",
        )

    operations = []
    for record in records:
        operations.append(
            {
                "replaceOne": {
                    "filter": {"organ": record["organ"], "gene_symbol": record["gene_symbol"]},
                    "replacement": record,
                    "upsert": True,
                }
            }
        )
    collection.bulk_write(operations)

    prefs = load_user_preferences(user_id)
    hist = list(prefs.get("uploadHistory") or [])
    hist.append(
        {
            "filename": file.filename or ("upload.xlsx" if ext in (".xlsx", ".xls") else "upload.csv"),
            "organ": organ_name,
            "rows": len(records),
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    prefs["uploadHistory"] = hist[-50:]
    save_user_preferences(user_id, prefs)

    gene_api.all_genes = gene_api.load_all_genes()
    return {"message": "Upload successful", "rows_written": len(records), "organ": organ_name}


@app.get("/api/user/preferences")
async def get_user_preferences(user_id: str = Depends(require_clerk_user)):
    return load_user_preferences(user_id)


@app.put("/api/user/preferences")
async def put_user_preferences(
    body: UserPreferencesUpdate,
    user_id: str = Depends(require_clerk_user),
):
    data = load_user_preferences(user_id)
    if body.customTheme is not None:
        data["customTheme"] = body.customTheme
    if body.uploadHistoryAppend is not None:
        hist = list(data.get("uploadHistory") or [])
        hist.append(body.uploadHistoryAppend)
        data["uploadHistory"] = hist[-50:]
    save_user_preferences(user_id, data)
    return data


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
        if name is None or (not isinstance(name, str)):
            return None
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

    def create_theme_chart(
        self, df: pd.DataFrame, theme_key: str, chart_title: Optional[str] = None
    ) -> str:
        """Create chart for a specific theme (theme_key matches df['Theme'])."""
        try:
            title = chart_title if chart_title else theme_key
            # Filter GO terms belonging to the current theme
            sub_df = df[df["Theme"] == theme_key].sort_values("Score", ascending=True)

            if sub_df.empty:
                print(f"No data found for theme: {theme_key}")
                return ""

            print(f"Creating chart for theme: {theme_key} with {len(sub_df)} terms")

            # Create plot with better proportions to avoid font stretching
            fig_width = 12
            fig_height = max(6, 0.3 * len(sub_df))  # Reduced height multiplier
            plt.figure(figsize=(fig_width, fig_height))
            
            # Create horizontal bar chart
            bars = plt.barh(sub_df["name"], sub_df["Score"], color="mediumseagreen", height=0.6)
            
            # Improve font settings
            plt.xlabel("-log10(p-value)", size=12)
            plt.title(f"Top GO Terms in Theme: {title}", loc="left", fontsize=14, weight="bold")
            
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

            print(f"Chart created successfully for theme: {theme_key}")
            return img_base64
            
        except Exception as e:
            print(f"Error creating chart for theme {theme_key}: {str(e)}")
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

    @staticmethod
    def _normalize_intersection_genes(raw: Any) -> List[str]:
        """Coerce gProfiler intersections cell to a list of gene symbols."""
        if raw is None or (isinstance(raw, float) and pd.isna(raw)):
            return []
        if isinstance(raw, np.ndarray):
            raw = raw.tolist()
        if isinstance(raw, (tuple, set)):
            raw = list(raw)
        if isinstance(raw, str):
            return [g.strip() for g in re.split(r"[,;\s]+", raw) if g.strip()]
        if not isinstance(raw, list):
            return []
        out: List[str] = []
        for g in raw:
            if isinstance(g, str) and g.strip():
                out.append(g.strip())
            elif isinstance(g, list):
                out.extend(gg.strip() for gg in g if isinstance(gg, str) and gg.strip())
        return out

    def enrich_with_genes(self, genes: List[str], p_thresh: float = 1e-2) -> pd.DataFrame:
        """Enrichment analysis returning gene lists per term (for theme-theme overlap)."""
        if not genes:
            return pd.DataFrame()
        try:
            print(f"Starting enrichment with gene lists for {len(genes)} genes")
            df = self.gp.profile(organism="mmusculus", query=genes, no_evidences=False)
            print(f"GProfiler returned {len(df)} results")
            df = df[df["p_value"] < p_thresh].sort_values("p_value").copy()
            df["Score"] = -np.log10(df["p_value"])
            if "intersections" not in df.columns:
                df["intersections"] = [[]] * len(df)
            else:
                df["intersections"] = df["intersections"].apply(self._normalize_intersection_genes)
            return df
        except Exception as e:
            print(f"Error in enrich_with_genes: {e}")
            import traceback
            traceback.print_exc()
            return pd.DataFrame()

    def get_theme_gene_sets(self, enr_df: pd.DataFrame) -> dict:
        """For each theme, return the set of genes from all GO terms assigned to that theme."""
        if enr_df.empty or "Theme" not in enr_df.columns:
            return {}
        theme_genes = {}
        for _, row in enr_df.iterrows():
            theme = row.get("Theme")
            if pd.isna(theme) or not theme:
                continue
            genes = row.get("intersections", [])
            if not isinstance(genes, list):
                genes = []
            theme_genes.setdefault(theme, set()).update(g for g in genes if isinstance(g, str))
        return theme_genes

    def gene_sets_for_selected_themes(
        self,
        enr_df: pd.DataFrame,
        selected_backend_names: List[str],
        query_genes: Optional[List[str]] = None,
    ) -> Dict[str, set]:
        """
        Build per-theme gene sets for selected themes. Each enriched GO term contributes
        intersection genes to every selected theme whose keywords appear in the term's
        name or description. If gProfiler returns empty intersections, falls back to the
        query gene list when intersection_size > 0, or (last resort) when no theme got any
        genes but terms matched keywords.
        """
        out: Dict[str, set] = {t: set() for t in selected_backend_names}
        if enr_df.empty or not selected_backend_names:
            return out

        qset: List[str] = []
        if query_genes:
            qset = list(
                dict.fromkeys(
                    g.strip() for g in query_genes if isinstance(g, str) and g.strip()
                )
            )

        def row_search_text(row: Any) -> str:
            parts: List[str] = []
            for key in ("name", "description"):
                v = row.get(key)
                if v is None:
                    continue
                if isinstance(v, float) and pd.isna(v):
                    continue
                s = str(v).strip()
                if s:
                    parts.append(s)
            return " ".join(parts).lower()

        def genes_for_row(row: Any) -> List[str]:
            gene_list = self._normalize_intersection_genes(row.get("intersections", []))
            if gene_list:
                return gene_list
            if not qset:
                return []
            isize = row.get("intersection_size")
            try:
                if isize is None or pd.isna(isize):
                    return []
                if int(isize) <= 0:
                    return []
            except (TypeError, ValueError):
                return []
            return list(qset)

        for _, row in enr_df.iterrows():
            low = row_search_text(row)
            if not low:
                continue
            gene_list = genes_for_row(row)
            if not gene_list:
                continue
            for th in selected_backend_names:
                kws = self.themes.get(th, [])
                if not kws:
                    continue
                for kw in kws:
                    if kw in low:
                        out[th].update(gene_list)
                        break

        if qset and all(not s for s in out.values()):
            for _, row in enr_df.iterrows():
                low = row_search_text(row)
                if not low:
                    continue
                for th in selected_backend_names:
                    kws = self.themes.get(th, [])
                    if not kws:
                        continue
                    for kw in kws:
                        if kw in low:
                            out[th].update(qset)
                            break

        return out

    def compute_theme_overlap_network(
        self, theme_genes: dict, theme_list: Optional[List[str]] = None
    ) -> dict:
        """Compute nodes and edges for theme-theme gene overlap network.
        theme_list: if provided, only include these themes (and only edges between them).
        Returns: { nodes: [{id, label}], edges: [{source, target, weight}], min_shared, max_shared }
        """
        themes = theme_list if theme_list is not None else list(theme_genes.keys())
        seen = set()
        ordered: List[str] = []
        for t in themes:
            if t in theme_genes and theme_genes[t] and t not in seen:
                seen.add(t)
                ordered.append(t)
        themes = ordered
        nodes = [{"id": t, "label": t} for t in themes]
        edges = []
        min_shared = None
        max_shared = None
        for i, a in enumerate(themes):
            for b in themes[i + 1 :]:
                shared = len(theme_genes[a] & theme_genes[b])
                if shared > 0:
                    edges.append({"source": a, "target": b, "weight": shared})
                    if min_shared is None or shared < min_shared:
                        min_shared = shared
                    if max_shared is None or shared > max_shared:
                        max_shared = shared
        if min_shared is None:
            min_shared = 0
        if max_shared is None:
            max_shared = 0
        return {
            "nodes": nodes,
            "edges": edges,
            "min_shared": min_shared,
            "max_shared": max_shared,
        }


# UI checkbox ids (Customize / Default theme pages) → backend aggregate theme names used in enrichment.
PREDEFINED_ONTOLOGY_THEME_ID_MAP: Dict[str, str] = {
    "metabolism": "Metabolic re-wiring",
    "cell_cycle": "Cell-cycle & Apoptosis",
    "apoptosis": "Cell-cycle & Apoptosis",
    "immune_response": "Inflammation & immune signaling",
    "development": "Neurotrophic Signaling & Growth Factors",
    "signaling": "Neurotrophic Signaling & Growth Factors",
    "transport": "Extracellular matrix & adhesion",
    "transcription": "Nucleus & Nuclear Processes",
    "translation": "Endoplasmic Reticulum & Golgi",
    "stress_response": "Stress & cytokine response",
    "enzyme_activity": "Metabolic re-wiring",
    "binding": "Metabolic re-wiring",
    "receptor_activity": "Neurotrophic Signaling & Growth Factors",
    "transporter_activity": "Extracellular matrix & adhesion",
    "structural_molecule": "Extracellular matrix & adhesion",
    "membrane": "Membrane & Cell Surface",
    "nucleus": "Nucleus & Nuclear Processes",
    "cytoplasm": "Cytoplasm & Cytoskeleton",
    "mitochondria": "Mitochondria & Energy",
    "endoplasmic_reticulum": "Endoplasmic Reticulum & Golgi",
    "golgi": "Endoplasmic Reticulum & Golgi",
    "cytoskeleton": "Cytoplasm & Cytoskeleton",
}


def build_restricted_ontology_themes_by_id(
    original: Dict[str, List[str]],
    selected_ids: List[str],
    custom_theme_data: List[Dict[str, Any]],
) -> Dict[str, List[str]]:
    """
    Build assign_theme keyword map keyed by UI checkbox id (e.g. transport, custom_123).

    Each selected theme uses only its own keywords from custom_theme_data — no merging
    across themes that share the same backend GO bucket (fixes edited keywords leaking).

    Payload entries: { "id": str, "keywords": list[str], "name": optional }.
    """
    unique_ids = list(dict.fromkeys(selected_ids))
    from_payload: Dict[str, List[str]] = {}
    for ct in custom_theme_data:
        if not isinstance(ct, dict):
            continue
        tid = ct.get("id")
        if not tid or not isinstance(tid, str):
            continue
        kws = ct.get("keywords") or []
        if not isinstance(kws, list):
            continue
        for k in kws:
            if not isinstance(k, str):
                continue
            s = k.strip()
            if not s:
                continue
            from_payload.setdefault(tid, []).append(s)
    for tid in list(from_payload.keys()):
        from_payload[tid] = list(dict.fromkeys(from_payload[tid]))

    restricted: Dict[str, List[str]] = {}
    for tid in unique_ids:
        if tid in from_payload:
            restricted[tid] = from_payload[tid]
        else:
            backend = PREDEFINED_ONTOLOGY_THEME_ID_MAP.get(tid)
            if backend and backend in original:
                restricted[tid] = list(original[backend])
            else:
                restricted[tid] = []
    return restricted


def parse_theme_labels_json(theme_labels: Optional[str]) -> Dict[str, str]:
    """Optional JSON object mapping theme id → display label for charts."""
    if not theme_labels:
        return {}
    s = str(theme_labels).strip()
    if not s:
        return {}
    try:
        d = json.loads(s)
    except json.JSONDecodeError:
        return {}
    if not isinstance(d, dict):
        return {}
    out: Dict[str, str] = {}
    for k, v in d.items():
        if v is None or k is None:
            continue
        ks = str(k).strip()
        vs = str(v).strip()
        if ks and vs:
            out[ks] = vs
    return out


def parse_custom_theme_form_value(custom_themes: Optional[str]) -> List[Dict[str, Any]]:
    """Parse the custom_themes multipart field into a list of dicts (never strings)."""
    if custom_themes is None:
        return []
    s = str(custom_themes).strip()
    if not s:
        return []
    try:
        parsed = json.loads(s)
    except json.JSONDecodeError:
        return []
    if isinstance(parsed, dict):
        return [parsed]
    if isinstance(parsed, list):
        return [x for x in parsed if isinstance(x, dict)]
    return []


def parse_selected_themes_json(themes: str) -> List[str]:
    """Parse the themes multipart field; must be a JSON array."""
    try:
        data = json.loads(themes)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid themes format")
    if not isinstance(data, list):
        raise HTTPException(
            status_code=400,
            detail="Invalid themes format: expected a JSON array of theme ids",
        )
    return [str(x) for x in data]


def try_parse_selected_themes_form(themes: Optional[str]) -> Optional[List[Any]]:
    """Lenient parse for optional theme lists (e.g. overlap network). Invalid input → None."""
    if themes is None:
        return None
    s = str(themes).strip()
    if not s:
        return None
    try:
        data = json.loads(s)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, list):
        return None
    return [str(x) for x in data]


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
async def generate_theme_chart(
    file: UploadFile = File(...), 
    theme: str = Form(...),
    theme_display: str = Form(None),
    custom_themes: str = Form(None)
):
    """Generate chart for a specific theme (`theme` = internal id; optional `theme_display` for title)."""
    if not file.filename.endswith('.txt'):
        raise HTTPException(status_code=400, detail="Only .txt files are supported")
    
    custom_theme_data = parse_custom_theme_form_value(custom_themes)
    if custom_theme_data:
        print(f"Custom themes received for theme-chart: {custom_theme_data}")
    
    # Temporarily scope theme keywords (custom chart: only the requested theme is matchable)
    original_themes = ontology_api.themes.copy()
    try:
        if custom_theme_data:
            ontology_api.themes = build_restricted_ontology_themes_by_id(
                original_themes, [theme], custom_theme_data
            )
            print(f"Theme-chart restricted themes keys: {list(ontology_api.themes.keys())}")
        
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
        print(f"Available themes in data: {enr_df['Theme'].dropna().unique().tolist()}")
        
        # Check if theme exists
        theme_terms = enr_df[enr_df["Theme"] == theme]
        if theme_terms.empty:
            available_themes = enr_df["Theme"].dropna().unique().tolist()
            raise HTTPException(
                status_code=400, 
                detail=f"Theme '{theme}' not found. Available themes: {available_themes}"
            )
        
        # Create chart
        disp = theme_display.strip() if isinstance(theme_display, str) and theme_display.strip() else None
        chart_base64 = ontology_api.create_theme_chart(enr_df, theme, chart_title=disp)
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
    finally:
        # Always restore original themes
        ontology_api.themes = original_themes

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
    
    original_themes = ontology_api.themes.copy()
    try:
        selected_themes = parse_selected_themes_json(themes)
        if not selected_themes:
            raise HTTPException(status_code=400, detail="No themes selected")
        
        print(f"Custom analysis requested for themes: {selected_themes}")
        
        custom_theme_data = parse_custom_theme_form_value(custom_themes)
        if custom_theme_data:
            print(f"Custom themes received: {custom_theme_data}")
        
        unique_ids = list(dict.fromkeys(selected_themes))
        ontology_api.themes = build_restricted_ontology_themes_by_id(
            original_themes, unique_ids, custom_theme_data
        )
        print(f"Custom analyze restricted theme keys: {list(ontology_api.themes.keys())}")
        
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
        
        # Assign themes and filter by selected themes
        enr_df["Theme"] = enr_df["name"].apply(ontology_api.assign_theme)
        
        print(f"Selected theme IDs: {selected_themes}")
        print(f"Available themes in data: {enr_df['Theme'].dropna().unique().tolist()}")
        
        # Filter enrichment results to only include selected themes
        filtered_df = enr_df[enr_df["Theme"].isin(unique_ids)].copy()
        
        print(f"Filtered dataframe shape: {filtered_df.shape}")
        
        if filtered_df.empty:
            return {"results": [], "message": f"No enrichment results found for selected themes: {unique_ids}"}
        
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
        
        return {"results": results}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error analyzing genes: {str(e)}")
    finally:
        ontology_api.themes = original_themes

@app.post("/api/ontology/custom-summary-chart")
async def generate_custom_summary_chart(
    file: UploadFile = File(...), 
    themes: str = Form(...),
    custom_themes: str = Form(None),
    theme_labels: str = Form(None),
):
    """Generate summary chart for custom theme selection"""
    if not file.filename.endswith('.txt'):
        raise HTTPException(status_code=400, detail="Only .txt files are supported")
    
    original_themes = ontology_api.themes.copy()
    try:
        selected_themes = parse_selected_themes_json(themes)
        if not selected_themes:
            raise HTTPException(status_code=400, detail="No themes selected")
        
        print(f"Custom summary chart requested for themes: {selected_themes}")
        
        custom_theme_data = parse_custom_theme_form_value(custom_themes)
        if custom_theme_data:
            print(f"Custom themes received: {custom_theme_data}")
        
        unique_ids = list(dict.fromkeys(selected_themes))
        labels_map = parse_theme_labels_json(theme_labels)
        ontology_api.themes = build_restricted_ontology_themes_by_id(
            original_themes, unique_ids, custom_theme_data
        )
        print(f"Custom summary chart restricted theme keys: {list(ontology_api.themes.keys())}")
        
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
        
        # Assign themes and filter by selected themes
        enr_df["Theme"] = enr_df["name"].apply(ontology_api.assign_theme)
        
        # Filter enrichment results to only include selected themes
        filtered_df = enr_df[enr_df["Theme"].isin(unique_ids)].copy()
        
        if filtered_df.empty:
            raise HTTPException(status_code=400, detail=f"No enrichment results found for selected themes: {unique_ids}")
        
        # Aggregate results for selected themes
        themed = ontology_api.aggregate(filtered_df)
        
        if themed.empty:
            raise HTTPException(status_code=400, detail="No themes could be aggregated")
        
        if labels_map:
            tdf = themed.reset_index()
            id_col = "Theme" if "Theme" in tdf.columns else tdf.columns[0]
            tdf["plot_label"] = tdf[id_col].astype(str).map(lambda tid: labels_map.get(tid, tid))
            themed = (
                tdf.groupby("plot_label", as_index=True)[["Score", "Terms"]]
                .sum()
                .sort_values("Score", ascending=False)
            )
        
        # Generate summary chart
        chart_base64 = ontology_api.create_summary_chart(themed)
        
        if not chart_base64:
            raise HTTPException(status_code=500, detail="Failed to generate custom summary chart")
        
        print("Successfully generated custom summary chart")
        
        return {"chart": chart_base64}
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error generating custom summary chart: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
    finally:
        ontology_api.themes = original_themes

@app.post("/api/ontology/theme-overlap-network")
async def get_theme_overlap_network(
    file: UploadFile = File(...),
    themes: str = Form(None),
    custom_themes: str = Form(None)
):
    """Return theme-theme gene overlap network (nodes, edges with shared gene count) for default or custom themes."""
    if not file.filename.endswith('.txt'):
        raise HTTPException(status_code=400, detail="Only .txt files are supported")
    original_themes = ontology_api.themes.copy()
    try:
        content = await file.read()
        file_content = content.decode('utf-8')
        genes = ontology_api.load_genes_from_file(file_content)
        if not genes:
            raise HTTPException(status_code=400, detail="No valid genes found in file")

        selected_themes = try_parse_selected_themes_form(themes)
        custom_theme_data = parse_custom_theme_form_value(custom_themes)

        selected_names: List[str] = []
        if selected_themes:
            selected_names = list(dict.fromkeys(selected_themes))
            ontology_api.themes = build_restricted_ontology_themes_by_id(
                original_themes, selected_names, custom_theme_data
            )

        enr_df = ontology_api.enrich_with_genes(genes)
        if enr_df.empty:
            raise HTTPException(status_code=400, detail="No significant enrichment results found")

        if selected_themes:
            theme_genes = ontology_api.gene_sets_for_selected_themes(
                enr_df, selected_names, query_genes=genes
            )
            theme_list = selected_names
        else:
            enr_df = enr_df.copy()
            enr_df["Theme"] = enr_df["name"].apply(ontology_api.assign_theme)
            enr_df = enr_df.dropna(subset=["Theme"])
            if enr_df.empty:
                raise HTTPException(
                    status_code=400,
                    detail="No GO terms could be assigned to a theme for overlap network",
                )
            theme_genes = ontology_api.get_theme_gene_sets(enr_df)
            theme_list = None

        network = ontology_api.compute_theme_overlap_network(theme_genes, theme_list=theme_list)
        return network
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        ontology_api.themes = original_themes

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
            "POST /api/ontology/summary-chart": "Generate ontology summary chart",
            "POST /api/ontology/custom-analyze": "Custom theme analysis",
            "POST /api/ontology/custom-summary-chart": "Custom theme summary chart",
            "POST /api/ontology/theme-overlap-network": "Theme-theme gene overlap network (nodes, edges)",
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

# IVCCA Analysis Endpoints
# Store analyzer instances in app state (using simple dict for now)
ivcca_analyzers = {}
two_set_analyzers = {}

@app.post("/api/ivcca/load-data")
async def ivcca_load_data(
    file: UploadFile = File(...), 
    filter_genes: Optional[UploadFile] = File(None)
):
    """
    Load data for IVCCA analysis
    
    Args:
        file: Excel, CSV, or TSV file containing gene expression data
        filter_genes: Optional text file with gene list to filter
    """
    try:
        # Read main data file
        file_ext = file.filename.split('.')[-1].lower()
        if file_ext not in ['xlsx', 'xls', 'csv', 'tsv']:
            raise HTTPException(status_code=400, detail="Unsupported file format")
        
        # Save uploaded file temporarily
        import tempfile
        import os
        with tempfile.NamedTemporaryFile(delete=False, suffix=f'.{file_ext}') as tmp_file:
            content = await file.read()
            tmp_file.write(content)
            tmp_path = tmp_file.name
        
        # Create analyzer instance
        analyzer_id = secrets.token_hex(8)
        analyzer = IVCCAAnalyzer()
        
        # Load filter genes if provided
        filter_gene_list = None
        if filter_genes:
            filter_content = await filter_genes.read()
            filter_gene_list = [g.strip() for g in filter_content.decode('utf-8').split('\n') if g.strip()]
        
        # Load data
        result = analyzer.load_data(tmp_path, filter_gene_list)
        
        # Clean up temp file
        os.unlink(tmp_path)
        
        if result["status"] == "error":
            raise HTTPException(status_code=400, detail=result["message"])
        
        # Store analyzer
        ivcca_analyzers[analyzer_id] = analyzer
        
        return {
            "analyzer_id": analyzer_id,
            **result
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading data: {str(e)}")

@app.post("/api/ivcca/calculate-correlation")
async def ivcca_calculate_correlation(
    analyzer_id: str = Form(...),
    method: str = Form("pearson")
):
    """Calculate correlation matrix"""
    if analyzer_id not in ivcca_analyzers:
        raise HTTPException(status_code=404, detail="Analyzer not found")
    
    analyzer = ivcca_analyzers[analyzer_id]
    result = analyzer.calculate_correlations(method=method)
    
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    
    return result

@app.post("/api/ivcca/sort-matrix")
async def ivcca_sort_matrix(
    analyzer_id: str = Form(...),
    sort_by: str = Form("magnitude")
):
    """Sort correlation matrix"""
    if analyzer_id not in ivcca_analyzers:
        raise HTTPException(status_code=404, detail="Analyzer not found")
    
    analyzer = ivcca_analyzers[analyzer_id]
    result = analyzer.sort_correlation_matrix(sort_by=sort_by)
    
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    
    return result

@app.post("/api/ivcca/heatmap")
async def ivcca_heatmap(
    analyzer_id: str = Form(...),
    sorted: bool = Form(False)
):
    """Generate correlation heatmap"""
    if analyzer_id not in ivcca_analyzers:
        raise HTTPException(status_code=404, detail="Analyzer not found")
    
    analyzer = ivcca_analyzers[analyzer_id]
    try:
        result = analyzer.create_correlation_heatmap(sorted=sorted)
        return {
            "plot_type": result["type"],
            "content": result["content"],
            "sorted": sorted
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating heatmap: {str(e)}")

@app.post("/api/ivcca/histogram")
async def ivcca_histogram(analyzer_id: str = Form(...)):
    """Generate correlation histogram"""
    if analyzer_id not in ivcca_analyzers:
        raise HTTPException(status_code=404, detail="Analyzer not found")
    
    analyzer = ivcca_analyzers[analyzer_id]
    try:
        image_base64 = analyzer.create_correlation_histogram()
        return {"image_base64": image_base64}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating histogram: {str(e)}")

@app.post("/api/ivcca/optimal-clusters")
async def ivcca_optimal_clusters(
    analyzer_id: str = Form(...),
    max_k: int = Form(10)
):
    """Calculate optimal number of clusters with interactive visualization"""
    if analyzer_id not in ivcca_analyzers:
        raise HTTPException(status_code=404, detail="Analyzer not found")
    
    analyzer = ivcca_analyzers[analyzer_id]
    result = analyzer.calculate_optimal_clusters(max_k=max_k)
    
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    
    # Convert plot_image to proper format
    if "plot_image" in result:
        plot_result = result["plot_image"]
        result["plot_image"] = plot_result
    
    return result

@app.post("/api/ivcca/dendrogram")
async def ivcca_dendrogram(
    analyzer_id: str = Form(...),
    threshold: Optional[float] = Form(None),
    method: str = Form("ward")
):
    """Generate dendrogram"""
    if analyzer_id not in ivcca_analyzers:
        raise HTTPException(status_code=404, detail="Analyzer not found")
    
    analyzer = ivcca_analyzers[analyzer_id]
    try:
        image_base64 = analyzer.create_dendrogram(threshold=threshold, method=method)
        return {"image_base64": image_base64}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating dendrogram: {str(e)}")

@app.post("/api/ivcca/pca")
async def ivcca_pca(
    analyzer_id: str = Form(...),
    n_components: int = Form(3),
    n_clusters: str = Form(None)
):
    """Perform PCA analysis with optional clustering visualization"""
    import sys
    # Convert n_clusters from string to int if provided
    n_clusters_int = None
    if n_clusters and n_clusters != "None" and n_clusters != "":
        try:
            n_clusters_int = int(n_clusters)
        except (ValueError, TypeError):
            n_clusters_int = None
    
    print(f"DEBUG API: Received n_clusters={n_clusters} (str), converted to {n_clusters_int} (int)", file=sys.stderr, flush=True)
    print(f"DEBUG API: n_components={n_components}", file=sys.stderr, flush=True)
    if analyzer_id not in ivcca_analyzers:
        raise HTTPException(status_code=404, detail="Analyzer not found")
    
    analyzer = ivcca_analyzers[analyzer_id]
    result = analyzer.perform_pca(n_components=n_components, n_clusters=n_clusters_int)
    
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    
    print(f"DEBUG API: Result keys: {list(result.keys())}", file=sys.stderr, flush=True)
    print(f"DEBUG API: cluster_assignments in result? {'cluster_assignments' in result}", file=sys.stderr, flush=True)
    if "cluster_assignments" in result:
        print(f"DEBUG API: cluster_assignments type: {type(result['cluster_assignments'])}", file=sys.stderr, flush=True)
        if isinstance(result['cluster_assignments'], dict):
            print(f"DEBUG API: cluster_assignments keys: {list(result['cluster_assignments'].keys())}", file=sys.stderr, flush=True)
            print(f"DEBUG API: First cluster sample: {list(result['cluster_assignments'].values())[0][:5] if result['cluster_assignments'] else 'empty'}", file=sys.stderr, flush=True)
    
    return result

@app.post("/api/ivcca/tsne")
async def ivcca_tsne(
    analyzer_id: str = Form(...),
    n_components: int = Form(2),
    perplexity: float = Form(30.0),
    n_clusters: Optional[int] = Form(None)
):
    """Perform t-SNE analysis with optional clustering visualization"""
    if analyzer_id not in ivcca_analyzers:
        raise HTTPException(status_code=404, detail="Analyzer not found")
    
    analyzer = ivcca_analyzers[analyzer_id]
    result = analyzer.perform_tsne(n_components=n_components, perplexity=perplexity, n_clusters=n_clusters)
    
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    
    return result

@app.post("/api/ivcca/single-pathway")
async def ivcca_single_pathway(
    analyzer_id: str = Form(...),
    pathway_file: UploadFile = File(...)
):
    """Analyze single pathway"""
    if analyzer_id not in ivcca_analyzers:
        raise HTTPException(status_code=404, detail="Analyzer not found")
    
    analyzer = ivcca_analyzers[analyzer_id]
    
    # Read pathway genes
    content = await pathway_file.read()
    pathway_genes = [g.strip() for g in content.decode('utf-8').split('\n') if g.strip()]
    
    result = analyzer.analyze_single_pathway(pathway_genes)
    
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    
    return result

@app.post("/api/ivcca/compare-pathways")
async def ivcca_compare_pathways(
    analyzer_id: str = Form(...),
    pathway1_file: UploadFile = File(...),
    pathway2_file: UploadFile = File(...)
):
    """Compare two pathways"""
    if analyzer_id not in ivcca_analyzers:
        raise HTTPException(status_code=404, detail="Analyzer not found")
    
    analyzer = ivcca_analyzers[analyzer_id]
    
    # Read pathway genes
    content1 = await pathway1_file.read()
    content2 = await pathway2_file.read()
    
    pathway1_genes = [g.strip() for g in content1.decode('utf-8').split('\n') if g.strip()]
    pathway2_genes = [g.strip() for g in content2.decode('utf-8').split('\n') if g.strip()]
    
    result = analyzer.compare_pathways(pathway1_genes, pathway2_genes)
    
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    
    return result

# Two-Set Correlation Endpoints
@app.post("/api/ivcca/two-set/load-data-a")
async def two_set_load_data_a(file: UploadFile = File(...)):
    """Load first dataset for two-set correlation analysis"""
    try:
        file_ext = file.filename.split('.')[-1].lower()
        if file_ext not in ['xlsx', 'xls', 'csv']:
            raise HTTPException(status_code=400, detail="Unsupported file format")
        
        import tempfile
        import os
        with tempfile.NamedTemporaryFile(delete=False, suffix=f'.{file_ext}') as tmp_file:
            content = await file.read()
            tmp_file.write(content)
            tmp_path = tmp_file.name
        
        analyzer_id = secrets.token_hex(8)
        analyzer = TwoSetCorrelation()
        
        result = analyzer.load_data_a(tmp_path)
        os.unlink(tmp_path)
        
        if result["status"] == "error":
            raise HTTPException(status_code=400, detail=result["message"])
        
        two_set_analyzers[analyzer_id] = analyzer
        
        return {
            "analyzer_id": analyzer_id,
            **result
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading data: {str(e)}")

@app.post("/api/ivcca/two-set/load-data-b")
async def two_set_load_data_b(
    analyzer_id: str = Form(...),
    file: UploadFile = File(...)
):
    """Load second dataset for two-set correlation analysis"""
    if analyzer_id not in two_set_analyzers:
        raise HTTPException(status_code=404, detail="Analyzer not found")
    
    analyzer = two_set_analyzers[analyzer_id]
    
    try:
        file_ext = file.filename.split('.')[-1].lower()
        if file_ext not in ['xlsx', 'xls', 'csv']:
            raise HTTPException(status_code=400, detail="Unsupported file format")
        
        import tempfile
        import os
        with tempfile.NamedTemporaryFile(delete=False, suffix=f'.{file_ext}') as tmp_file:
            content = await file.read()
            tmp_file.write(content)
            tmp_path = tmp_file.name
        
        result = analyzer.load_data_b(tmp_path)
        os.unlink(tmp_path)
        
        if result["status"] == "error":
            raise HTTPException(status_code=400, detail=result["message"])
        
        return {
            "analyzer_id": analyzer_id,
            **result
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading data: {str(e)}")

@app.post("/api/ivcca/two-set/calculate")
async def two_set_calculate(analyzer_id: str = Form(...)):
    """Calculate correlation between two datasets"""
    if analyzer_id not in two_set_analyzers:
        raise HTTPException(status_code=404, detail="Analyzer not found")
    
    analyzer = two_set_analyzers[analyzer_id]
    result = analyzer.calculate_correlation()
    
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    
    return result

@app.post("/api/ivcca/two-set/heatmap")
async def two_set_heatmap(
    analyzer_id: str = Form(...),
    sorted: bool = Form(False)
):
    """Generate heatmap for two-set correlation"""
    if analyzer_id not in two_set_analyzers:
        raise HTTPException(status_code=404, detail="Analyzer not found")
    
    analyzer = two_set_analyzers[analyzer_id]
    try:
        image_base64 = analyzer.create_heatmap(sorted=sorted)
        return {"image_base64": image_base64}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating heatmap: {str(e)}")

@app.post("/api/ivcca/gene-to-genes")
async def ivcca_gene_to_genes(
    analyzer_id: str = Form(...),
    single_gene: str = Form(...),
    target_genes_file: UploadFile = File(...)
):
    """Calculate correlation between a single gene and a group of genes"""
    if analyzer_id not in ivcca_analyzers:
        raise HTTPException(status_code=404, detail="Analyzer not found")
    
    analyzer = ivcca_analyzers[analyzer_id]
    
    try:
        # Read target genes from file
        content = await target_genes_file.read()
        target_genes = [g.strip() for g in content.decode('utf-8').split('\n') if g.strip()]
        
        result = analyzer.gene_to_genes(single_gene, target_genes)
        
        if result["status"] == "error":
            raise HTTPException(status_code=400, detail=result["message"])
        
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")

@app.post("/api/ivcca/gene-to-pathways")
async def ivcca_gene_to_pathways(
    analyzer_id: str = Form(...),
    single_gene: str = Form(...),
    pathway_files: List[UploadFile] = File(...)
):
    """Calculate correlation between a single gene and multiple pathways"""
    if analyzer_id not in ivcca_analyzers:
        raise HTTPException(status_code=404, detail="Analyzer not found")
    
    analyzer = ivcca_analyzers[analyzer_id]
    
    try:
        pathway_files_list = []
        pathway_genes_list = []
        
        for pathway_file in pathway_files:
            pathway_files_list.append(pathway_file.filename)
            content = await pathway_file.read()
            pathway_genes = [g.strip() for g in content.decode('utf-8').split('\n') if g.strip()]
            pathway_genes_list.append(pathway_genes)
        
        result = analyzer.gene_to_pathways(single_gene, pathway_files_list, pathway_genes_list)
        
        if result["status"] == "error":
            raise HTTPException(status_code=400, detail=result["message"])
        
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")

@app.post("/api/ivcca/multi-pathway")
async def ivcca_multi_pathway(
    analyzer_id: str = Form(...),
    pathway_files: List[UploadFile] = File(...),
    min_genes_threshold: int = Form(5),
    sorted_matrix: Optional[str] = Form(None)
):
    """Multi-pathway analysis with CECI calculation"""
    if analyzer_id not in ivcca_analyzers:
        raise HTTPException(status_code=404, detail="Analyzer not found")
    
    analyzer = ivcca_analyzers[analyzer_id]
    
    try:
        pathway_files_list = []
        pathway_genes_list = []
        
        for pathway_file in pathway_files:
            pathway_files_list.append(pathway_file.filename)
            content = await pathway_file.read()
            pathway_genes = [g.strip() for g in content.decode('utf-8').split('\n') if g.strip()]
            pathway_genes_list.append(pathway_genes)
        
        # Get sorted data if provided
        sorted_genes = None
        sorted_correlations = None
        if sorted_matrix == "true":
            sort_result = analyzer.sort_correlation_matrix()
            if sort_result["status"] == "success":
                sorted_genes = sort_result["sorted_gene_names"]
                sorted_correlations = sort_result["sorted_scores"]
        
        result = analyzer.multi_pathway_analysis(
            pathway_files_list, 
            pathway_genes_list,
            sorted_genes=sorted_genes,
            sorted_correlations=sorted_correlations,
            min_genes_threshold=min_genes_threshold
        )
        
        if result["status"] == "error":
            raise HTTPException(status_code=400, detail=result["message"])
        
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")

@app.post("/api/ivcca/venn-diagram")
async def ivcca_venn_diagram(
    analyzer_id: str = Form(...),
    pathway1_file: UploadFile = File(...),
    pathway2_file: UploadFile = File(...)
):
    """Create Venn diagram for two pathways"""
    if analyzer_id not in ivcca_analyzers:
        raise HTTPException(status_code=404, detail="Analyzer not found")
    
    analyzer = ivcca_analyzers[analyzer_id]
    
    try:
        # Read pathway genes
        content1 = await pathway1_file.read()
        pathway1_genes = [g.strip() for g in content1.decode('utf-8').split('\n') if g.strip()]
        
        content2 = await pathway2_file.read()
        pathway2_genes = [g.strip() for g in content2.decode('utf-8').split('\n') if g.strip()]
        
        result = analyzer.create_venn_diagram(pathway1_genes, pathway2_genes)
        
        if result["status"] == "error":
            raise HTTPException(status_code=400, detail=result["message"])
        
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")

@app.post("/api/ivcca/network-analysis")
async def ivcca_network_analysis(
    analyzer_id: str = Form(...),
    pathway_file: Optional[UploadFile] = File(None),
    threshold: float = Form(0.75),
    plot_type: str = Form("2D")
):
    """Create network graph from correlation matrix"""
    if analyzer_id not in ivcca_analyzers:
        raise HTTPException(status_code=404, detail="Analyzer not found")
    
    analyzer = ivcca_analyzers[analyzer_id]
    
    try:
        pathway_genes = None
        if pathway_file:
            content = await pathway_file.read()
            pathway_genes = [g.strip() for g in content.decode('utf-8').split('\n') if g.strip()]
        
        if plot_type not in ['2D', '3D']:
            raise HTTPException(status_code=400, detail="plot_type must be '2D' or '3D'")
        
        result = analyzer.create_network_graph(
            pathway_genes=pathway_genes,
            threshold=threshold,
            plot_type=plot_type
        )
        
        if result["status"] == "error":
            raise HTTPException(status_code=400, detail=result["message"])
        
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")

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
    
    # 与 Docker / Coolify 一致：可用环境变量 PORT 覆盖（默认 8000）
    port = int(os.getenv("PORT", "8000"))
    import socket
    
    def is_port_available(port):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('localhost', port))
                return True
            except OSError:
                return False
    
    # 检查端口是否可用
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