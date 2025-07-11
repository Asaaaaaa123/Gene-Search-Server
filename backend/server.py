from fastapi import FastAPI, HTTPException, Query, Depends, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend
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
if not MONGODB_URI:
    raise ValueError("MONGODB_URI environment variable is required")

try:
    client = MongoClient(MONGODB_URI)
    # Test the connection
    client.admin.command('ping')
    print("Successfully connected to MongoDB")
    db = client.gene_search_db
    collection = db.gene_data
except ConnectionFailure as e:
    print(f"Failed to connect to MongoDB: {e}")
    raise

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
            "POST /api/gene/add": "Add a new gene to the database"
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 