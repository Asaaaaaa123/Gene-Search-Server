import tkinter as tk
from tkinter import ttk, messagebox
import pandas as pd
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
import os
import glob
from typing import Dict, List, Optional
import numpy as np

class GeneSearchApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Gene Expression Search (Berezin Lab)")
        self.root.geometry("800x600")
        
        # Load data
        self.data = self.load_data()
        self.all_genes = self.load_all_genes()
        
        # Create GUI elements
        self.create_widgets()
        
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
    
    def create_widgets(self):
        """Create the GUI widgets"""
        # Gene input section
        input_frame = ttk.Frame(self.root)
        input_frame.pack(fill='x', padx=20, pady=10)
        
        # Gene symbol dropdown
        ttk.Label(input_frame, text="Gene Symbol:").pack(side='left')
        self.gene_var = tk.StringVar()
        self.gene_dropdown = ttk.Combobox(input_frame, textvariable=self.gene_var, 
                                         values=self.all_genes, width=20)
        self.gene_dropdown.pack(side='left', padx=(10, 0))
        self.gene_dropdown.bind('<KeyRelease>', self.filter_genes)
        
        # Search button
        ttk.Button(input_frame, text="Search", 
                  command=self.search_gene).pack(side='left', padx=(10, 0))
        
        # Additional buttons
        ttk.Button(input_frame, text="Show Fold Change", 
                  command=self.show_fold_change).pack(side='left', padx=(10, 0))
        ttk.Button(input_frame, text="Show LSmean (Control)", 
                  command=self.show_lsmean_control).pack(side='left', padx=(10, 0))
        ttk.Button(input_frame, text="Show LSmean (10mg/kg)", 
                  command=self.show_lsmean_10mgkg).pack(side='left', padx=(10, 0))
        
        # Results table
        table_frame = ttk.Frame(self.root)
        table_frame.pack(fill='both', expand=True, padx=20, pady=10)
        
        # Create treeview for results
        columns = ('Organ', 'Gene Symbol', 'Gene Name', 'P-value', 'FDR Step Up', 
                  'Ratio', 'Fold Change', 'LSMean (10mg/kg)', 'LSMean (Control)')
        self.tree = ttk.Treeview(table_frame, columns=columns, show='headings', height=10)
        
        # Set column headings
        for col in columns:
            self.tree.heading(col, text=col)
            self.tree.column(col, width=100)
        
        # Add scrollbar
        scrollbar = ttk.Scrollbar(table_frame, orient='vertical', command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)
        
        self.tree.pack(side='left', fill='both', expand=True)
        scrollbar.pack(side='right', fill='y')
        
        # Graph area
        self.fig, self.ax = plt.subplots(figsize=(10, 6))
        self.canvas = FigureCanvasTkAgg(self.fig, self.root)
        self.canvas.get_tk_widget().pack(fill='both', expand=True, padx=20, pady=10)
        
    def filter_genes(self, event=None):
        """Filter genes in dropdown based on input"""
        search_term = self.gene_var.get().lower()
        filtered_genes = [gene for gene in self.all_genes if search_term in gene.lower()]
        self.gene_dropdown['values'] = filtered_genes
    
    def search_gene(self):
        """Search for a gene and display results in table"""
        gene_symbol = self.gene_var.get()
        if not gene_symbol:
            messagebox.showwarning("Warning", "Please enter a gene symbol")
            return
        
        # Clear existing items
        for item in self.tree.get_children():
            self.tree.delete(item)
        
        results = []
        for organ_name, organ_data in self.data.items():
            if 'Gene_symbol' in organ_data.columns:
                matches = organ_data[organ_data['Gene_symbol'].str.lower() == gene_symbol.lower()]
                if not matches.empty:
                    row = matches.iloc[0]
                    results.append((
                        organ_name,
                        row.get('Gene_symbol', ''),
                        row.get('Gene_name', ''),
                        row.get('P_value_10_mgkg_vs_control', ''),
                        row.get('FDR_step_up_10_mgkg_vs_control', ''),
                        row.get('Ratio_10_mgkg_vs_control', ''),
                        row.get('Fold_change_10_mgkg_vs_control', ''),
                        row.get('LSMean10mgkg_10_mgkg_vs_control', ''),
                        row.get('LSMeancontrol_10_mgkg_vs_control', '')
                    ))
        
        if not results:
            self.tree.insert('', 'end', values=('No Results', '', '', '', '', '', '', '', ''))
        else:
            for result in results:
                self.tree.insert('', 'end', values=result)
    
    def show_fold_change(self):
        """Show fold change vs organ plot"""
        gene_symbol = self.gene_var.get()
        if not gene_symbol:
            messagebox.showwarning("Warning", "Please enter a gene symbol")
            return
        
        organs = []
        fold_changes = []
        fdr_values = []
        colors = []
        
        for organ_name, organ_data in self.data.items():
            if 'Gene_symbol' in organ_data.columns:
                matches = organ_data[organ_data['Gene_symbol'].str.lower() == gene_symbol.lower()]
                if not matches.empty:
                    row = matches.iloc[0]
                    fold_change = row.get('Fold_change_10_mgkg_vs_control', 0)
                    fdr = row.get('FDR_step_up_10_mgkg_vs_control', 0)
                    
                    organs.append(organ_name)
                    fold_changes.append(fold_change)
                    fdr_values.append(fdr)
                    
                    # Color based on fold change sign
                    if fold_change >= 0:
                        colors.append('blue')
                    else:
                        colors.append('red')
        
        if not organs:
            self.ax.clear()
            self.ax.set_title('No results found')
            self.canvas.draw()
            return
        
        # Create the plot
        self.ax.clear()
        bars = self.ax.bar(organs, fold_changes, color=colors)
        self.ax.set_title(f'Fold Change for {gene_symbol}')
        self.ax.set_xlabel('Organ')
        self.ax.set_ylabel('Fold Change')
        self.ax.tick_params(axis='x', rotation=45)
        self.ax.grid(True, axis='y')
        plt.tight_layout()
        self.canvas.draw()
    
    def show_lsmean_control(self):
        """Show LSmean(Control) vs organ plot"""
        gene_symbol = self.gene_var.get()
        if not gene_symbol:
            messagebox.showwarning("Warning", "Please enter a gene symbol")
            return
        
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
            self.ax.clear()
            self.ax.set_title('No results found')
            self.canvas.draw()
            return
        
        # Create the plot
        self.ax.clear()
        self.ax.bar(organs, lsmeans, color='blue')
        self.ax.set_title(f'LSmean(Control) for {gene_symbol}')
        self.ax.set_xlabel('Organ')
        self.ax.set_ylabel('LSmean (Control)')
        self.ax.tick_params(axis='x', rotation=45)
        self.ax.grid(True, axis='y')
        plt.tight_layout()
        self.canvas.draw()
    
    def show_lsmean_10mgkg(self):
        """Show LSmean(10mg/kg) vs organ plot"""
        gene_symbol = self.gene_var.get()
        if not gene_symbol:
            messagebox.showwarning("Warning", "Please enter a gene symbol")
            return
        
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
            self.ax.clear()
            self.ax.set_title('No results found')
            self.canvas.draw()
            return
        
        # Create the plot
        self.ax.clear()
        self.ax.bar(organs, lsmeans, color='green')
        self.ax.set_title(f'LSmean(10mg/kg) for {gene_symbol}')
        self.ax.set_xlabel('Organ')
        self.ax.set_ylabel('LSmean (10mg/kg)')
        self.ax.tick_params(axis='x', rotation=45)
        self.ax.grid(True, axis='y')
        plt.tight_layout()
        self.canvas.draw()

def main():
    """Main function to run the application"""
    root = tk.Tk()
    app = GeneSearchApp(root)
    root.mainloop()

if __name__ == "__main__":
    main() 