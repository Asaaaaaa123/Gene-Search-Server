"""
IVCCA Core Module - Python Implementation
Inter-Variability Cross Correlation Analysis
Converted from MATLAB by Berezin Lab (2023-2024)

This module provides the core functionality for IVCCA analysis including:
- Data loading and processing
- Correlation matrix calculation
- Sorting and visualization
- Clustering analysis
- Dimensionality reduction (PCA, t-SNE)
- Pathway analysis
- Network analysis
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from scipy.stats import pearsonr
from scipy.cluster.hierarchy import dendrogram, linkage
from sklearn.decomposition import PCA
from sklearn.manifold import TSNE
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from scipy.spatial.distance import cosine
import base64
import io
import json
from typing import Dict, List, Optional, Tuple
import warnings
warnings.filterwarnings('ignore')

# Import plotly for interactive plots
try:
    import plotly.graph_objects as go
    import plotly.express as px
    from plotly.subplots import make_subplots
    PLOTLY_AVAILABLE = True
except ImportError:
    PLOTLY_AVAILABLE = False
    print("Warning: plotly not available. Interactive plots will not work.")

class IVCCAAnalyzer:
    """Main IVCCA Analysis Class"""
    
    def __init__(self):
        self.data = None
        self.gene_names = None
        self.sample_names = None
        self.correlation_matrix = None
        self.data_loaded = False
        self.correlation_calculated = False
        
    def load_data(self, file_path: str, filter_genes: Optional[List[str]] = None) -> Dict:
        """
        Load data from Excel, CSV, or TSV file
        
        Args:
            file_path: Path to data file
            filter_genes: Optional list of gene names to filter
            
        Returns:
            Dictionary with status and message
        """
        try:
            # Determine file type
            if file_path.endswith('.xlsx') or file_path.endswith('.xls'):
                df = pd.read_excel(file_path)
            elif file_path.endswith('.csv'):
                df = pd.read_csv(file_path)
            elif file_path.endswith('.tsv'):
                df = pd.read_csv(file_path, sep='\t')
            else:
                raise ValueError("Unsupported file format. Use .xlsx, .csv, or .tsv")
            
            # Extract sample names (first column)
            if df.empty:
                raise ValueError("Data file is empty")
                
            sample_col = df.columns[0]
            self.sample_names = df[sample_col].tolist()
            
            # Extract gene names (remaining columns)
            self.gene_names = [col for col in df.columns[1:]]
            
            # Extract data (excluding first column)
            self.data = df.iloc[:, 1:].values
            
            # Filter genes if provided
            if filter_genes:
                gene_indices = [i for i, gene in enumerate(self.gene_names) if gene in filter_genes]
                if gene_indices:
                    self.data = self.data[:, gene_indices]
                    self.gene_names = [self.gene_names[i] for i in gene_indices]
                else:
                    raise ValueError("No matching genes found in filter list")
            
            # Convert to numeric, handling any non-numeric values
            self.data = pd.DataFrame(self.data).apply(pd.to_numeric, errors='coerce').values
            
            # Check for NaN values
            nan_count = np.isnan(self.data).sum()
            if nan_count > 0:
                print(f"Warning: Found {nan_count} NaN values in data")
            
            self.data_loaded = True
            self.correlation_calculated = False
            
            # Prepare preview using full dataset (no sampling)
            preview_columns = [sample_col] + self.gene_names
            preview_df = df.loc[:, preview_columns]
            
            preview_rows = []
            for _, row in preview_df.iterrows():
                formatted_row = []
                for value in row:
                    if pd.isna(value):
                        formatted_row.append(None)
                    elif isinstance(value, (np.floating, float)):
                        formatted_row.append(float(value))
                    elif isinstance(value, (np.integer, int)):
                        formatted_row.append(int(value))
                    else:
                        formatted_row.append(str(value))
                preview_rows.append(formatted_row)
            
            preview = {
                "columns": [str(col) for col in preview_columns],
                "rows": preview_rows
            }
            
            return {
                "status": "success",
                "message": f"Data loaded successfully: {self.data.shape[0]} samples x {self.data.shape[1]} genes",
                "n_samples": self.data.shape[0],
                "n_genes": self.data.shape[1],
                "gene_names": self.gene_names[:10],  # Retained for backwards compatibility
                "preview": preview
            }
            
        except Exception as e:
            self.data_loaded = False
            return {
                "status": "error",
                "message": f"Error loading data: {str(e)}"
            }
    
    def calculate_correlations(self, method: str = 'pearson') -> Dict:
        """
        Calculate correlation matrix
        
        Args:
            method: Correlation method ('pearson', 'spearman', 'kendall')
            
        Returns:
            Dictionary with status and correlation matrix info
        """
        if not self.data_loaded:
            return {"status": "error", "message": "Data not loaded. Please load data first."}
        
        try:
            # Calculate correlation matrix
            # Handle NaN values by filling with 0 or removing columns/rows with too many NaNs
            data_df = pd.DataFrame(self.data, columns=self.gene_names)
            
            if method == 'pearson':
                self.correlation_matrix = data_df.corr(method='pearson').values
            elif method == 'spearman':
                self.correlation_matrix = data_df.corr(method='spearman').values
            else:
                self.correlation_matrix = data_df.corr(method='kendall').values
            
            # Replace NaN values with 0 (or could use pairwise deletion)
            self.correlation_matrix = np.nan_to_num(self.correlation_matrix, nan=0.0)
            
            self.correlation_calculated = True
            
            # Calculate statistics
            corr_values = self.correlation_matrix[np.triu_indices_from(self.correlation_matrix, k=1)]
            stats = {
                "mean": float(np.mean(corr_values)),
                "std": float(np.std(corr_values)),
                "min": float(np.min(corr_values)),
                "max": float(np.max(corr_values)),
                "median": float(np.median(corr_values))
            }
            
            return {
                "status": "success",
                "message": "Correlation matrix calculated successfully",
                "matrix_size": self.correlation_matrix.shape,
                "statistics": stats
            }
            
        except Exception as e:
            return {
                "status": "error",
                "message": f"Error calculating correlations: {str(e)}"
            }
    
    def sort_correlation_matrix(self, sort_by: str = 'magnitude') -> Dict:
        """
        Sort correlation matrix by average correlation magnitude
        
        Args:
            sort_by: Sorting method ('magnitude', 'mean', 'max')
            
        Returns:
            Dictionary with sorted matrix and indices
        """
        if not self.correlation_calculated:
            return {"status": "error", "message": "Correlation matrix not calculated"}
        
        try:
            # Calculate average correlation for each gene (excluding diagonal)
            abs_corr = np.abs(self.correlation_matrix)
            np.fill_diagonal(abs_corr, 0)  # Exclude diagonal
            
            if sort_by == 'magnitude' or sort_by == 'mean':
                gene_scores = np.mean(abs_corr, axis=1)
            elif sort_by == 'max':
                gene_scores = np.max(abs_corr, axis=1)
            else:
                gene_scores = np.mean(abs_corr, axis=1)
            
            # Sort indices
            sorted_indices = np.argsort(gene_scores)[::-1]  # Descending order
            
            # Sort correlation matrix and gene names
            sorted_matrix = self.correlation_matrix[sorted_indices][:, sorted_indices]
            sorted_gene_names = [self.gene_names[i] for i in sorted_indices]
            sorted_scores = gene_scores[sorted_indices]
            
            return {
                "status": "success",
                "message": "Matrix sorted successfully",
                "sorted_matrix": sorted_matrix.tolist(),
                "sorted_gene_names": sorted_gene_names,
                "sorted_scores": sorted_scores.tolist(),
                "sorted_indices": sorted_indices.tolist()
            }
            
        except Exception as e:
            return {
                "status": "error",
                "message": f"Error sorting matrix: {str(e)}"
            }
    
    def create_correlation_heatmap(self, sorted: bool = False, figsize: Tuple[int, int] = (12, 10)) -> Dict:
        """
        Create correlation heatmap visualization
        Only shows lower triangle, upper triangle is masked in gray
        
        Args:
            sorted: Whether to use sorted matrix
            figsize: Figure size tuple
            
        Returns:
            Base64 encoded image string
        """
        if not self.correlation_calculated:
            raise ValueError("Correlation matrix not calculated")
        
        try:
            if sorted:
                sort_result = self.sort_correlation_matrix()
                if sort_result["status"] == "error":
                    raise ValueError(sort_result["message"])
                matrix = np.array(sort_result["sorted_matrix"])
                gene_names = sort_result["sorted_gene_names"]
            else:
                matrix = self.correlation_matrix
                gene_names = self.gene_names
            
            gene_count = len(gene_names)
            if gene_count == 0:
                raise ValueError("No genes available for heatmap")

            # Create mask for upper triangle (to hide it in heatmap)
            mask = np.triu(np.ones_like(matrix, dtype=bool), k=1)
            
            # Different color schemes for sorted vs unsorted
            if sorted:
                # For sorted heatmap: use absolute values with high contrast colormap
                # No center at 0, just show magnitude with high contrast
                matrix_to_plot = np.abs(matrix)  # Use absolute values for sorted
                vmin = 0
                vmax = 1
            else:
                # For unsorted heatmap: use diverging colormap centered at 0
                matrix_to_plot = matrix
                vmin = -1
                vmax = 1
            
            # Create interactive heatmap using plotly
            if PLOTLY_AVAILABLE:
                # Create mask for display (only lower triangle)
                display_matrix = matrix_to_plot.copy()
                display_matrix[mask] = np.nan  # Hide upper triangle
                
                # Limit gene names for display if too many
                max_display_genes = 200
                if gene_count > max_display_genes:
                    display_matrix = display_matrix[:max_display_genes, :max_display_genes]
                    display_gene_names = gene_names[:max_display_genes]
                else:
                    display_gene_names = gene_names
                
                # Create interactive heatmap
                if not sorted:
                    colorscale = 'RdBu'
                    zmid = 0
                else:
                    colorscale = [[0, 'white'], [0.2, '#FFFF00'], [0.4, '#FFA500'], [0.6, '#FF4500'], [0.8, '#FF0000'], [1, '#8B0000']]
                    zmid = None
                
                fig = go.Figure(data=go.Heatmap(
                    z=display_matrix,
                    x=display_gene_names,
                    y=display_gene_names,
                    colorscale=colorscale,
                    zmid=zmid,
                    zmin=vmin,
                    zmax=vmax,
                    colorbar=dict(title='Correlation Coefficient' if not sorted else 'Absolute Correlation'),
                    hovertemplate='<b>%{y} vs %{x}</b><br>Correlation: %{z:.3f}<extra></extra>',
                    showscale=True
                ))
                
                fig.update_layout(
                    title='Correlation Matrix Heatmap (Lower Triangle)' if not sorted else 'Sorted Correlation Matrix Heatmap (Lower Triangle)',
                    xaxis_title='Genes',
                    yaxis_title='Genes',
                    height=max(600, min(gene_count * 5, 1200)),
                    width=max(800, min(gene_count * 5, 1200)),
                    template='plotly_white'
                )
                
                # Return plotly JSON data instead of HTML for React rendering
                plot_data = fig.to_json()
                return {"type": "plotly", "content": plot_data, "div_id": f'heatmap_{"sorted" if sorted else "unsorted"}'}
            else:
                # Fallback to static image using matplotlib
                from matplotlib.colors import LinearSegmentedColormap, TwoSlopeNorm
                
                dynamic_size = max(8, min(0.35 * gene_count, 60))
                fig, ax = plt.subplots(figsize=(dynamic_size, dynamic_size), dpi=150)
                
                if sorted:
                    # High contrast colormap: white -> yellow -> orange -> red -> dark red
                    colors_sorted = ['#FFFFFF', '#FFFF00', '#FFA500', '#FF4500', '#FF0000', '#8B0000', '#4B0000']
                    n_bins = 256
                    cmap = LinearSegmentedColormap.from_list('custom_sorted_high_contrast', colors_sorted, N=n_bins)
                    center = None
                    norm = None
                else:
                    # Strong blue for negative, white for zero, strong red for positive
                    colors_neg = ['#000080', '#0000FF', '#4169E1', '#87CEEB', '#B0E0E6']  # Dark blue to light blue
                    colors_pos = ['#FFE4E1', '#FFB6C1', '#FF69B4', '#FF1493', '#8B0000']  # Light red to dark red
                    colors = colors_neg + ['#FFFFFF'] + colors_pos  # Blue -> White -> Red
                    n_bins = 256
                    cmap = LinearSegmentedColormap.from_list('custom_corr_strong', colors, N=n_bins)
                    # Use TwoSlopeNorm to ensure symmetric color scaling around 0
                    norm = TwoSlopeNorm(vmin=-1, vcenter=0, vmax=1)
                    center = 0
                
                # Plot heatmap with mask (only lower triangle visible)
                sns.heatmap(
                    matrix_to_plot,
                    mask=mask,
                    xticklabels=gene_names if gene_count <= 100 else False,
                    yticklabels=gene_names if gene_count <= 100 else False,
                    cmap=cmap,
                    norm=norm,
                    center=center,
                    vmin=vmin,
                    vmax=vmax,
                    square=True,
                    fmt='.2f' if gene_count <= 50 else '',
                    cbar_kws={'label': 'Correlation Coefficient' if not sorted else 'Absolute Correlation', 'shrink': 0.8},
                    ax=ax,
                    linewidths=0.1 if gene_count <= 100 else 0,
                    linecolor='white'
                )
                
                # Fill upper triangle with gray overlay using a patch
                # Draw gray rectangles for upper triangle
                for i in range(len(gene_names)):
                    for j in range(i + 1, len(gene_names)):
                        rect = plt.Rectangle((j - 0.5, i - 0.5), 1, 1, 
                                            facecolor='gray', edgecolor='none', alpha=0.6)
                        ax.add_patch(rect)
                
                ax.set_title('Correlation Matrix Heatmap (Lower Triangle)', fontsize=14, fontweight='bold')
                if gene_count <= 100:
                    plt.xticks(rotation=90, fontsize=8)
                    plt.yticks(rotation=0, fontsize=8)
                plt.tight_layout()
                
                buffer = io.BytesIO()
                plt.savefig(buffer, format='png', dpi=200, bbox_inches='tight', facecolor='white')
                buffer.seek(0)
                image_base64 = base64.b64encode(buffer.getvalue()).decode()
                plt.close()
                return {"type": "image", "content": image_base64}
            
        except Exception as e:
            plt.close('all')
            raise ValueError(f"Error creating heatmap: {str(e)}")
    
    def create_correlation_histogram(self) -> str:
        """Create histogram of correlation values"""
        if not self.correlation_calculated:
            raise ValueError("Correlation matrix not calculated")
        
        try:
            # Get upper triangle (excluding diagonal)
            corr_values = self.correlation_matrix[np.triu_indices_from(self.correlation_matrix, k=1)]
            
            # Create figure
            fig, ax = plt.subplots(figsize=(10, 6))
            
            ax.hist(corr_values, bins=50, edgecolor='black', alpha=0.7)
            ax.set_xlabel('Correlation Coefficient', fontsize=12)
            ax.set_ylabel('Frequency', fontsize=12)
            ax.set_title('Distribution of Correlation Coefficients', fontsize=14, fontweight='bold')
            ax.grid(True, alpha=0.3)
            
            # Add statistics
            mean_val = np.mean(corr_values)
            median_val = np.median(corr_values)
            ax.axvline(mean_val, color='red', linestyle='--', label=f'Mean: {mean_val:.3f}')
            ax.axvline(median_val, color='blue', linestyle='--', label=f'Median: {median_val:.3f}')
            ax.legend()
            
            plt.tight_layout()
            
            # Convert to base64
            buffer = io.BytesIO()
            plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
            buffer.seek(0)
            image_base64 = base64.b64encode(buffer.getvalue()).decode()
            plt.close()
            
            return image_base64
            
        except Exception as e:
            plt.close('all')
            raise ValueError(f"Error creating histogram: {str(e)}")
    
    def calculate_optimal_clusters(self, max_k: int = 10) -> Dict:
        """
        Calculate optimal number of clusters using Elbow and Silhouette methods
        Returns visualization plots
        
        Args:
            max_k: Maximum number of clusters to test
            
        Returns:
            Dictionary with optimal k, scores, and visualization images
        """
        if not self.correlation_calculated:
            return {"status": "error", "message": "Correlation matrix not calculated"}
        
        try:
            # Use absolute correlation as distance
            abs_corr = np.abs(self.correlation_matrix)
            distance_matrix = 1 - abs_corr  # Convert correlation to distance
            
            k_range = range(2, min(max_k + 1, len(self.gene_names)))
            inertias = []
            silhouette_scores = []
            
            for k in k_range:
                kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
                labels = kmeans.fit_predict(distance_matrix)
                
                inertias.append(kmeans.inertia_)
                if len(set(labels)) > 1:  # Need at least 2 clusters for silhouette
                    sil_score = silhouette_score(distance_matrix, labels)
                    silhouette_scores.append(sil_score)
                else:
                    silhouette_scores.append(0)
            
            # Find optimal k (elbow method approximation and max silhouette)
            # Elbow method: find the point where the decrease in inertia starts to slow down
            if len(inertias) > 1:
                # Calculate second derivative to find elbow
                if len(inertias) >= 3:
                    second_diff = np.diff(inertias, n=2)
                    elbow_idx = np.argmax(second_diff < 0) if np.any(second_diff < 0) else 0
                    optimal_k_elbow = list(k_range)[min(elbow_idx, len(k_range) - 1)]
                else:
                    optimal_k_elbow = list(k_range)[0]
            else:
                optimal_k_elbow = 2
            
            # Silhouette method: choose k with maximum silhouette score
            optimal_k_silhouette = k_range[np.argmax(silhouette_scores)] if silhouette_scores and len(silhouette_scores) > 0 else 2
            
            # Create visualization plots
            plot_image = self._create_elbow_silhouette_plot(list(k_range), inertias, silhouette_scores, 
                                                          optimal_k_elbow, optimal_k_silhouette)
            
            return {
                "status": "success",
                "optimal_k_elbow": int(optimal_k_elbow),
                "optimal_k_silhouette": int(optimal_k_silhouette),
                "inertias": inertias,
                "silhouette_scores": silhouette_scores,
                "k_range": list(k_range),
                "plot_image": plot_image
            }
            
        except Exception as e:
            return {
                "status": "error",
                "message": f"Error calculating optimal clusters: {str(e)}"
            }
    
    def _create_elbow_silhouette_plot(self, k_range: List[int], inertias: List[float], 
                                     silhouette_scores: List[float], 
                                     optimal_k_elbow: int, optimal_k_silhouette: int) -> Dict:
        """Create interactive Elbow and Silhouette plots"""
        if PLOTLY_AVAILABLE:
            # Create subplots
            fig = make_subplots(
                rows=1, cols=2,
                subplot_titles=('Elbow Curve', 'Silhouette Analysis'),
                horizontal_spacing=0.15
            )
            
            # Elbow plot
            log_inertias = np.log(inertias)
            fig.add_trace(
                go.Scatter(
                    x=k_range,
                    y=log_inertias,
                    mode='lines+markers',
                    name='Inertia',
                    line=dict(color='blue', width=2),
                    marker=dict(size=8, color='blue'),
                    hovertemplate='<b>K=%{x}</b><br>log(Inertia): %{y:.3f}<extra></extra>'
                ),
                row=1, col=1
            )
            fig.add_vline(
                x=optimal_k_elbow,
                line_dash="dash",
                line_color="red",
                annotation_text=f'Optimal K (Elbow): {optimal_k_elbow}',
                row=1, col=1
            )
            
            # Silhouette plot
            fig.add_trace(
                go.Scatter(
                    x=k_range,
                    y=silhouette_scores,
                    mode='lines+markers',
                    name='Silhouette Score',
                    line=dict(color='red', width=2),
                    marker=dict(size=10, color='red', symbol='star'),
                    hovertemplate='<b>K=%{x}</b><br>Silhouette: %{y:.3f}<extra></extra>'
                ),
                row=1, col=2
            )
            fig.add_vline(
                x=optimal_k_silhouette,
                line_dash="dash",
                line_color="blue",
                annotation_text=f'Optimal K (Silhouette): {optimal_k_silhouette}',
                row=1, col=2
            )
            
            # Update axes
            fig.update_xaxes(title_text="Number of clusters (K)", row=1, col=1)
            fig.update_yaxes(title_text="log(Average Sum of Squared Distances)", row=1, col=1)
            fig.update_xaxes(title_text="Number of clusters (K)", row=1, col=2)
            fig.update_yaxes(title_text="Average Silhouette Value", row=1, col=2)
            
            fig.update_layout(
                height=500,
                width=1200,
                template='plotly_white',
                showlegend=True
            )
            
            # Return plotly JSON data instead of HTML for React rendering
            plot_data = fig.to_json()
            return {"type": "plotly", "content": plot_data, "div_id": "elbow_silhouette_plot"}
        else:
            # Fallback to static image
            fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
            ax1.plot(k_range, np.log(inertias), 'bo-', linewidth=2, markersize=8, label='Inertia')
            ax1.axvline(x=optimal_k_elbow, color='r', linestyle='--', linewidth=2, 
                       label=f'Optimal K (Elbow): {optimal_k_elbow}')
            ax1.set_xlabel('Number of clusters (K)', fontsize=12)
            ax1.set_ylabel('log(Average Sum of Squared Distances)', fontsize=12)
            ax1.set_title('Elbow Curve', fontsize=14, fontweight='bold')
            ax1.grid(True, alpha=0.3)
            ax1.legend()
            ax1.set_xticks(k_range)
            ax2.plot(k_range, silhouette_scores, 'r*-', linewidth=2, markersize=10, label='Silhouette Score')
            ax2.axvline(x=optimal_k_silhouette, color='b', linestyle='--', linewidth=2,
                       label=f'Optimal K (Silhouette): {optimal_k_silhouette}')
            ax2.set_xlabel('Number of clusters (K)', fontsize=12)
            ax2.set_ylabel('Average Silhouette Value', fontsize=12)
            ax2.set_title('Silhouette Analysis', fontsize=14, fontweight='bold')
            ax2.grid(True, alpha=0.3)
            ax2.legend()
            ax2.set_xticks(k_range)
            plt.tight_layout()
            buffer = io.BytesIO()
            plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
            buffer.seek(0)
            image_base64 = base64.b64encode(buffer.getvalue()).decode()
            plt.close()
            return {"type": "image", "content": image_base64}
    
    def create_dendrogram(self, threshold: Optional[float] = None, method: str = 'ward') -> str:
        """
        Create dendrogram for hierarchical clustering
        
        Args:
            threshold: Distance threshold for clustering
            method: Linkage method ('ward', 'complete', 'average', 'single')
            
        Returns:
            Base64 encoded image string
        """
        if not self.correlation_calculated:
            raise ValueError("Correlation matrix not calculated")
        
        try:
            # Convert correlation to distance
            abs_corr = np.abs(self.correlation_matrix)
            distance_matrix = 1 - abs_corr
            
            # Perform hierarchical clustering
            linkage_matrix = linkage(distance_matrix, method=method)
            
            # Create figure
            fig, ax = plt.subplots(figsize=(15, 8))
            
            # Create dendrogram
            dendrogram(
                linkage_matrix,
                labels=self.gene_names[:100] if len(self.gene_names) > 100 else self.gene_names,
                leaf_rotation=90,
                leaf_font_size=8,
                ax=ax
            )
            
            if threshold:
                ax.axhline(y=threshold, color='r', linestyle='--', label=f'Threshold: {threshold:.2f}')
                ax.legend()
            
            ax.set_title('Hierarchical Clustering Dendrogram', fontsize=14, fontweight='bold')
            ax.set_xlabel('Genes', fontsize=12)
            ax.set_ylabel('Distance', fontsize=12)
            plt.tight_layout()
            
            # Convert to base64
            buffer = io.BytesIO()
            plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
            buffer.seek(0)
            image_base64 = base64.b64encode(buffer.getvalue()).decode()
            plt.close()
            
            return image_base64
            
        except Exception as e:
            plt.close('all')
            raise ValueError(f"Error creating dendrogram: {str(e)}")
    
    def perform_pca(self, n_components: int = 3, n_clusters: Optional[int] = None) -> Dict:
        import sys
        print(f"DEBUG perform_pca: n_components={n_components}, n_clusters={n_clusters}, type(n_clusters)={type(n_clusters)}", file=sys.stderr, flush=True)
        """
        Perform Principal Component Analysis on correlation matrix
        Each gene is a point in the PCA space (as in MATLAB IVCCA)
        
        Args:
            n_components: Number of principal components for scatter plot
            n_clusters: Optional number of clusters for coloring
            
        Returns:
            Dictionary with PCA results and visualization images
        """
        if not self.correlation_calculated:
            return {"status": "error", "message": "Correlation matrix not calculated. Please calculate correlation first."}
        
        try:
            # Use correlation matrix (genes x genes), not original data
            # Take absolute value as in MATLAB
            data = np.abs(self.correlation_matrix)
            
            # Fill NaN values
            data_filled = np.nan_to_num(data, nan=0.0)
            
            # For scree plot, we need at least 25 components (or all available)
            # For scatter plot, we use the requested n_components
            n_genes = min(data_filled.shape)
            max_components_for_scree = min(25, n_genes)  # Calculate up to 25 components for scree plot
            max_components_for_scatter = min(n_components, n_genes)  # Use requested components for scatter
            
            # Perform PCA with enough components for scree plot (at least 25)
            pca_full = PCA(n_components=max_components_for_scree)
            pca_full.fit(data_filled)  # Fit to get all explained variances
            
            # Calculate explained variance for all components (up to 25)
            explained_variance = pca_full.explained_variance_ratio_
            cumulative_variance = np.cumsum(explained_variance)
            
            # Now get the scores for scatter plot (only the requested number of components)
            if max_components_for_scatter < max_components_for_scree:
                # Use a separate PCA with fewer components for scatter plot
                pca_scatter = PCA(n_components=max_components_for_scatter)
                pca_scores = pca_scatter.fit_transform(data_filled)
            else:
                # Use the full PCA scores, but only take the first n_components
                pca_scores = pca_full.transform(data_filled)[:, :max_components_for_scatter]
            
            # Create scree plot (line plot) - shows first 25 components
            scree_image = self._create_pca_scree_plot(explained_variance, cumulative_variance)
            
            # Create 3D scatter plot - always create if n_components >= 3
            scatter_image = None
            cluster_assignments = None
            if n_components >= 3 and pca_scores.shape[1] >= 3:
                # Use first 3 components for 3D plot
                scatter_image = self._create_pca_3d_plot(pca_scores[:, :3], n_clusters=n_clusters, gene_names=self.gene_names)
                if isinstance(scatter_image, dict) and "cluster_assignments" in scatter_image:
                    cluster_assignments = scatter_image["cluster_assignments"]
                    print(f"DEBUG: Extracted cluster_assignments from 3D plot: {len(cluster_assignments) if cluster_assignments else 0} clusters")
            elif pca_scores.shape[1] >= 2:
                # Use first 2 components for 2D plot
                scatter_image = self._create_pca_2d_plot(pca_scores[:, :2], n_clusters=n_clusters, gene_names=self.gene_names)
                if isinstance(scatter_image, dict) and "cluster_assignments" in scatter_image:
                    cluster_assignments = scatter_image["cluster_assignments"]
                    print(f"DEBUG: Extracted cluster_assignments from 2D plot: {len(cluster_assignments) if cluster_assignments else 0} clusters")
            
            print(f"DEBUG: n_clusters={n_clusters}, cluster_assignments={cluster_assignments is not None}, type={type(cluster_assignments)}")
            
            # Get components from the appropriate PCA object
            if max_components_for_scatter < max_components_for_scree:
                components_for_result = pca_scatter.components_.tolist()
            else:
                components_for_result = pca_full.components_[:max_components_for_scatter].tolist()
            
            result = {
                "status": "success",
                "scores": pca_scores.tolist(),
                "explained_variance": explained_variance.tolist(),
                "cumulative_variance": cumulative_variance.tolist(),
                "components": components_for_result,
                "n_components": len(explained_variance),
                "n_genes": len(self.gene_names),
                "scree_plot": scree_image
            }
            
            if scatter_image:
                result["scatter_plot"] = scatter_image
            
            if cluster_assignments:
                result["cluster_assignments"] = cluster_assignments
                print(f"DEBUG: Added cluster_assignments to result: {len(cluster_assignments)} clusters")
                print(f"DEBUG: Cluster keys: {list(cluster_assignments.keys())}")
                print(f"DEBUG: First cluster has {len(cluster_assignments[list(cluster_assignments.keys())[0]])} genes")
            else:
                print(f"DEBUG: No cluster_assignments to add (n_clusters={n_clusters})")
            
            # Debug: print result keys before returning
            print(f"DEBUG: Result keys before return: {list(result.keys())}")
            print(f"DEBUG: cluster_assignments in result? {'cluster_assignments' in result}")
            
            return result
            
        except Exception as e:
            return {
                "status": "error",
                "message": f"Error performing PCA: {str(e)}"
            }
    
    def _create_pca_scree_plot(self, explained_variance: np.ndarray, cumulative_variance: np.ndarray) -> Dict:
        """Create interactive scree plot showing cumulative variance for first 25 components"""
        if PLOTLY_AVAILABLE:
            # Convert to percentage as in MATLAB
            cumulative_variance_pct = cumulative_variance * 100
            
            # Select only first 25 components as in MATLAB
            components_to_display = min(len(cumulative_variance_pct), 25)
            cumulative_variance_25 = cumulative_variance_pct[:components_to_display]
            components = list(range(1, components_to_display + 1))
            
            # Create interactive plot
            fig = go.Figure()
            
            fig.add_trace(go.Scatter(
                x=components,
                y=cumulative_variance_25,
                mode='lines+markers',
                name='Cumulative Variance',
                line=dict(color='red', width=2),
                marker=dict(size=8, color='red'),
                hovertemplate='<b>Component %{x}</b><br>Cumulative Variance: %{y:.2f}%<extra></extra>'
            ))
            
            fig.update_layout(
                title='Cumulative Variance Explained by the First 25 Principal Components',
                xaxis_title='Number of Principal Components',
                yaxis_title='Cumulative Variance Explained (%)',
                xaxis=dict(tickmode='linear', tick0=1, dtick=1),
                yaxis=dict(range=[0, 100]),
                hovermode='closest',
                template='plotly_white',
                height=500,
                width=800
            )
            
            # Return as HTML string
            # Return plotly JSON data instead of HTML for React rendering
            plot_data = fig.to_json()
            return {"type": "plotly", "content": plot_data, "div_id": "pca_scree_plot"}
        else:
            # Fallback to static image
            fig, ax = plt.subplots(figsize=(10, 6))
            
            # Select only first 25 components
            components_to_display = min(len(cumulative_variance), 25)
            cumulative_variance_25 = cumulative_variance[:components_to_display] * 100
            components = list(range(1, components_to_display + 1))
            
            ax.plot(components, cumulative_variance_25, 'ro-', linewidth=2, markersize=8)
            ax.set_xlabel('Number of Principal Components', fontsize=12)
            ax.set_ylabel('Cumulative Variance Explained (%)', fontsize=12)
            ax.set_title('Cumulative Variance Explained by the First 25 Principal Components', fontsize=14, fontweight='bold')
            ax.grid(True, alpha=0.3)
            ax.set_xticks(components)
            ax.set_ylim([0, 100])
            
            plt.tight_layout()
            
            buffer = io.BytesIO()
            plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
            buffer.seek(0)
            image_base64 = base64.b64encode(buffer.getvalue()).decode()
            plt.close()
            
            return {"type": "image", "content": image_base64}
    
    def _create_pca_3d_plot(self, pca_scores: np.ndarray, n_clusters: Optional[int] = None, 
                           gene_names: Optional[List[str]] = None) -> Dict:
        """Create interactive 3D scatter plot for PCA - each point is a gene"""
        n_points = pca_scores.shape[0]
        
        # Calculate adaptive marker size to prevent overlapping
        # Smaller markers for more points, larger for fewer points
        # More aggressive size reduction for 3D to prevent overlap
        base_size = max(2, min(5, 300 / n_points))
        
        # Add small random jitter to prevent exact overlaps (very small to preserve structure)
        # Only add jitter if there are many points
        if n_points > 50:
            jitter_scale = np.std(pca_scores, axis=0) * 0.008  # 0.8% of standard deviation
            jitter = np.random.RandomState(42).normal(0, jitter_scale, pca_scores.shape)
            pca_scores_jittered = pca_scores + jitter
        else:
            pca_scores_jittered = pca_scores
        
        if PLOTLY_AVAILABLE:
            # Perform clustering if requested
            labels = None
            cluster_assignments = None
            if n_clusters and n_clusters > 1:
                from sklearn.cluster import KMeans
                kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
                labels = kmeans.fit_predict(pca_scores_jittered)
                
                # Create cluster assignments dictionary
                cluster_assignments = {}
                for i in range(n_clusters):
                    mask = labels == i
                    if np.any(mask):
                        cluster_indices = np.where(mask)[0]
                        cluster_genes = [gene_names[j] if gene_names and j < len(gene_names) else f'Gene_{j}' for j in cluster_indices]
                        cluster_assignments[i+1] = cluster_genes
            
            # Create interactive 3D plot
            fig = go.Figure()
            
            if labels is not None:
                colors_list = px.colors.qualitative.Set3[:n_clusters] if n_clusters <= 12 else px.colors.qualitative.Dark24[:n_clusters]
                for i in range(n_clusters):
                    mask = labels == i
                    if np.any(mask):
                        cluster_indices = np.where(mask)[0]
                        cluster_genes = [gene_names[j] if gene_names and j < len(gene_names) else f'Gene_{j}' for j in cluster_indices]
                        fig.add_trace(go.Scatter3d(
                            x=pca_scores_jittered[mask, 0],
                            y=pca_scores_jittered[mask, 1],
                            z=pca_scores_jittered[mask, 2],
                            mode='markers',
                            name=f'Cluster {i+1}',
                            marker=dict(
                                size=base_size,
                                color=colors_list[i],
                                opacity=0.6,
                                line=dict(width=0.3, color='black'),
                                symbol='circle'
                            ),
                            text=cluster_genes,
                            hovertemplate='<b>%{text}</b><br>PC1: %{x:.3f}<br>PC2: %{y:.3f}<br>PC3: %{z:.3f}<extra></extra>'
                        ))
            else:
                gene_labels = gene_names if gene_names and len(gene_names) == n_points else [f'Gene_{i}' for i in range(n_points)]
                # Ensure we have labels for all points
                if len(gene_labels) != n_points:
                    gene_labels = [f'Gene_{i}' for i in range(n_points)]
                
                fig.add_trace(go.Scatter3d(
                    x=pca_scores_jittered[:, 0],
                    y=pca_scores_jittered[:, 1],
                    z=pca_scores_jittered[:, 2],
                    mode='markers',
                    name='Genes',
                    marker=dict(
                        size=base_size,
                        color='blue',
                        opacity=0.6,
                        line=dict(width=0.3, color='black'),
                        symbol='circle'
                    ),
                    text=gene_labels,
                    hovertemplate='<b>%{text}</b><br>PC1: %{x:.3f}<br>PC2: %{y:.3f}<br>PC3: %{z:.3f}<extra></extra>'
                ))
            
            fig.update_layout(
                title=f'PCA 3D Scatter Plot ({n_points} genes)' + (f' (K={n_clusters} clusters)' if n_clusters else ''),
                scene=dict(
                    xaxis_title='PC1',
                    yaxis_title='PC2',
                    zaxis_title='PC3',
                    bgcolor='white',
                    camera=dict(
                        eye=dict(x=1.5, y=1.5, z=1.5)
                    ),
                    aspectmode='cube'  # Ensures equal scaling on all axes
                ),
                height=600,
                width=900,
                template='plotly_white'
            )
            
            # Return plotly JSON data instead of HTML for React rendering
            plot_data = fig.to_json()
            result = {"type": "plotly", "content": plot_data, "div_id": "pca_3d_plot"}
            if cluster_assignments:
                result["cluster_assignments"] = cluster_assignments
            return result
        else:
            # Fallback to static image
            from mpl_toolkits.mplot3d import Axes3D
            fig = plt.figure(figsize=(14, 12), dpi=150)
            ax = fig.add_subplot(111, projection='3d')
            # Use smaller marker size for matplotlib too
            marker_size = max(20, min(40, 3000 / n_points))
            if n_clusters and n_clusters > 1:
                from sklearn.cluster import KMeans
                kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
                labels = kmeans.fit_predict(pca_scores_jittered)
                colors_list = plt.cm.tab20(np.linspace(0, 1, min(n_clusters, 20)))
                if n_clusters > 20:
                    colors_list = plt.cm.Set3(np.linspace(0, 1, n_clusters))
                for i in range(n_clusters):
                    mask = labels == i
                    if np.any(mask):
                        ax.scatter(pca_scores_jittered[mask, 0], pca_scores_jittered[mask, 1], pca_scores_jittered[mask, 2],
                                  c=[colors_list[i]], label=f'Cluster {i+1}', alpha=0.6, s=marker_size, edgecolors='black', linewidths=0.3)
                ax.legend(bbox_to_anchor=(1.05, 1), loc='upper left', fontsize=8)
            else:
                ax.scatter(pca_scores_jittered[:, 0], pca_scores_jittered[:, 1], pca_scores_jittered[:, 2],
                          c='blue', alpha=0.6, s=marker_size, edgecolors='black', linewidths=0.3)
            ax.set_xlabel('PC1', fontsize=14, fontweight='bold')
            ax.set_ylabel('PC2', fontsize=14, fontweight='bold')
            ax.set_zlabel('PC3', fontsize=14, fontweight='bold')
            ax.set_title(f'PCA 3D Scatter Plot ({n_points} genes)' + (f' (K={n_clusters} clusters)' if n_clusters else ''), 
                        fontsize=16, fontweight='bold', pad=20)
            ax.grid(True, alpha=0.3)
            plt.tight_layout()
            buffer = io.BytesIO()
            plt.savefig(buffer, format='png', dpi=200, bbox_inches='tight', facecolor='white')
            buffer.seek(0)
            image_base64 = base64.b64encode(buffer.getvalue()).decode()
            plt.close()
            return {"type": "image", "content": image_base64}
    
    def _create_pca_2d_plot(self, pca_scores: np.ndarray, n_clusters: Optional[int] = None,
                           gene_names: Optional[List[str]] = None) -> Dict:
        """Create interactive 2D scatter plot for PCA - each point is a gene"""
        n_points = pca_scores.shape[0]
        
        if PLOTLY_AVAILABLE:
            # Perform clustering if requested
            labels = None
            cluster_assignments = None
            if n_clusters and n_clusters > 1:
                from sklearn.cluster import KMeans
                kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
                labels = kmeans.fit_predict(pca_scores)
                
                # Create cluster assignments dictionary
                cluster_assignments = {}
                for i in range(n_clusters):
                    mask = labels == i
                    if np.any(mask):
                        cluster_indices = np.where(mask)[0]
                        cluster_genes = [gene_names[j] if gene_names and j < len(gene_names) else f'Gene_{j}' for j in cluster_indices]
                        cluster_assignments[i+1] = cluster_genes
            
            # Create interactive 2D plot
            fig = go.Figure()
            
            if labels is not None:
                colors_list = px.colors.qualitative.Set3[:n_clusters] if n_clusters <= 12 else px.colors.qualitative.Dark24[:n_clusters]
                for i in range(n_clusters):
                    mask = labels == i
                    if np.any(mask):
                        cluster_indices = np.where(mask)[0]
                        cluster_genes = [gene_names[j] if gene_names and j < len(gene_names) else f'Gene_{j}' for j in cluster_indices]
                        fig.add_trace(go.Scatter(
                            x=pca_scores[mask, 0],
                            y=pca_scores[mask, 1],
                            mode='markers',
                            name=f'Cluster {i+1}',
                            marker=dict(
                                size=5,
                                color=colors_list[i],
                                opacity=0.7,
                                line=dict(width=0.5, color='black')
                            ),
                            text=cluster_genes,
                            hovertemplate='<b>%{text}</b><br>PC1: %{x:.3f}<br>PC2: %{y:.3f}<extra></extra>'
                        ))
            else:
                gene_labels = gene_names if gene_names and len(gene_names) == n_points else [f'Gene_{i}' for i in range(n_points)]
                # Ensure we have labels for all points
                if len(gene_labels) != n_points:
                    gene_labels = [f'Gene_{i}' for i in range(n_points)]
                
                fig.add_trace(go.Scatter(
                    x=pca_scores[:, 0],
                    y=pca_scores[:, 1],
                    mode='markers',
                    name='Genes',
                    marker=dict(
                        size=5,
                        color='blue',
                        opacity=0.7,
                        line=dict(width=0.5, color='black')
                    ),
                    text=gene_labels,
                    hovertemplate='<b>%{text}</b><br>PC1: %{x:.3f}<br>PC2: %{y:.3f}<extra></extra>'
                ))
            
            fig.update_layout(
                title=f'PCA 2D Scatter Plot ({n_points} genes)' + (f' (K={n_clusters} clusters)' if n_clusters else ''),
                xaxis_title='PC1',
                yaxis_title='PC2',
                height=700,
                width=900,
                template='plotly_white',
                hovermode='closest'
            )
            
            # Return plotly JSON data instead of HTML for React rendering
            plot_data = fig.to_json()
            result = {"type": "plotly", "content": plot_data, "div_id": "pca_2d_plot"}
            if cluster_assignments:
                result["cluster_assignments"] = cluster_assignments
            return result
        else:
            # Fallback to static image
            fig, ax = plt.subplots(figsize=(12, 10), dpi=150)
            if n_clusters and n_clusters > 1:
                from sklearn.cluster import KMeans
                kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
                labels = kmeans.fit_predict(pca_scores)
                colors_list = plt.cm.tab20(np.linspace(0, 1, min(n_clusters, 20)))
                if n_clusters > 20:
                    colors_list = plt.cm.Set3(np.linspace(0, 1, n_clusters))
                for i in range(n_clusters):
                    mask = labels == i
                    if np.any(mask):
                        ax.scatter(pca_scores[mask, 0], pca_scores[mask, 1],
                                  c=[colors_list[i]], label=f'Cluster {i+1}', alpha=0.7, s=60, 
                                  edgecolors='black', linewidths=0.5)
                ax.legend(bbox_to_anchor=(1.05, 1), loc='upper left', fontsize=8)
            else:
                ax.scatter(pca_scores[:, 0], pca_scores[:, 1], c='blue', alpha=0.7, s=60,
                          edgecolors='black', linewidths=0.5)
            ax.set_xlabel('PC1', fontsize=14, fontweight='bold')
            ax.set_ylabel('PC2', fontsize=14, fontweight='bold')
            ax.set_title(f'PCA 2D Scatter Plot ({n_points} genes)' + (f' (K={n_clusters} clusters)' if n_clusters else ''), 
                        fontsize=16, fontweight='bold')
            ax.grid(True, alpha=0.3)
            plt.tight_layout()
            buffer = io.BytesIO()
            plt.savefig(buffer, format='png', dpi=200, bbox_inches='tight', facecolor='white')
            buffer.seek(0)
            image_base64 = base64.b64encode(buffer.getvalue()).decode()
            plt.close()
            return {"type": "image", "content": image_base64}
    
    def perform_tsne(self, n_components: int = 2, perplexity: float = 30.0, 
                    random_state: int = 42, n_clusters: Optional[int] = None) -> Dict:
        """
        Perform t-SNE dimensionality reduction on correlation matrix
        Each gene is a point in the t-SNE space (as in MATLAB IVCCA)
        
        Args:
            n_components: Number of dimensions (2 or 3)
            perplexity: Perplexity parameter
            random_state: Random seed
            n_clusters: Optional number of clusters for coloring
            
        Returns:
            Dictionary with t-SNE results and visualization images
        """
        if not self.correlation_calculated:
            return {"status": "error", "message": "Correlation matrix not calculated. Please calculate correlation first."}
        
        try:
            # Use correlation matrix (genes x genes), not original data
            # Take absolute value as in MATLAB
            data = np.abs(self.correlation_matrix)
            
            # Fill NaN values
            data_filled = np.nan_to_num(data, nan=0.0)
            
            # Adjust perplexity based on number of genes (not samples)
            n_genes = data_filled.shape[0]
            adjusted_perplexity = min(perplexity, max(5, (n_genes - 1) // 3))
            
            # Perform PCA first to get initialization (as in MATLAB tsne3.m)
            # Step 1: Perform PCA to get the first three principal components
            pca_init = PCA(n_components=min(3, n_genes))
            pca_scores_init = pca_init.fit_transform(data_filled)
            first_three_pcs = pca_scores_init[:, :min(3, n_genes)]
            
            # Step 2: Standardize the components (as in MATLAB)
            if first_three_pcs.shape[1] > 0:
                std_dev = np.std(first_three_pcs[:, 0])
                if std_dev > 0:
                    first_three_pcs = first_three_pcs / std_dev
                # Step 3: Multiply by a small number (0.0001) as in MATLAB
                first_three_pcs = first_three_pcs * 0.0001
                
                # Prepare initialization for t-SNE
                if n_components == 3 and first_three_pcs.shape[1] >= 3:
                    init_data = first_three_pcs[:, :3]
                elif n_components == 2 and first_three_pcs.shape[1] >= 2:
                    init_data = first_three_pcs[:, :2]
                else:
                    init_data = 'random'
            else:
                init_data = 'random'
            
            # Perform t-SNE with PCA initialization (as in MATLAB)
            tsne = TSNE(
                n_components=n_components,
                perplexity=adjusted_perplexity,
                random_state=random_state,
                n_iter=1000,
                init=init_data if isinstance(init_data, np.ndarray) else 'random',
                n_iter_without_progress=300,
                method='exact' if n_genes < 1000 else 'barnes_hut'
            )
            tsne_scores = tsne.fit_transform(data_filled)  # Shape: (n_genes, n_components)
            
            # Create visualization - always create 3D if n_components == 3
            scatter_result = None
            if n_components == 3:
                scatter_result = self._create_tsne_3d_plot(tsne_scores, n_clusters=n_clusters, gene_names=self.gene_names)
            elif n_components == 2:
                scatter_result = self._create_tsne_2d_plot(tsne_scores, n_clusters=n_clusters, gene_names=self.gene_names)
            
            result = {
                "status": "success",
                "scores": tsne_scores.tolist(),
                "n_components": n_components,
                "n_genes": n_genes
            }
            
            if scatter_result:
                result["scatter_plot"] = scatter_result
            
            return result
            
        except Exception as e:
            return {
                "status": "error",
                "message": f"Error performing t-SNE: {str(e)}"
            }
    
    def _create_tsne_3d_plot(self, tsne_scores: np.ndarray, n_clusters: Optional[int] = None,
                            gene_names: Optional[List[str]] = None) -> Dict:
        """Create interactive 3D scatter plot for t-SNE - each point is a gene"""
        n_points = tsne_scores.shape[0]
        
        if PLOTLY_AVAILABLE:
            # Perform clustering if requested
            labels = None
            if n_clusters and n_clusters > 1:
                from sklearn.cluster import KMeans
                kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
                labels = kmeans.fit_predict(tsne_scores)
            
            # Create interactive 3D plot
            fig = go.Figure()
            
            if labels is not None:
                colors_list = px.colors.qualitative.Set3[:n_clusters] if n_clusters <= 12 else px.colors.qualitative.Dark24[:n_clusters]
                for i in range(n_clusters):
                    mask = labels == i
                    if np.any(mask):
                        cluster_indices = np.where(mask)[0]
                        cluster_genes = [gene_names[j] if gene_names and j < len(gene_names) else f'Gene_{j}' for j in cluster_indices]
                        fig.add_trace(go.Scatter3d(
                            x=tsne_scores[mask, 0],
                            y=tsne_scores[mask, 1],
                            z=tsne_scores[mask, 2],
                            mode='markers',
                            name=f'Cluster {i+1}',
                            marker=dict(
                                size=4,
                                color=colors_list[i],
                                opacity=0.7,
                                line=dict(width=0.5, color='black')
                            ),
                            text=cluster_genes,
                            hovertemplate='<b>%{text}</b><br>t-SNE 1: %{x:.3f}<br>t-SNE 2: %{y:.3f}<br>t-SNE 3: %{z:.3f}<extra></extra>'
                        ))
            else:
                gene_labels = gene_names if gene_names and len(gene_names) == n_points else [f'Gene_{i}' for i in range(n_points)]
                # Ensure we have labels for all points
                if len(gene_labels) != n_points:
                    gene_labels = [f'Gene_{i}' for i in range(n_points)]
                
                fig.add_trace(go.Scatter3d(
                    x=tsne_scores[:, 0],
                    y=tsne_scores[:, 1],
                    z=tsne_scores[:, 2],
                    mode='markers',
                    name='Genes',
                    marker=dict(
                        size=4,
                        color='blue',
                        opacity=0.7,
                        line=dict(width=0.5, color='black')
                    ),
                    text=gene_labels,
                    hovertemplate='<b>%{text}</b><br>t-SNE 1: %{x:.3f}<br>t-SNE 2: %{y:.3f}<br>t-SNE 3: %{z:.3f}<extra></extra>'
                ))
            
            fig.update_layout(
                title=f't-SNE 3D Scatter Plot ({n_points} genes)' + (f' (K={n_clusters} clusters)' if n_clusters else ''),
                scene=dict(
                    xaxis_title='t-SNE 1',
                    yaxis_title='t-SNE 2',
                    zaxis_title='t-SNE 3',
                    bgcolor='white'
                ),
                height=800,
                width=1000,
                template='plotly_white'
            )
            
            # Return plotly JSON data instead of HTML for React rendering
            plot_data = fig.to_json()
            return {"type": "plotly", "content": plot_data, "div_id": "tsne_3d_plot"}
        else:
            # Fallback to static image
            from mpl_toolkits.mplot3d import Axes3D
            fig = plt.figure(figsize=(14, 12), dpi=150)
            ax = fig.add_subplot(111, projection='3d')
            if n_clusters and n_clusters > 1:
                from sklearn.cluster import KMeans
                kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
                labels = kmeans.fit_predict(tsne_scores)
                colors_list = plt.cm.tab20(np.linspace(0, 1, min(n_clusters, 20)))
                if n_clusters > 20:
                    colors_list = plt.cm.Set3(np.linspace(0, 1, n_clusters))
                for i in range(n_clusters):
                    mask = labels == i
                    if np.any(mask):
                        ax.scatter(tsne_scores[mask, 0], tsne_scores[mask, 1], tsne_scores[mask, 2],
                                  c=[colors_list[i]], label=f'Cluster {i+1}', alpha=0.7, s=60, edgecolors='black', linewidths=0.5)
                ax.legend(bbox_to_anchor=(1.05, 1), loc='upper left', fontsize=8)
            else:
                ax.scatter(tsne_scores[:, 0], tsne_scores[:, 1], tsne_scores[:, 2],
                          c='blue', alpha=0.7, s=60, edgecolors='black', linewidths=0.5)
            ax.set_xlabel('t-SNE 1', fontsize=14, fontweight='bold')
            ax.set_ylabel('t-SNE 2', fontsize=14, fontweight='bold')
            ax.set_zlabel('t-SNE 3', fontsize=14, fontweight='bold')
            ax.set_title(f't-SNE 3D Scatter Plot ({n_points} genes)' + (f' (K={n_clusters} clusters)' if n_clusters else ''), 
                        fontsize=16, fontweight='bold', pad=20)
            ax.grid(True, alpha=0.3)
            plt.tight_layout()
            buffer = io.BytesIO()
            plt.savefig(buffer, format='png', dpi=200, bbox_inches='tight', facecolor='white')
            buffer.seek(0)
            image_base64 = base64.b64encode(buffer.getvalue()).decode()
            plt.close()
            return {"type": "image", "content": image_base64}
    
    def _create_tsne_2d_plot(self, tsne_scores: np.ndarray, n_clusters: Optional[int] = None,
                            gene_names: Optional[List[str]] = None) -> Dict:
        """Create interactive 2D scatter plot for t-SNE - each point is a gene"""
        n_points = tsne_scores.shape[0]
        
        if PLOTLY_AVAILABLE:
            # Perform clustering if requested
            labels = None
            if n_clusters and n_clusters > 1:
                from sklearn.cluster import KMeans
                kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
                labels = kmeans.fit_predict(tsne_scores)
            
            # Create interactive 2D plot
            fig = go.Figure()
            
            if labels is not None:
                colors_list = px.colors.qualitative.Set3[:n_clusters] if n_clusters <= 12 else px.colors.qualitative.Dark24[:n_clusters]
                for i in range(n_clusters):
                    mask = labels == i
                    if np.any(mask):
                        cluster_genes = [gene_names[j] if gene_names else f'Gene_{j}' for j in range(len(mask)) if mask[j]]
                        fig.add_trace(go.Scatter(
                            x=tsne_scores[mask, 0],
                            y=tsne_scores[mask, 1],
                            mode='markers',
                            name=f'Cluster {i+1}',
                            marker=dict(
                                size=10,
                                color=colors_list[i],
                                opacity=0.7,
                                line=dict(width=1, color='black')
                            ),
                            text=cluster_genes,
                            hovertemplate='<b>%{text}</b><br>t-SNE 1: %{x:.3f}<br>t-SNE 2: %{y:.3f}<extra></extra>'
                        ))
            else:
                gene_labels = gene_names if gene_names else [f'Gene_{i}' for i in range(n_points)]
                fig.add_trace(go.Scatter(
                    x=tsne_scores[:, 0],
                    y=tsne_scores[:, 1],
                    mode='markers',
                    name='Genes',
                    marker=dict(
                        size=10,
                        color='blue',
                        opacity=0.7,
                        line=dict(width=1, color='black')
                    ),
                    text=gene_labels,
                    hovertemplate='<b>%{text}</b><br>t-SNE 1: %{x:.3f}<br>t-SNE 2: %{y:.3f}<extra></extra>'
                ))
            
            fig.update_layout(
                title=f't-SNE 2D Scatter Plot ({n_points} genes)' + (f' (K={n_clusters} clusters)' if n_clusters else ''),
                xaxis_title='t-SNE 1',
                yaxis_title='t-SNE 2',
                height=700,
                width=900,
                template='plotly_white',
                hovermode='closest'
            )
            
            # Return plotly JSON data instead of HTML for React rendering
            plot_data = fig.to_json()
            return {"type": "plotly", "content": plot_data, "div_id": "tsne_2d_plot"}
        else:
            # Fallback to static image
            fig, ax = plt.subplots(figsize=(12, 10), dpi=150)
            if n_clusters and n_clusters > 1:
                from sklearn.cluster import KMeans
                kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
                labels = kmeans.fit_predict(tsne_scores)
                colors_list = plt.cm.tab20(np.linspace(0, 1, min(n_clusters, 20)))
                if n_clusters > 20:
                    colors_list = plt.cm.Set3(np.linspace(0, 1, n_clusters))
                for i in range(n_clusters):
                    mask = labels == i
                    if np.any(mask):
                        ax.scatter(tsne_scores[mask, 0], tsne_scores[mask, 1],
                                  c=[colors_list[i]], label=f'Cluster {i+1}', alpha=0.7, s=60,
                                  edgecolors='black', linewidths=0.5)
                ax.legend(bbox_to_anchor=(1.05, 1), loc='upper left', fontsize=8)
            else:
                ax.scatter(tsne_scores[:, 0], tsne_scores[:, 1], c='blue', alpha=0.7, s=60,
                          edgecolors='black', linewidths=0.5)
            ax.set_xlabel('t-SNE 1', fontsize=14, fontweight='bold')
            ax.set_ylabel('t-SNE 2', fontsize=14, fontweight='bold')
            ax.set_title(f't-SNE 2D Scatter Plot ({n_points} genes)' + (f' (K={n_clusters} clusters)' if n_clusters else ''), 
                        fontsize=16, fontweight='bold')
            ax.grid(True, alpha=0.3)
            plt.tight_layout()
            buffer = io.BytesIO()
            plt.savefig(buffer, format='png', dpi=200, bbox_inches='tight', facecolor='white')
            buffer.seek(0)
            image_base64 = base64.b64encode(buffer.getvalue()).decode()
            plt.close()
            return {"type": "image", "content": image_base64}
    
    def analyze_single_pathway(self, pathway_genes: List[str]) -> Dict:
        """
        Analyze correlations within a single pathway
        
        Args:
            pathway_genes: List of gene names in the pathway
            
        Returns:
            Dictionary with pathway analysis results
        """
        if not self.correlation_calculated:
            return {"status": "error", "message": "Correlation matrix not calculated"}
        
        try:
            # Find indices of pathway genes (case-insensitive matching)
            gene_names_lower = [g.lower() for g in self.gene_names]
            gene_indices = []
            pathway_gene_names = []
            
            for gene in pathway_genes:
                gene_lower = gene.strip().lower()
                if gene_lower in gene_names_lower:
                    idx = gene_names_lower.index(gene_lower)
                    if idx not in gene_indices:  # Avoid duplicates
                        gene_indices.append(idx)
                        pathway_gene_names.append(self.gene_names[idx])
            
            if not gene_indices:
                return {"status": "error", "message": "No matching genes found in pathway. Please check gene names match your data."}
            
            # Extract pathway correlation submatrix
            pathway_corr = self.correlation_matrix[np.ix_(gene_indices, gene_indices)]
            
            # Calculate average correlation for each gene in pathway
            abs_pathway_corr = np.abs(pathway_corr)
            np.fill_diagonal(abs_pathway_corr, 0)
            avg_corr = np.mean(abs_pathway_corr, axis=1)
            
            # Sort by average correlation
            sorted_indices = np.argsort(avg_corr)[::-1]
            sorted_genes = [pathway_gene_names[i] for i in sorted_indices]
            sorted_scores = avg_corr[sorted_indices]
            
            return {
                "status": "success",
                "pathway_size": len(pathway_gene_names),
                "sorted_genes": sorted_genes,
                "sorted_scores": sorted_scores.tolist(),
                "correlation_matrix": pathway_corr.tolist(),
                "mean_correlation": float(np.mean(abs_pathway_corr[abs_pathway_corr > 0]))
            }
            
        except Exception as e:
            return {
                "status": "error",
                "message": f"Error analyzing pathway: {str(e)}"
            }
    
    def compare_pathways(self, pathway1_genes: List[str], pathway2_genes: List[str]) -> Dict:
        """
        Compare two pathways using cosine similarity
        
        Args:
            pathway1_genes: List of genes in first pathway
            pathway2_genes: List of genes in second pathway
            
        Returns:
            Dictionary with comparison results
        """
        if not self.correlation_calculated:
            return {"status": "error", "message": "Correlation matrix not calculated"}
        
        try:
            # Find gene indices (case-insensitive matching)
            gene_names_lower = [g.lower() for g in self.gene_names]
            indices1 = []
            indices2 = []
            
            for gene in pathway1_genes:
                gene_lower = gene.strip().lower()
                if gene_lower in gene_names_lower:
                    idx = gene_names_lower.index(gene_lower)
                    if idx not in indices1:
                        indices1.append(idx)
            
            for gene in pathway2_genes:
                gene_lower = gene.strip().lower()
                if gene_lower in gene_names_lower:
                    idx = gene_names_lower.index(gene_lower)
                    if idx not in indices2:
                        indices2.append(idx)
            
            if not indices1 or not indices2:
                return {"status": "error", "message": "Genes not found in data. Please check gene names match your data."}
            
            # Extract pathway correlation matrices
            pathway1_corr = self.correlation_matrix[np.ix_(indices1, indices1)]
            pathway2_corr = self.correlation_matrix[np.ix_(indices2, indices2)]
            
            # Calculate average correlation vectors
            abs_corr1 = np.abs(pathway1_corr)
            abs_corr2 = np.abs(pathway2_corr)
            np.fill_diagonal(abs_corr1, 0)
            np.fill_diagonal(abs_corr2, 0)
            
            avg_vec1 = np.mean(abs_corr1, axis=1)
            avg_vec2 = np.mean(abs_corr2, axis=1)
            
            # Pad vectors to same length for cosine similarity
            max_len = max(len(avg_vec1), len(avg_vec2))
            vec1_padded = np.pad(avg_vec1, (0, max_len - len(avg_vec1)), 'constant')
            vec2_padded = np.pad(avg_vec2, (0, max_len - len(avg_vec2)), 'constant')
            
            # Calculate cosine similarity
            cosine_sim = 1 - cosine(vec1_padded, vec2_padded)
            
            # Find intersection
            intersection = set(pathway1_genes) & set(pathway2_genes)
            
            return {
                "status": "success",
                "cosine_similarity": float(cosine_sim),
                "pathway1_size": len(pathway1_genes),
                "pathway2_size": len(pathway2_genes),
                "intersection_size": len(intersection),
                "intersection_genes": list(intersection)
            }
            
        except Exception as e:
            return {
                "status": "error",
                "message": f"Error comparing pathways: {str(e)}"
            }
    
    def gene_to_genes(self, single_gene: str, target_genes: List[str]) -> Dict:
        """
        Calculate correlation between a single gene and a group of genes
        
        Args:
            single_gene: Name of the single gene
            target_genes: List of target gene names
            
        Returns:
            Dictionary with correlation results
        """
        if not self.correlation_calculated:
            return {"status": "error", "message": "Correlation matrix not calculated"}
        
        try:
            # Find single gene index (case-insensitive)
            single_gene_lower = single_gene.lower()
            gene_names_lower = [g.lower() for g in self.gene_names]
            
            if single_gene_lower not in gene_names_lower:
                return {"status": "error", "message": f"Gene '{single_gene}' not found in data"}
            
            single_idx = gene_names_lower.index(single_gene_lower)
            
            # Find target gene indices
            target_indices = []
            found_genes = []
            for target_gene in target_genes:
                target_lower = target_gene.lower()
                if target_lower in gene_names_lower:
                    idx = gene_names_lower.index(target_lower)
                    target_indices.append(idx)
                    found_genes.append(self.gene_names[idx])
            
            if not target_indices:
                return {"status": "error", "message": "No target genes found in data"}
            
            # Calculate correlations
            correlations = []
            for idx in target_indices:
                corr_val = self.correlation_matrix[single_idx, idx]
                correlations.append(float(corr_val))
            
            # Create results table
            results = list(zip(found_genes, correlations))
            results.sort(key=lambda x: abs(x[1]), reverse=True)  # Sort by absolute correlation
            
            sorted_genes = [r[0] for r in results]
            sorted_correlations = [r[1] for r in results]
            
            avg_abs_corr = np.mean([abs(c) for c in correlations])
            
            return {
                "status": "success",
                "single_gene": single_gene,
                "target_genes": sorted_genes,
                "correlations": sorted_correlations,
                "avg_abs_correlation": float(avg_abs_corr),
                "n_targets": len(found_genes)
            }
            
        except Exception as e:
            return {
                "status": "error",
                "message": f"Error calculating gene-to-genes correlation: {str(e)}"
            }
    
    def gene_to_pathways(self, single_gene: str, pathway_files: List[str], pathway_genes_list: List[List[str]]) -> Dict:
        """
        Calculate correlation between a single gene and multiple pathways
        
        Args:
            single_gene: Name of the single gene
            pathway_files: List of pathway file names
            pathway_genes_list: List of lists, each containing genes in a pathway
            
        Returns:
            Dictionary with pathway correlation results
        """
        if not self.correlation_calculated:
            return {"status": "error", "message": "Correlation matrix not calculated"}
        
        try:
            # Find single gene index
            single_gene_lower = single_gene.lower()
            gene_names_lower = [g.lower() for g in self.gene_names]
            
            if single_gene_lower not in gene_names_lower:
                return {"status": "error", "message": f"Gene '{single_gene}' not found in data"}
            
            single_idx = gene_names_lower.index(single_gene_lower)
            
            results = []
            for pathway_file, pathway_genes in zip(pathway_files, pathway_genes_list):
                # Find pathway gene indices
                pathway_indices = []
                for gene in pathway_genes:
                    gene_lower = gene.lower()
                    if gene_lower in gene_names_lower:
                        idx = gene_names_lower.index(gene_lower)
                        pathway_indices.append(idx)
                
                if not pathway_indices:
                    continue
                
                # Calculate average correlation to pathway
                pathway_corrs = [self.correlation_matrix[single_idx, idx] for idx in pathway_indices]
                avg_corr = np.mean(pathway_corrs)
                avg_abs_corr = np.mean([abs(c) for c in pathway_corrs])
                
                results.append({
                    "pathway_file": pathway_file,
                    "pathway_size": len(pathway_genes),
                    "genes_found": len(pathway_indices),
                    "avg_correlation": float(avg_corr),
                    "avg_abs_correlation": float(avg_abs_corr)
                })
            
            # Sort by average absolute correlation
            results.sort(key=lambda x: x["avg_abs_correlation"], reverse=True)
            
            return {
                "status": "success",
                "single_gene": single_gene,
                "pathways": results,
                "n_pathways": len(results)
            }
            
        except Exception as e:
            return {
                "status": "error",
                "message": f"Error calculating gene-to-pathways correlation: {str(e)}"
            }
    
    def multi_pathway_analysis(self, pathway_files: List[str], pathway_genes_list: List[List[str]], 
                               sorted_genes: Optional[List[str]] = None, 
                               sorted_correlations: Optional[List[float]] = None,
                               min_genes_threshold: int = 5) -> Dict:
        """
        Multi-pathway analysis with CECI (Correlation-Expression Composite Index) calculation
        
        Args:
            pathway_files: List of pathway file names
            pathway_genes_list: List of lists, each containing genes in a pathway
            sorted_genes: Optional list of sorted gene names (from sorted correlation matrix)
            sorted_correlations: Optional list of sorted correlation scores
            min_genes_threshold: Minimum number of genes in pathway to include
            
        Returns:
            Dictionary with multi-pathway analysis results
        """
        if not self.correlation_calculated:
            return {"status": "error", "message": "Correlation matrix not calculated"}
        
        try:
            gene_names_lower = [g.lower() for g in self.gene_names]
            results = []
            
            # If sorted data provided, use it for PCI_B calculation
            pci_b_dict = {}
            if sorted_genes and sorted_correlations:
                for gene, corr in zip(sorted_genes, sorted_correlations):
                    gene_lower = gene.lower()
                    if gene_lower in gene_names_lower:
                        idx = gene_names_lower.index(gene_lower)
                        pci_b_dict[idx] = float(corr)
            
            for pathway_file, pathway_genes in zip(pathway_files, pathway_genes_list):
                # Find pathway gene indices
                pathway_indices = []
                pathway_genes_lower = [g.lower() for g in pathway_genes]
                
                for gene in pathway_genes:
                    gene_lower = gene.lower()
                    if gene_lower in gene_names_lower:
                        idx = gene_names_lower.index(gene_lower)
                        pathway_indices.append(idx)
                
                if len(pathway_indices) < min_genes_threshold:
                    continue
                
                # Calculate PCI_A (internal correlation within pathway)
                pathway_corr = self.correlation_matrix[np.ix_(pathway_indices, pathway_indices)]
                abs_pathway_corr = np.abs(pathway_corr)
                np.fill_diagonal(abs_pathway_corr, 0)
                
                # Average absolute correlation within pathway
                sum_abs_correlations = np.sum(abs_pathway_corr, axis=1)
                avg_abs_correlation = sum_abs_correlations / (len(pathway_indices) - 1)
                pci_a = float(np.mean(avg_abs_correlation))
                
                # Calculate PCI_B (correlation extracted from sorted dataset)
                pci_b = None
                if pci_b_dict:
                    matching_corrs = [pci_b_dict.get(idx, 0.0) for idx in pathway_indices if idx in pci_b_dict]
                    if matching_corrs:
                        pci_b = float(np.mean(matching_corrs))
                
                # Calculate PAI (Pathway Activation Index)
                ratio_deg_to_total = len(pathway_indices) / len(pathway_genes) if pathway_genes else 0
                pai = ratio_deg_to_total
                
                # Calculate CECI (Correlation-Expression Composite Index)
                if pci_b is not None:
                    ceci = ratio_deg_to_total * pci_b * 100
                else:
                    ceci = ratio_deg_to_total * pci_a * 100
                
                # Calculate Z-score (using default values from MATLAB code)
                z_score = (ceci - 7.908) / 2.0605 if ceci is not None else None
                
                results.append({
                    "pathway_file": pathway_file,
                    "total_genes_in_pathway": len(pathway_genes),
                    "genes_found_in_set": len(pathway_indices),
                    "pai": float(pai),
                    "pci_a": pci_a,
                    "pci_b": pci_b,
                    "ceci": float(ceci) if ceci is not None else None,
                    "z_score": float(z_score) if z_score is not None else None
                })
            
            # Sort by CECI
            results.sort(key=lambda x: x["ceci"] if x["ceci"] is not None else -float('inf'), reverse=True)
            
            return {
                "status": "success",
                "pathways": results,
                "n_pathways": len(results)
            }
            
        except Exception as e:
            return {
                "status": "error",
                "message": f"Error in multi-pathway analysis: {str(e)}"
            }
    
    def create_venn_diagram(self, pathway1_genes: List[str], pathway2_genes: List[str]) -> Dict:
        """
        Create Venn diagram for two pathways
        
        Args:
            pathway1_genes: List of genes in first pathway
            pathway2_genes: List of genes in second pathway
            
        Returns:
            Dictionary with Venn diagram image and statistics
        """
        try:
            from matplotlib_venn import venn2
            
            # Convert to sets (case-insensitive)
            set1 = set([g.lower() for g in pathway1_genes])
            set2 = set([g.lower() for g in pathway2_genes])
            
            # Find intersection
            intersection = set1 & set2
            only1 = set1 - set2
            only2 = set2 - set1
            
            # Calculate sizes for visualization
            num_genes1 = len(pathway1_genes)
            num_genes2 = len(pathway2_genes)
            num_overlap = len(intersection)
            
            # Create figure
            fig, ax = plt.subplots(figsize=(10, 8))
            
            # Create Venn diagram
            v = venn2([set1, set2], set_labels=('Pathway 1', 'Pathway 2'), ax=ax)
            
            # Customize colors
            if v:
                v.get_patch_by_id('10').set_color('red')
                v.get_patch_by_id('10').set_alpha(0.5)
                v.get_patch_by_id('01').set_color('blue')
                v.get_patch_by_id('01').set_alpha(0.5)
                v.get_patch_by_id('11').set_color('purple')
                v.get_patch_by_id('11').set_alpha(0.5)
            
            # Add title
            title = f'Venn Diagram: {num_genes1} genes vs {num_genes2} genes | Overlap: {num_overlap}'
            ax.set_title(title, fontsize=14, fontweight='bold')
            
            plt.tight_layout()
            
            # Convert to base64
            buffer = io.BytesIO()
            plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
            buffer.seek(0)
            image_base64 = base64.b64encode(buffer.getvalue()).decode()
            plt.close()
            
            # Get original gene names for intersection
            intersection_original = []
            pathway1_lower = [g.lower() for g in pathway1_genes]
            for gene in pathway1_genes:
                if gene.lower() in intersection:
                    intersection_original.append(gene)
            
            return {
                "status": "success",
                "image_base64": image_base64,
                "pathway1_size": num_genes1,
                "pathway2_size": num_genes2,
                "intersection_size": num_overlap,
                "intersection_genes": intersection_original,
                "only_pathway1": list(only1),
                "only_pathway2": list(only2)
            }
            
        except ImportError:
            # Fallback if matplotlib_venn is not available
            try:
                # Simple Venn diagram using circles
                fig, ax = plt.subplots(figsize=(10, 8))
                
                set1 = set([g.lower() for g in pathway1_genes])
                set2 = set([g.lower() for g in pathway2_genes])
                intersection = set1 & set2
                
                num_genes1 = len(pathway1_genes)
                num_genes2 = len(pathway2_genes)
                num_overlap = len(intersection)
                
                # Calculate circle sizes and positions
                radius1 = np.sqrt(num_genes1)
                radius2 = np.sqrt(num_genes2)
                radius_max = max(radius1, radius2)
                
                # Position circles
                overlap_offset = radius1 + radius2 - np.sqrt(num_overlap) if num_overlap > 0 else radius1 + radius2
                
                # Draw circles
                circle1 = plt.Circle((0, 0), radius1, color='red', alpha=0.5, label=f'Pathway 1: {num_genes1} genes')
                circle2 = plt.Circle((overlap_offset, 0), radius2, color='blue', alpha=0.5, label=f'Pathway 2: {num_genes2} genes')
                
                ax.add_patch(circle1)
                ax.add_patch(circle2)
                
                ax.set_xlim(-radius_max * 1.5, (overlap_offset + radius_max) * 1.5)
                ax.set_ylim(-radius_max * 1.5, radius_max * 1.5)
                ax.set_aspect('equal')
                ax.axis('off')
                
                title = f'Venn Diagram: {num_genes1} genes vs {num_genes2} genes | Overlap: {num_overlap}'
                ax.set_title(title, fontsize=14, fontweight='bold')
                ax.legend(loc='upper right')
                
                plt.tight_layout()
                
                buffer = io.BytesIO()
                plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
                buffer.seek(0)
                image_base64 = base64.b64encode(buffer.getvalue()).decode()
                plt.close()
                
                intersection_original = [g for g in pathway1_genes if g.lower() in intersection]
                
                return {
                    "status": "success",
                    "image_base64": image_base64,
                    "pathway1_size": num_genes1,
                    "pathway2_size": num_genes2,
                    "intersection_size": num_overlap,
                    "intersection_genes": intersection_original,
                    "only_pathway1": list(set1 - set2),
                    "only_pathway2": list(set2 - set1)
                }
            except Exception as e:
                return {
                    "status": "error",
                    "message": f"Error creating Venn diagram: {str(e)}"
                }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Error creating Venn diagram: {str(e)}"
            }
    
    def create_network_graph(self, pathway_genes: Optional[List[str]] = None, 
                            threshold: float = 0.75, plot_type: str = '2D') -> Dict:
        """
        Create network graph from correlation matrix
        
        Args:
            pathway_genes: Optional list of genes to filter (if None, use all genes)
            threshold: Correlation threshold for edges
            plot_type: '2D' or '3D'
            
        Returns:
            Dictionary with network graph image and statistics
        """
        if not self.correlation_calculated:
            return {"status": "error", "message": "Correlation matrix not calculated"}
        
        try:
            import networkx as nx
            
            # Filter genes if pathway provided
            if pathway_genes:
                gene_names_lower = [g.lower() for g in self.gene_names]
                pathway_indices = []
                pathway_gene_names = []
                
                for gene in pathway_genes:
                    gene_lower = gene.lower()
                    if gene_lower in gene_names_lower:
                        idx = gene_names_lower.index(gene_lower)
                        pathway_indices.append(idx)
                        pathway_gene_names.append(self.gene_names[idx])
                
                if not pathway_indices:
                    return {"status": "error", "message": "No pathway genes found in data"}
                
                # Extract submatrix
                corr_submatrix = self.correlation_matrix[np.ix_(pathway_indices, pathway_indices)]
                gene_names = pathway_gene_names
            else:
                corr_submatrix = self.correlation_matrix
                gene_names = self.gene_names
            
            # Create graph from correlation matrix
            abs_corr = np.abs(corr_submatrix)
            abs_corr[abs_corr < threshold] = 0  # Filter by threshold
            
            # Create NetworkX graph
            G = nx.Graph()
            
            # Add nodes
            for i, gene in enumerate(gene_names):
                G.add_node(gene)
            
            # Add edges
            for i in range(len(gene_names)):
                for j in range(i + 1, len(gene_names)):
                    if abs_corr[i, j] >= threshold:
                        G.add_edge(gene_names[i], gene_names[j], weight=abs_corr[i, j])
            
            # Calculate node degrees
            degrees = dict(G.degree())
            
            # Create figure
            if plot_type == '3D':
                from mpl_toolkits.mplot3d import Axes3D
                fig = plt.figure(figsize=(12, 10))
                ax = fig.add_subplot(111, projection='3d')
                
                # Generate 3D positions on sphere
                num_nodes = len(gene_names)
                indices = np.arange(num_nodes)
                phi = np.arccos(1 - 2 * (indices + 0.5) / num_nodes)
                theta = np.pi * (1 + np.sqrt(5)) * indices
                
                pos_3d = {}
                for i, gene in enumerate(gene_names):
                    pos_3d[gene] = (
                        np.cos(theta[i]) * np.sin(phi[i]),
                        np.sin(theta[i]) * np.sin(phi[i]),
                        np.cos(phi[i])
                    )
                
                # Draw edges
                for edge in G.edges():
                    x_coords = [pos_3d[edge[0]][0], pos_3d[edge[1]][0]]
                    y_coords = [pos_3d[edge[0]][1], pos_3d[edge[1]][1]]
                    z_coords = [pos_3d[edge[0]][2], pos_3d[edge[1]][2]]
                    ax.plot(x_coords, y_coords, z_coords, 'b-', alpha=0.3, linewidth=0.5)
                
                # Draw nodes
                max_degree = max(degrees.values()) if degrees else 1
                node_sizes = [10 + 1.5 * ((degrees[gene] / max_degree) ** 10 * 50) if max_degree > 0 else 10
                             for gene in gene_names]
                xs = [pos_3d[gene][0] for gene in gene_names]
                ys = [pos_3d[gene][1] for gene in gene_names]
                zs = [pos_3d[gene][2] for gene in gene_names]
                
                ax.scatter(xs, ys, zs, s=node_sizes, c='red', alpha=0.7)
                
                # Add labels
                for gene in gene_names[:20]:  # Limit labels
                    ax.text(pos_3d[gene][0], pos_3d[gene][1], pos_3d[gene][2], 
                           gene, fontsize=8)
                
                ax.set_title(f'3D Network Graph (Threshold: {threshold})', fontsize=14, fontweight='bold')
                
            else:  # 2D
                fig, ax = plt.subplots(figsize=(12, 10))
                
                # Generate 2D positions on circle
                num_nodes = len(gene_names)
                theta = np.linspace(0, 2 * np.pi, num_nodes + 1)[:-1]
                
                pos_2d = {}
                for i, gene in enumerate(gene_names):
                    pos_2d[gene] = (np.cos(theta[i]), np.sin(theta[i]))
                
                # Draw edges
                for edge in G.edges():
                    x_coords = [pos_2d[edge[0]][0], pos_2d[edge[1]][0]]
                    y_coords = [pos_2d[edge[0]][1], pos_2d[edge[1]][1]]
                    ax.plot(x_coords, y_coords, 'b-', alpha=0.3, linewidth=0.5)
                
                # Draw nodes
                max_degree = max(degrees.values()) if degrees else 1
                node_sizes = [10 + 1.5 * ((degrees[gene] / max_degree) ** 10 * 50) if max_degree > 0 else 10
                             for gene in gene_names]
                xs = [pos_2d[gene][0] for gene in gene_names]
                ys = [pos_2d[gene][1] for gene in gene_names]
                
                ax.scatter(xs, ys, s=node_sizes, c='red', alpha=0.7)
                
                # Add labels
                for gene in gene_names[:30]:  # Limit labels
                    ax.text(pos_2d[gene][0], pos_2d[gene][1], gene, 
                           fontsize=8, ha='center', va='center')
                
                ax.set_xlim(-1.5, 1.5)
                ax.set_ylim(-1.5, 1.5)
                ax.set_aspect('equal')
                ax.axis('off')
                ax.set_title(f'2D Network Graph (Threshold: {threshold})', fontsize=14, fontweight='bold')
            
            plt.tight_layout()
            
            # Convert to base64
            buffer = io.BytesIO()
            plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
            buffer.seek(0)
            image_base64 = base64.b64encode(buffer.getvalue()).decode()
            plt.close()
            
            # Prepare degree statistics
            degree_list = [{"gene": gene, "degree": degrees[gene]} for gene in gene_names]
            degree_list.sort(key=lambda x: x["degree"], reverse=True)
            
            return {
                "status": "success",
                "image_base64": image_base64,
                "n_nodes": len(gene_names),
                "n_edges": G.number_of_edges(),
                "threshold": threshold,
                "plot_type": plot_type,
                "node_degrees": degree_list[:50]  # Top 50
            }
            
        except ImportError:
            return {
                "status": "error",
                "message": "NetworkX library required for network analysis. Install with: pip install networkx"
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Error creating network graph: {str(e)}"
            }


class TwoSetCorrelation:
    """Two Dataset Correlation Analysis (TwoSetCorrTool equivalent)"""
    
    def __init__(self):
        self.data_a = None
        self.data_b = None
        self.gene_names_a = None
        self.gene_names_b = None
        self.correlation_matrix = None
        
    def load_data_a(self, file_path: str) -> Dict:
        """Load first dataset"""
        return self._load_data(file_path, 'a')
    
    def load_data_b(self, file_path: str) -> Dict:
        """Load second dataset"""
        return self._load_data(file_path, 'b')
    
    def _load_data(self, file_path: str, dataset: str) -> Dict:
        """Internal method to load data"""
        try:
            if file_path.endswith('.xlsx') or file_path.endswith('.xls'):
                df = pd.read_excel(file_path)
            elif file_path.endswith('.csv'):
                df = pd.read_csv(file_path)
            else:
                raise ValueError("Unsupported file format")
            
            # Extract gene names (columns except first)
            gene_names = [col for col in df.columns[1:]]
            data = df.iloc[:, 1:].values
            data = pd.DataFrame(data).apply(pd.to_numeric, errors='coerce').values
            
            if dataset == 'a':
                self.data_a = data
                self.gene_names_a = gene_names
            else:
                self.data_b = data
                self.gene_names_b = gene_names
            
            return {
                "status": "success",
                "message": f"Data {dataset.upper()} loaded: {data.shape[0]} samples x {data.shape[1]} genes"
            }
            
        except Exception as e:
            return {"status": "error", "message": f"Error loading data: {str(e)}"}
    
    def calculate_correlation(self) -> Dict:
        """Calculate pairwise correlation between two datasets"""
        if self.data_a is None or self.data_b is None:
            return {"status": "error", "message": "Both datasets must be loaded"}
        
        # Check if datasets have the same number of samples
        if self.data_a.shape[0] != self.data_b.shape[0]:
            return {
                "status": "error", 
                "message": f"Datasets must have the same number of samples. Data A: {self.data_a.shape[0]}, Data B: {self.data_b.shape[0]}"
            }
        
        try:
            # Calculate correlation matrix between datasets
            # Shape: (genes_a x genes_b)
            correlation_matrix = np.zeros((len(self.gene_names_a), len(self.gene_names_b)))
            
            for i, gene_a in enumerate(self.gene_names_a):
                for j, gene_b in enumerate(self.gene_names_b):
                    # Calculate correlation between gene_a across samples vs gene_b across samples
                    # Check for valid data (no constant values)
                    gene_a_data = self.data_a[:, i]
                    gene_b_data = self.data_b[:, j]
                    
                    # Skip if either gene has constant values (std = 0)
                    if np.std(gene_a_data) == 0 or np.std(gene_b_data) == 0:
                        correlation_matrix[i, j] = 0.0
                        continue
                    
                    corr_val, _ = pearsonr(gene_a_data, gene_b_data)
                    correlation_matrix[i, j] = corr_val if not np.isnan(corr_val) else 0.0
            
            self.correlation_matrix = correlation_matrix
            
            return {
                "status": "success",
                "message": "Correlation matrix calculated",
                "matrix_size": correlation_matrix.shape,
                "mean_correlation": float(np.mean(correlation_matrix)),
                "max_correlation": float(np.max(correlation_matrix)),
                "min_correlation": float(np.min(correlation_matrix))
            }
            
        except Exception as e:
            return {"status": "error", "message": f"Error calculating correlation: {str(e)}"}
    
    def sort_correlation(self, method: str = 'magnitude') -> Dict:
        """Sort correlation matrix"""
        if self.correlation_matrix is None:
            return {"status": "error", "message": "Correlation matrix not calculated"}
        
        try:
            abs_corr = np.abs(self.correlation_matrix)
            
            if method == 'magnitude' or method == 'mean':
                # Sort by average correlation for each gene pair
                gene_a_scores = np.mean(abs_corr, axis=1)
                gene_b_scores = np.mean(abs_corr, axis=0)
            elif method == 'max':
                gene_a_scores = np.max(abs_corr, axis=1)
                gene_b_scores = np.max(abs_corr, axis=0)
            else:
                gene_a_scores = np.mean(abs_corr, axis=1)
                gene_b_scores = np.mean(abs_corr, axis=0)
            
            sorted_indices_a = np.argsort(gene_a_scores)[::-1]
            sorted_indices_b = np.argsort(gene_b_scores)[::-1]
            
            sorted_matrix = self.correlation_matrix[sorted_indices_a][:, sorted_indices_b]
            sorted_genes_a = [self.gene_names_a[i] for i in sorted_indices_a]
            sorted_genes_b = [self.gene_names_b[i] for i in sorted_indices_b]
            
            return {
                "status": "success",
                "sorted_matrix": sorted_matrix.tolist(),
                "sorted_genes_a": sorted_genes_a,
                "sorted_genes_b": sorted_genes_b
            }
            
        except Exception as e:
            return {"status": "error", "message": f"Error sorting correlation: {str(e)}"}
    
    def create_heatmap(self, sorted: bool = False, figsize: Tuple[int, int] = (12, 10)) -> str:
        """Create heatmap of correlation matrix"""
        if self.correlation_matrix is None:
            raise ValueError("Correlation matrix not calculated")
        
        try:
            if sorted:
                sort_result = self.sort_correlation()
                if sort_result["status"] == "error":
                    raise ValueError(sort_result["message"])
                matrix = np.array(sort_result["sorted_matrix"])
                gene_names_a = sort_result["sorted_genes_a"][:50]
                gene_names_b = sort_result["sorted_genes_b"][:50]
            else:
                matrix = self.correlation_matrix
                gene_names_a = self.gene_names_a[:50]
                gene_names_b = self.gene_names_b[:50]
            
            fig, ax = plt.subplots(figsize=figsize)
            
            # Limit matrix size for display (max 100x100 for readability)
            max_display = 100
            if matrix.shape[0] > max_display or matrix.shape[1] > max_display:
                display_matrix = matrix[:max_display, :max_display]
                display_genes_a = gene_names_a[:max_display]
                display_genes_b = gene_names_b[:max_display]
                ax.set_title(f'Two-Dataset Correlation Heatmap (showing first {max_display} genes)', 
                           fontsize=14, fontweight='bold')
            else:
                display_matrix = matrix
                display_genes_a = gene_names_a
                display_genes_b = gene_names_b
                ax.set_title('Two-Dataset Correlation Heatmap', fontsize=14, fontweight='bold')
            
            sns.heatmap(
                display_matrix,
                xticklabels=display_genes_b if len(display_genes_b) <= 50 else False,
                yticklabels=display_genes_a if len(display_genes_a) <= 50 else False,
                cmap='coolwarm',
                center=0,
                vmin=-1,
                vmax=1,
                square=True,
                fmt='.2f',
                cbar_kws={'label': 'Correlation Coefficient'},
                ax=ax
            )
            ax.set_xlabel('Dataset B Genes', fontsize=12)
            ax.set_ylabel('Dataset A Genes', fontsize=12)
            plt.xticks(rotation=45, ha='right')
            plt.yticks(rotation=0)
            plt.tight_layout()
            
            buffer = io.BytesIO()
            plt.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
            buffer.seek(0)
            image_base64 = base64.b64encode(buffer.getvalue()).decode()
            plt.close()
            
            return image_base64
            
        except Exception as e:
            plt.close('all')
            raise ValueError(f"Error creating heatmap: {str(e)}")

