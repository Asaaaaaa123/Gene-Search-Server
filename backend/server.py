from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
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

app = FastAPI(title="Gene Expression Search API", version="1.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class GeneSearchAPI:
    def __init__(self):
        self.data = self.load_data()
        self.all_genes = self.load_all_genes()
    
    def load_data(self) -> Dict[str, pd.DataFrame]:
        """Load data from Excel files in the data directory"""
        data = {}
        data_dir = "data"
        if os.path.exists(data_dir):
            excel_files = glob.glob(os.path.join(data_dir, "*.xlsx"))
            for file_path in excel_files:
                organ_name = os.path.splitext(os.path.basename(file_path))[0]
                try:
                    data[organ_name] = pd.read_excel(file_path)
                except Exception as e:
                    print(f"Error loading {file_path}: {e}")
        return data
    
    def load_all_genes(self) -> List[str]:
        """Load all unique gene symbols from all Excel files"""
        all_genes = set()
        for organ_data in self.data.values():
            if 'Gene_symbol' in organ_data.columns:
                all_genes.update(organ_data['Gene_symbol'].dropna().unique())
        return sorted(list(all_genes))
    
    def search_gene_data(self, gene_symbol: str) -> List[Dict]:
        """Search for a gene and return results"""
        results = []
        for organ_name, organ_data in self.data.items():
            if 'Gene_symbol' in organ_data.columns:
                matches = organ_data[organ_data['Gene_symbol'].str.lower() == gene_symbol.lower()]
                if not matches.empty:
                    row = matches.iloc[0]
                    results.append({
                        'organ': organ_name,
                        'gene_symbol': row.get('Gene_symbol', ''),
                        'gene_name': row.get('Gene_name', ''),
                        'p_value': row.get('P_value_10_mgkg_vs_control', ''),
                        'fdr_step_up': row.get('FDR_step_up_10_mgkg_vs_control', ''),
                        'ratio': row.get('Ratio_10_mgkg_vs_control', ''),
                        'fold_change': row.get('Fold_change_10_mgkg_vs_control', ''),
                        'lsmean_10mgkg': row.get('LSMean10mgkg_10_mgkg_vs_control', ''),
                        'lsmean_control': row.get('LSMeancontrol_10_mgkg_vs_control', '')
                    })
        return results
    
    def create_fold_change_plot(self, gene_symbol: str) -> str:
        """Create fold change plot and return as base64 string"""
        organs = []
        fold_changes = []
        colors = []
        
        for organ_name, organ_data in self.data.items():
            if 'Gene_symbol' in organ_data.columns:
                matches = organ_data[organ_data['Gene_symbol'].str.lower() == gene_symbol.lower()]
                if not matches.empty:
                    row = matches.iloc[0]
                    fold_change = row.get('Fold_change_10_mgkg_vs_control', 0)
                    
                    organs.append(organ_name)
                    fold_changes.append(fold_change)
                    
                    # Color based on fold change sign
                    if fold_change >= 0:
                        colors.append('blue')
                    else:
                        colors.append('red')
        
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
        organs = []
        lsmeans = []
        
        for organ_name, organ_data in self.data.items():
            if 'Gene_symbol' in organ_data.columns:
                matches = organ_data[organ_data['Gene_symbol'].str.lower() == gene_symbol.lower()]
                if not matches.empty:
                    row = matches.iloc[0]
                    lsmean = row.get('LSMeancontrol_10_mgkg_vs_control', 0)
                    organs.append(organ_name)
                    lsmeans.append(lsmean)
        
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
        organs = []
        lsmeans = []
        
        for organ_name, organ_data in self.data.items():
            if 'Gene_symbol' in organ_data.columns:
                matches = organ_data[organ_data['Gene_symbol'].str.lower() == gene_symbol.lower()]
                if not matches.empty:
                    row = matches.iloc[0]
                    lsmean = row.get('LSMean10mgkg_10_mgkg_vs_control', 0)
                    organs.append(organ_name)
                    lsmeans.append(lsmean)
        
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
            "GET /api/gene/symbol/showLSMeanTenMgKg?gene_symbol=<symbol>": "Get LSmean(10mg/kg) plot (base64)"
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 